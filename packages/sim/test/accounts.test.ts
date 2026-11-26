import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './fixtures';
import {
  createSim,
  DEFAULT_CONFIG,
  Input,
  parseLevel,
  post,
  rivalIds,
  step,
  toCents,
  type SimEvent,
  type SimState,
} from '../src/index';

type LedgerEvent = Extract<SimEvent, { type: 'ledger' }>;
const ledgerOf = (ev: SimEvent[]) => ev.filter((e): e is LedgerEvent => e.type === 'ledger');

function run(s: SimState, ticks: number, input = 0): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...step(s, { p1: input }));
  return out;
}

/** Each taxi's ledger amounts must sum to its balance, and each entry's balance must chain. */
function reconcile(s: SimState, entries: LedgerEvent[]): void {
  for (const t of s.taxis) {
    const mine = entries.filter((e) => e.taxiId === t.id);
    let balance = 0;
    for (const e of mine) {
      balance += e.amount;
      expect(Number.isInteger(e.amount)).toBe(true);
      expect(e.balance).toBe(balance);
    }
    expect(balance).toBe(t.cents);
  }
}

describe('accounting', () => {
  it('every new taxi gets an explicit opening credit (posted on the first step)', () => {
    const level = parseLevel(CAMPAIGN[7]!.data);
    const s = createSim(level, { npcIds: rivalIds(level), seed: 1 });
    const opening = ledgerOf(run(s, 1)).filter((e) => e.category === 'opening');
    expect(opening.map((e) => e.taxiId).sort()).toEqual(['npc1', 'npc2', 'npc3', 'p1']);
    for (const e of opening) expect(e.amount).toBe(toCents(DEFAULT_CONFIG.startMoney));
    expect(s.taxis.every((t) => t.cents === toCents(DEFAULT_CONFIG.startMoney))).toBe(true);
  });

  it('taxis carried over from the last level keep their balance, with no new opening', () => {
    const level = parseLevel(CAMPAIGN[1]!.data);
    const s = createSim(level, { npcIds: rivalIds(level), seed: 1, balances: { p1: 12345 } });
    const opening = ledgerOf(run(s, 1)).filter((e) => e.category === 'opening');
    expect(opening.map((e) => e.taxiId)).toEqual(['npc1']);
    expect(s.taxis[0]!.cents).toBe(12345);
  });

  it('only whole cents can be posted', () => {
    const s = createSim(parseLevel(CAMPAIGN[0]!.data), { seed: 1 });
    expect(() => post(s, s.taxis[0]!, 'adjustment', 0.5, 'x', [])).toThrow();
  });

  // Long seeded runs: fares, tips, gas, ammo, repairs, penalties and destruction all happen.
  it.each(CAMPAIGN.flatMap((l) => [1, 2].map((seed) => ({ id: l.id, data: l.data, seed }))))(
    '$id (seed $seed): every taxi’s ledger reconciles to its balance',
    ({ data, seed }) => {
      const level = parseLevel(data);
      const s = createSim(level, { npcIds: rivalIds(level), seed });
      const entries = ledgerOf(run(s, 60 * 180));
      reconcile(s, entries);
      const cats = new Set(entries.map((e) => e.category));
      expect(cats.has('opening')).toBe(true);
      expect(cats.has('fare')).toBe(true);
    },
  );

  it('a busy run covers every money-moving category and still reconciles', () => {
    const level = parseLevel(CAMPAIGN[7]!.data);
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      const s = createSim(level, { npcIds: rivalIds(level), seed });
      const entries = ledgerOf(run(s, 60 * 240));
      reconcile(s, entries);
      for (const e of entries) seen.add(e.category);
    }
    for (const c of ['opening', 'fare', 'tip', 'gas', 'missile', 'destroyed']) expect(seen).toContain(c);
  });
});

describe('store accounting', () => {
  /** Player parked on Level 1's store. */
  function atStore(): SimState {
    const level = parseLevel(CAMPAIGN[0]!.data);
    const s = createSim(level, { seed: 1 });
    const store = level.pads.find((p) => p.kind === 'fuel')!;
    const t = s.taxis[0]!;
    Object.assign(t, { padIndex: store.index, x: store.x + store.w / 2, y: store.y - 10 - 14 });
    run(s, 1); // opening posted
    return s;
  }
  const press = (s: SimState, bit: number) => [...step(s, { p1: bit }), ...step(s, { p1: 0 })];

  it('a purchase without enough cash is rejected with no debit', () => {
    const s = atStore();
    const t = s.taxis[0]!;
    t.cents = toCents(DEFAULT_CONFIG.missilePrice) - 1;
    const missiles = t.missiles;
    expect(ledgerOf(press(s, Input.BUY_MISSILE))).toEqual([]);
    expect(t.missiles).toBe(missiles);
    expect(t.cents).toBe(toCents(DEFAULT_CONFIG.missilePrice) - 1);
  });

  it('purchases debit exactly their price and say what they were for', () => {
    const s = atStore();
    const t = s.taxis[0]!;
    const before = t.cents;
    const [e] = ledgerOf(press(s, Input.BUY_FLARE));
    expect(e).toMatchObject({ category: 'flare', amount: -toCents(DEFAULT_CONFIG.flarePrice), ref: 'store:flare' });
    expect(t.cents).toBe(before - toCents(DEFAULT_CONFIG.flarePrice));
  });

  it('many tiny gas top-offs never give fuel away (each costs at least a cent, rounded up)', () => {
    const s = atStore();
    const t = s.taxis[0]!;
    const c = s.config;
    const perUnit = toCents(c.gallonPrice) / c.fuelPerGallon; // cents per fuel unit
    let paid = 0;
    let gained = 0;
    for (let i = 0; i < 200; i++) {
      t.fuel = c.fuelMax - 0.01; // a sliver below full
      const before = t.fuel;
      for (const e of ledgerOf(press(s, Input.BUY_FILL))) paid -= e.amount;
      gained += t.fuel - before;
    }
    expect(gained).toBeCloseTo(200 * 0.01, 6);
    expect(paid).toBeGreaterThanOrEqual(gained * perUnit);
  });

  it('cash-limited gas buys exactly what the cash pays for, never into debt', () => {
    const s = atStore();
    const t = s.taxis[0]!;
    t.fuel = 10;
    t.cents = 301; // $3.01 at $2/gal = 1.505 gal
    const [e] = ledgerOf(press(s, Input.BUY_FILL));
    expect(e).toMatchObject({ category: 'gas', amount: -301, balance: 0 });
    expect(t.fuel).toBeCloseTo(10 + (301 / toCents(s.config.gallonPrice)) * s.config.fuelPerGallon, 6);
  });
});
