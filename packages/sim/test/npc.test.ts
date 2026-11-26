import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSim,
  DEFAULT_CONFIG,
  DT,
  Input,
  NPC_FACE_TICKS,
  parseLevel,
  rivalIds,
  spawnPassenger,
  step,
  TAXI,
  type LevelData,
  type SimEvent,
  type SimState,
} from '../src/index';

const DIR = join(__dirname, 'fixtures/campaign');
const campaign = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((file) => ({ file, data: JSON.parse(readFileSync(join(DIR, file), 'utf8')) as LevelData }));

function run(s: SimState, seconds: number, inputs: Record<string, number> = {}): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) all.push(...step(s, inputs));
  return all;
}

function find<T extends SimEvent['type']>(ev: SimEvent[], type: T) {
  return ev.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('NPC arrival', () => {
  it('waits offstage, then appears flying just below the exit gate', () => {
    const level = parseLevel(campaign[0]!.data);
    const s = createSim(level, { npcIds: ['npc1'] });
    const npc = s.taxis.find((t) => t.id === 'npc1')!;
    expect(npc).toMatchObject({ status: 'offstage', npc: true });
    const before = run(s, DEFAULT_CONFIG.npcArrivalDelay - 0.1);
    expect(find(before, 'arrived')).toBeUndefined();
    const ev = run(s, 0.2);
    expect(find(ev, 'arrived')).toMatchObject({ taxiId: 'npc1' });
    expect(npc.status).toBe('flying');
    const gate = level.exit!;
    expect(npc.x).toBe(gate.x + gate.w / 2);
    expect(npc.y).toBeGreaterThan(gate.y + gate.h);
  });

  it('keeps carried-over fuel and hull on arrival; once destroyed, it never comes back', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'] });
    const npc = s.taxis[1]!;
    expect([npc.fuel, npc.hp]).toEqual([DEFAULT_CONFIG.fuelMax, DEFAULT_CONFIG.taxiMaxHp]);
    Object.assign(npc, { fuel: 40, hp: 2, cents: 7700 }); // as if carried over from the last level
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 0.1);
    expect(npc.status).toBe('flying');
    expect(npc.hp).toBe(2);
    expect(npc.fuel).toBeLessThanOrEqual(40);
    expect(npc.cents).toBe(7700);
    const pad = s.level.pads.find((p) => p.label === '3')!;
    Object.assign(npc, { hp: 1, x: pad.x + pad.w / 2, y: pad.y - 40, vx: 0, vy: 400 }); // slam into a pad
    run(s, 1);
    expect(npc.status).toBe('destroyed');
    run(s, 120);
    expect(npc).toMatchObject({ status: 'destroyed', cents: 7700 }); // final balance kept
  });

  it('offstage taxis are ignored by passengers and collisions', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'] });
    const npc = s.taxis[1]!;
    const player = s.taxis[0]!;
    npc.x = player.x;
    npc.y = player.y; // overlapping, but offstage
    const ev = run(s, 0.5);
    expect(find(ev, 'taxiBump')).toBeUndefined();
  });
});

