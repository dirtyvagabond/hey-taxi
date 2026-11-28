import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSim,
  DEFAULT_CONFIG,
  DT,
  inSafeZone,
  Input,
  parseLevel,
  step,
  TAXI,
  type LevelData,
  type SimEvent,
  type SimState,
  type Taxi,
} from '../src/index';

// 10×7 tiles of 40u. Pad 1 spans cols 1–3 on row 5 (surface y=200); fuel pad cols 6–7.
const MINI: LevelData = {
  name: 'mini',
  tileSize: 40,
  tiles: [
    '##########',
    '#........#',
    '#........#',
    '#........#',
    '#.S......#',
    '#111..FF.#',
    '##########',
  ],
};
const SURFACE = 200;
const LANDED_Y = SURFACE - TAXI.gearLength - TAXI.halfH;

function setup(): { s: SimState; t: Taxi } {
  const s = createSim(parseLevel(MINI));
  return { s, t: s.taxis[0]! };
}

function run(s: SimState, ticks: number, input = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s, { p1: input }));
  return all;
}

/** Put the taxi in flight with its skids `gap` units above the given surface. */
function hover(t: Taxi, x: number, gap: number, vx: number, vy: number, gear = true): void {
  t.status = 'flying';
  t.padIndex = -1;
  t.gearDown = gear;
  t.gear = gear ? 1 : 0;
  t.x = x;
  t.y = SURFACE - gap - TAXI.halfH - (gear ? TAXI.gearLength : 0);
  t.vx = vx;
  t.vy = vy;
}

