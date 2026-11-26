import { describe, expect, it } from 'vitest';
import {
  createSim,
  DEFAULT_CONFIG,
  DT,
  Input,
  parseLevel,
  spawnPassenger,
  step,
  TAXI,
  type SimConfig,
  type SimEvent,
  type SimState,
  type Taxi,
} from '../src/index';

// Big open room: player spawns bottom-left on pad 1; a store (fuel pad) in the middle; pad 2 right.
const ARENA = {
  name: 'arena',
  tiles: [
    '########################',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#.S....................#',
    '#111.....FFFF......2222#',
    '########################',
  ],
};
const STORE_Y = 360; // fuel pad surface
const STORE_X = 440; // fuel pad center

function setup(config: Partial<SimConfig> = {}, seed = 1): { s: SimState; me: Taxi; foe: Taxi } {
  const s = createSim(parseLevel(ARENA), {
    playerIds: ['me', 'foe'],
    // Co-pilots off (threat range 0) unless a test turns them on: these test missiles and manual flares.
    config: { passengersPerTaxi: 0, extraPassengers: 0, copilotThreatRange: 0, ...config },
    seed,
  });
  const [me, foe] = s.taxis as [Taxi, Taxi];
  Object.assign(foe, { status: 'flying', padIndex: -1, x: 500, y: 140, vx: 0, vy: 0 });
  return { s, me, foe };
}

/** Step, keeping the foe hovering in place (as if it were thrusting perfectly). */
function run(s: SimState, foe: Taxi, ticks: number, input = 0, foeInput = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    if (foe.status === 'flying') Object.assign(foe, { x: 500, y: 140, vx: 0, vy: 0 });
    all.push(...step(s, { me: i === 0 ? input : 0, foe: i === 0 ? foeInput : 0 }));
  }
  return all;
}

