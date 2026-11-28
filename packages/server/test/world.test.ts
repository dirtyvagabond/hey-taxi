import { DEFAULT_CONFIG, Input } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec';
import { GameSession, wireSim, type GameSave } from '../src/session';
import { World, WORLD_LEVELS } from '../src/world';
import { startedSession, teleportTo, TEST_ACCOUNT } from './helpers';

/** The player stays parked and fires now and then; the world gets busy on its own. */
function play(s: GameSession, ticks: number, from = 0): void {
  for (let i = from; i < from + ticks && s.running; i++) {
    s.setInput(i % 900 === 700 ? Input.FIRE : 0);
    s.tick();
  }
}

/** Everything about every locale (incl. AI memory and RNG), the registry and the ledger. */
function fingerprint(s: GameSession): string {
  return JSON.stringify({ world: s.world.save(), ledger: s.ledger.entries, mode: s.mode });
}

describe('world', () => {
  it('has all locales running from the start, with globally unique taxi IDs', () => {
    const w = World.create({ ...DEFAULT_CONFIG }, 7, ['p1']);
    expect(w.locales.map((l) => l.id)).toEqual([...WORLD_LEVELS]);
    const ids = w.locales.flatMap((l) => l.sim.taxis.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(w.taxis).sort()).toEqual([...ids].sort());
    expect(w.localeOf('p1').id).toBe(WORLD_LEVELS[0]);
  });

  it('every locale advances together while running, including ones the player isn’t in', () => {
    const s = startedSession(3);
    play(s, 60 * 90);
    for (const l of s.world.locales) expect(l.sim.tick).toBe(s.worldTick);
    const elsewhere = s.ledger.entries.filter((e) => e.locale !== s.levelId && e.category === 'fare');
    expect(elsewhere.length).toBeGreaterThan(0);
    expect(new Set(s.ledger.entries.map((e) => e.locale)).size).toBe(WORLD_LEVELS.length);
  }, 15_000);

  it('the whole world freezes on pause, at the menu and on disconnect', () => {
    const s = startedSession(4);
    play(s, 300);
    const ticks = () => s.world.locales.map((l) => l.sim.tick);
    const before = ticks();
    s.command('pause');
    play(s, 300);
    s.tick();
    expect(ticks()).toEqual(before);
    s.leaveAccount();
    s.tick();
    expect(ticks()).toEqual(before);
    s.joinAccount(TEST_ACCOUNT);
    s.command('pause'); // resume
    s.onDisconnect();
    s.tick();
    expect(ticks()).toEqual(before);
  });

  it('save/load restores every locale at the same tick and continues identically', () => {
    const a = startedSession(9);
    play(a, 60 * 60);
    const save = decode<GameSave>(encode(a.toSave()));
    const b = new GameSession({ seed: 1 });
    b.restore(save, structuredClone(a.ledger.entries));
    b.joinAccount(TEST_ACCOUNT);
    b.command('pause'); // resume
    expect(new Set(b.world.locales.map((l) => l.sim.tick))).toEqual(new Set([a.worldTick]));
    expect(fingerprint(b)).toBe(fingerprint(a));
    play(a, 60 * 60, 3600);
    play(b, 60 * 60, 3600);
    expect(fingerprint(b)).toBe(fingerprint(a));
  }, 15_000);

  it('transfers a taxi exactly once, carrying everything, without resetting either locale', () => {
    const s = startedSession(5);
    const pid = s.playerId;
    play(s, 60 * 40);
    const from = s.world.localeOf(pid);
    const to = s.world.locale(WORLD_LEVELS[1]);
    Object.assign(s.player!, { fuel: 61, hp: 4, missiles: 1, flares: 2, fireCooldownTicks: 17 });
    s.debugPatch(pid, { cents: 12345 });
    const fromState = { tick: from.sim.tick, rivals: from.sim.taxis.filter((t) => t.npc).map((t) => [t.id, t.x, t.y]) };
    const toState = { tick: to.sim.tick, passengers: to.sim.passengers.length, rivals: to.sim.taxis.map((t) => t.id) };
    s.world.transfer(pid, to.id);

    const everywhere = s.world.locales.flatMap((l) => l.sim.taxis.filter((t) => t.id === pid).map(() => l.id));
    expect(everywhere).toEqual([to.id]);
    expect(s.world.taxis[pid]!.localeId).toBe(to.id);
    expect(s.player!).toMatchObject({ fuel: 61, hp: 4, missiles: 1, flares: 2, fireCooldownTicks: 17, cents: 12345, status: 'landed' });
    expect(from.sim.tick).toBe(fromState.tick);
    expect(from.sim.taxis.filter((t) => t.npc).map((t) => [t.id, t.x, t.y])).toEqual(fromState.rivals);
    expect(to.sim.tick).toBe(toState.tick);
    expect(to.sim.passengers.length).toBe(toState.passengers);
    expect(to.sim.taxis.map((t) => t.id)).toEqual([...toState.rivals, pid]);
    s.world.transfer(pid, to.id);
    expect(to.sim.taxis.filter((t) => t.id === pid)).toHaveLength(1);
    expect(
      s.ledger.mismatches(
        s.world.locales.flatMap((l) => l.sim.taxis),
        Object.fromEntries(Object.entries(s.players).map(([id, ps]) => [id, ps.cents])),
      ),
    ).toEqual([]);
  });

  it('after a teleport the browser view follows the player; the old locale carries on', () => {
    const s = startedSession(6);
    const pid = s.playerId;
    play(s, 600);
    s.simReset = false;
    teleportTo(s, WORLD_LEVELS[1]);
    expect(s.levelId).toBe(WORLD_LEVELS[1]);
    expect(s.mode).toBe('playing');
    expect(s.simReset).toBe(true);
    expect(s.frame().sim.levelId).toBe(WORLD_LEVELS[1]);
    expect(wireSim(s.sim, s.levelId).taxis.some((t) => t.id === pid)).toBe(true);
    play(s, 120);
    const first = s.world.locale(WORLD_LEVELS[0]);
    expect(first.sim.taxis.some((t) => t.id === pid)).toBe(false);
    expect(first.sim.tick).toBe(s.worldTick);
  });

  it('a save whose locale content changed is reported as unsupported', () => {
    const s = startedSession(8);
    const save = s.toSave();
    save.world.locales[2]!.version = 'deadbeef';
    expect(() => new GameSession({ seed: 1 }).restore(save, s.ledger.entries)).toThrow(/changed/);
  });

  it('extreme-vengeance rivals pursue their vendetta target across teleports while others drop it', () => {
    const s = startedSession(9);
    const pid = s.playerId;
    teleportTo(s, WORLD_LEVELS[1]);
    play(s, 300);
    const first = s.world.locale(WORLD_LEVELS[1]);
    const rival = first.sim.taxis.find((t) => t.npc);
    expect(rival).toBeDefined();

    rival!.personality = { aggression: 15, vengeance: 17, nerve: 14, hustle: 10, skill: 12 };
    rival!.vendettaTargetId = pid;
    teleportTo(s, WORLD_LEVELS[2]);
    play(s, 60);
    expect(rival!.relocateTo).toBe(WORLD_LEVELS[2]);
    expect(rival!.vendettaTargetId).toBe(pid);

    // Retreating to the noRivals sanctuary (Santa Monica) drops cross-locale pursuit.
    rival!.relocateTo = null;
    teleportTo(s, WORLD_LEVELS[0]);
    play(s, 60);
    expect(rival!.relocateTo).toBeNull();
    expect(rival!.vendettaTargetId).toBeNull();

    teleportTo(s, WORLD_LEVELS[2]);
    rival!.relocateTo = null;
    rival!.personality = { aggression: 12, vengeance: 10, nerve: 12, hustle: 10, skill: 12 };
    rival!.vendettaTargetId = pid;
    play(s, 60);
    expect(rival!.vendettaTargetId).toBeNull();
    expect(rival!.relocateTo).toBeNull();
  });

  it('Santa Monica keeps passengers local until a player completes at least one drop-off', () => {
    const w = World.create({ ...DEFAULT_CONFIG, interlocaleChance: 1 }, 21, ['p1']);
    const beach = w.locale(WORLD_LEVELS[0]);
    // Before any player drop-off, every spawned passenger stays in Santa Monica.
    for (let i = 0; i < 60 * 20; i++) w.step({});
    expect(beach.sim.passengers.length).toBeGreaterThan(0);
    expect(beach.sim.passengers.every((p) => p.destination.localeId === beach.id)).toBe(true);
    // Once a player has delivered at least one fare, new passengers can ask for another locale.
    beach.sim.passengers = [];
    beach.sim.faresDelivered = 1;
    beach.sim.passengerSpawnTicks = 1;
    for (let i = 0; i < 60 * 10 && beach.sim.passengers.length === 0; i++) w.step({});
    expect(beach.sim.passengers.length).toBeGreaterThan(0);
    expect(beach.sim.passengers.some((p) => p.destination.localeId !== beach.id)).toBe(true);
  });

  it('marks status dirty immediately when a new rival arrives so the client has its display name', () => {
    const s = startedSession(10);
    teleportTo(s, WORLD_LEVELS[1]);
    play(s, 5);
    s.statusDirty = false;
    const id = s.world.createRival(WORLD_LEVELS[1]);
    const ev = s.tick();
    expect(ev.some((e) => e.type === 'arrived' && e.taxiId === id)).toBe(true);
    expect(s.statusDirty).toBe(true);
    const name = s.status().taxiNames[id];
    expect(name).toBeDefined();
    expect(name).not.toBe(id);
  });
});
