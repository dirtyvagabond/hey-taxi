import { describe, expect, it } from 'vitest';
import {
  createSim,
  DEFAULT_CONFIG,
  DT,
  Input,
  parseLevel,
  PASSENGER,
  spawnPassenger,
  step,
  TAXI,
  type LevelData,
  type SimConfig,
  type SimEvent,
  type SimState,
  type Taxi,
} from '../src/index';

// 12×7 tiles of 40u. Pad 1: x 40–160 (taxi spawns at x=100). Pad 2: x 280–440. Fuel pad: none.
// Both pad surfaces are at y=200.
const TWO_PADS: LevelData = {
  name: 'two pads',
  tileSize: 40,
  tiles: [
    '############',
    '#..........#',
    '#..........#',
    '#..........#',
    '#.S........#',
    '#111...2222#',
    '############',
  ],
};
const SURFACE = 200;
const PAD1 = 0;
const PAD2 = 1;

function setup(config: Partial<SimConfig> = { passengersPerTaxi: 0, extraPassengers: 0 }): { s: SimState; t: Taxi } {
  const s = createSim(parseLevel(TWO_PADS), { config });
  return { s, t: s.taxis[0]! };
}

function run(s: SimState, ticks: number, input = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s, { p1: input }));
  return all;
}

function find<T extends SimEvent['type']>(ev: SimEvent[], type: T) {
  return ev.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** Teleport the taxi to just above a pad and let it settle (smooth landing). */
function landAt(s: SimState, t: Taxi, x: number): SimEvent[] {
  t.status = 'flying';
  t.padIndex = -1;
  t.x = x;
  t.y = SURFACE - 0.25 - TAXI.halfH - TAXI.gearLength;
  t.vx = 0;
  t.vy = 10;
  return run(s, 3);
}

/** Put a passenger on pad 1 (left of the taxi) and step until they have boarded. */
function boardOnPad1(s: SimState, t: Taxi): SimEvent[] {
  spawnPassenger(s, { padIndex: PAD1, destPadIndex: PAD2, x: 50 });
  expect(t.status).toBe('landed');
  const all: SimEvent[] = [];
  for (let i = 0; i < 120 && !find(all, 'passengerBoarded'); i++) all.push(...run(s, 1));
  return all;
}

describe('spawning', () => {
  it('spawns a passenger on a numbered pad after the first delay, heading to another pad', () => {
    const { s } = setup({});
    const before = run(s, Math.round(DEFAULT_CONFIG.firstPassengerDelay / DT) - 2);
    expect(find(before, 'passengerSpawned')).toBeUndefined();
    const ev = run(s, 4);
    const spawned = find(ev, 'passengerSpawned');
    expect(spawned).toBeDefined();
    const p = s.passengers[0]!;
    expect(['waiting', 'walking']).toContain(p.state); // (walking: it spawned by the parked taxi)
    expect(p.destPadIndex).not.toBe(p.padIndex);
    expect(p.y).toBe(SURFACE);
  });

  it('never spawns a passenger on top of the taxi', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = createSim(parseLevel(TWO_PADS), { seed });
      const t = s.taxis[0]!;
      for (let i = 0; i < 120; i++) {
        const spawned = find(run(s, 1), 'passengerSpawned');
        const p = spawned && s.passengers.find((q) => q.id === spawned.passengerId)!;
        if (p?.padIndex === PAD1) expect(Math.abs(p.x - t.x)).toBeGreaterThan(TAXI.halfW + PASSENGER.halfW);
      }
    }
  });

  it('keeps one passenger per taxi plus the extras in play', () => {
    const { s } = setup({ passengersPerTaxi: 1, extraPassengers: 1 });
    run(s, 600);
    expect(s.passengers.filter((p) => p.state !== 'leaving').length).toBe(2);
    const { s: s2 } = setup({ passengersPerTaxi: 1, extraPassengers: 0 });
    run(s2, 600);
    expect(s2.passengers.filter((p) => p.state !== 'leaving').length).toBe(1);
  });

  it('does not spawn passengers in a level with fewer than two numbered pads', () => {
    const s = createSim(parseLevel({ name: 'x', tiles: ['#####', '#.S.#', '#111#', '#####'] }));
    run(s, 600);
    expect(s.passengers).toHaveLength(0);
  });
});