describe('several hostile rivals', () => {
  it('levels allow 1–3 rivals, ramping up through the campaign', () => {
    const counts = campaign.map(({ data }) => parseLevel(data).rivals);
    expect(counts[0]).toBe(1);
    expect(Math.max(...counts)).toBe(3);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    expect(rivalIds(parseLevel(campaign[campaign.length - 1]!.data))).toEqual(['npc1', 'npc2', 'npc3']);
  });

  it('rivals arrive one at a time, well spaced', () => {
    const level = parseLevel(campaign[campaign.length - 1]!.data);
    const s = createSim(level, { npcIds: rivalIds(level), seed: 2 });
    const arrivals: number[] = [];
    for (let tick = 0; tick < Math.round(120 / DT); tick++) {
      for (const e of step(s, {})) if (e.type === 'arrived' && e.taxiId.startsWith('npc')) arrivals.push(tick * DT);
      if (arrivals.length === 3) break;
    }
    const c = DEFAULT_CONFIG;
    expect(arrivals).toHaveLength(3);
    expect(arrivals[0]).toBeCloseTo(c.npcArrivalDelay, 0);
    for (let i = 1; i < 3; i++) {
      const gap = arrivals[i]! - arrivals[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(c.npcArrivalInterval - 0.1);
      expect(gap).toBeLessThanOrEqual(c.npcArrivalInterval + c.npcArrivalJitter + 0.1);
    }
  });

  it('a destroyed rival is gone for good: out of traffic, never respawned', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 2 });
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const npc = s.taxis[1]!;
    npc.hp = 1;
    Object.assign(npc, { status: 'flying', vy: 400, y: 400 });
    run(s, 2);
    expect(npc.status).toBe('destroyed');
    const ev = run(s, 300);
    expect(npc.status).toBe('destroyed');
    expect(ev.filter((e) => 'taxiId' in e && e.taxiId === 'npc1')).toEqual([]); // does nothing at all
  });

  it('rivals fight each other, not just the player', () => {
    let rivalOnRival = 0;
    for (const { data } of campaign) {
      const level = parseLevel(data);
      if (level.rivals < 2) continue;
      const s = createSim(level, { npcIds: rivalIds(level), seed: 4 });
      for (let tick = 0; tick < Math.round(200 / DT); tick++) {
        for (const e of step(s, {})) {
          if (e.type !== 'missileFired' || e.ownerId === 'p1') continue;
          const m = s.missiles.find((q) => q.id === e.missileId);
          if (m?.targetId?.startsWith('npc')) rivalOnRival++;
        }
      }
    }
    expect(rivalOnRival).toBeGreaterThan(5);
  });

  it('rivals mostly steer clear of each other in flight', () => {
    let collisions = 0;
    const level = parseLevel(campaign[campaign.length - 1]!.data);
    for (const seed of [1, 2]) {
      const s = createSim(parseLevel(campaign[campaign.length - 1]!.data), { npcIds: rivalIds(level), seed });
      for (let tick = 0; tick < Math.round(240 / DT); tick++) {
        for (const e of step(s, {})) {
          if (e.type === 'taxiDamaged' && e.cause === 'collision' && e.byTaxiId?.startsWith('npc') && e.taxiId.startsWith('npc')) collisions++;
        }
      }
    }
    // Two 4-minute runs with three rivals. Measured ~21 damage events (~10 collisions, each
    // counted for both taxis) vs ~60 before collision avoidance; guard against regressions.
    expect(collisions).toBeLessThan(30);
  });

  it('the passenger supply scales with taxis actually in the level', () => {
    const level = parseLevel(campaign[campaign.length - 1]!.data);
    const s = createSim(level, { npcIds: rivalIds(level), seed: 2 });
    run(s, 5); // no rivals yet: 1 player + 1 spare
    expect(s.passengers.filter((p) => p.state !== 'leaving').length).toBeLessThanOrEqual(2);
  });
});

describe('NPC gear discipline', () => {
  it('rivals raise the gear to travel and lower it to land, under the same side-jet rule', () => {
    const level = parseLevel(campaign[7]!.data);
    const s = createSim(level, { npcIds: rivalIds(level), seed: 3 });
    let ups = 0;
    let downs = 0;
    let sideWithGear = 0;
    let landings = 0;
    for (let tick = 0; tick < Math.round(180 / DT); tick++) {
      for (const e of step(s, {})) {
        if (e.type === 'gear' && e.taxiId.startsWith('npc')) e.down ? downs++ : ups++;
        if (e.type === 'landed' && e.taxiId.startsWith('npc')) landings++;
      }
      for (const t of s.taxis) if (t.npc && t.thrust & (Input.LEFT | Input.RIGHT) && t.gear > 0) sideWithGear++;
    }
    expect(ups).toBeGreaterThan(3);
    expect(downs).toBeGreaterThan(3);
    expect(landings).toBeGreaterThan(3);
    expect(sideWithGear).toBe(0);
    expect(s.taxis.filter((t) => t.npc).reduce((n, t) => n + t.fares, 0)).toBeGreaterThan(2);
  });
});

