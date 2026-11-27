import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Missile, type Passenger, type SimState, type Taxi } from '@hey-taxi/sim';
import { isUrgentCategory, LINES, type CommentCategory } from '../src/dialogue';
import { EventPresenter, type EventContext } from '../src/events';
import { synthesizePassengerVoice } from '../src/voice';

function makeTaxi(overrides: Partial<Taxi> = {}): Taxi {
  return {
    id: 'p1',
    npc: false,
    x: 200,
    y: 200,
    vx: 0,
    vy: 0,
    facing: 1,
    gear: 0,
    gearTarget: 0,
    thrust: 0,
    status: 'flying',
    padIndex: -1,
    fuel: DEFAULT_CONFIG.fuelMax,
    hp: DEFAULT_CONFIG.taxiMaxHp,
    damageGraceTicks: 0,
    missiles: 3,
    flares: 3,
    fireCooldownTicks: 0,
    flareCooldownTicks: 0,
    missileReloadTicks: 0,
    copilot: { countermeasureProficiency: 80 },
    cents: 10000,
    fares: 0,
    passengerId: -1,
    ...overrides,
  } as Taxi;
}

function makePassenger(overrides: Partial<Passenger> = {}): Passenger {
  return {
    id: 1,
    kind: 0,
    state: 'riding',
    padIndex: 0,
    destPadIndex: 1,
    x: 200,
    y: 200,
    dir: 1,
    taxiId: 'p1',
    fare: 10,
    tip: 2,
    tipPercent: 20,
    tipCuts: 0,
    tipForfeited: false,
    rideTicks: 0,
    dueTicks: 600,
    annoyance: 0,
    leaveTicks: 0,
    waitTicks: 0,
    ...overrides,
  };
}

function makeMissile(overrides: Partial<Missile> = {}): Missile {
  return {
    id: 10,
    ownerId: 'npc1',
    x: 200,
    y: 400,
    vx: 0,
    vy: -200,
    targetId: 'p1',
    life: 120,
    fallTicks: 0,
    decoyId: null,
    spoofed: false,
    reactions: {},
    ...overrides,
  };
}

function makeHarness(opts: { taxis?: Taxi[]; passengers?: Passenger[]; missiles?: Missile[]; tick?: number; random?: () => number } = {}) {
  const taxis = opts.taxis ?? [makeTaxi({ passengerId: 1 })];
  const passengers = opts.passengers ?? [makePassenger()];
  const missiles = opts.missiles ?? [];
  const sim = {
    tick: opts.tick ?? 600,
    levelId: 'world/1-first-shift',
    level: {
      pads: [
        { index: 0, label: '1', kind: 'pad', x: 100, y: 300, w: 80 },
        { index: 1, label: '4', kind: 'pad', x: 400, y: 300, w: 80 },
      ],
    },
    config: DEFAULT_CONFIG,
    taxis,
    passengers,
    missiles,
    decoys: [],
  } as unknown as SimState;

  const spoken: Array<{ text: string; category: CommentCategory; passengerId: number }> = [];
  const bubbles: Array<{ key: string; text: string }> = [];

  const noop = () => {};
  const ctx: EventContext = {
    sim,
    config: DEFAULT_CONFIG,
    localId: 'p1',
    spectatingId: null,
    particles: { emit: noop } as unknown as EventContext['particles'],
    sound: {
      land: noop,
      explosion: noop,
      fuelEmpty: noop,
      lowFuel: noop,
      refuelTick: noop,
      rivalArrives: noop,
      gearMotor: noop,
      gearLock: noop,
      taxiBump: noop,
      rescueSummoned: noop,
      rescueArrived: noop,
      missileLaunch: noop,
      flares: noop,
      purchase: noop,
      missileBlast: noop,
      board: noop,
      tipLost: noop,
      cash: noop,
      bonk: noop,
    } as unknown as EventContext['sound'],
    hud: { flash: noop } as unknown as EventContext['hud'],
    passengers: {
      say: (key: string, text: string) => {
        bubbles.push({ key, text });
      },
      float: noop,
      headOf: () => ({ x: 0, y: 0 }),
    } as unknown as EventContext['passengers'],
    camera: { addShake: noop } as unknown as EventContext['camera'],
    nameOf: (id) => id,
    drawnAt: (id) => {
      const t = sim.taxis.find((x) => x.id === id);
      return { x: t?.x ?? 0, y: t?.y ?? 0 };
    },
    onTaxiArrived: noop,
    onPassengerSpawned: noop,
    isPassengerOnScreen: () => true,
    speakPassenger: (text, _kind, passengerId, category) => {
      spoken.push({ text, category, passengerId });
      return true;
    },
  };

  const presenter = new EventPresenter(ctx, opts.random ?? (() => 0));
  return { sim, ctx, presenter, spoken, bubbles };
}

describe('dialogue & voice', () => {
  it('synthesizes every line in LINES across all categories without stray backticks', () => {
    for (const [cat, lines] of Object.entries(LINES) as Array<[CommentCategory, readonly string[]]>) {
      expect(lines.length).toBeGreaterThanOrEqual(4);
      for (const raw of lines) {
        expect(raw).not.toContain('`');
        const text = raw.replace('{pad}', '4');
        const rendered = synthesizePassengerVoice(text, { kind: 1, passengerId: 7, category: cat });
        expect(rendered, `failed to synthesize ${cat}: ${text}`).not.toBeNull();
        expect(rendered!.samples.length).toBeGreaterThan(0);
      }
    }
  });

  it('classifies urgent combat/survival categories accurately', () => {
    expect(isUrgentCategory('incoming')).toBe(true);
    expect(isUrgentCategory('missileHit')).toBe(true);
    expect(isUrgentCategory('hullCritical')).toBe(true);
    expect(isUrgentCategory('outOfFuel')).toBe(true);
    expect(isUrgentCategory('playerFired')).toBe(false);
    expect(isUrgentCategory('lowFuel')).toBe(false);
    expect(isUrgentCategory('wrongPad')).toBe(false);
    expect(isUrgentCategory('board')).toBe(false);
  });
});

