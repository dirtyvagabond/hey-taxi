import { Input } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { Ledger, LedgerError } from '../src/ledger';
import { GameSession } from '../src/session';
import { WORLD_LEVELS } from '../src/world';
import { startedSession, teleportTo, TEST_ACCOUNT } from './helpers';

const base = { locale: 'x', tick: 0, ref: 'test' } as const;

describe('Ledger', () => {
  it('numbers entries and tracks balances', () => {
    const l = new Ledger('g1');
    l.record({ ...base, taxiId: 'a', category: 'opening', amount: 10000, balance: 10000 });
    const e = l.record({ ...base, taxiId: 'a', category: 'gas', amount: -250, balance: 9750 });
    expect(e).toMatchObject({ seq: 2, gameId: 'g1' });
    expect(l.balanceOf('a')).toBe(9750);
  });

  it('tracks player account wallets across multiple taxis', () => {
    const l = new Ledger('s1');
    l.record({ ...base, accountId: 'acc1', taxiId: 'p1', category: 'opening', amount: 10000, balance: 10000 });
    l.record({ ...base, accountId: 'acc1', taxiId: 'p1', category: 'fare', amount: 2500, balance: 12500 });
    l.record({ ...base, accountId: 'acc1', taxiId: 'p1', category: 'destroyed', amount: 0, balance: 12500 });
    l.record({ ...base, accountId: 'acc1', taxiId: 'p2', category: 'spawn', amount: 0, balance: 12500 });
    l.record({ ...base, accountId: 'acc1', taxiId: 'p2', category: 'gas', amount: -500, balance: 12000 });
    expect(l.balanceOfAccount('acc1')).toBe(12000);
  });

  it('rejects entries whose balance does not follow, or fractional cents', () => {
    const l = new Ledger('g1');
    l.record({ ...base, taxiId: 'a', category: 'opening', amount: 10000, balance: 10000 });
    expect(() => l.record({ ...base, taxiId: 'a', category: 'fare', amount: 500, balance: 10600 })).toThrow(LedgerError);
    expect(() => l.record({ ...base, taxiId: 'a', category: 'fare', amount: 0.5, balance: 10000.5 })).toThrow(LedgerError);
    expect(l.entries).toHaveLength(1);
  });
});

/** The player stays parked (alive) and fires now and then; rivals keep the world busy. */
const script = (i: number) => (i % 900 === 700 ? Input.FIRE : 0);

function playFor(s: GameSession, ticks: number): void {
  for (let i = 0; i < ticks && s.running; i++) {
    s.setInput(script(i));
    s.tick();
  }
}

/** Sum of each NPC taxi's and player account's ledger amounts equals its live balance. */
function reconciled(s: GameSession): void {
  const accountBalances: Record<string, number> = {};
  for (const [id, ps] of Object.entries(s.players)) {
    accountBalances[id] = ps.cents;
    const sum = s.ledger.entries.filter((e) => e.accountId === id).reduce((n, e) => n + e.amount, 0);
    expect(sum).toBe(ps.cents);
  }
  for (const t of s.sim.taxis) {
    if (!t.npc) continue;
    const sum = s.ledger.entries.filter((e) => e.taxiId === t.id).reduce((n, e) => n + e.amount, 0);
    expect(sum).toBe(t.cents);
  }
  expect(s.ledger.mismatches(s.sim.taxis, accountBalances)).toEqual([]);
}

describe('server ledger', () => {
  it('opens the player and each rival exactly once, at their starting funds', () => {
    const s = startedSession(5);
    playFor(s, 60 * 30);
    const opening = s.ledger.entries.filter((e) => e.category === 'opening');
    const expectedIds = Object.keys(s.world.taxis).sort();
    expect(opening.map((e) => e.taxiId).sort()).toEqual(expectedIds);
    expect(expectedIds).toContain(s.playerId);
    expect(opening.every((e) => e.amount === 10000)).toBe(true);
  });

  it('reconciles across a long session, teleporting through every locale', { timeout: 20000 }, () => {
    const s = startedSession(9);
    const pid = s.playerId;
    for (let hop = 1; hop <= 4; hop++) {
      playFor(s, 60 * 90);
      reconciled(s);
      teleportTo(s, WORLD_LEVELS[hop % WORLD_LEVELS.length]!);
    }
    expect(s.levelId).toBe(WORLD_LEVELS[4 % WORLD_LEVELS.length]);
    reconciled(s);
    expect(s.ledger.entries.filter((e) => e.category === 'transfer' && e.taxiId === pid)).toHaveLength(4);
    const opened = s.ledger.entries.filter((e) => e.category === 'opening').map((e) => e.taxiId);
    expect(new Set(opened).size).toBe(opened.length);
    const cats = new Set(s.ledger.entries.map((e) => e.category));
    for (const c of ['opening', 'fare']) expect(cats).toContain(c);
    const ticks = s.ledger.entries.map((e) => e.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
    expect(new Set(s.ledger.entries.map((e) => e.locale)).size).toBeGreaterThan(1);
    expect(s.ledger.entries.every((e) => e.gameId === s.serverId)).toBe(true);
  });

  it('creating a new server starts a separate ledger', () => {
    const s = startedSession(9, { serverName: 'Alpha' });
    playFor(s, 600);
    const first = s.serverId;
    s.initServer('Beta');
    s.joinAccount(TEST_ACCOUNT);
    expect(s.serverId).not.toBe(first);
    expect(s.ledger.entries).toEqual([]);
    s.command('advance');
    playFor(s, 2);
    expect(s.ledger.entries.find((e) => e.taxiId === s.playerId)).toMatchObject({
      accountId: TEST_ACCOUNT.accountId,
      category: 'opening',
      amount: 10000,
    });
  });

  it('debug balance patches go through the ledger and update the account wallet', () => {
    const s = startedSession(9);
    playFor(s, 2);
    s.debugPatch(s.playerId, { cents: 123 });
    expect(s.currentPlayer!.cents).toBe(123);
    playFor(s, 600);
    reconciled(s);
  });
});