describe('NPC autopilot', () => {
  // The rival must be able to work every campaign level on its own, safely.
  it.each(campaign.flatMap((l) => [1, 2, 3].map((seed) => ({ ...l, seed }))))(
    '$file (seed $seed): delivers fares without crashing',
    ({ data, seed }) => {
      const s = createSim(parseLevel(data), { npcIds: ['npc1'], seed });
      const ev = run(s, 120); // player sits idle on the spawn pad
      const npc = s.taxis[1]!;
      const crashes = ev.filter((e) => e.type === 'crashed' && e.taxiId === 'npc1');
      expect(crashes).toEqual([]);
      expect(npc.fares).toBeGreaterThanOrEqual(2);
      expect(ev.filter((e) => e.type === 'passengerHit')).toEqual([]);
    },
  );

  it('refuels before running dry', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'] });
    const npc = s.taxis[1]!;
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 0.1);
    npc.fuel = DEFAULT_CONFIG.fuelMax * 0.3;
    let lowest = npc.fuel;
    for (let i = 0; i < Math.round(60 / DT); i++) {
      step(s, {});
      lowest = Math.min(lowest, npc.fuel);
    }
    expect(lowest).toBeGreaterThan(0);
    expect(npc.fuel).toBeGreaterThan(DEFAULT_CONFIG.fuelMax * 0.5);
  });
});

describe('rival rules', () => {
  it("NPC deliveries don't count toward the quota, and the NPC can't finish the level", () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'] });
    const ev = run(s, 120);
    expect(s.taxis[1]!.fares).toBeGreaterThanOrEqual(3);
    expect(s.faresDelivered).toBe(0);
    expect(s.exitOpen).toBe(false);
    expect(find(ev, 'levelComplete')).toBeUndefined();
  });

  it('keeps one waiting passenger per taxi plus a spare', () => {
    const s = createSim(parseLevel(campaign[1]!.data), { npcIds: ['npc1'] });
    run(s, 10);
    expect(s.passengers.filter((p) => p.state !== 'leaving').length).toBe(3);
  });
});

describe('boarding with a rival around', () => {
  it('landing beside a waiting passenger makes them walk to you, every time', () => {
    let tries = 0;
    for (const { data } of campaign) {
      const s = createSim(parseLevel(data), { npcIds: ['npc1'], seed: 4 });
      const me = s.taxis[0]!;
      for (let tick = 0; tick < 60 * 60 && tries < 200; tick++) {
        step(s, {});
        if (tick % 90 !== 0 || me.status !== 'landed') continue;
        const rider = s.passengers.find((p) => p.state === 'riding' && p.taxiId === 'p1');
        const target = rider ? null : s.passengers.find((p) => p.state === 'waiting');
        const pad = s.level.pads[rider ? rider.destPadIndex : (target?.padIndex ?? -1)];
        if (!pad) continue;
        const lo = pad.x + 30;
        const hi = pad.x + pad.w - 30;
        const x = target && Math.abs(target.x - lo) < Math.abs(target.x - hi) ? hi : lo;
        Object.assign(me, { status: 'flying', padIndex: -1, x, y: pad.y - 0.3 - TAXI.halfH - TAXI.gearLength, vx: 0, vy: 10 });
        for (let i = 0; i < 4; i++) step(s, {});
        if (!target || me.status !== 'landed' || me.padIndex !== target.padIndex) continue;
        tries++;
        expect(target.state === 'walking' || target.state === 'riding' ? target.taxiId : target.state).toBe('p1');
      }
    }
    expect(tries).toBeGreaterThan(20);
  });

  it('a passenger already walking to the rival stays with the rival', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const [me, rival] = s.taxis as [(typeof s.taxis)[0], (typeof s.taxis)[0]];
    const pad = s.level.pads.find((p) => p.label === '3')!;
    const p = spawnPassenger(s, { padIndex: pad.index, destPadIndex: 0, x: pad.x + 12 });
    const land = (t: typeof me, x: number) =>
      Object.assign(t, { status: 'landed', padIndex: pad.index, x, y: pad.y - TAXI.halfH - TAXI.gearLength, vx: 0, vy: 0 });
    land(rival, pad.x + 80);
    step(s, {});
    expect(p).toMatchObject({ state: 'walking', taxiId: 'npc1' });
    land(me, pad.x + pad.w - 30);
    run(s, 0.1);
    expect(p.taxiId).toBe('npc1');
  });
});