function find<T extends SimEvent['type']>(ev: SimEvent[], type: T) {
  return ev.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

function parkAtStore(t: Taxi, s: SimState): void {
  const store = s.level.pads.find((p) => p.kind === 'fuel')!;
  Object.assign(t, { status: 'landed', padIndex: store.index, x: STORE_X, y: STORE_Y - TAXI.halfH - TAXI.gearLength, vx: 0, vy: 0 });
}

describe('ammo', () => {
  it('every taxi starts with 3 missiles and 3 flares, and nothing regenerates for free', () => {
    expect(DEFAULT_CONFIG.missilesUnlimited).toBe(false);
    const { s, me, foe } = setup();
    expect([me.missiles, me.flares, foe.missiles, foe.flares]).toEqual([3, 3, 3, 3]);
    run(s, foe, 1, Input.FIRE);
    run(s, foe, Math.round(40 / DT));
    expect(me.missiles).toBe(2);
  });

  it('runs out, respecting the cooldown', () => {
    const { s, me, foe } = setup();
    run(s, foe, 1, Input.FIRE);
    run(s, foe, 1);
    run(s, foe, 1, Input.FIRE); // pressed again within the cooldown: ignored
    expect(me.missiles).toBe(2);
    for (let i = 0; i < 5; i++) run(s, foe, Math.round(DEFAULT_CONFIG.missileCooldown / DT) + 1, Input.FIRE);
    expect(me.missiles).toBe(0);
  });

  it('optional modes still work: unlimited, and free regeneration', () => {
    const unlimited = setup({ missilesUnlimited: true });
    for (let i = 0; i < 6; i++) run(unlimited.s, unlimited.foe, Math.round(DEFAULT_CONFIG.missileCooldown / DT) + 1, Input.FIRE);
    expect(unlimited.me.missiles).toBe(3);

    const regen = setup({ missileReload: 5 });
    run(regen.s, regen.foe, 1, Input.FIRE);
    run(regen.s, regen.foe, Math.round(5 / DT) + 2);
    expect(regen.me.missiles).toBe(3);
  });
});

describe('missiles', () => {
  it('home in on the other taxi and damage it', () => {
    const { s, me, foe } = setup();
    expect(foe.hp).toBe(DEFAULT_CONFIG.taxiMaxHp);
    const ev = run(s, foe, Math.round(3 / DT), Input.FIRE);
    expect(find(ev, 'missileFired')).toMatchObject({ ownerId: 'me' });
    expect(find(ev, 'missileExploded')).toMatchObject({ hitTaxiId: 'foe' });
    expect(find(ev, 'taxiDamaged')).toMatchObject({
      taxiId: 'foe',
      byTaxiId: 'me',
      cause: 'missile',
      hp: DEFAULT_CONFIG.taxiMaxHp - DEFAULT_CONFIG.missileDamage,
    });
    expect(ev.find((e) => e.type === 'crashed')).toBeUndefined();
    expect(foe.status).toBe('flying');
    expect(me.status).toBe('landed'); // the shooter is untouched
  });

  it('it takes three hits to destroy a taxi', () => {
    expect(DEFAULT_CONFIG.taxiMaxHp / DEFAULT_CONFIG.missileDamage).toBe(3);
    const { s, foe } = setup();
    const ev: SimEvent[] = [];
    for (let shot = 0; shot < 3; shot++) ev.push(...run(s, foe, Math.round(3 / DT), Input.FIRE));
    const hits = ev.filter((e) => e.type === 'missileExploded' && e.hitTaxiId === 'foe');
    const damaged = ev.filter((e) => e.type === 'taxiDamaged').map((e) => (e as { hp: number }).hp);
    const destroyed = ev.filter((e) => e.type === 'crashed' && e.taxiId === 'foe');
    expect(hits).toHaveLength(3);
    expect(damaged).toEqual([4, 2]);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({ reason: 'missile', byTaxiId: 'me' });
    // The ledger records whose missile it was.
    expect(ev.find((e) => e.type === 'ledger' && e.taxiId === 'foe' && e.category === 'destroyed')).toMatchObject({
      ref: 'crash:missile:me',
    });
  });

  it('a destroyed taxi stays destroyed (no respawn)', () => {
    const { s, foe } = setup();
    foe.hp = 1;
    const ev: SimEvent[] = [...step(s, { me: Input.FIRE })];
    for (let i = 0; i < Math.round(3 / DT) && foe.status !== 'destroyed'; i++) {
      Object.assign(foe, { x: 500, y: 140, vx: 0, vy: 0 });
      ev.push(...step(s, {}));
    }
    expect(foe).toMatchObject({ status: 'destroyed', hp: 0 });
    run(s, foe, Math.round(60 / DT));
    expect(foe).toMatchObject({ status: 'destroyed', hp: 0 });
  });

  it('a non-lethal hit knocks a flying taxi along the missile path', () => {
    const { s, foe } = setup();
    const ev: SimEvent[] = [...step(s, { me: Input.FIRE })];
    // Let the foe fly freely (no pinning) until the hit.
    for (let i = 0; i < Math.round(3 / DT) && !find(ev, 'taxiDamaged'); i++) {
      if (!find(ev, 'missileExploded')) Object.assign(foe, { x: 500, y: 140, vx: 0, vy: 0 });
      ev.push(...step(s, {}));
    }
    expect(find(ev, 'taxiDamaged')).toBeDefined();
    expect(Math.hypot(foe.vx, foe.vy)).toBeGreaterThan(DEFAULT_CONFIG.missileKnockback * 0.6);
  });

  it('a missile hit costs twice what a collision does', () => {
    const { s, me } = setup();
    Object.assign(me, { status: 'flying', padIndex: -1, y: me.y - 4, vy: 300 });
    const ev = [...step(s, {}), ...step(s, {}), ...step(s, {})];
    expect(find(ev, 'taxiDamaged')).toMatchObject({ taxiId: 'me', cause: 'collision', hp: 5 });
    expect(DEFAULT_CONFIG.missileDamage).toBe(2 * DEFAULT_CONFIG.collisionDamage);
  });

  it('a damaging hit costs the rider tip', () => {
    const { s, foe } = setup();
    const p = spawnPassenger(s, { padIndex: 2, destPadIndex: 0, x: 900 });
    Object.assign(p, { state: 'riding', taxiId: 'foe', fare: 10, dueTicks: 1e6 });
    foe.passengerId = p.id;
    const ev = run(s, foe, Math.round(3 / DT), Input.FIRE);
    expect(find(ev, 'tipLost')).toMatchObject({ taxiId: 'foe' });
    expect(p.state).toBe('riding');
  });

  it('a destroyed taxi loses its passenger', () => {
    const { s, foe } = setup();
    foe.hp = 1;
    const p = spawnPassenger(s, { padIndex: 2, destPadIndex: 0, x: 900 });
    Object.assign(p, { state: 'riding', taxiId: 'foe', fare: 10, dueTicks: 1e6 });
    foe.passengerId = p.id;
    const ev = run(s, foe, Math.round(3 / DT), Input.FIRE);
    expect(find(ev, 'passengerLost')).toMatchObject({ taxiId: 'foe' });
  });

  it('have a limited range: the motor burns out, the missile falls and explodes on impact', () => {
    const s = createSim(parseLevel(ARENA), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const ev: SimEvent[] = [...step(s, { p1: Input.FIRE })];
    const burn = Math.round(DEFAULT_CONFIG.missileLife / DT);
    for (let i = 0; i < burn + 2 && s.missiles.length; i++) ev.push(...step(s, {}));
    if (s.missiles.length) {
      // Still airborne after its motor quit: it's falling, not exploding in mid-air.
      expect(find(ev, 'missileBurnout')).toBeDefined();
      const vy = s.missiles[0]!.vy;
      ev.push(...step(s, {}));
      expect(s.missiles[0]?.vy ?? Infinity).toBeGreaterThan(vy);
    }
    for (let i = 0; i < Math.round(15 / DT) && s.missiles.length; i++) ev.push(...step(s, {}));
    expect(find(ev, 'missileExploded')).toMatchObject({ hitTaxiId: null });
    expect(s.missiles).toHaveLength(0);
  });

  it('a burnt-out missile stops steering: it no longer follows its target', () => {
    const { s, me, foe } = setup();
    step(s, { me: Input.FIRE });
    const m = s.missiles[0]!;
    m.life = 1; // the motor quits on the next tick
    step(s, {});
    expect(m.targetId).toBeNull();
    const vx = m.vx;
    Object.assign(foe, { x: me.x - 300 }); // target jumps behind it
    step(s, {});
    expect(m.vx).toBeCloseTo(vx, 6); // no turning, only gravity
  });

  it('cannot be fired while crashed', () => {
    const { s, me, foe } = setup();
    me.status = 'destroyed';
    run(s, foe, 1, Input.FIRE);
    expect(s.missiles).toHaveLength(0);
  });

  it('never hurt passengers', () => {
    const { s, foe } = setup();
    spawnPassenger(s, { padIndex: 0, destPadIndex: 2, x: 150 });
    const ev = run(s, foe, Math.round(3 / DT), Input.FIRE);
    expect(find(ev, 'passengerHit')).toBeUndefined();
    expect(s.passengers).toHaveLength(1);
  });

  it('are deterministic', () => {
    const a = setup();
    const b = setup();
    run(a.s, a.foe, 120, Input.FIRE);
    run(b.s, b.foe, 120, Input.FIRE);
    expect(JSON.stringify(a.s.missiles)).toBe(JSON.stringify(b.s.missiles));
  });
});

describe('flares', () => {
  /** Fire at the foe, pop flares once the missile is close; return what the burst did. */
  function duel(seed: number) {
    const { s, foe } = setup({}, seed);
    run(s, foe, 1, Input.FIRE);
    for (let i = 0; i < 300; i++) {
      const m = s.missiles[0];
      if (m && Math.hypot(m.x - foe.x, m.y - foe.y) < 200) break;
      run(s, foe, 1);
    }
    const ev = run(s, foe, 1, 0, Input.FLARE);
    return { s, foe, burst: find(ev, 'flaresDeployed')!, ev };
  }

  it('decoy each chasing missile 95% of the time', () => {
    let threats = 0;
    let decoyed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { burst } = duel(seed);
      threats += burst.threats;
      decoyed += burst.decoyed;
    }
    expect(threats).toBe(200);
    expect(decoyed / threats).toBeGreaterThan(0.9);
    expect(decoyed / threats).toBeLessThan(0.99);
  });

  it('eject three burning flares that fall away from the taxi and burn out', () => {
    const { s, foe } = setup();
    run(s, foe, 1, 0, Input.FLARE);
    expect(s.decoys).toHaveLength(3);
    expect(s.decoys.every((d) => d.ownerId === 'foe')).toBe(true);
    run(s, foe, 30);
    for (const d of s.decoys) expect(d.y).toBeGreaterThan(foe.y + 20); // dropping below the cab
    expect(Math.min(...s.decoys.map((d) => d.x))).toBeLessThan(foe.x - 20); // fanning out
    expect(Math.max(...s.decoys.map((d) => d.x))).toBeGreaterThan(foe.x + 20);
    run(s, foe, Math.round(DEFAULT_CONFIG.flareBurnTime / DT));
    expect(s.decoys).toHaveLength(0);
  });

  it('a decoyed missile peels off, chases a flare and blows up on it; the taxi survives', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { s, foe, burst } = duel(seed);
      if (!burst.decoyed) continue;
      const m = s.missiles[0]!;
      expect(m.decoyId).not.toBeNull();
      expect(m.targetId).toBeNull();
      const lure = s.decoys.find((d) => d.id === m.decoyId)!;
      const ev = run(s, foe, Math.round(2 / DT));
      const boom = find(ev, 'missileExploded')!;
      expect(boom).toMatchObject({ decoyed: true, hitTaxiId: null });
      // It blew up away from the taxi, at the flare (which kept falling meanwhile).
      expect(Math.hypot(boom.x - foe.x, boom.y - foe.y)).toBeGreaterThan(TAXI.halfW);
      expect(lure.ownerId).toBe('foe');
      expect(foe.status).toBe('flying');
      return;
    }
    throw new Error('no decoy in 20 seeds');
  });

  it('an undecoyed missile ignores the flares and still hits', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const { s, foe, burst } = duel(seed);
      if (burst.decoyed) continue;
      const ev = run(s, foe, Math.round(2 / DT));
      expect(find(ev, 'missileExploded')).toMatchObject({ hitTaxiId: 'foe' });
      return;
    }
    throw new Error('every missile was decoyed in 20 seeds');
  });

  it("a fooled missile whose flare burns out has lost lock: it won't re-acquire the taxi", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { s, foe, burst } = duel(seed);
      if (!burst.decoyed) continue;
      s.decoys = []; // flare gone before impact
      const ev = run(s, foe, Math.round(DEFAULT_CONFIG.missileLife / DT));
      expect(ev.find((e) => e.type === 'crashed' && e.taxiId === 'foe')).toBeUndefined();
      return;
    }
    throw new Error('no decoy in 20 seeds');
  });

  it('use one flare per burst, with a cooldown, and nothing without flares', () => {
    const { s, foe } = setup();
    run(s, foe, 1, 0, Input.FLARE);
    run(s, foe, 1, 0, Input.FLARE); // cooldown
    expect(foe.flares).toBe(2);
    foe.flares = 0;
    const ev = run(s, foe, 60, 0, Input.FLARE);
    expect(find(ev, 'flaresDeployed')).toBeUndefined();
  });

  it("don't affect missiles that are far away or chasing someone else", () => {
    const { s, foe } = setup();
    run(s, foe, 1, Input.FIRE);
    const ev = run(s, foe, 1, 0, Input.FLARE); // missile just launched, ~400u away
    expect(find(ev, 'flaresDeployed')).toMatchObject({ threats: 0, decoyed: 0 });
    expect(s.missiles).toHaveLength(1);
  });
});

