import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, Input, TAXI_SKINS, type TaxiSkin } from '@hey-taxi/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec';
import { GameHost } from '../src/host';
import { gameDetail, listGames, listServers } from '../src/review';
import { GameSaver } from '../src/saver';
import { GameSession, type GameSave } from '../src/session';
import { SaveStore } from '../src/store';
import { WORLD_LEVELS } from '../src/world';
import { startedSession, teleportTo, TEST_ACCOUNT, TEST_ACCOUNT_2 } from './helpers';

function play(s: GameSession, ticks: number, input = 0): void {
  for (let i = 0; i < ticks && s.running; i++) {
    s.setInput(input);
    s.tick();
  }
}

/** Fly the rival into a pad at its last hull point (it is destroyed). */
function destroyRival(s: GameSession): string {
  play(s, Math.round((DEFAULT_CONFIG.npcArrivalDelay + 1) * 60));
  const npc = s.sim.taxis.find((t) => t.npc && t.status === 'flying')!;
  const pad = s.sim.level.pads.find((p) => p.label === '3')!;
  Object.assign(npc, { hp: 1, x: pad.x + pad.w / 2, y: pad.y - 40, vx: 0, vy: 400, passengerId: -1 });
  s.sim.passengers = s.sim.passengers.filter((p) => p.taxiId !== npc.id);
  play(s, 60);
  expect(npc.status).toBe('destroyed');
  return npc.id;
}

/** Force a fatal hard landing for the player's current taxi. */
function crashPlayer(s: GameSession): void {
  const pad = s.sim.level.pads[0]!;
  Object.assign(s.player!, {
    status: 'flying',
    padIndex: -1,
    hp: 1,
    damageGraceTicks: 0,
    gearDown: true,
    gear: 1,
    x: pad.x + pad.w / 2,
    y: pad.y - 30,
    vx: 0,
    vy: 400,
  });
  play(s, 10);
  expect(s.player!.status).toBe('destroyed');
}