function find<T extends SimEvent['type']>(ev: SimEvent[], type: T) {
  return ev.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('parseLevel', () => {
  it('finds pads, kinds and surfaces', () => {
    const lvl = parseLevel(MINI);
    expect(lvl.pads.map((p) => [p.label, p.kind, p.x, p.y, p.w])).toEqual([
      ['1', 'pad', 40, 200, 120],
      ['F', 'fuel', 240, 200, 80],
    ]);
    expect([lvl.width, lvl.height]).toEqual([400, 280]);
  });

  it('rejects ragged rows, unknown tiles, duplicate pads and missing spawn', () => {
    expect(() => parseLevel({ name: 'x', tiles: ['#S#', '##'] })).toThrow(/row 1/);
    expect(() => parseLevel({ name: 'x', tiles: ['#S?'] })).toThrow(/unknown tile/);
    expect(() => parseLevel({ name: 'x', tiles: ['S1.1'] })).toThrow(/more than once/);
    expect(() => parseLevel({ name: 'x', tiles: ['###'] })).toThrow(/no spawn/);
  });
});

describe('spawn', () => {
  it('starts landed on the pad below S with full fuel', () => {
    const { t } = setup();
    expect(t.status).toBe('landed');
    expect(t.x).toBe(100);
    expect(t.y).toBe(LANDED_Y);
    expect(t.padIndex).toBe(0);
    expect(t.fuel).toBe(DEFAULT_CONFIG.fuelMax);
  });

  it('rejects a spawn over ground too narrow for the skids', () => {
    // 20u tiles: a single-tile column is narrower than the 36u skids.
    expect(() =>
      createSim(parseLevel({ name: 'x', tileSize: 20, tiles: ['#.#.#', '#.S.#', '#.#.#', '#####'] })),
    ).toThrow(
      /too narrow/,
    );
  });

  it.each(readdirSync(join(__dirname, 'fixtures/sandbox')).filter((f) => f.endsWith('.json')))(
    'sandbox level %s parses and has a valid spawn',
    (file) => {
      const data = JSON.parse(readFileSync(join(__dirname, 'fixtures/sandbox', file), 'utf8')) as LevelData;
      const s = createSim(parseLevel(data));
      run(s, 120);
      expect(s.taxis[0]!.status).toBe('landed');
    },
  );
});

describe('flight', () => {
  it('stays put when landed with no input', () => {
    const { s, t } = setup();
    run(s, 60);
    expect(t.y).toBe(LANDED_Y);
    expect(t.status).toBe('landed');
  });

  it('takes off and climbs with main thrust, then falls under gravity', () => {
    const { s, t } = setup();
    const ev = run(s, 20, Input.UP);
    expect(find(ev, 'tookOff')).toBeDefined();
    expect(t.y).toBeLessThan(LANDED_Y - 5);
    expect(t.vy).toBeLessThan(0);
    run(s, 40);
    expect(t.vy).toBeGreaterThan(0);
  });

  it('accelerates sideways with side thrust (gear up)', () => {
    const { s, t } = setup();
    hover(t, 200, 60, 0, 0, false);
    run(s, 10, Input.RIGHT);
    expect(t.vx).toBeGreaterThan(30);
  });

  it('is deterministic for the same input sequence', () => {
    const script = (tick: number) =>
      [Input.UP, Input.UP | Input.RIGHT, Input.LEFT, 0, Input.UP | Input.GEAR, Input.DOWN][(tick >> 3) % 6]!;
    const a = setup().s;
    const b = setup().s;
    for (let i = 0; i < 900; i++) {
      step(a, { p1: script(i) });
      step(b, { p1: script(i) });
    }
    expect(JSON.stringify(a.taxis)).toBe(JSON.stringify(b.taxis));
  });
});

describe('landing', () => {
  it('a slow touchdown on a pad lands smoothly', () => {
    const { s, t } = setup();
    hover(t, 100, 0.25, 0, 20); // gravity adds ~3.7 u/s per tick, so start right above the pad
    const landed = find(run(s, 10), 'landed');
    expect(landed).toMatchObject({ rating: 'smooth', padIndex: 0 });
    expect(t.status).toBe('landed');
    expect(t.y).toBe(LANDED_Y);
    expect(t.vy).toBe(0);
  });

  it('a fast-but-safe touchdown rates rough', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 110);
    expect(find(run(s, 10), 'landed')?.rating).toBe('rough');
  });

  // Collisions cost hull points; at the last point they're fatal. These check the reasons.
  it('too much vertical speed is a crash (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 170);
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('hardLanding');
    expect(t.status).toBe('destroyed');
  });

  it('too much horizontal speed is a crash (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 150, 20);
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('hardLanding');
  });

  it('moderate sideways speed at touchdown is survivable, but rates rough', () => {
    const { s, t } = setup();
    hover(t, 90, 2, 90, 20);
    expect(find(run(s, 10), 'landed')).toMatchObject({ rating: 'rough' });
    expect(t.status).toBe('landed');
  });

  it('gliding in sideways allows a harder vertical touchdown', () => {
    const glide = setup();
    hover(glide.t, 90, 2, 50, 150);
    expect(find(run(glide.s, 10), 'landed')).toBeDefined();

    const straightDown = setup();
    hover(straightDown.t, 100, 2, 0, 150);
    straightDown.t.hp = 1;
    expect(find(run(straightDown.s, 10), 'crashed')?.reason).toBe('hardLanding');

    const tooHard = setup();
    hover(tooHard.t, 90, 2, 50, 190);
    tooHard.t.hp = 1;
    expect(find(run(tooHard.s, 10), 'crashed')?.reason).toBe('hardLanding');
  });

  it('touching down with the gear up is a crash (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 60, false);
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('gearUp');
  });

  it('touching down while the gear is still deploying is a crash (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 60);
    t.gear = 0.5;
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('gearUp');
  });

  it('lands with half the skids hanging off a ledge', () => {
    const { s, t } = setup();
    hover(t, 160, 0.25, 0, 20); // skids span x 140–180: half on the pad, half over air
    expect(find(run(s, 10), 'landed')).toMatchObject({ padIndex: 0 });
  });

  it('crashes when most of the skids miss the ledge (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 172, 0.25, 0, 60); // skids span x 152–192: only 20% on the pad
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('badFooting');
  });

  it('skids bumping a ledge sideways stop the taxi instead of crashing it', () => {
    const { s, t } = setup();
    hover(t, 184, 2, -60, 0); // skids start 4u right of the pad edge (x=160)
    t.y = SURFACE + 5 - TAXI.gearLength - TAXI.halfH; // skids 5u below the pad top, body above it
    const ev = run(s, 10);
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(t.vx).toBe(0);
    expect(t.x - TAXI.feetHalfW).toBeGreaterThanOrEqual(160);
  });

  it('flying into a wall is a crash (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 70, 60, -200, 0);
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('body');
  });

  it('flying into the ceiling is a crash (at the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 200, 60, 0, -300);
    t.hp = 1;
    expect(find(run(s, 60, Input.UP), 'crashed')?.reason).toBe('body');
  });

  it('fast movement does not tunnel through a thin wall', () => {
    const level = parseLevel({
      name: 'thin',
      tiles: ['###########', '#.........#', '#.....#...#', '#.S.......#', '###########'],
    });
    const s = createSim(level, { config: { gravity: 0, maxSpeed: 5000 } });
    const t = s.taxis[0]!;
    t.status = 'flying';
    t.x = 120;
    t.y = 100;
    t.vx = 3000; // 50 units per tick, wall is 40 wide
    t.hp = 1;
    expect(find(run(s, 10), 'crashed')?.reason).toBe('body');
    expect(t.x).toBeLessThan(240);
  });
});

