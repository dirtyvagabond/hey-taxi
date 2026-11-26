/**
 * NPC character personalities: D&D-style 3–18 attribute rolls across 5 traits
 * (Aggression, Vengeance, Nerve, Hustle, Piloting Skill), derived archetypes,
 * and behavioral tuning profiles for the NPC autopilot.
 *
 * Pure and deterministic: uses the simulation's seeded RNG when rolling a new
 * NPC, and produces fixed attributes that survive saves and locale transfers.
 */

export interface Personality {
  /** 3–18: Unprovoked hostility, combat range, missile appetite. */
  aggression: number;
  /** 3–18: Grudge memory, vendetta trigger, cross-locale pursuit. */
  vengeance: number;
  /** 3–18: Risk tolerance, cruise speed, courage vs. fear/avoidance. */
  nerve: number;
  /** 3–18: Fare ambition, poaching willingness, cash aggressiveness. */
  hustle: number;
  /** 3–18: Piloting precision, smooth landings, obstacle/hazard evasion. */
  skill: number;
}

export type PersonalityStat = keyof Personality;

export const PERSONALITY_STATS: readonly PersonalityStat[] = [
  'aggression',
  'vengeance',
  'nerve',
  'hustle',
  'skill',
] as const;

export const STAT_MIN = 3;
export const STAT_MAX = 18;

export type Archetype =
  | 'Menace'
  | 'Avenger'
  | 'Hothead'
  | 'Timid'
  | 'Pacifist'
  | 'Wildcard'
  | 'Daredevil'
  | 'Hustler'
  | 'Ace'
  | 'Rookie'
  | 'Vindictive'
  | 'Steady';