describe('permanent death & persistent account balance', () => {
  it('a fatal crash destroys the taxi; after the explosion the world waits with retained account balance', () => {
    const s = startedSession();
    play(s, 30);
    expect(s.player!.status).toBe('landed');
    crashPlayer(s);
    expect(s.player!.status).toBe('destroyed');
    expect(s.mode).toBe('playing');
    expect(s.dying).toMatchObject({ cause: 'hardLanding' });
    const t0 = s.sim.tick;
    play(s, 60);
    expect(s.sim.tick).toBe(t0 + 60);
    play(s, 70);
    expect(s.mode).toBe('destroyed');
    expect(s.running).toBe(false);
    expect(s.card).toMatchObject({
      kind: 'destroyed',
      taxiNumber: 1,
      accountCents: 10000,
      death: { cause: 'hardLanding', levelName: 'First Shift' },
    });
    const tick = s.sim.tick;
    play(s, 600, Input.UP);
    expect(s.sim.tick).toBe(tick);
  });

  it('shot down: the death record names whose missile it was', () => {
    const s = startedSession();
    play(s, Math.round((DEFAULT_CONFIG.npcArrivalDelay + 2) * 60));
    const npc = s.sim.taxis.find((t) => t.npc && t.status === 'flying')!;
    Object.assign(s.player!, { status: 'flying', padIndex: -1, hp: 1, flares: 0, y: s.player!.y - 60, vx: 0, vy: 0 });
    s.sim.missiles.push({
      id: s.sim.nextMissileId++,
      ownerId: npc.id,
      x: s.player!.x,
      y: s.player!.y,
      vx: 0,
      vy: 100,
      targetId: s.player!.id,
      life: 60,
      fallTicks: 0,
      decoyId: null,
      spoofed: false,
      reactions: {},
    });
    play(s, 1);
    expect(s.player!.status).toBe('destroyed');
    expect(s.dying).toMatchObject({ cause: 'missile', byTaxiId: npc.id });
    play(s, 130);
    expect(s.currentPlayer!.deaths.at(-1)).toMatchObject({ cause: 'missile', byTaxiId: npc.id, byName: s.world.nameOf(npc.id) });
    expect(s.ledger.entries.at(-1)).toMatchObject({ category: 'destroyed', ref: `crash:missile:${npc.id}` });
  });

  it('a fresh taxi carries the account balance (no new $100 grant) and gets full fuel/hull/kit in First Shift', () => {
    const s = startedSession(8);
    play(s, 60 * 20);
    teleportTo(s, WORLD_LEVELS[1]);
    Object.assign(s.player!, { missiles: 7, flares: 0 });
    s.debugPatch(s.playerId, { cents: 25000 });
    play(s, 60 * 10);
    const worldTick = s.worldTick;
    const rivals = Object.keys(s.world.taxis).filter((id) => s.world.taxis[id]!.npc);
    crashPlayer(s);
    play(s, 130);
    expect(s.mode).toBe('destroyed');
    expect(s.card).toMatchObject({ kind: 'destroyed', accountCents: 25000 });
    const old = s.playerId;
    s.command('respawn');
    expect(s.mode).toBe('playing');
    expect(s.playerId).not.toBe(old);
    expect(s.levelId).toBe(WORLD_LEVELS[0]);
    const C = s.config;
    expect(s.player).toMatchObject({
      status: 'landed',
      fuel: C.fuelMax,
      hp: C.taxiMaxHp,
      missiles: C.startMissiles,
      flares: C.startFlares,
      cents: 25000,
    });
    play(s, 1);
    // Replacement taxi records a zero-cent spawn entry, preserving exact account balance!
    expect(s.player!.cents).toBe(25000);
    expect(s.currentPlayer!.cents).toBe(25000);
    expect(s.ledger.balanceOfAccount(TEST_ACCOUNT.accountId)).toBe(25000);
    expect(s.ledger.entries.filter((e) => e.taxiId === s.playerId)).toEqual([
      expect.objectContaining({ accountId: TEST_ACCOUNT.accountId, category: 'spawn', amount: 0, balance: 25000, locale: WORLD_LEVELS[0] }),
    ]);
    expect(s.world.taxi(old)).toMatchObject({ status: 'destroyed', cents: 25000 });
    expect(s.worldTick).toBeGreaterThan(worldTick);
    expect(Object.keys(s.world.taxis).filter((id) => s.world.taxis[id]!.npc)).toEqual(expect.arrayContaining(rivals));
    expect(s.world.taxis[s.playerId]!.name).toBe(`${TEST_ACCOUNT.name} #2`);
    expect(
      s.ledger.mismatches(
        s.world.locales.flatMap((l) => l.sim.taxis),
        { [TEST_ACCOUNT.accountId]: s.currentPlayer!.cents },
      ),
    ).toEqual([]);
  });

  it('dying with $0 keeps $0 on respawn (still gets full fuel/hull/kit)', () => {
    const s = startedSession(3);
    play(s, 2);
    s.debugPatch(s.playerId, { cents: 0 });
    crashPlayer(s);
    play(s, 130);
    expect(s.mode).toBe('destroyed');
    expect(s.card).toMatchObject({ kind: 'destroyed', accountCents: 0 });
    s.command('respawn');
    play(s, 1);
    expect(s.player!.cents).toBe(0);
    expect(s.player!.fuel).toBe(s.config.fuelMax);
    expect(s.currentPlayer!.cents).toBe(0);
  });

  it('from the destroyed card: leaving to server menu and rejoining returns to the destroyed card', () => {
    const s = startedSession();
    crashPlayer(s);
    play(s, 130);
    s.leaveAccount();
    expect(s.mode).toBe('menu');
    s.joinAccount(TEST_ACCOUNT);
    expect(s.mode).toBe('destroyed');
    s.command('respawn');
    expect(s.mode).toBe('playing');
  });

  it('multiple accounts on the same server have independent balances and safely stash offline taxis', () => {
    const s = startedSession(12, { account: TEST_ACCOUNT });
    play(s, 10);
    s.debugPatch(s.playerId, { cents: 33300 });
    const p1TaxiId = s.playerId;
    s.leaveAccount();

    // Second account joins the same server: Account 1's taxi is stashed safely.
    s.joinAccount(TEST_ACCOUNT_2);
    expect(s.mode).toBe('intro');
    s.command('advance');
    play(s, 60);
    expect(s.player!.cents).toBe(10000);
    expect(s.players[TEST_ACCOUNT.accountId]!.stashedTaxi).not.toBeNull();
    expect(s.world.taxi(p1TaxiId)).toBeUndefined(); // stashed, not in live sim

    // Account 1 rejoins: its taxi is restored with its exact balance!
    s.leaveAccount();
    s.joinAccount(TEST_ACCOUNT);
    expect(s.playerId).toBe(p1TaxiId);
    expect(s.player!.cents).toBe(33300);
    expect(s.players[TEST_ACCOUNT.accountId]!.stashedTaxi).toBeNull();
  });

  it('a destroyed rival never returns, wherever the player goes', () => {
    const s = startedSession(4);
    const dead = destroyRival(s);
    const cents = s.sim.taxis.find((t) => t.id === dead)!.cents;
    play(s, 60 * 120);
    expect(s.sim.taxis.find((t) => t.id === dead)!.status).toBe('destroyed');
    teleportTo(s, WORLD_LEVELS[1]);
    play(s, 60 * 30);
    teleportTo(s, WORLD_LEVELS[0]);
    expect(s.world.taxi(dead)!.status).toBe('destroyed');
    const active = s.world.locales.flatMap((l) => l.sim.taxis).filter((t) => t.status !== 'destroyed');
    expect(active.map((t) => t.id)).not.toContain(dead);
    expect(s.ledger.balanceOf(dead)).toBe(cents);
    expect(s.ledger.entries.filter((e) => e.taxiId === dead).at(-1)).toMatchObject({ category: 'destroyed' });
  });
});

