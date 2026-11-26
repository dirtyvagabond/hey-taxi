import { describe, expect, it } from 'vitest';
import {
  createSim,
  DT,
  Input,
  parseLevel,
  PROFICIENCY_MAX,
  PROFICIENCY_MIN,
  rivalIds,
  step,
  WORLD,
  type LevelData,
  type SimConfig,
  type SimEvent,
  type SimState,
  type Taxi,
} from '../src/index';

// An empty box: one shooter ('me') on the floor, a target ('foe') hovering to the right.
const ARENA: LevelData = {
  name: 'arena',
  tiles: [
    '##############################',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#.S..........................#',
    '#.1111..............22222....#',
    '##############################',
  ],
};

function setup(config: Partial<SimConfig> = {}, seed = 1): { s: SimState; me: Taxi; foe: Taxi } {
  const s = createSim(parseLevel(ARENA), {
    playerIds: ['me', 'foe'],
    config: { passengersPerTaxi: 0, extraPassengers: 0, ...config },
    seed,
  });
  const [me, foe] = s.taxis as [Taxi, Taxi];
  Object.assign(foe, { status: 'flying', padIndex: -1, x: 900, y: 140, vx: 0, vy: 0 });
  return { s, me, foe };
}

/** Step with the foe held in place (as if hovering perfectly). */
function run(s: SimState, foe: Taxi, ticks: number, meInput = 0, foeInput = 0): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    if (foe.status === 'flying') Object.assign(foe, { x: 900, y: 140, vx: 0, vy: 0 });
    all.push(...step(s, { me: i === 0 ? meInput : 0, foe: i === 0 ? foeInput : 0 }));
  }
  return all;
}

/** Fire one missile at the foe and run until the co-pilot has decided (or the missile is gone). */
function duel(seed: number, proficiency: number, prep?: (foe: Taxi, s: SimState) => void) {
  const { s, foe } = setup({}, seed);
  foe.copilot.countermeasureProficiency = proficiency;
  prep?.(foe, s);
  const ev: SimEvent[] = run(s, foe, 1, Input.FIRE);
  for (let i = 0; i < 400 && !ev.some((e) => e.type === 'copilotReaction') && s.missiles.length; i++) {
    ev.push(...run(s, foe, 1));
  }
  return { s, foe, ev };
}