describe('collision damage', () => {
  const damaged = (ev: SimEvent[]) => find(ev, 'taxiDamaged');

  it('a healthy taxi has 6 hull points; each collision costs one and it survives', () => {
    expect(DEFAULT_CONFIG.taxiMaxHp).toBe(6);
    const { s, t } = setup();
    hover(t, 70, 60, -200, 0);
    const ev = run(s, 10);
    expect(damaged(ev)).toMatchObject({ cause: 'collision', reason: 'body', hp: 5, byTaxiId: null });
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(t.status).toBe('flying');
  });

  it('bounces off walls and ceilings instead of stopping dead', () => {
    const wall = setup();
    hover(wall.t, 70, 60, -200, 0);
    run(wall.s, 2);
    expect(wall.t.vx).toBeGreaterThan(0); // bounced back to the right
    const ceiling = setup();
    hover(ceiling.t, 200, 60, 0, -300);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 40 && !damaged(ev); i++) ev.push(...run(ceiling.s, 1));
    expect(damaged(ev)).toMatchObject({ reason: 'body' });
    expect(ceiling.t.vy).toBeGreaterThan(0); // heading back down
    expect(ceiling.t.status).toBe('flying');
  });

  it('six hard collisions destroy a healthy taxi', () => {
    const { s, t } = setup();
    let crashed = false;
    let hits = 0;
    for (let i = 0; i < 6 && !crashed; i++) {
      hover(t, 70, 60, -200, 0);
      t.damageGraceTicks = 0;
      const ev = run(s, 3);
      if (damaged(ev)) hits++;
      crashed = !!find(ev, 'crashed');
    }
    expect(hits).toBe(5);
    expect(crashed).toBe(true);
  });

  it('gentle scrapes are free, and there is a short grace period after a hit', () => {
    const { s, t } = setup();
    hover(t, 70, 60, -20, 0);
    expect(damaged(run(s, 10))).toBeUndefined();
    hover(t, 70, 60, -200, 0);
    expect(damaged(run(s, 3))).toBeDefined();
    hover(t, 70, 60, -200, 0);
    expect(damaged(run(s, 3))).toBeUndefined(); // within the grace period
  });

  it('a hard landing still lands, but costs a hull point', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 170);
    const ev = run(s, 10);
    expect(damaged(ev)).toMatchObject({ reason: 'hardLanding', hp: 5 });
    expect(find(ev, 'landed')).toMatchObject({ rating: 'rough' });
    expect(t.status).toBe('landed');
  });

  it('a gear-up touchdown bounces on the belly and settles as parked; lowering the gear still lifts it onto its skids', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 60, false);
    const ev = run(s, 40);
    expect(damaged(ev)).toMatchObject({ reason: 'gearUp' });
    expect(t.status).toBe('landed'); // settled on its belly
    expect(t.gear).toBe(0);
    run(s, 1, Input.GEAR);
    run(s, 60);
    expect(t.gear).toBe(1);
    expect(t.status).toBe('landed');
  });
});

