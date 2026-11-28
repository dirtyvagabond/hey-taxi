import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, Input } from '@hey-taxi/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameHost } from '../src/host';
import { walletKeyOf } from '../src/ledger';
import { describe as describeEntry, gameDetail, howDestroyed, listGames } from '../src/review';
import { GameSaver } from '../src/saver';
import { GameSession } from '../src/session';
import { SaveStore } from '../src/store';
import { WORLD_LEVELS } from '../src/world';
import { teleportTo, TEST_ACCOUNT } from './helpers';

let dir: string;
let stores: SaveStore[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hey-taxi-review-'));
  stores = [];
});
afterEach(async () => {
  for (const st of stores) await st.shutdown().catch(() => null);
  rmSync(dir, { recursive: true, force: true });
});

function play(s: GameSession, ticks: number, input = (i: number) => (i % 900 === 700 ? Input.FIRE : 0)): void {
  for (let i = 0; i < ticks && s.running; i++) {
    s.setInput(input(i));
    s.tick();
  }
}

/** A busy server: work, a teleport, a destroyed rival, a lost taxi and a fresh one. */
async function busyServer() {
  const st = new SaveStore(dir);
  stores.push(st);
  const acct = await st.createOrSelectAccount(TEST_ACCOUNT.name);
  const session = new GameSession({ seed: 31 });
  session.initServer('Review City');
  const saver = new GameSaver(st, session);
  await saver.create();
  const host = new GameHost(session, 'test', st);
  host.saver = saver;
  host.activeAccount = acct;
  session.joinAccount(acct);
  await saver.checkpoint('join');
  host.command('advance');
  play(session, 60 * 60);
  teleportTo(session, WORLD_LEVELS[1]);
  play(session, 60 * 60);
  const rival = session.sim.taxis.find((t) => t.npc && t.status === 'flying');
  if (rival) {
    const pad = session.sim.level.pads.find((p) => p.kind === 'pad')!;
    Object.assign(rival, { hp: 1, x: pad.x + pad.w / 2, y: pad.y - 40, vx: 0, vy: 400, passengerId: -1 });
    session.sim.passengers = session.sim.passengers.filter((p) => p.taxiId !== rival.id);
    play(session, 30);
  }
  const myPad = session.sim.level.pads[0]!;
  Object.assign(session.player!, {
    status: 'flying',
    padIndex: -1,
    hp: 1,
    damageGraceTicks: 0,
    gearDown: true,
    gear: 1,
    x: myPad.x + myPad.w / 2,
    y: myPad.y - 30,
    vx: 0,
    vy: 400,
  });
  play(session, 10 + 130);
  host.command('respawn');
  play(session, 60 * 5);
  session.leaveAccount();
  await saver.checkpoint('menu');
  return { st, session, acct };
}