describe('rival combat & shopping', () => {
  it('takes occasional shots at a player in clear view', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 3 });
    // Ensure this rival isn't rolled as a pacifist for the general combat test.
    s.taxis[1]!.personality = { aggression: 11, vengeance: 10, nerve: 10, hustle: 10, skill: 10 };
    const ev = run(s, 120);
    const shots = ev.filter((e) => e.type === 'missileFired' && e.ownerId === 'npc1').length;
    expect(shots).toBeGreaterThanOrEqual(1);
    expect(shots).toBeLessThanOrEqual(DEFAULT_CONFIG.startMissiles + 4); // "occasionally", plus restocks
  });

  it('pops flares when a missile closes in', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 2 });
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const ev = [...step(s, { p1: Input.FIRE })];
    for (let i = 0; i < Math.round(5 / DT); i++) ev.push(...step(s, {}));
    expect(find(ev, 'flaresDeployed')).toMatchObject({ taxiId: 'npc1' });
  });

  it('goes shopping when out of ammo and can afford it', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 5 });
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const npc = s.taxis[1]!;
    Object.assign(npc, { missiles: 0, flares: 0, cents: 10000 });
    const ev = run(s, 60);
    const bought = ev.filter((e) => e.type === 'purchase' && e.taxiId === 'npc1');
    expect(bought.length).toBeGreaterThanOrEqual(2);
    expect(npc.missiles).toBeGreaterThan(0);
    expect(npc.flares).toBeGreaterThan(0);
  });

  it('goes to the store to repair when badly damaged', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 5 });
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const npc = s.taxis[1]!;
    Object.assign(npc, { hp: 2, cents: 20000 });
    const ev = run(s, 60);
    const repairs = ev.filter((e) => e.type === 'purchase' && e.taxiId === 'npc1' && e.item === 'repair');
    expect(repairs.length).toBeGreaterThanOrEqual(3);
    expect(npc.hp).toBeGreaterThanOrEqual(5);
  });

  it("won't spend its last dollars on ammo", () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 5 });
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const npc = s.taxis[1]!;
    Object.assign(npc, { missiles: 0, flares: 0, cents: 500 });
    const ev = run(s, 20);
    // Gas is survival, not ammo: buying it with the last dollars is fine.
    expect(ev.filter((e) => e.type === 'purchase' && e.taxiId === 'npc1' && e.item !== 'gas')).toEqual([]);
  });
});