describe('gear and side thrusters', () => {
  const C = DEFAULT_CONFIG;
  /** Flying with the gear fully down/up, gliding sideways at 80 u/s. */
  function gliding(gear: boolean) {
    const { s, t } = setup();
    hover(t, 200, 120, 80, 0, gear);
    return { s, t };
  }

  it('with the gear down, side thrust does nothing: no push, exhaust or fuel', () => {
    const { s, t } = gliding(true);
    const fuel = t.fuel;
    run(s, 30, Input.RIGHT);
    expect(t.thrust).toBe(0);
    expect(t.fuel).toBe(fuel);
    expect(t.vx).toBeLessThan(80); // only drag acts: no extra push
    expect(t.vx).toBeGreaterThan(60); // …and momentum is kept
  });

  it('starting to deploy the gear cuts the side jets at once, and they stay off until fully retracted', () => {
    const { s, t } = gliding(false);
    run(s, 2, Input.RIGHT);
    expect(t.thrust & Input.RIGHT).toBeTruthy();
    step(s, { p1: Input.RIGHT | Input.GEAR }); // deploy
    expect(t.gearDown).toBe(true);
    expect(t.thrust & Input.RIGHT).toBe(0);
    run(s, 5, Input.RIGHT);
    expect(t.gear).toBeGreaterThan(0);
    expect(t.gear).toBeLessThan(1);
    expect(t.thrust & Input.RIGHT).toBe(0); // deploying
    run(s, Math.round(C.gearTime / DT) + 2, Input.RIGHT);
    expect(t.gear).toBe(1);
    expect(t.thrust & Input.RIGHT).toBe(0); // deployed
    step(s, { p1: Input.GEAR }); // retract
    run(s, 5, Input.RIGHT);
    expect(t.gear).toBeGreaterThan(0);
    expect(t.thrust & Input.RIGHT).toBe(0); // retracting
    run(s, Math.round(C.gearTime / DT) + 2, Input.RIGHT);
    expect(t.gear).toBe(0);
    expect(t.thrust & Input.RIGHT).toBeTruthy(); // fully up: available again
  });

  it('up and down thrust still work with the gear down', () => {
    const { s, t } = gliding(true);
    run(s, 10, Input.UP);
    expect(t.thrust & Input.UP).toBeTruthy();
    expect(t.vy).toBeLessThan(0);
    run(s, 2, Input.DOWN);
    expect(t.thrust & Input.DOWN).toBeTruthy();
  });

  it('a parked taxi takes off with the gear down; side jets need it retracted first', () => {
    const { s, t } = setup();
    run(s, 20, Input.UP | Input.RIGHT);
    expect(t.status).toBe('flying');
    expect(t.thrust & Input.RIGHT).toBe(0);
    expect(Math.abs(t.vx)).toBeLessThan(1);
  });
});

describe('destruction', () => {
  it('is permanent: no respawn', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 200);
    t.hp = 1;
    run(s, 5);
    expect(t.status).toBe('destroyed');
    expect(t.crashes).toBe(1);
    const ev = run(s, Math.round(30 / DT), Input.UP);
    expect(find(ev, 'arrived')).toBeUndefined();
    expect(t.status).toBe('destroyed');
  });
});