describe('EventPresenter combat & survival dialogue', () => {
  it('triggers incoming warning once per missile when closing in within threat range', () => {
    const farMissile = makeMissile({ id: 1, x: 200, y: 900, vy: -200 });
    const movingAway = makeMissile({ id: 2, x: 200, y: 350, vy: 200 });
    const spoofed = makeMissile({ id: 3, x: 200, y: 350, vy: -200, spoofed: true });
    const closing = makeMissile({ id: 4, x: 200, y: 400, vy: -200 });
    const { presenter, spoken } = makeHarness({ missiles: [farMissile, movingAway, spoofed, closing] });

    presenter.checkIncomingMissiles();
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.category).toBe('incoming');
    expect(LINES.incoming).toContain(spoken[0]!.text);

    // Same missile on subsequent ticks does not re-trigger.
    presenter.checkIncomingMissiles();
    expect(spoken).toHaveLength(1);
  });

  it('does not trigger incoming warning for rival taxis or when cab is empty', () => {
    const rival = makeTaxi({ id: 'npc1', npc: true, passengerId: 2 });
    const rivalRider = makePassenger({ id: 2, taxiId: 'npc1' });
    const emptyPlayer = makeTaxi({ id: 'p1', passengerId: -1 });
    const m1 = makeMissile({ id: 11, targetId: 'npc1', x: 200, y: 350, vy: -200 });
    const m2 = makeMissile({ id: 12, targetId: 'p1', x: 200, y: 350, vy: -200 });
    const { presenter, spoken } = makeHarness({
      taxis: [emptyPlayer, rival],
      passengers: [rivalRider],
      missiles: [m1, m2],
    });

    presenter.checkIncomingMissiles();
    expect(spoken).toHaveLength(0);
  });

  it('allows urgent warnings to preempt casual cooldown, while throttling back-to-back urgent lines', () => {
    const m1 = makeMissile({ id: 21, x: 200, y: 380, vy: -200 });
    const m2 = makeMissile({ id: 22, x: 200, y: 380, vy: -200 });
    const { sim, presenter, spoken } = makeHarness({ missiles: [] });

    // Casual reaction on player firing.
    presenter.handle([{ type: 'missileFired', missileId: 99, ownerId: 'p1', x: 200, y: 180 }]);
    expect(spoken.map((s) => s.category)).toEqual(['playerFired']);

    // 1 second later, urgent incoming warning bypasses casual cooldown.
    sim.tick += TICK_RATE;
    sim.missiles.push(m1);
    presenter.checkIncomingMissiles();
    expect(spoken.map((s) => s.category)).toEqual(['playerFired', 'incoming']);

    // 1 second later, a second urgent incoming warning is blocked by urgent cooldown.
    sim.tick += TICK_RATE;
    sim.missiles.push(m2);
    presenter.checkIncomingMissiles();
    expect(spoken).toHaveLength(2);

    // After 4+ seconds, urgent reactions work again.
    sim.tick += 5 * TICK_RATE;
    presenter.handle([{ type: 'fuelEmpty', taxiId: 'p1' }]);
    expect(spoken.map((s) => s.category)).toEqual(['playerFired', 'incoming', 'outOfFuel']);
  });

  it('uses missileHit (and suppresses mild rough tipLost bark) on missile damage, and hullCritical at 1 HP', () => {
    const { sim, presenter, spoken } = makeHarness();

    presenter.handle([
      { type: 'taxiDamaged', taxiId: 'p1', hp: 4, cause: 'missile', x: 200, y: 200 },
      { type: 'tipLost', passengerId: 1, taxiId: 'p1', amount: 0.5, points: 5, reason: 'bump' },
    ]);
    expect(spoken.map((s) => s.category)).toEqual(['missileHit']);

    sim.tick += 5 * TICK_RATE;
    presenter.handle([
      { type: 'taxiDamaged', taxiId: 'p1', hp: 1, cause: 'missile', x: 200, y: 200 },
      { type: 'tipLost', passengerId: 1, taxiId: 'p1', amount: 0.5, points: 5, reason: 'bump' },
    ]);
    expect(spoken.map((s) => s.category)).toEqual(['missileHit', 'hullCritical']);
  });

  it('triggers lowFuel on crossing threshold and wrongPad with destination label on wrongLanding', () => {
    const { presenter, spoken } = makeHarness();

    presenter.fuelSounds(DEFAULT_CONFIG.fuelMax * 0.25, DEFAULT_CONFIG.fuelMax * 0.19);
    expect(spoken.map((s) => s.category)).toEqual(['lowFuel']);

    presenter.handle([{ type: 'wrongLanding', passengerId: 1, taxiId: 'p1', padIndex: 0 }]);
    expect(spoken[1]!.category).toBe('wrongPad');
    expect(spoken[1]!.text).toContain('4');
  });
});