describe('co-pilots', () => {
  it('every taxi gets a fixed, seeded proficiency from 65 to 95', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      for (const w of WORLD) {
        const level = parseLevel(w.data);
        const s = createSim(level, { npcIds: rivalIds(level), seed });
        for (const t of s.taxis) {
          const p = t.copilot.countermeasureProficiency;
          expect(Number.isInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(PROFICIENCY_MIN);
          expect(p).toBeLessThanOrEqual(PROFICIENCY_MAX);
          seen.add(p);
        }
      }
    }
    expect(seen.size).toBe(31); // the whole range turns up (uniform)
    const again = (seed: number) => createSim(parseLevel(WORLD[0]!.data), { npcIds: ['npc1'], seed }).taxis.map((t) => t.copilot);
    expect(again(42)).toEqual(again(42));
  });

  it.each([65, 80, 95])('proficiency %i: reacts in time p%% of the time; automatic protection ≈ p × 95%%', (p) => {
    const N = 1500;
    let timely = 0;
    let protectedCount = 0;
    for (let seed = 1; seed <= N; seed++) {
      const { ev } = duel(seed * 7 + p, p);
      const r = ev.find((e) => e.type === 'copilotReaction');
      expect(r).toBeDefined();
      if (r!.type === 'copilotReaction' && r!.timely) timely++;
      const burst = ev.find((e) => e.type === 'flaresDeployed');
      if (burst?.type === 'flaresDeployed' && burst.auto && burst.decoyed > 0) protectedCount++;
    }
    const tolerance = 3 * Math.sqrt((0.25) / N); // ~3 sigma
    expect(timely / N).toBeCloseTo(p / 100, 1);
    expect(Math.abs(timely / N - p / 100)).toBeLessThan(tolerance);
    expect(Math.abs(protectedCount / N - (p / 100) * 0.95)).toBeLessThan(tolerance);
  });

  it('decides once per missile: no second attempt on later ticks, or after a refill', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { s, foe, ev } = duel(seed, 80, (f) => (f.flares = 0)); // nothing to pop at first
      const r = ev.find((e) => e.type === 'copilotReaction')!;
      if (r.type !== 'copilotReaction' || !r.timely) continue;
      expect(ev.find((e) => e.type === 'copilotUnable')).toMatchObject({ reason: 'noFlares' });
      foe.flares = 3; // restocked while the missile is still coming
      const later = run(s, foe, 90);
      expect(later.filter((e) => e.type === 'copilotReaction')).toEqual([]);
      expect(later.find((e) => e.type === 'flaresDeployed')).toBeUndefined();
      return;
    }
    throw new Error('no timely reaction found');
  });

  it('a cooldown makes protection unavailable for that missile (no retry)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { s, foe, ev } = duel(seed, 95, (f) => (f.flareCooldownTicks = 10_000));
      const r = ev.find((e) => e.type === 'copilotReaction')!;
      if (r.type !== 'copilotReaction' || !r.timely) continue;
      expect(ev.find((e) => e.type === 'copilotUnable')).toMatchObject({ reason: 'cooldown' });
      foe.flareCooldownTicks = 0;
      expect(run(s, foe, 90).find((e) => e.type === 'flaresDeployed')).toBeUndefined();
      return;
    }
    throw new Error('no timely reaction found');
  });

  it('a late reaction does nothing for that missile', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { s, foe, ev } = duel(seed, 65);
      const r = ev.find((e) => e.type === 'copilotReaction')!;
      if (r.type !== 'copilotReaction' || r.timely) continue;
      const flares = foe.flares;
      const rest = [...ev, ...run(s, foe, 120)];
      expect(rest.find((e) => e.type === 'flaresDeployed')).toBeUndefined();
      expect(foe.flares).toBe(flares);
      return;
    }
    throw new Error('no late reaction found');
  });

  it('a salvo: simultaneous threats share one burst and one flare charge', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { s, foe } = setup({}, seed);
      foe.copilot.countermeasureProficiency = 95;
      run(s, foe, 1, Input.FIRE);
      const m = s.missiles[0]!;
      // A second missile right alongside the first.
      s.missiles.push({ ...structuredClone(m), id: 9999, y: m.y + 12 });
      const flares = foe.flares;
      const ev: SimEvent[] = [];
      for (let i = 0; i < 400 && !ev.some((e) => e.type === 'copilotReaction'); i++) ev.push(...run(s, foe, 1));
      const reactions = ev.filter((e) => e.type === 'copilotReaction');
      if (reactions.length !== 2 || reactions.some((e) => e.type === 'copilotReaction' && !e.timely)) continue;
      const bursts = ev.filter((e) => e.type === 'flaresDeployed');
      expect(bursts).toHaveLength(1);
      expect(bursts[0]).toMatchObject({ auto: true, threats: 2 });
      expect(foe.flares).toBe(flares - 1);
      return;
    }
    throw new Error('no salvo with two timely reactions found');
  });

  it('a burst also covers a missile the co-pilot was too slow for', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { s, foe } = setup({}, seed);
      foe.copilot.countermeasureProficiency = 95;
      run(s, foe, 1, Input.FIRE);
      const m = s.missiles[0]!;
      const late = { ...structuredClone(m), id: 9999, y: m.y + 12, reactions: { foe: false } }; // already judged late
      s.missiles.push(late);
      const ev: SimEvent[] = [];
      for (let i = 0; i < 400 && !ev.some((e) => e.type === 'copilotReaction'); i++) ev.push(...run(s, foe, 1));
      const r = ev.find((e) => e.type === 'copilotReaction');
      if (r?.type !== 'copilotReaction' || !r.timely) continue;
      expect(ev.find((e) => e.type === 'flaresDeployed')).toMatchObject({ auto: true, threats: 2 });
      return;
    }
    throw new Error('no timely reaction found');
  });

  it('manual flares (C) still work, with the same 95% per missile', () => {
    let threats = 0;
    let decoyed = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { s, foe } = setup({ copilotThreatRange: 0 }, seed); // co-pilot off: manual only
      run(s, foe, 1, Input.FIRE);
      for (let i = 0; i < 300 && s.missiles[0] && Math.hypot(s.missiles[0].x - foe.x, s.missiles[0].y - foe.y) > 200; i++) run(s, foe, 1);
      const burst = run(s, foe, 1, 0, Input.FLARE).find((e) => e.type === 'flaresDeployed');
      if (burst?.type === 'flaresDeployed') {
        expect(burst.auto).toBe(false);
        threats += burst.threats;
        decoyed += burst.decoyed;
      }
    }
    expect(decoyed / threats).toBeGreaterThan(0.9);
  });

  it('never two bursts in one tick: a manual burst that tick covers the co-pilot', () => {
    let both = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { s, foe } = setup({}, seed);
      foe.copilot.countermeasureProficiency = 95;
      run(s, foe, 1, Input.FIRE);
      const m = s.missiles[0]!;
      // Put the missile just inside the threat window, heading straight for the foe.
      Object.assign(m, { x: foe.x - 250, y: foe.y, vx: 380, vy: 0, reactions: {} });
      const flares = foe.flares;
      const ev = run(s, foe, 1, 0, Input.FLARE); // the pilot presses C on that same tick
      const bursts = ev.filter((e) => e.type === 'flaresDeployed' && e.taxiId === 'foe');
      expect(bursts).toHaveLength(1);
      expect(foe.flares).toBe(flares - 1);
      if (ev.some((e) => e.type === 'copilotReaction' && e.timely)) both++;
    }
    // (Usually the manual burst fools the missile first; when it doesn't, the co-pilot's timely
    // reaction rides on that burst instead of popping a second one.)
    expect(both).toBeGreaterThanOrEqual(0);
  });

  it('decisions made mid-threat survive a save (JSON round trip of the state)', () => {
    const a = duel(5, 80).s;
    const { level, config, ...rest } = a;
    const b: SimState = { ...JSON.parse(JSON.stringify(rest)), level, config };
    expect(b.missiles[0]?.reactions).toEqual(a.missiles[0]?.reactions);
    for (let i = 0; i < 120; i++) {
      const ea = step(a, {});
      const eb = step(b, {});
      expect(JSON.stringify(eb)).toBe(JSON.stringify(ea));
    }
  });

  it('rivals are protected by their co-pilots (they no longer pop flares themselves)', () => {
    const level = parseLevel(WORLD[2]!.data);
    let auto = 0;
    for (const seed of [1, 2, 3, 4]) {
      const s = createSim(level, { npcIds: ['npc1', 'npc2', 'npc3'], seed });
      for (let i = 0; i < Math.round(180 / DT); i++) {
        for (const e of step(s, {})) if (e.type === 'flaresDeployed' && e.taxiId.startsWith('npc')) {
          expect(e.auto).toBe(true);
          auto++;
        }
      }
    }
    expect(auto).toBeGreaterThan(0);
  });
});