export interface AiProfile {
  /** Flight & piloting (Nerve + Skill). */
  cruiseSpeed: number;
  climbSpeed: number;
  descendSpeed: number;
  alignX: number;
  alignVx: number;
  landDescendMax: number;
  steerDeadband: number;
  replanTicks: number;
  avoidHorizon: number;
  separationRange: number;
  gustWaitThreshold: number;
  /** Economy & supplies (Nerve + Aggression + Hustle + Skill). */
  refuelBelow: number;
  refuelCritical: number;
  /** Extra tank fraction kept as safety cushion when estimating trip fuel. */
  fuelBuffer: number;
  /** Multiplier on estimated trip fuel (< 1 = low-Skill pilots underestimate burn). */
  fuelEstimateScale: number;
  /** Cash above reserve needed to summon mobile service for convenience (Infinity = emergency only). */
  convenienceServiceCash: number;
  repairAtHp: number;
  wantMissiles: number;
  wantFlares: number;
  cashReserve: number;
  poachWilling: boolean;
  fareValueWeight: number;
  /** Combat & emotional thresholds (Aggression + Vengeance + Nerve). */
  canInitiate: boolean;
  fireRange: number;
  firePauseMin: number;
  firePauseJitter: number;
  fireWithRider: boolean;
  grudgeDecayPerSec: number;
  vendettaThreshold: number;
  pursueAcrossLocales: boolean;
  huntWithRider: boolean;
  fleeThreshold: number;
  escapeLocaleThreshold: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function norm(stat: number): number {
  return clamp((stat - STAT_MIN) / (STAT_MAX - STAT_MIN), 0, 1);
}

function d6(rng: () => number): number {
  return 1 + Math.floor(rng() * 6);
}

function roll3d6(rng: () => number): number {
  return d6(rng) + d6(rng) + d6(rng);
}

function roll4d6DropLowest(rng: () => number): number {
  const rolls = [d6(rng), d6(rng), d6(rng), d6(rng)].sort((a, b) => a - b);
  return rolls[1]! + rolls[2]! + rolls[3]!;
}

function roll4d6DropHighest(rng: () => number): number {
  const rolls = [d6(rng), d6(rng), d6(rng), d6(rng)].sort((a, b) => a - b);
  return rolls[0]! + rolls[1]! + rolls[2]!;
}

/**
 * Roll a new NPC personality on the classic 3–18 scale using "3d6 with a Signature & a Flaw":
 * one randomly chosen stat gets a boosted 4d6-drop-lowest roll, a different stat gets a
 * depressed 4d6-drop-highest roll, and the remaining three use pure 3d6. This keeps extremes
 * exciting while guaranteeing every rival has discernible character traits.
 */
export function rollPersonality(rng: () => number): Personality {
  const spikeIdx = Math.floor(rng() * PERSONALITY_STATS.length);
  let dumpIdx = Math.floor(rng() * (PERSONALITY_STATS.length - 1));
  if (dumpIdx >= spikeIdx) dumpIdx++;

  const values = PERSONALITY_STATS.map((_, i) => {
    if (i === spikeIdx) return clamp(roll4d6DropLowest(rng) + 2, STAT_MIN, STAT_MAX);
    if (i === dumpIdx) return clamp(roll4d6DropHighest(rng) - 2, STAT_MIN, STAT_MAX);
    return roll3d6(rng);
  });

  return {
    aggression: values[0]!,
    vengeance: values[1]!,
    nerve: values[2]!,
    hustle: values[3]!,
    skill: values[4]!,
  };
}

/** Balanced fallback profile (used for older saves without rolled personalities). */
export function defaultPersonality(): Personality {
  return { aggression: 10, vengeance: 10, nerve: 10, hustle: 10, skill: 10 };
}

/** Derive a concise, readable archetype title from an NPC's rolled attributes. */
export function personalityArchetype(p: Personality | null | undefined): Archetype {
  if (!p) return 'Steady';
  if (p.aggression >= 15 && p.vengeance >= 14) return 'Menace';
  if (p.vengeance >= 15 && p.aggression <= 11) return 'Avenger';
  if (p.aggression >= 15) return 'Hothead';
  if (p.nerve <= 6 && p.aggression <= 10) return 'Timid';
  if (p.aggression <= 6 && p.vengeance <= 9) return 'Pacifist';
  if (p.nerve >= 15 && p.skill <= 8) return 'Wildcard';
  if (p.nerve >= 15) return 'Daredevil';
  if (p.hustle >= 15) return 'Hustler';
  if (p.skill >= 15) return 'Ace';
  if (p.skill <= 6) return 'Rookie';
  if (p.vengeance >= 14) return 'Vindictive';
  return 'Steady';
}

/** Accent color for an archetype badge on the HUD and Overview. */
export function archetypeColor(archetype: Archetype): number {
  switch (archetype) {
    case 'Menace':
      return 0xff4d6d;
    case 'Hothead':
      return 0xff7b47;
    case 'Avenger':
    case 'Vindictive':
      return 0xe85dff;
    case 'Daredevil':
    case 'Wildcard':
      return 0xffb833;
    case 'Hustler':
      return 0x6dff8a;
    case 'Ace':
      return 0x39d0ff;
    case 'Timid':
      return 0x8cc8ff;
    case 'Pacifist':
      return 0x7ce6c3;
    case 'Rookie':
      return 0xc9b3ff;
    default:
      return 0xb0badb;
  }
}

/** Short one-line stat summary, e.g. "AGG 16 · VNG 14 · NRV 11 · HSL 9 · SKL 13". */
export function formatStats(p: Personality): string {
  return `AGG ${p.aggression} · VNG ${p.vengeance} · NRV ${p.nerve} · HSL ${p.hustle} · SKL ${p.skill}`;
}

/**
 * Format a taxi display name for compact tactical labels:
 * - "Alma Thibodeaux" -> "Alma T."
 * - "Aaron" -> "Aaron"
 * - "Aaron #2" -> "Aaron #2"
 * - "Aaron Smith #2" -> "Aaron S. #2"
 * - "Cab 2" -> "Cab 2" (non-alphabetic trailing tokens are kept as-is)
 */
export function shortTaxiName(fullName?: string | null): string {
  if (typeof fullName !== 'string') return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  const suffixMatch = trimmed.match(/^(.*?)\s+(#\d+)$/);
  const base = suffixMatch ? suffixMatch[1]!.trim() : trimmed;
  const suffix = suffixMatch ? ` ${suffixMatch[2]}` : '';
  const parts = base.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    if (/^[A-Za-z\p{L}]/u.test(last)) {
      return `${first} ${last[0]!.toUpperCase()}.${suffix}`;
    }
  }
  return `${base}${suffix}`;
}

/** Translate rolled attributes into concrete autopilot tuning parameters. */
export function aiProfile(raw?: Personality | null): AiProfile {
  const p = raw ?? defaultPersonality();
  const agg = norm(p.aggression);
  const vng = norm(p.vengeance);
  const nrv = norm(p.nerve);
  const hsl = norm(p.hustle);
  const skl = norm(p.skill);

  return {
    // Flight & piloting
    cruiseSpeed: Math.round(115 + nrv * 80 + (skl - 0.5) * 16),
    climbSpeed: Math.round(95 + nrv * 55),
    descendSpeed: Math.round(70 + nrv * 45),
    alignX: Math.round(6 - skl * 3),
    alignVx: Math.round(9 - skl * 4),
    landDescendMax: Math.round(76 - skl * 28),
    steerDeadband: Math.round(9 - skl * 5),
    replanTicks: Math.round(28 - skl * 14),
    avoidHorizon: 0.75 + skl * 0.55,
    separationRange: Math.round(165 - nrv * 90),
    gustWaitThreshold: Math.round(32 + nrv * 18),

    // Economy & supplies
    refuelBelow: clamp(0.58 - nrv * 0.34 - hsl * 0.06, 0.16, 0.62),
    refuelCritical: clamp(0.42 - nrv * 0.3, 0.1, 0.45),
    fuelBuffer: clamp(0.22 - nrv * 0.14 - (1 - skl) * 0.05, 0.04, 0.24),
    fuelEstimateScale: 0.78 + skl * 0.28,
    convenienceServiceCash: p.hustle >= 13 || p.nerve >= 15 ? Math.round(95 - hsl * 45) : Infinity,
    repairAtHp: p.nerve <= 5 ? 5 : p.nerve <= 8 ? 4 : p.nerve <= 13 ? 3 : 2,
    wantMissiles: p.aggression <= 4 ? 0 : p.aggression <= 7 ? 1 : p.aggression <= 11 ? 3 : p.aggression <= 14 ? 4 : 6,
    wantFlares: p.nerve <= 6 ? 5 : p.nerve <= 11 ? 3 : 2,
    cashReserve: Math.round(22 - hsl * 18),
    poachWilling: p.hustle >= 13,
    fareValueWeight: hsl * 0.85,

    // Combat & emotional thresholds
    canInitiate: p.aggression >= 7,
    fireRange: Math.round(380 + agg * 280),
    firePauseMin: 20 - agg * 15,
    firePauseJitter: 8 - agg * 5,
    fireWithRider: p.aggression >= 14,
    grudgeDecayPerSec: p.vengeance >= 17 ? 0.08 : 2.8 - vng * 2.5,
    vendettaThreshold: p.vengeance <= 6 ? Infinity : Math.round(125 - vng * 85),
    pursueAcrossLocales: p.vengeance >= 15,
    huntWithRider: p.vengeance >= 17,
    fleeThreshold: p.nerve >= 12 ? Infinity : Math.round(20 + ((p.nerve - 3) / 8) * 55),
    escapeLocaleThreshold: p.nerve <= 6 ? 70 : Infinity,
  };
}