describe('Server review data', () => {
  it('the list shows each server with name, status, time, account balance and taxis lost', { timeout: 15000 }, async () => {
    const { st, session, acct } = await busyServer();
    const [g] = await listGames(st, acct.accountId);
    expect(g).toMatchObject({ gameId: session.serverId, name: 'Review City', status: 'suspended', taxisLost: 1, playerCount: 1 });
    expect(g!.seconds).toBeGreaterThan(120);
  });

  it('overview and taxi totals reconcile with the ledger; starting funds are granted once per server', { timeout: 15000 }, async () => {
    const { st, session, acct } = await busyServer();
    const d = await gameDetail(st, session.serverId, acct.accountId);
    const ledger = session.ledger.entries;
    expect(d.entries.map((e) => e.seq)).toEqual(ledger.map((e) => e.seq));
    const running: Record<string, number> = {};
    for (const e of d.entries) {
      const key = walletKeyOf(e);
      running[key] = (running[key] ?? 0) + e.amount;
      expect(e.balance).toBe(running[key]);
    }
    for (const t of d.taxis) {
      expect(t.reconciled).toBe(true);
      if (!t.player) expect(t.opening + t.income - t.expenses + t.adjustments).toBe(t.balance);
    }
    const o = d.overview;
    const mine = d.taxis.filter((t) => t.player);
    expect(mine.map((t) => t.status)).toEqual(['destroyed', 'active']);
    expect(o.accountName).toBe(acct.name);
    expect(o.taxisUsed).toBe(2);
    // Starting funds granted ONCE when joining the server (not duplicated on respawn).
    expect(o.startingFunds).toBe(Math.round(DEFAULT_CONFIG.startMoney * 100));
    expect(o.earned).toBe(o.fareRevenue + o.tips);
    expect(o.earned).toBe(mine.reduce((n, t) => n + t.income, 0));
    expect(o.expenses).toBe(mine.reduce((n, t) => n + t.expenses, 0));
    expect(o.netProfit).toBe(o.earned - o.expenses + o.adjustments);
    expect(o.endingCash).toBe(session.player!.cents);
    expect(o.startingFunds + o.netProfit).toBe(o.endingCash);
    expect(o.deaths).toEqual([expect.objectContaining({ cause: 'hardLanding' })]);
  });

  it('taxis: living and destroyed, with names, proficiency and their life events', async () => {
    const { st, session, acct } = await busyServer();
    const d = await gameDetail(st, session.serverId, acct.accountId);
    for (const t of d.taxis) {
      expect(t.name).toBeTruthy();
      expect(t.proficiency).toBeGreaterThanOrEqual(65);
      expect(t.proficiency).toBeLessThanOrEqual(95);
      expect(t.events[0]).toMatchObject({ kind: 'started' });
    }
    const first = d.taxis[0]!;
    expect(first.events.map((e) => e.kind)).toEqual(['started', 'teleported', 'destroyed']);
    expect(first.events[1]!.text).toBe('Teleported Santa Monica → First Shift');
    expect(first.events[2]!.text).toBe('Destroyed: landed too hard');
    expect(first.destroyedBy).toBe('Landed too hard');
    for (const t of d.taxis) if (t.status !== 'destroyed') expect(t.destroyedBy).toBeUndefined();
    if (session.deadRivals.length) {
      const dead = d.taxis.find((t) => t.taxiId === session.deadRivals[0])!;
      expect(dead).toMatchObject({ status: 'destroyed', player: false });
      expect(dead.events.at(-1)!.kind).toBe('destroyed');
    }
  });

  it('a destruction names whose missile it was, or who it collided with', () => {
    const e = { seq: 1, gameId: 'g', taxiId: 'p1', locale: WORLD_LEVELS[0], tick: 0, category: 'destroyed' as const, amount: 0, balance: 0 };
    const names = (id: string) => ({ npc3: 'Rival 3', p1: 'TestPilot' })[id] ?? id;
    expect(describeEntry({ ...e, ref: 'crash:missile:npc3' }, names)).toBe("Destroyed: hit by Rival 3's missile");
    expect(describeEntry({ ...e, ref: 'crash:body:npc3' }, names)).toBe('Destroyed: hit something (collided with Rival 3)');
    expect(describeEntry({ ...e, ref: 'crash:missile' }, names)).toBe('Destroyed: hit by a missile');
    expect(howDestroyed('crash:missile:npc3', names)).toBe("hit by Rival 3's missile");
  });

  it('every entry has a readable description, a taxi name and a locale name', async () => {
    const { st, session, acct } = await busyServer();
    const d = await gameDetail(st, session.serverId, acct.accountId);
    const names = [
      'Santa Monica',
      'First Shift',
      'Midtown',
      'Skyline',
      'Frostbite Pass',
      'Singularity Station',
      'Polarity Yard',
      'Gridlock Vault',
      'Overdrive Canyon',
    ];
    for (const e of d.entries) {
      expect(e.description).not.toMatch(/undefined|\w:\w/);
      expect(e.taxiName).toBeTruthy();
      expect(names).toContain(e.localeName);
    }
    expect(d.entries.find((e) => e.category === 'opening')!.description).toBe('Starting funds (joined server)');
    expect(d.entries.find((e) => e.category === 'spawn')!.description).toBe('Replacement taxi issued (account balance carried over)');
    const fare = d.entries.find((e) => e.category === 'fare');
    if (fare) expect(fare.description).toMatch(/^Fare, \w+ \w+$/);
  });
});