describe('boarding', () => {
  it('a passenger walks to a taxi landed on their pad and boards', () => {
    const { s, t } = setup();
    const ev = boardOnPad1(s, t);
    const boarded = find(ev, 'passengerBoarded');
    expect(boarded).toMatchObject({ taxiId: 'p1', destPadIndex: PAD2 });
    expect(t.passengerId).toBe(s.passengers[0]!.id);
    const p = s.passengers[0]!;
    expect(p).toMatchObject({ state: 'riding', tipPercent: DEFAULT_CONFIG.tipPercent, tipCuts: 0, rideTicks: 0 });
    expect(p.tip).toBeCloseTo((p.fare * DEFAULT_CONFIG.tipPercent) / 100, 6);
    // On time: the allowance plus the straight-line distance (260 u) at the expected pace.
    expect(p.dueTicks).toBe(Math.round((DEFAULT_CONFIG.tripAllowance + 260 / DEFAULT_CONFIG.tripPace) * 60));
  });

  it('taking off while they walk annoys them and costs tip later', () => {
    const { s, t } = setup();
    spawnPassenger(s, { padIndex: PAD1, destPadIndex: PAD2, x: 50 });
    run(s, 5);
    expect(s.passengers[0]!.state).toBe('walking');
    const ev = run(s, 5, Input.UP);
    expect(find(ev, 'passengerAnnoyed')).toBeDefined();
    expect(s.passengers[0]!.state).toBe('waiting');
    landAt(s, t, 100);
    const boarded: SimEvent[] = [];
    for (let i = 0; i < 120 && !find(boarded, 'passengerBoarded'); i++) boarded.push(...run(s, 1));
    expect(s.passengers[0]).toMatchObject({
      state: 'riding',
      tipPercent: DEFAULT_CONFIG.tipPercent - DEFAULT_CONFIG.tipCutAnnoyed,
    });
  });
});

describe('tips are never negative', () => {
  it('a penalty bigger than the remaining tip (even a fraction of a cent) leaves exactly zero', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.tipCuts = DEFAULT_CONFIG.tipPercent - 0.0006; // a sliver of a cent left
    t.status = 'flying';
    t.y = SURFACE - 2 - TAXI.halfH - TAXI.gearLength;
    t.vy = 110; // rough landing: a 5-point cut
    const ev = run(s, 5);
    expect(p.tip).toBe(0);
    expect(p.tipPercent).toBe(0);
    for (const e of ev) if (e.type === 'tipLost') expect(e.amount).toBeLessThanOrEqual(0.01);
  });

  it('payouts never include a negative (or "-0") tip, across many punishing trips', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { s, t } = setup();
      boardOnPad1(s, t);
      const p = s.passengers[0]!;
      p.tipCuts = DEFAULT_CONFIG.tipPercent - seed / 1000; // tiny leftovers
      p.rideTicks = p.dueTicks; // and no early bonus to rescue them
      const money = (t.cents / 100);
      // A few rough landings on the way, then deliver.
      for (let i = 0; i < 3; i++) {
        Object.assign(t, { status: 'flying', padIndex: -1, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy: 110 });
        run(s, 5);
        expect(p.tip).toBeGreaterThanOrEqual(0);
      }
      const done = find(landAt(s, t, 360), 'fareCompleted')!;
      expect(done.tip).toBeGreaterThanOrEqual(0);
      expect(Object.is(done.tip, -0)).toBe(false);
      expect((t.cents / 100)).toBeGreaterThanOrEqual(money + done.fare);
    }
  });
});