describe('taxi bumps', () => {
  it('overlapping taxis are pushed apart and bounce, without crashing', () => {
    // Wide open box; two taxis flying into each other.
    const level = parseLevel({
      name: 'arena',
      tiles: [
        '################',
        '#..............#',
        '#..............#',
        '#..............#',
        '#..............#',
        '#.S............#',
        '#111.......2222#',
        '################',
      ],
    });
    const s = createSim(level, { playerIds: ['a', 'b'], config: { gravity: 0, passengersPerTaxi: 0, extraPassengers: 0 } });
    const [a, b] = s.taxis as [(typeof s.taxis)[0], (typeof s.taxis)[0]];
    Object.assign(a, { status: 'flying', padIndex: -1, x: 250, y: 120, vx: 60, vy: 0 });
    Object.assign(b, { status: 'flying', padIndex: -1, x: 300, y: 120, vx: -60, vy: 0 });
    const ev = run(s, 0.5);
    expect(find(ev, 'taxiBump')).toMatchObject({ taxiIds: ['a', 'b'] });
    expect(find(ev, 'crashed')).toBeUndefined();
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.x - a.x).toBeGreaterThanOrEqual(2 * TAXI.halfW);
    // A collision like any other: each taxi loses one hull point.
    const hits = ev.filter((e) => e.type === 'taxiDamaged');
    expect(hits).toEqual([
      expect.objectContaining({ taxiId: 'a', byTaxiId: 'b', cause: 'collision', hp: DEFAULT_CONFIG.taxiMaxHp - 1 }),
      expect.objectContaining({ taxiId: 'b', byTaxiId: 'a', cause: 'collision', hp: DEFAULT_CONFIG.taxiMaxHp - 1 }),
    ]);
  });

  it('a gentle nudge between taxis does no damage', () => {
    const level = parseLevel(campaign[0]!.data);
    const s = createSim(level, { playerIds: ['a', 'b'], config: { gravity: 0, passengersPerTaxi: 0, extraPassengers: 0 } });
    const [a, b] = s.taxis as [(typeof s.taxis)[0], (typeof s.taxis)[0]];
    Object.assign(a, { status: 'flying', padIndex: -1, x: 600, y: 300, vx: 10, vy: 0 });
    Object.assign(b, { status: 'flying', padIndex: -1, x: 650, y: 300, vx: -10, vy: 0 });
    const ev = run(s, 0.5);
    expect(ev.filter((e) => e.type === 'taxiDamaged')).toEqual([]);
  });

  it('a landed taxi is not moved by a bump', () => {
    const level = parseLevel(campaign[0]!.data);
    const s = createSim(level, { playerIds: ['a', 'b'], config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const [a, b] = s.taxis as [(typeof s.taxis)[0], (typeof s.taxis)[0]];
    const { x, y } = a;
    Object.assign(b, { status: 'flying', padIndex: -1, x: x + 40, y: y - 5, vx: -50, vy: 0 });
    run(s, 0.5);
    expect(a).toMatchObject({ status: 'landed', x, y });
    expect(b.status).not.toBe('crashed');
  });

  it('a hard bump costs riders some tip', () => {
    const level = parseLevel(campaign[0]!.data);
    const s = createSim(level, { playerIds: ['a', 'b'], config: { gravity: 0, passengersPerTaxi: 0, extraPassengers: 0 } });
    const [a, b] = s.taxis as [(typeof s.taxis)[0], (typeof s.taxis)[0]];
    const p = spawnPassenger(s, { padIndex: 1, destPadIndex: 2, x: 0 });
    Object.assign(p, { state: 'riding', taxiId: 'a', fare: 10, dueTicks: 1e6 });
    a.passengerId = p.id;
    Object.assign(a, { status: 'flying', padIndex: -1, x: 500, y: 200, vx: 80, vy: 0 });
    Object.assign(b, { status: 'flying', padIndex: -1, x: 560, y: 200, vx: -80, vy: 0 });
    const ev = run(s, 0.3);
    expect(find(ev, 'tipLost')).toMatchObject({ taxiId: 'a', reason: 'bump' });
  });
});

describe('determinism with an NPC', () => {
  it('same seed gives identical runs', () => {
    const make = () => createSim(parseLevel(campaign[2]!.data), { npcIds: ['npc1'], seed: 9 });
    const a = make();
    const b = make();
    run(a, 60);
    run(b, 60);
    expect(JSON.stringify(a.taxis)).toBe(JSON.stringify(b.taxis));
    expect(JSON.stringify(a.passengers)).toBe(JSON.stringify(b.passengers));
  });
});

describe('rival facing', () => {
  it("a rival turns only after sustained horizontal motion (its small corrections don't flip it)", () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 4 });
    const npc = s.taxis.find((x) => x.npc)!;
    let flips = 0;
    let lastFlip = -Infinity;
    let facing = npc.facing;
    for (let i = 0; i < 60 * 60; i++) {
      run(s, 1 / 60);
      if (npc.facing !== facing) {
        expect(i - lastFlip).toBeGreaterThanOrEqual(NPC_FACE_TICKS);
        lastFlip = i;
        facing = npc.facing;
        flips++;
      }
    }
    expect(flips).toBeGreaterThan(0); // it did get around
    expect(flips).toBeLessThan(30);
  });

  it('faces the direction of sustained horizontal travel (cruising and braking)', () => {
    const s = createSim(parseLevel(campaign[0]!.data), { npcIds: ['npc1'], seed: 4 });
    const npc = s.taxis.find((x) => x.npc)!;
    let sustainedTicks = 0;
    let wrongFacingTicks = 0;
    let runDir = 0;
    let runLen = 0;
    for (let i = 0; i < 60 * 60; i++) {
      run(s, 1 / 60);
      const dir = npc.status === 'flying' && Math.abs(npc.vx) >= 30 ? (npc.vx > 0 ? 1 : -1) : 0;
      if (dir !== 0 && dir === runDir) {
        runLen++;
      } else {
        runDir = dir;
        runLen = dir === 0 ? 0 : 1;
      }
      // Once moving consistently in one direction beyond the debounce window, it must face that way.
      if (runLen > NPC_FACE_TICKS + 1) {
        sustainedTicks++;
        if (npc.facing !== runDir) wrongFacingTicks++;
      }
    }
    expect(sustainedTicks).toBeGreaterThan(200);
    expect(wrongFacingTicks).toBe(0);
  });
});
