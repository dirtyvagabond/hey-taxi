import { describe, expect, it } from 'vitest';
import { CAMPAIGN } from './fixtures';
import {
  aiProfile,
  createSim,
  DEFAULT_CONFIG,
  DT,
  Input,
  parseLevel,
  personalityArchetype,
  PERSONALITY_STATS,
  rollPersonality,
  shortTaxiName,
  STAT_MAX,
  STAT_MIN,
  step,
  type SimEvent,
  type SimState,
} from '../src';

function run(s: SimState, seconds: number, inputs: Record<string, number> = {}): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...step(s, inputs));
  return out;
}

describe('NPC personalities', () => {
  it('rolls 5 D&D-style 3–18 integer attributes deterministically and produces diverse archetypes', () => {
    const a = createSim(parseLevel(CAMPAIGN[0]!.data), { npcIds: ['npc1', 'npc2', 'npc3'], seed: 42 });
    const b = createSim(parseLevel(CAMPAIGN[0]!.data), { npcIds: ['npc1', 'npc2', 'npc3'], seed: 42 });
    expect(a.taxis.filter((t) => t.npc).map((t) => t.personality)).toEqual(
      b.taxis.filter((t) => t.npc).map((t) => t.personality),
    );
    expect(a.taxis[0]!.personality).toBeNull(); // player has no NPC personality

    let x = 123456789;
    const rng = () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 4294967296;
    };
    const archetypes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = rollPersonality(rng);
      for (const k of PERSONALITY_STATS) {
        expect(Number.isInteger(p[k])).toBe(true);
        expect(p[k]).toBeGreaterThanOrEqual(STAT_MIN);
        expect(p[k]).toBeLessThanOrEqual(STAT_MAX);
      }
      archetypes.add(personalityArchetype(p));
    }
    expect(archetypes.size).toBeGreaterThanOrEqual(6);
  });

  it('classifies distinct archetypes and translates stats into meaningful AI profiles', () => {
    expect(personalityArchetype({ aggression: 17, vengeance: 16, nerve: 12, hustle: 10, skill: 11 })).toBe('Menace');
    expect(personalityArchetype({ aggression: 8, vengeance: 17, nerve: 12, hustle: 10, skill: 11 })).toBe('Avenger');
    expect(personalityArchetype({ aggression: 7, vengeance: 8, nerve: 4, hustle: 10, skill: 11 })).toBe('Timid');
    expect(personalityArchetype({ aggression: 4, vengeance: 6, nerve: 10, hustle: 10, skill: 11 })).toBe('Pacifist');
    expect(personalityArchetype({ aggression: 10, vengeance: 10, nerve: 10, hustle: 10, skill: 17 })).toBe('Ace');
    expect(personalityArchetype({ aggression: 10, vengeance: 10, nerve: 10, hustle: 10, skill: 4 })).toBe('Rookie');

    const timid = aiProfile({ aggression: 4, vengeance: 5, nerve: 3, hustle: 6, skill: 10 });
    const menace = aiProfile({ aggression: 18, vengeance: 18, nerve: 17, hustle: 16, skill: 16 });
    expect(timid.canInitiate).toBe(false);
    expect(menace.canInitiate).toBe(true);
    expect(menace.cruiseSpeed).toBeGreaterThan(timid.cruiseSpeed + 50);
    expect(timid.separationRange).toBeGreaterThan(menace.separationRange + 50);
    expect(menace.pursueAcrossLocales).toBe(true);
    expect(timid.pursueAcrossLocales).toBe(false);
    expect(menace.poachWilling).toBe(true);
    expect(timid.poachWilling).toBe(false);
  });

  it('pacifists do not initiate missile fire unprovoked, while hotheads open fire', () => {
    const pacSim = createSim(parseLevel(CAMPAIGN[0]!.data), { npcIds: ['npc1'], seed: 3 });
    pacSim.taxis[1]!.personality = { aggression: 3, vengeance: 5, nerve: 10, hustle: 10, skill: 12 };
    const pacEvents = run(pacSim, 40);
    expect(pacEvents.filter((e) => e.type === 'missileFired' && e.ownerId === 'npc1')).toHaveLength(0);

    const hotSim = createSim(parseLevel(CAMPAIGN[0]!.data), { npcIds: ['npc1'], seed: 3 });
    hotSim.taxis[1]!.personality = { aggression: 18, vengeance: 12, nerve: 14, hustle: 10, skill: 14 };
    const hotEvents = run(hotSim, 40);
    expect(hotEvents.filter((e) => e.type === 'missileFired' && e.ownerId === 'npc1').length).toBeGreaterThanOrEqual(1);
  });

  it('triggers symmetric Vendetta Mode (NPC-vs-NPC) when provoked and clears it on target destruction', () => {
    const s = createSim(parseLevel(CAMPAIGN[0]!.data), {
      playerIds: [],
      npcIds: ['npc1', 'npc2'],
      seed: 7,
      config: { passengersPerTaxi: 0, extraPassengers: 0 },
    });
    const avenger = s.taxis.find((t) => t.id === 'npc1')!;
    const attacker = s.taxis.find((t) => t.id === 'npc2')!;
    avenger.personality = { aggression: 10, vengeance: 17, nerve: 14, hustle: 10, skill: 14 };
    attacker.personality = { aggression: 18, vengeance: 10, nerve: 12, hustle: 10, skill: 12 };
    // Disable auto-flares on avenger so a missile hit lands cleanly.
    avenger.flares = 0;

    run(s, DEFAULT_CONFIG.npcArrivalDelay + 2);
    // Position both NPCs facing each other in clear open air and have attacker fire at avenger.
    Object.assign(avenger, { status: 'flying', x: 320, y: 260, vx: 0, vy: 0, gearDown: false, gear: 0 });
    Object.assign(attacker, { status: 'flying', x: 480, y: 260, vx: 0, vy: 0, gearDown: false, gear: 0 });
    attacker.ai = {
      goal: '',
      padIndex: -1,
      landX: 0,
      route: [],
      replanIn: 0,
      checkX: attacker.x,
      checkY: attacker.y,
      checkIn: 120,
      unstick: 0,
      landing: false,
      fireIn: 0,
    };

    const ev = run(s, 6);
    const started = ev.find((e) => e.type === 'vendettaStarted' && e.taxiId === 'npc1' && e.targetId === 'npc2');
    expect(started).toBeDefined();
    expect(avenger.vendettaTargetId).toBe('npc2');

    // Destroying the target ends the vendetta.
    attacker.hp = 1;
    const ev2 = [...step(s, {})];
    s.pending.push({
      type: 'crashed',
      taxiId: 'npc2',
      reason: 'missile',
      x: attacker.x,
      y: attacker.y,
      vx: 0,
      vy: 0,
      byTaxiId: 'npc1',
    });
    attacker.status = 'destroyed';
    ev2.push(...step(s, {}));
    expect(avenger.vendettaTargetId).toBeNull();
    expect(ev2.some((e) => e.type === 'vendettaEnded' && e.taxiId === 'npc1' && e.targetId === 'npc2' && e.reason === 'destroyed')).toBe(true);
  });

  it('triggers Flee Mode on a timid NPC when fired upon', () => {
    const s = createSim(parseLevel(CAMPAIGN[0]!.data), {
      npcIds: ['npc1'],
      seed: 2,
      config: { passengersPerTaxi: 0, extraPassengers: 0 },
    });
    const timid = s.taxis[1]!;
    timid.personality = { aggression: 4, vengeance: 4, nerve: 3, hustle: 8, skill: 12 };
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const ev = [...step(s, { p1: Input.FIRE }), ...run(s, 1)];
    expect(ev.some((e) => e.type === 'npcFleeing' && e.taxiId === 'npc1' && e.fromTaxiId === 'p1')).toBe(true);
    expect(timid.fleeFromId).toBe('p1');
    expect(timid.vendettaTargetId).toBeNull();
  });

  it('formats taxi names compactly for tactical labels', () => {
    expect(shortTaxiName('Alma Thibodeaux')).toBe('Alma T.');
    expect(shortTaxiName("Alma O'Rourke")).toBe('Alma O.');
    expect(shortTaxiName('Alva T.')).toBe('Alva T.');
    expect(shortTaxiName('Aaron')).toBe('Aaron');
    expect(shortTaxiName('Aaron #2')).toBe('Aaron #2');
    expect(shortTaxiName('Aaron Smith #2')).toBe('Aaron S. #2');
    expect(shortTaxiName('Cab 2')).toBe('Cab 2');
    expect(shortTaxiName('npc1')).toBe('npc1');
    expect(shortTaxiName('  ')).toBe('');
  });
});