describe('convenience stores', () => {
  it('a taxi parked at a store is invisible to missiles and cannot be hit', () => {
    const { s, me, foe } = setup();
    parkAtStore(foe, s);
    const ev: SimEvent[] = [...step(s, { me: Input.FIRE })];
    for (let i = 0; i < Math.round(6 / DT); i++) ev.push(...step(s, {}));
    expect(find(ev, 'missileFired')).toBeDefined();
    expect(ev.find((e) => e.type === 'crashed')).toBeUndefined();
    expect(foe.status).toBe('landed');
    expect(me.status).toBe('landed');
  });

  it('a missile chasing a taxi loses it when that taxi parks at a store', () => {
    const { s, foe } = setup();
    run(s, foe, 1, Input.FIRE);
    expect(s.missiles[0]!.targetId).toBe('foe');
    parkAtStore(foe, s);
    step(s, {});
    expect(s.missiles[0]?.targetId ?? null).toBeNull();
  });

  it('sell missiles and flares at a real price, only while parked there', () => {
    const { s, me, foe } = setup();
    const money = (me.cents / 100);
    // On pad 1 (not a store): nothing.
    run(s, foe, 1, Input.BUY_MISSILE);
    expect(me.missiles).toBe(3);
    run(s, foe, 1); // release the key (purchases trigger on press)
    parkAtStore(me, s);
    const ev = [...run(s, foe, 1, Input.BUY_MISSILE), ...run(s, foe, 1, Input.BUY_FLARE)];
    expect(ev.filter((e) => e.type === 'purchase')).toEqual([
      { type: 'purchase', taxiId: 'me', item: 'missile', price: DEFAULT_CONFIG.missilePrice },
      { type: 'purchase', taxiId: 'me', item: 'flare', price: DEFAULT_CONFIG.flarePrice },
    ]);
    expect([me.missiles, me.flares]).toEqual([4, 4]);
    expect((me.cents / 100)).toBeCloseTo(money - DEFAULT_CONFIG.missilePrice - DEFAULT_CONFIG.flarePrice, 2);
  });

  it('repair the hull at $20 per point, up to full', () => {
    const { s, me, foe } = setup();
    parkAtStore(me, s);
    me.hp = 4;
    const money = (me.cents / 100);
    const ev = run(s, foe, 1, Input.BUY_REPAIR);
    expect(find(ev, 'purchase')).toMatchObject({ item: 'repair', price: DEFAULT_CONFIG.repairPrice });
    expect(me.hp).toBe(5);
    expect((me.cents / 100)).toBeCloseTo(money - DEFAULT_CONFIG.repairPrice, 2);
    run(s, foe, 1);
    run(s, foe, 1, Input.BUY_REPAIR);
    run(s, foe, 1);
    run(s, foe, 1, Input.BUY_REPAIR); // already full: no sale
    expect(me.hp).toBe(DEFAULT_CONFIG.taxiMaxHp);
    expect((me.cents / 100)).toBeCloseTo(money - 2 * DEFAULT_CONFIG.repairPrice, 2);
  });

  it("won't sell beyond the cap or what you can afford", () => {
    const { s, me, foe } = setup();
    parkAtStore(me, s);
    me.missiles = DEFAULT_CONFIG.missileMax;
    run(s, foe, 1, Input.BUY_MISSILE);
    expect(me.missiles).toBe(DEFAULT_CONFIG.missileMax);
    me.cents = Math.round(DEFAULT_CONFIG.flarePrice * 100) - 1;
    run(s, foe, 1, Input.BUY_FLARE);
    expect(me.flares).toBe(3);
  });
});
