import { DEFAULT_CONFIG, spawnPassenger, type SimState } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec';
import { longWaiting } from '../src/population';
import { GameSession, type GameSave } from '../src/session';
import { World, WORLD_LEVELS } from '../src/world';
import { parkOnTeleport, startedSession } from './helpers';

const PLAYER_ID = 'p1';
const C = DEFAULT_CONFIG;
const WAIT = Math.round(C.demandWaitSeconds * 60);

function started(seed = 1): GameSession {
  return startedSession(seed);
}

function play(s: GameSession, ticks: number): void {
  for (let i = 0; i < ticks && s.running; i++) {
    s.setInput(0);
    s.tick();
  }
}

/** Two passengers who have waited past the threshold, with nobody heading for them. */
function shortage(sim: SimState): void {
  for (const p of sim.passengers) if (p.state === 'waiting') p.waitTicks = 0;
  const pads = sim.level.pads.filter((p) => p.kind === 'pad');
  for (const pad of pads.slice(0, 2)) {
    const p = spawnPassenger(sim, { padIndex: pad.index, destPadIndex: pads[3]!.index, x: pad.x + 50 });
    p.waitTicks = WAIT + 60;
  }
  for (const t of sim.taxis) if (t.ai) t.ai.goal = 'idle:0'; // nobody's claimed them yet
}

/** Make a taxi idle, healthy and fuelled (a good candidate to send elsewhere). */
function fit(world: World, id: string): void {
  const t = world.taxi(id)!;
  Object.assign(t, { status: 'flying', fuel: C.fuelMax, hp: C.taxiMaxHp, relocateTo: null, passengerId: -1 });
}

function checkNow(world: World): void {
  world.population.nextCheckTick = 0;
  world.policy.step();
}