describe('riding & delivery', () => {
  it('the tip holds while on time, then shrinks for every second late', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    run(s, 60);
    expect(p.tipPercent).toBe(DEFAULT_CONFIG.tipPercent);
    p.rideTicks = p.dueTicks;
    const ev = run(s, 1);
    expect(find(ev, 'rideLate')).toMatchObject({ passengerId: p.id, taxiId: 'p1' });
    run(s, 119);
    expect(p.tipPercent).toBeCloseTo(DEFAULT_CONFIG.tipPercent - 2 * DEFAULT_CONFIG.tipLatePerSecond, 6);
    expect(p.tip).toBeCloseTo((p.fare * p.tipPercent) / 100, 6);
  });

  it('a late delivery gets no bonus; its tip is the service percentage', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.rideTicks = p.dueTicks + 600; // 10 s late
    const done = find(landAt(s, t, 360), 'fareCompleted')!;
    const pct = DEFAULT_CONFIG.tipPercent - 10 * DEFAULT_CONFIG.tipLatePerSecond;
    expect(done.earlyBonus).toBe(0);
    expect(done.tipPercent).toBeCloseTo(pct, 1);
    expect(done.tip).toBeCloseTo(Math.round(done.fare * pct) / 100, 2);
  });

  it('an early delivery earns a bonus, half a point per second early, up to the maximum', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.rideTicks = p.dueTicks - 240; // 4 s early: +2 points
    let done = find(landAt(s, t, 360), 'fareCompleted')!;
    expect(done.earlyBonus).toBeCloseTo(4 * DEFAULT_CONFIG.tipEarlyPerSecond, 1);
    expect(done.tipPercent).toBeCloseTo(DEFAULT_CONFIG.tipPercent + 2, 1);
    // Very early (a generous allowance, delivered at once): capped at the maximum.
    const again = setup({ passengersPerTaxi: 0, extraPassengers: 0, tripAllowance: 60 });
    boardOnPad1(again.s, again.t);
    done = find(landAt(again.s, again.t, 360), 'fareCompleted')!;
    expect(done.tipPercent).toBe(DEFAULT_CONFIG.tipPercentMax);
  });

  it('landing on the destination pad pays fare + tip and the passenger walks off', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const money = (t.cents / 100);
    const ev = landAt(s, t, 360);
    const done = find(ev, 'fareCompleted');
    expect(done).toBeDefined();
    expect(done!.fare).toBeCloseTo(DEFAULT_CONFIG.baseFare + DEFAULT_CONFIG.farePerDistance * 260, 2);
    expect(done!.tip).toBeCloseTo(Math.round(done!.fare * done!.tipPercent) / 100, 2);
    expect((t.cents / 100)).toBeCloseTo(money + done!.fare + done!.tip, 2);
    expect(t.passengerId).toBe(-1);
    expect(t.fares).toBe(1);
    expect(s.passengers[0]!.state).toBe('leaving');
    run(s, 120);
    expect(s.passengers).toHaveLength(0);
  });

  it('landing on some other pad does not deliver, emits wrongLanding, and zeros the tip permanently', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    const money = t.cents / 100;
    const ev = landAt(s, t, 100);
    expect(p.state).toBe('riding');
    expect(find(ev, 'wrongLanding')).toMatchObject({ passengerId: p.id, taxiId: 'p1', padIndex: PAD1 });
    expect(find(ev, 'tipLost')).toMatchObject({
      passengerId: p.id,
      taxiId: 'p1',
      reason: 'wrongLanding',
      points: DEFAULT_CONFIG.tipPercent,
      amount: Math.floor(p.fare * DEFAULT_CONFIG.tipPercent) / 100,
    });
    expect(p.tip).toBe(0);
    expect(p.tipPercent).toBe(0);
    expect(p.tipForfeited).toBe(true);

    // A second wrong landing still expresses dissatisfaction without emitting another tipLost.
    const ev2 = landAt(s, t, 100);
    expect(find(ev2, 'wrongLanding')).toMatchObject({ passengerId: p.id, taxiId: 'p1', padIndex: PAD1 });
    expect(find(ev2, 'tipLost')).toBeUndefined();
    expect(p.tip).toBe(0);

    // Even arriving early at the destination yields a $0 tip (no early bonus).
    expect(p.rideTicks).toBeLessThan(p.dueTicks);
    const doneEv = landAt(s, t, 360);
    const done = find(doneEv, 'fareCompleted')!;
    expect(done.tip).toBe(0);
    expect(done.tipPercent).toBe(0);
    expect(done.earlyBonus).toBe(0);
    expect(t.cents / 100).toBeCloseTo(money + done.fare, 2);
    expect(doneEv.some((e) => e.type === 'ledger' && e.category === 'tip')).toBe(false);
  });

  it('landing on a non-pad ledge or store pad with a passenger also emits wrongLanding and zeros the tip', () => {
    const withLedgeAndStore: LevelData = {
      name: 'ledge and store',
      tileSize: 40,
      tiles: [
        '##############',
        '#............#',
        '#............#',
        '#............#',
        '#.S..........#',
        '#111.##.FFF.2#',
        '##############',
      ],
    };
    const s = createSim(parseLevel(withLedgeAndStore), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;
    const destIdx = s.level.pads.findIndex((pad) => pad.label === '2');
    const storeIdx = s.level.pads.findIndex((pad) => pad.kind === 'fuel');
    spawnPassenger(s, { padIndex: PAD1, destPadIndex: destIdx, x: 50 });
    for (let i = 0; i < 120 && s.passengers[0]!.state !== 'riding'; i++) run(s, 1);
    const p = s.passengers[0]!;
    // Land on the solid ledge (x = 240, padIndex = -1).
    const ledgeEv = landAt(s, t, 240);
    expect(find(ledgeEv, 'landed')?.padIndex).toBe(-1);
    expect(find(ledgeEv, 'wrongLanding')).toMatchObject({ passengerId: p.id, taxiId: 'p1', padIndex: -1 });
    expect(p.tip).toBe(0);
    expect(p.tipForfeited).toBe(true);

    // Land on the fuel/store pad (x = 380): still wrongLanding.
    const storeEv = landAt(s, t, 380);
    expect(find(storeEv, 'landed')?.padIndex).toBe(storeIdx);
    expect(find(storeEv, 'wrongLanding')).toMatchObject({ passengerId: p.id, taxiId: 'p1', padIndex: storeIdx });
    expect(p.tip).toBe(0);
  });

  it('a hard landing on a wrong pad forfeits the whole tip in one wrongLanding cut', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    Object.assign(t, { status: 'flying', padIndex: -1, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy: 160 });
    const ev = run(s, 5);
    expect(ev.some((e) => e.type === 'taxiDamaged' && e.reason === 'hardLanding')).toBe(true);
    expect(find(ev, 'wrongLanding')).toMatchObject({ passengerId: p.id, taxiId: 'p1', padIndex: PAD1 });
    const tipLosses = ev.filter((e) => e.type === 'tipLost');
    expect(tipLosses).toHaveLength(1);
    expect(tipLosses[0]).toMatchObject({ reason: 'wrongLanding', points: DEFAULT_CONFIG.tipPercent });
    expect(p.tip).toBe(0);
    expect(p.tipPercent).toBe(0);
  });

  it('rough landings at the destination with a passenger aboard cost tip', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.rideTicks = p.dueTicks; // no early bonus so final tipPercent reflects the cut directly
    Object.assign(t, { status: 'flying', padIndex: -1, x: 360, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy: 110 });
    const ev = run(s, 5);
    expect(find(ev, 'landed')?.rating).toBe('rough');
    expect(find(ev, 'tipLost')).toMatchObject({
      reason: 'roughLanding',
      points: DEFAULT_CONFIG.tipCutRough,
      amount: Math.floor(p.fare * DEFAULT_CONFIG.tipCutRough) / 100,
    });
    expect(find(ev, 'fareCompleted')?.tipPercent).toBeCloseTo(DEFAULT_CONFIG.tipPercent - DEFAULT_CONFIG.tipCutRough, 1);
  });

  it('an ok landing at the destination costs a little; a smooth one nothing', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.rideTicks = p.dueTicks;
    Object.assign(t, { status: 'flying', padIndex: -1, x: 360, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy: 70 });
    const ev = run(s, 5);
    expect(find(ev, 'landed')?.rating).toBe('ok');
    expect(find(ev, 'tipLost')).toMatchObject({ reason: 'okLanding', points: DEFAULT_CONFIG.tipCutOk });
    expect(find(ev, 'fareCompleted')?.tipPercent).toBeCloseTo(DEFAULT_CONFIG.tipPercent - DEFAULT_CONFIG.tipCutOk, 1);

    const smooth = setup();
    boardOnPad1(smooth.s, smooth.t);
    expect(find(landAt(smooth.s, smooth.t, 360), 'tipLost')).toBeUndefined();
  });

  it('a smooth ride is reported as smooth', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    expect(find(landAt(s, t, 360), 'fareCompleted')?.smooth).toBe(true);
  });

  it('reports whether the delivery was late', () => {
    // A second either side of the on-time limit (landing itself takes a few ticks).
    for (const [offset, late] of [[-60, false], [60, true]] as const) {
      const { s, t } = setup();
      boardOnPad1(s, t);
      const p = s.passengers[0]!;
      p.rideTicks = p.dueTicks + offset;
      expect(find(landAt(s, t, 360), 'fareCompleted')?.late).toBe(late);
    }
  });

  it('any bump marks the ride not smooth, even when an early bonus tops the tip back up', () => {
    for (const vy of [70, 110]) {
      // ok and rough landings
      const { s, t } = setup();
      boardOnPad1(s, t);
      const p = s.passengers[0]!;
      p.rideTicks = 0;
      p.dueTicks = 60 * 60; // a minute early: the bonus refills the tip to the maximum
      Object.assign(t, { status: 'flying', padIndex: -1, x: 360, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy });
      const done = find(run(s, 5), 'fareCompleted')!;
      expect(done.tipPercent).toBeGreaterThanOrEqual(DEFAULT_CONFIG.tipPercent);
      expect(done.smooth).toBe(false);
    }
  });

  it('a bump still counts when there is no tip left to cut', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.tipCuts = DEFAULT_CONFIG.tipPercent; // tip already gone
    Object.assign(t, { status: 'flying', padIndex: -1, x: 360, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy: 110 });
    expect(find(run(s, 5), 'fareCompleted')?.smooth).toBe(false);
  });

  it('a hard landing (hull damage) at the destination is one bigger cut, not two', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    const p = s.passengers[0]!;
    p.rideTicks = p.dueTicks;
    Object.assign(t, { status: 'flying', padIndex: -1, x: 360, y: SURFACE - 2 - TAXI.halfH - TAXI.gearLength, vy: 160 });
    const ev = run(s, 5);
    expect(ev.some((e) => e.type === 'taxiDamaged' && e.reason === 'hardLanding')).toBe(true);
    const cuts = ev.filter((e) => e.type === 'tipLost').reduce((n, e) => n + (e as { points: number }).points, 0);
    expect(cuts).toBe(DEFAULT_CONFIG.tipCutRough + DEFAULT_CONFIG.tipCutHardLanding);
    expect(find(ev, 'fareCompleted')?.tipPercent).toBeCloseTo(DEFAULT_CONFIG.tipPercent - 8, 1);
  });

  it('crashing with a passenger aboard loses them', () => {
    const { s, t } = setup();
    boardOnPad1(s, t);
    t.status = 'flying';
    t.hp = 1; // last hull point: this collision is fatal
    t.vy = 400;
    t.y -= 3;
    const ev = run(s, 5);
    expect(find(ev, 'crashed')).toBeDefined();
    expect(find(ev, 'passengerLost')).toBeDefined();
    expect(s.passengers).toHaveLength(0);
    expect(t.passengerId).toBe(-1);
  });
});

