import { DEFAULT_CONFIG, spawnPassenger, targetable } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec';
import { GameSession, type GameSave } from '../src/session';
import { WORLD_LEVELS } from '../src/world';
import { parkOnTeleport, startedSession } from './helpers';

function play(s: GameSession, ticks: number): void {
  for (let i = 0; i < ticks && s.running; i++) {
    s.setInput(0);
    s.tick();
  }
}

describe('teleports', () => {
  it('every locale has a teleport pad, separate from passenger pads and stores', () => {
    const s = startedSession();
    for (const l of s.world.locales) {
      const kinds = l.sim.level.pads.map((p) => p.kind);
      expect(kinds).toContain('teleport');
      expect(kinds).toContain('pad');
      expect(kinds).toContain('fuel');
    }
  });

  it('the player travels free with an empty cab, keeping everything; it is recorded and saved', () => {
    const s = startedSession(2);
    const pid = s.playerId;
    play(s, 120);
    parkOnTeleport(s.sim, s.player!);
    Object.assign(s.player!, { fuel: 7, hp: 3, missiles: 0, flares: 4, fireCooldownTicks: 11 });
    s.debugPatch(pid, { cents: 4321 });
    const ledgerLen = s.ledger.entries.length;
    s.saveRequest = null;
    expect(s.teleport(WORLD_LEVELS[2])).toBe('ok');
    expect(s.levelId).toBe(WORLD_LEVELS[2]);
    expect(s.player!).toMatchObject({ fuel: 7, hp: 3, missiles: 0, flares: 4, fireCooldownTicks: 11, cents: 4321, status: 'landed' });
    expect(s.sim.level.pads[s.player!.padIndex]!.kind).toBe('teleport');
    expect(s.world.locales.filter((l) => l.sim.taxis.some((t) => t.id === pid))).toHaveLength(1);
    const e = s.ledger.entries.slice(ledgerLen);
    expect(e).toEqual([
      expect.objectContaining({ taxiId: pid, category: 'transfer', amount: 0, balance: 4321, locale: WORLD_LEVELS[2] }),
    ]);
    expect(s.saveRequest).toBe('transfer');
    expect(s.mode).toBe('playing');
  });

  it('refuses off a teleport pad or during boarding, with no partial transfer', () => {
    const s = startedSession(3);
    expect(s.teleport(WORLD_LEVELS[1])).toBe('notAtTeleport');
    parkOnTeleport(s.sim, s.player!);
    const p = spawnPassenger(s.sim, { padIndex: s.player!.padIndex, destPadIndex: 0, x: s.player!.x + 40 });
    p.state = 'walking';
    p.taxiId = s.playerId;
    const before = s.ledger.entries.length;
    expect(s.teleport(WORLD_LEVELS[1])).toBe('occupied');
    expect(s.levelId).toBe(WORLD_LEVELS[0]);
    expect(s.ledger.entries.length).toBe(before);
  });

  it('a blocked arrival leaves the taxi safely where it is', () => {
    const s = startedSession(4);
    play(s, 60);
    parkOnTeleport(s.sim, s.player!);
    const dest = s.world.locale(WORLD_LEVELS[1]);
    const pad = dest.sim.level.pads.find((p) => p.kind === 'teleport')!;
    const blocker = dest.sim.taxis.find((t) => t.npc)!;
    for (let x = pad.x; x <= pad.x + pad.w; x += 30) {
      dest.sim.taxis.push({ ...structuredClone(blocker), id: `block${x}`, status: 'landed', x, y: pad.y - 24 });
    }
    const before = { ledger: s.ledger.entries.length, cents: s.player!.cents, fuel: s.player!.fuel };
    expect(s.teleport(WORLD_LEVELS[1])).toBe('blocked');
    expect(s.levelId).toBe(WORLD_LEVELS[0]);
    expect(s.player!).toMatchObject({ status: 'landed', cents: before.cents, fuel: before.fuel });
    expect(s.ledger.entries.length).toBe(before.ledger);
  });

  it("co-pilots never change: not through a teleport, not through a save", () => {
    const s = startedSession(9);
    play(s, 60);
    const before = Object.fromEntries(s.world.locales.flatMap((l) => l.sim.taxis).map((t) => [t.id, t.copilot.countermeasureProficiency]));
    for (const p of Object.values(before)) expect(p).toBeGreaterThanOrEqual(65);
    parkOnTeleport(s.sim, s.player!);
    expect(s.teleport(WORLD_LEVELS[1])).toBe('ok');
    expect(s.player!.copilot.countermeasureProficiency).toBe(before[s.playerId]);
    const b = new GameSession({ seed: 1 });
    b.restore(decode<GameSave>(encode(s.toSave())), structuredClone(s.ledger.entries));
    const after = Object.fromEntries(b.world.locales.flatMap((l) => l.sim.taxis).map((t) => [t.id, t.copilot.countermeasureProficiency]));
    expect(after).toEqual(before);
  });

  it('a taxi parked on a teleport is invisible to missiles', () => {
    const s = startedSession(5);
    parkOnTeleport(s.sim, s.player!);
    expect(targetable(s.sim, s.player!)).toBe(false);
    s.player!.status = 'flying';
    expect(targetable(s.sim, s.player!)).toBe(true);
  });

  it('an NPC asked to relocate flies to a teleport, transfers exactly once, and goes to work there', () => {
    const s = startedSession(6);
    play(s, Math.round((DEFAULT_CONFIG.npcArrivalDelay + 2) * 60));
    const npc = s.world.locale(WORLD_LEVELS[0]).sim.taxis.find((t) => t.npc && t.status !== 'offstage')!;
    npc.relocateTo = WORLD_LEVELS[1];
    let moved = false;
    for (let i = 0; i < 60 * 60 && !moved; i++) {
      play(s, 1);
      moved = s.world.taxis[npc.id]!.localeId === WORLD_LEVELS[1];
    }
    expect(moved).toBe(true);
    const there = s.world.taxi(npc.id)!;
    expect(there.relocateTo).toBeNull();
    expect(s.world.locales.filter((l) => l.sim.taxis.some((t) => t.id === npc.id))).toHaveLength(1);
    expect(s.ledger.entries.filter((e) => e.taxiId === npc.id && e.category === 'transfer')).toHaveLength(1);
    expect(s.saveRequest === 'transfer' || s.save.state !== 'none').toBe(true);
    play(s, 60 * 40);
    expect(['flying', 'landed']).toContain(there.status);
    expect(
      s.ledger.mismatches(
        s.world.locales.flatMap((l) => l.sim.taxis),
        Object.fromEntries(Object.entries(s.players).map(([id, ps]) => [id, ps.cents])),
      ),
    ).toEqual([]);
  });
});