describe('rival population', () => {
  it('starts with each locale’s baseline rivals, with distinct names', () => {
    const w = World.create({ ...C }, 5, [PLAYER_ID]);
    const rivals = Object.values(w.taxis).filter((r) => r.npc);
    const expectedTotal = w.locales.reduce((n, l) => n + l.sim.level.rivals, 0);
    expect(rivals).toHaveLength(expectedTotal);
    expect(rivals.map((r) => r.id)).toEqual(Array.from({ length: expectedTotal }, (_, i) => `npc${i + 1}`));
    for (const l of w.locales) {
      expect(rivals.filter((r) => r.localeId === l.id)).toHaveLength(l.sim.level.rivals);
    }
    const names = rivals.map((r) => r.name);
    expect(new Set(names).size).toBe(expectedTotal);
    for (const n of names) expect(n).toMatch(/^\S+ \S+$/);
    expect(w.nameOf(PLAYER_ID)).toBe('You');
    // Same seed, same names (seeded, not random per load).
    expect(Object.values(World.create({ ...C }, 5, [PLAYER_ID]).taxis).map((r) => r.name)).toEqual(
      Object.values(w.taxis).map((r) => r.name),
    );
  });

  it('passenger supply is set by the locale, not by how many taxis are around', { timeout: 15000 }, () => {
    for (const rivals of [0, 3]) {
      const w = World.create({ ...C }, 7, [PLAYER_ID]);
      for (let i = 0; i < rivals; i++) w.createRival(WORLD_LEVELS[2]);
      let most = 0;
      for (let i = 0; i < 60 * 120; i++) {
        w.step({});
        for (const l of w.locales) {
          const waiting = l.sim.passengers.filter((p) => p.state === 'waiting' || p.state === 'walking').length;
          expect(waiting).toBeLessThanOrEqual(l.sim.level.maxWaiting);
          most = Math.max(most, waiting);
        }
      }
      expect(most).toBeGreaterThan(0);
    }
  });

  it('a shortage redirects an idle, fit rival from a locale with spare capacity, once', () => {
    const w = World.create({ ...C }, 11, [PLAYER_ID]);
    for (let i = 0; i < 60 * 12; i++) w.step({});
    const target = w.locale(WORLD_LEVELS[2]);
    const extraId = w.createRival(WORLD_LEVELS[0]); // First Shift now exceeds its baseline floor
    for (let i = 0; i < 30; i++) w.step({});
    for (const t of w.locale(WORLD_LEVELS[0]).sim.taxis) if (t.npc) fit(w, t.id);
    for (const p of w.locale(WORLD_LEVELS[0]).sim.passengers) p.state = 'leaving';
    // Ensure only target has a shortage.
    for (const l of w.locales) if (l !== target) for (const p of l.sim.passengers) if (p.state === 'waiting') p.waitTicks = 0;
    shortage(target.sim);
    expect(longWaiting(target.sim, WAIT)).toBeGreaterThanOrEqual(2);
    checkNow(w);
    const sent = Object.values(w.taxis).filter((r) => w.taxi(r.id)?.relocateTo === target.id);
    expect(sent).toHaveLength(1);
    expect(w.population.reservations).toMatchObject([{ localeId: target.id, kind: 'redirect', taxiId: sent[0]!.id }]);
    expect(w.policy.diagnostics().locales.find((l) => l.id === target.id)!.reserved).toBe(1);
    expect(extraId).toBeTruthy();
    // The same shortage again: no second dispatch while the first is on its way.
    checkNow(w);
    checkNow(w);
    expect(Object.values(w.taxis).filter((r) => w.taxi(r.id)?.relocateTo === target.id)).toHaveLength(1);
    expect(w.population.decisions.at(-1)!.text).toMatch(/sending .* over from First Shift/);
  });

  it('the redirected rival really goes: transferred once, recorded, and clears its reservation', () => {
    const s = started(12);
    play(s, 60 * 12);
    const w = s.world;
    w.createRival(WORLD_LEVELS[0]);
    play(s, 30);
    for (const t of w.locale(WORLD_LEVELS[0]).sim.taxis) if (t.npc) fit(w, t.id);
    for (const p of w.locale(WORLD_LEVELS[0]).sim.passengers) p.state = 'leaving';
    for (const l of w.locales) if (l.id !== WORLD_LEVELS[2]) for (const p of l.sim.passengers) if (p.state === 'waiting') p.waitTicks = 0;
    shortage(w.locale(WORLD_LEVELS[2]).sim);
    checkNow(w);
    const sent = Object.values(w.taxis).find((r) => w.taxi(r.id)?.relocateTo === WORLD_LEVELS[2])!;
    let arrived = false;
    for (let i = 0; i < 60 * 90 && !arrived; i++) {
      play(s, 1);
      arrived = w.taxis[sent.id]!.localeId === WORLD_LEVELS[2];
    }
    expect(arrived).toBe(true);
    expect(s.ledger.entries.filter((e) => e.taxiId === sent.id && e.category === 'transfer')).toHaveLength(1);
    // Reservation is cleared on arrival so diagnostics never double-count the arrived taxi.
    expect(w.population.reservations.some((r) => r.taxiId === sent.id)).toBe(false);
    expect(w.policy.diagnostics().locales.find((l) => l.id === WORLD_LEVELS[2])!.reserved).toBe(0);
  });

  it('with no taxi to spare, a brand-new rival appears (new ID, name, money) without double-counting reservations', () => {
    const s = started(13);
    play(s, 60 * 12);
    const w = s.world;
    // Nobody can be spared: every rival is low on fuel, and no other locale has a shortage.
    for (const l of w.locales) {
      for (const t of l.sim.taxis) if (t.npc) t.fuel = 10;
      for (const p of l.sim.passengers) if (p.state === 'waiting') p.waitTicks = 0;
    }
    shortage(w.locale(WORLD_LEVELS[1]).sim);
    const names = new Set(Object.values(w.taxis).map((r) => r.name));
    const nextId = `npc${w.nextRivalNumber}`;
    const afterId = `npc${w.nextRivalNumber + 1}`;
    checkNow(w);
    const fresh = w.taxis[nextId]!;
    expect(fresh).toMatchObject({ npc: true, localeId: WORLD_LEVELS[1] });
    expect(names.has(fresh.name)).toBe(false);
    expect(w.taxi(nextId)).toMatchObject({ fuel: C.fuelMax, hp: C.taxiMaxHp, missiles: C.startMissiles });
    // Newly spawned rival is already in the locale, so it is not double-counted as "on the way".
    expect(w.policy.diagnostics().locales.find((l) => l.id === WORLD_LEVELS[1])!.reserved).toBe(0);
    play(s, 2);
    expect(s.ledger.entries.find((e) => e.taxiId === nextId)).toMatchObject({ category: 'opening', amount: 10000, locale: WORLD_LEVELS[1] });
    // Another shortage elsewhere right away: the spawn cooldown holds it off.
    shortage(w.locale(WORLD_LEVELS[2]).sim);
    for (const l of w.locales) for (const t of l.sim.taxis) if (t.npc) t.fuel = 10;
    checkNow(w);
    expect(w.taxis[afterId]).toBeUndefined();
    expect(w.policy.diagnostics().spawnCooldownSeconds).toBeGreaterThan(0);
  });

  it('never exceeds the per-locale and world limits; destroyed IDs are never reused', () => {
    const s = started(14);
    play(s, 60 * 12);
    const w = s.world;
    w.config.rivalSpawnCooldownSeconds = 0;
    w.config.dispatchTimeoutSeconds = 1;
    w.taxi('npc1')!.status = 'destroyed'; // a dead rival stays dead
    for (let round = 0; round < 40; round++) {
      for (const l of w.locales) {
        for (const t of l.sim.taxis) if (t.npc && t.status !== 'destroyed') t.fuel = 10;
        shortage(l.sim);
      }
      checkNow(w);
      play(s, 70);
      for (const l of w.locales) {
        const living = l.sim.taxis.filter((t) => t.npc && t.status !== 'destroyed').length;
        expect(living).toBeLessThanOrEqual(C.rivalsMaxPerLocale);
      }
      const livingAll = w.locales.flatMap((l) => l.sim.taxis).filter((t) => t.npc && t.status !== 'destroyed').length;
      expect(livingAll).toBeLessThanOrEqual(C.rivalsMaxWorld);
    }
    expect(w.taxi('npc1')!.status).toBe('destroyed');
    const ids = Object.keys(w.taxis);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('npc')).length).toBeGreaterThan(3);
  });

  it('saves keep wait times, reservations, cooldowns, names and decisions', () => {
    const s = started(15);
    play(s, 60 * 12);
    for (const l of s.world.locales) for (const t of l.sim.taxis) if (t.npc) t.fuel = 10;
    shortage(s.world.locale(WORLD_LEVELS[1]).sim);
    checkNow(s.world);
    play(s, 30);
    const save = decode<GameSave>(encode(s.toSave()));
    const b = new GameSession({ seed: 1 });
    b.restore(save, structuredClone(s.ledger.entries));
    expect(b.world.population).toEqual(s.world.population);
    expect(b.world.taxis).toEqual(s.world.taxis);
    const waits = (g: GameSession) => g.world.locales.flatMap((l) => l.sim.passengers.map((p) => p.waitTicks));
    expect(waits(b)).toEqual(waits(s));
  });

  it('a long run stays bounded: limits hold, demand is capped, decisions are logged', { timeout: 20000 }, () => {
    const s = started(16);
    parkOnTeleport(s.sim, s.player!); // safe from missiles, so the world runs the full ten minutes
    for (let minute = 0; minute < 10; minute++) {
      play(s, 60 * 60);
      const d = s.world.policy.diagnostics();
      expect(d.livingRivals).toBeLessThanOrEqual(C.rivalsMaxWorld);
      for (const l of d.locales) {
        expect(l.rivalsLiving).toBeLessThanOrEqual(C.rivalsMaxPerLocale);
        expect(l.waiting).toBeLessThanOrEqual(s.world.locale(l.id).sim.level.maxWaiting);
      }
    }
    expect(s.running).toBe(true);
    expect(s.world.population.decisions.length).toBeGreaterThan(0);
    expect(s.ledger.entries.filter((e) => e.category === 'fare').length).toBeGreaterThan(20); // useful traffic
    expect(
      s.ledger.mismatches(
        s.world.locales.flatMap((l) => l.sim.taxis),
        Object.fromEntries(Object.entries(s.players).map(([id, ps]) => [id, ps.cents])),
      ),
    ).toEqual([]);
  });
});