describe('landing gear', () => {
  it('toggles once per press in flight and animates over gearTime', () => {
    const { s, t } = setup();
    hover(t, 200, 60, 0, 0);
    const ev = run(s, 5, Input.GEAR); // held: only one toggle
    expect(ev.filter((e) => e.type === 'gear')).toHaveLength(1);
    expect(t.gearDown).toBe(false);
    expect(t.gear).toBeGreaterThan(0);
    const after = run(s, Math.ceil(DEFAULT_CONFIG.gearTime / DT));
    expect(t.gear).toBe(0);
    expect(after.filter((e) => e.type === 'gearLocked')).toEqual([{ type: 'gearLocked', taxiId: 'p1', down: false }]);
  });

  it('cannot be toggled while landed', () => {
    const { s, t } = setup();
    run(s, 1, Input.GEAR);
    expect(t.gearDown).toBe(true);
    expect(t.gear).toBe(1);
  });
});

describe('fuel', () => {
  it('drains while thrusting', () => {
    const { s, t } = setup();
    run(s, 60, Input.UP);
    expect(t.fuel).toBeCloseTo(DEFAULT_CONFIG.fuelMax - DEFAULT_CONFIG.burnUp, 5);
  });

  it('running dry in flight: the engines die and the taxi falls; a hard impact damages or destroys it', () => {
    const { s, t } = setup();
    hover(t, 200, 100, 0, 0);
    t.fuel = 0.05;
    t.hp = 1;
    const first = run(s, 10, Input.UP);
    expect(find(first, 'fuelEmpty')).toMatchObject({ taxiId: 'p1' });
    expect(find(first, 'crashed')).toBeUndefined(); // still in the air
    expect(t.status).toBe('flying');
    const y = t.y;
    const falling = run(s, 5, Input.UP);
    expect(t.thrust).toBe(0); // nothing fires
    expect(find(falling, 'crashed')).toBeUndefined();
    expect(t.y).toBeGreaterThan(y); // falling
    const ev = run(s, 120, Input.UP);
    const boom = ev.filter((e) => e.type === 'crashed');
    expect(boom).toHaveLength(1);
    expect(boom[0]).toMatchObject({ taxiId: 'p1', reason: 'hardLanding' });
    expect(t.status).toBe('destroyed');
  });

  it('a clean dead-stick landing at a store, with money for gas, is survivable', () => {
    const { s, t } = setup();
    hover(t, 280, 1, 0, 20); // a whisker above the store, sinking slowly
    t.fuel = 0;
    const ev = run(s, 30);
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(find(ev, 'landed')).toMatchObject({ padIndex: 1 });
    run(s, 60); // parked dry at the store: still fine
    expect(t.status).toBe('landed');
    step(s, { p1: Input.BUY_FILL });
    expect(t.fuel).toBeGreaterThan(0);
  });

  it('a dry landing without money leaves the taxi stranded rather than exploding', () => {
    const { s, t } = setup();
    hover(t, 280, 1, 0, 20);
    Object.assign(t, { fuel: 0, cents: 0 });
    const ev = run(s, 30);
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(find(ev, 'landed')).toMatchObject({ padIndex: 1 });
    expect(t.status).toBe('landed');
    // Cannot take off with an empty tank.
    run(s, 10, Input.UP);
    expect(t.status).toBe('landed');
  });

  it('a hard dead-stick landing deals normal collision damage (lethal on the last hull point)', () => {
    const { s, t } = setup();
    hover(t, 280, 2, 0, 400);
    t.fuel = 0;
    t.hp = 1;
    expect(find(run(s, 30), 'crashed')).toMatchObject({ reason: 'hardLanding' });
  });

  it('a dry gear-up crash landing at a store settles as parked without gear so you can buy gas and take off', () => {
    const { s, t } = setup();
    hover(t, 280, 2, 0, 60, false); // gear up above the fuel store
    t.fuel = 0;
    const ev = run(s, 60);
    expect(ev.find((e) => e.type === 'taxiDamaged')).toMatchObject({ reason: 'gearUp' });
    expect(t.gear).toBe(0);
    expect(t.status).toBe('landed');
    expect(t.padIndex).toBe(1);
    step(s, { p1: Input.BUY_FILL });
    expect(t.fuel).toBeGreaterThan(0);
    step(s, { p1: Input.UP });
    expect(t.status).toBe('flying');
    expect(t.gear).toBe(0);
  });

  it('a dry taxi survives a gentle dead-stick touchdown on any pad', () => {
    const { s, t } = setup();
    hover(t, 100, 1, 0, 20); // a whisker above pad 1, sinking slowly
    t.fuel = 0;
    const ev = run(s, 30);
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(find(ev, 'landed')).toMatchObject({ padIndex: 0 });
    expect(t.status).toBe('landed');
  });

  it('a taxi sitting with an empty tank stays parked and stranded (does not explode)', () => {
    const { s, t } = setup();
    expect(t.status).toBe('landed');
    t.fuel = 0;
    const ev = run(s, 60, Input.UP);
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(t.status).toBe('landed');
  });

  it('a destroyed taxi stays destroyed', () => {
    const { s, t } = setup();
    hover(t, 100, 2, 0, 400);
    t.hp = 1;
    run(s, 30);
    expect(t.status).toBe('destroyed');
    run(s, Math.round(30 / DT));
    expect(t.status).toBe('destroyed');
  });

  describe('buying gas by the gallon', () => {
    const C = DEFAULT_CONFIG;
    const atStore = () => {
      const { s, t } = setup();
      hover(t, 280, 2, 0, 20);
      expect(find(run(s, 5), 'landed')?.padIndex).toBe(1);
      return { s, t };
    };
    /** Press (one tick) and release (one tick). */
    const press = (s: SimState, bit: number) => [...step(s, { p1: bit }), ...step(s, { p1: 0 })];

    it('no automatic refueling: parking at a store pumps nothing', () => {
      const { s, t } = atStore();
      t.fuel = 50;
      const money = (t.cents / 100);
      run(s, 120);
      expect(t.fuel).toBe(50);
      expect((t.cents / 100)).toBe(money);
    });

    it('each BUY_GAS press pumps one gallon and charges for it', () => {
      const { s, t } = atStore();
      t.fuel = 50;
      const money = (t.cents / 100);
      const ev = [...press(s, Input.BUY_GAS), ...press(s, Input.BUY_GAS)];
      expect(ev.filter((e) => e.type === 'purchase')).toHaveLength(2);
      expect(find(ev, 'purchase')).toMatchObject({ item: 'gas', gallons: 1, price: C.gallonPrice });
      expect(t.fuel).toBeCloseTo(50 + 2 * C.fuelPerGallon, 5);
      expect((t.cents / 100)).toBeCloseTo(money - 2 * C.gallonPrice, 2);
    });

    it('BUY_FILL fills the tank in one go; topping off sells a fraction of a gallon', () => {
      const { s, t } = atStore();
      t.fuel = C.fuelMax - 2.5 * C.fuelPerGallon;
      const money = (t.cents / 100);
      expect(find(press(s, Input.BUY_FILL), 'purchase')).toMatchObject({ item: 'gas', gallons: 2.5 });
      expect(t.fuel).toBeCloseTo(C.fuelMax, 5);
      expect((t.cents / 100)).toBeCloseTo(money - 2.5 * C.gallonPrice, 2);
      expect(find(press(s, Input.BUY_GAS), 'purchase')).toBeUndefined(); // already full
    });

    it("only sells what you can pay for (never into debt)", () => {
      const { s, t } = atStore();
      t.fuel = 10;
      t.cents = Math.round(C.gallonPrice * 150);
      expect(find(press(s, Input.BUY_FILL), 'purchase')).toMatchObject({ gallons: 1.5 });
      expect(t.cents).toBe(0);
      expect(t.fuel).toBeCloseTo(10 + 1.5 * C.fuelPerGallon, 5);
      expect(find(press(s, Input.BUY_GAS), 'purchase')).toBeUndefined();
    });

    it('cannot buy gas away from a store', () => {
      const { s, t } = setup();
      t.fuel = 50;
      expect(find(press(s, Input.BUY_FILL), 'purchase')).toBeUndefined();
      expect(t.fuel).toBe(50);
    });
  });

  it('does not refuel on a normal pad', () => {
    const { s, t } = setup();
    t.fuel = 50;
    run(s, 60);
    expect(t.fuel).toBe(50);
  });
});