describe('persistent servers & accounts', () => {
  let dir: string;
  let stores: SaveStore[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hey-taxi-life-'));
    stores = [];
  });
  afterEach(async () => {
    for (const st of stores) await st.shutdown().catch(() => null);
    rmSync(dir, { recursive: true, force: true });
  });
  const store = () => {
    const st = new SaveStore(dir);
    stores.push(st);
    return st;
  };
  async function waitFor(cond: () => boolean): Promise<void> {
    const until = Date.now() + 3000;
    while (!cond()) {
      if (Date.now() > until) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  async function hostWithServer(seed: number, name = 'Test Server') {
    const st = store();
    const acct = await st.createOrSelectAccount(TEST_ACCOUNT.name);
    const session = new GameSession({ seed });
    session.initServer(name);
    const saver = new GameSaver(st, session);
    await saver.create();
    const host = new GameHost(session, 'test', st);
    host.saver = saver;
    host.activeAccount = acct;
    session.joinAccount(acct);
    await saver.checkpoint('join');
    host.command('advance');
    return { host, session, st, acct };
  }
  const flushSaves = (host: GameHost) => (host as unknown as { processSaves(): void }).processSaves();

  it('a destroyed taxi is saved at once; the server and account balance survive a restart', async () => {
    const { host, session, st, acct } = await hostWithServer(21, 'Midtown Prime');
    play(session, 60 * 40, 0);
    session.debugPatch(session.playerId, { cents: 18500 });
    const first = session.playerId;
    crashPlayer(session);
    play(session, 130);
    flushSaves(host);
    await waitFor(() => session.save.state === 'saved');
    const [srv] = await listServers(st, acct.accountId);
    expect(srv!.name).toBe('Midtown Prime');
    expect(srv!.account).toMatchObject({ joined: true, cents: 18500, destroyed: true, taxisLost: 1 });

    host.command('respawn');
    play(session, 120);
    host.command('pause');
    await waitFor(() => session.save.state === 'saved');
    const detail = await gameDetail(st, session.serverId, acct.accountId);
    expect(detail.taxis.every((t) => t.reconciled)).toBe(true);
    expect(detail.taxis.filter((t) => t.player).map((t) => t.status)).toEqual(['destroyed', 'active']);
    expect(detail.overview.endingCash).toBe(18500);
    expect(first).not.toBe(session.playerId);

    // After a restart, loading the server restores the fresh taxi with the retained balance.
    await host.stop();
    const st2 = store();
    const loaded = await st2.load(st2.fileFor(session.serverId));
    const fresh = new GameSession({ seed: 1 });
    fresh.restore(decode<GameSave>(loaded.state), loaded.entries);
    fresh.joinAccount(acct);
    expect(fresh.playerId).toBe(session.playerId);
    expect(fresh.player!.cents).toBe(18500);
    expect(fresh.mode).toBe('playing');
  });

  it('host.init() creates a default starter server when none exist, and servers can be created and deleted', async () => {
    const st = store();
    const host = new GameHost(new GameSession({ seed: 1 }), 'test', st);
    await host.init();
    const initial = await listServers(st);
    expect(initial).toHaveLength(1);
    expect(initial[0]!.name).toBe('Metro One');

    const created = await host.createServerOnDisk('Hardcore');
    expect(created.name).toBe('Hardcore');
    expect((await listServers(st)).map((s) => s.name).sort()).toEqual(['Hardcore', 'Metro One']);

    await st.delete(created.serverId);
    expect((await listServers(st)).map((s) => s.name)).toEqual(['Metro One']);
  });

  it('destroyed rivals stay reviewable with their final balance and history', async () => {
    const { host, session, st, acct } = await hostWithServer(4);
    const dead = destroyRival(session);
    host.command('pause');
    await waitFor(() => session.save.state === 'saved');
    const detail = await gameDetail(st, session.serverId, acct.accountId);
    const rival = detail.taxis.find((t) => t.taxiId === dead)!;
    expect(rival).toMatchObject({ status: 'destroyed', opening: 10000, reconciled: true });
    expect(rival.balance).toBe(session.ledger.balanceOf(dead));
  });

  it('multiple servers stay separate on disk and reviewable', async () => {
    const { host, session, st, acct } = await hostWithServer(5, 'Alpha');
    const first = session.serverId;
    play(session, 120);
    await host.saver!.checkpoint('save');
    const second = await host.createServerOnDisk('Beta');
    const games = await listGames(st, acct.accountId);
    expect(games.map((g) => g.gameId).sort()).toEqual([first, second.serverId].sort());
    expect(games.map((g) => g.name).sort()).toEqual(['Alpha', 'Beta']);
  });
});

describe('taxi skins', () => {
  const skinned = (skin?: string, seed = 1) =>
    startedSession(seed, { skin: skin as TaxiSkin | undefined });

  it('the player picks the skin when joining; anything unknown defaults to original on respawn', () => {
    expect(skinned('pixelHomage').player!.skin).toBe('pixelHomage');
    expect(skinned('softRetro').player!.skin).toBe('softRetro');
    expect(skinned().player!.skin).toBe('original');
  });

  it('each fresh taxi gets the skin picked for it', () => {
    const s = skinned('pixelHomage');
    crashPlayer(s);
    play(s, 130);
    expect(s.mode).toBe('destroyed');
    const old = s.player!.id;
    s.command('respawn', 'softRetro');
    expect(s.player!.id).not.toBe(old);
    expect(s.player!.skin).toBe('softRetro');
    expect(s.world.taxi(old)!.skin).toBe('pixelHomage');
  });

  it('rivals get skins at random, the same for the same server seed, and keep them through a save', () => {
    const rivals = (s: GameSession) =>
      s.world.locales.flatMap((l) => l.sim.taxis.filter((t) => t.npc).map((t) => `${t.id}:${t.skin}`));
    const a = skinned('original', 5);
    const b = skinned('original', 5);
    play(a, 60 * 60);
    play(b, 60 * 60);
    expect(rivals(a)).toEqual(rivals(b));
    const skins = new Set(a.world.locales.flatMap((l) => l.sim.taxis.filter((t) => t.npc).map((t) => t.skin)));
    for (const k of skins) expect(TAXI_SKINS).toContain(k);
    const all = new Set([1, 2, 3, 4, 5, 6].flatMap((seed) => rivals(skinned('original', seed)).map((r) => r.split(':')[1])));
    expect(all.size).toBeGreaterThan(1);
    const save = decode<GameSave>(encode(a.toSave()));
    const c = new GameSession({ seed: 5 });
    c.restore(save, a.ledger.entries);
    expect(rivals(c)).toEqual(rivals(a));
  });
});