describe('hitting passengers', () => {
  it('landing on a waiting passenger knocks them over and costs money', () => {
    const { s, t } = setup();
    spawnPassenger(s, { padIndex: PAD2, destPadIndex: PAD1, x: 360 });
    const money = (t.cents / 100);
    const ev = landAt(s, t, 365);
    expect(find(ev, 'passengerHit')).toMatchObject({ penalty: DEFAULT_CONFIG.hitPenalty });
    expect(s.passengers).toHaveLength(0);
    expect((t.cents / 100)).toBe(money - DEFAULT_CONFIG.hitPenalty);
  });

  it('a passenger boarding a landed taxi is never hit by it', () => {
    const { s, t } = setup();
    const ev = boardOnPad1(s, t);
    expect(find(ev, 'passengerHit')).toBeUndefined();
  });
});

describe('determinism with passengers', () => {
  it('same seed and inputs give identical passengers', () => {
    const script = (i: number) => [Input.UP, Input.RIGHT, 0, Input.LEFT, Input.UP | Input.RIGHT][(i >> 4) % 5]!;
    const a = createSim(parseLevel(TWO_PADS), { seed: 7 });
    const b = createSim(parseLevel(TWO_PADS), { seed: 7 });
    for (let i = 0; i < 1200; i++) {
      step(a, { p1: script(i) });
      step(b, { p1: script(i) });
    }
    expect(JSON.stringify(a.passengers)).toBe(JSON.stringify(b.passengers));
    expect(a.rng).toBe(b.rng);
  });
});