describe('facing (cosmetic)', () => {
  it('◀ or ▶ alone turns the taxi at once, landed with the gear down too; motion never turns it back', () => {
    const { s, t } = setup();
    expect(t).toMatchObject({ status: 'landed', facing: 1 });
    run(s, 1, Input.LEFT); // landed, gear down: the side jets are off, but it looks left
    expect(t.facing).toBe(-1);
    // Drifting right with no keys: still facing left.
    Object.assign(t, { status: 'flying', padIndex: -1, y: t.y - 60, vx: 150 });
    run(s, 30);
    expect(t.facing).toBe(-1);
    run(s, 1, Input.RIGHT | Input.UP);
    expect(t.facing).toBe(1);
    // Both arrows at once: no change.
    run(s, 5, Input.LEFT | Input.RIGHT);
    expect(t.facing).toBe(1);
  });
});

describe('safe zones (store & teleport)', () => {
  const SAFE_LEVEL: LevelData = {
    name: 'safe',
    tileSize: 40,
    tiles: [
      '############',
      '#..........#',
      '#..........#',
      '#..........#',
      '#.S........#',
      '#111.FF.TT.#',
      '############',
    ],
  };

  function parkedOn(kind: 'fuel' | 'teleport', playerIds = ['p1']) {
    const s = createSim(parseLevel(SAFE_LEVEL), { playerIds });
    const t = s.taxis[0]!;
    const padIndex = s.level.pads.findIndex((p) => p.kind === kind);
    const pad = s.level.pads[padIndex]!;
    Object.assign(t, { status: 'landed', padIndex, x: pad.x + pad.w / 2, y: LANDED_Y, vx: 0, vy: 0, gear: 1, gearDown: true });
    return { s, t };
  }

  it.each(['fuel', 'teleport'] as const)('locks missiles and flares while parked at %s', (kind) => {
    const { s, t } = parkedOn(kind);
    expect(inSafeZone(s, t)).toBe(true);
    t.missiles = 3;
    t.flares = 3;
    const ev = step(s, { p1: Input.FIRE | Input.FLARE });
    expect(find(ev, 'missileFired')).toBeUndefined();
    expect(find(ev, 'flaresDeployed')).toBeUndefined();
    expect(t.missiles).toBe(3);
    expect(t.flares).toBe(3);
  });

  it.each(['fuel', 'teleport'] as const)('makes parked taxi invulnerable to high-speed ramming at %s', (kind) => {
    const { s, t } = parkedOn(kind, ['p1', 'p2']);
    const rammer = s.taxis[1]!;
    Object.assign(rammer, {
      status: 'flying',
      padIndex: -1,
      x: t.x - TAXI.halfW,
      y: t.y,
      vx: 300,
      vy: 0,
      gear: 0,
      gearDown: false,
      damageGraceTicks: 0,
    });
    t.damageGraceTicks = 0;
    const hpBefore = t.hp;
    const rammerHpBefore = rammer.hp;
    step(s, { p1: 0, p2: 0 });
    expect(t.hp).toBe(hpBefore);
    expect(t.status).toBe('landed');
    expect(rammer.hp).toBeLessThan(rammerHpBefore);
  });
});
