/**
 * Co-pilots. Every taxi has one, with a fixed set of attributes rolled (seeded) when the taxi
 * is created. For now the only attribute is countermeasure proficiency (65–95), and the
 * co-pilot's only job is popping flares:
 *
 *  - When a missile chasing the taxi first comes within the threat window (and is closing in),
 *    the co-pilot rolls once: it reacts in time with probability proficiency / 100. The
 *    outcome is stored on the missile, so it's never re-rolled (and survives saves).
 *  - A timely reaction pops one flare burst through the normal action (ammunition, cooldown and
 *    limits apply). If there are no flares, or they're cooling down, protection is unavailable
 *    for that missile; it is not retried later. A late reaction does nothing for that missile.
 *  - Several timely reactions in one tick share a single burst (one flare charge), which can
 *    also fool other missiles closing in, including ones the co-pilot was too slow for.
 *
 * Each missile a burst catches is decoyed with probability flareSuccess (95%), the same as a
 * manual burst (C). So for an isolated missile, automatic protection = proficiency% × 95%.
 */
import { deployFlares } from './missiles';
import { nextRandom } from './rng';
import { isActive, type SimEvent, type SimState, type Taxi } from './sim';

export interface CoPilot {
  /** Chance (in %) of reacting in time to an incoming missile: an integer from 65 to 95. */
  countermeasureProficiency: number;
}

export const PROFICIENCY_MIN = 65;
export const PROFICIENCY_MAX = 95;

/** A new co-pilot, rolled from the simulation's seeded RNG (uniform 65–95). */
export function newCoPilot(s: SimState): CoPilot {
  const span = PROFICIENCY_MAX - PROFICIENCY_MIN + 1;
  return { countermeasureProficiency: PROFICIENCY_MIN + Math.floor(nextRandom(s) * span) };
}

/** How far out (units) the co-pilot notices a missile: the threat range, within flare reach. */
export function threatRange(s: SimState): number {
  return Math.min(s.config.copilotThreatRange, s.config.flareRange);
}

/** Is this missile coming for this taxi, inside the threat window and closing in? */
export function isThreat(s: SimState, t: Taxi, m: SimState['missiles'][number]): boolean {
  if (m.targetId !== t.id || m.spoofed || m.life <= 0) return false;
  const dx = t.x - m.x;
  const dy = t.y - m.y;
  return Math.hypot(dx, dy) <= threatRange(s) && dx * m.vx + dy * m.vy > 0;
}

/** Can the co-pilot pop flares right now (has flares, not cooling down)? */
export function autoFlaresReady(t: Taxi): boolean {
  return t.flares > 0 && t.flareCooldownTicks <= 0;
}

/** Each tick, every co-pilot watches for new threats and reacts (see the file comment). */
export function stepCoPilots(s: SimState, ev: SimEvent[]): void {
  for (const t of s.taxis) {
    if (!isActive(t)) continue;
    let timely = 0;
    for (const m of s.missiles) {
      if (!isThreat(s, t, m) || m.reactions[t.id] !== undefined) continue;
      const inTime = nextRandom(s) < t.copilot.countermeasureProficiency / 100;
      m.reactions[t.id] = inTime; // decided once, for good
      ev.push({ type: 'copilotReaction', taxiId: t.id, missileId: m.id, timely: inTime });
      if (inTime) timely++;
    }
    if (!timely) continue;
    // A burst popped this very tick (e.g. a manual one) already covers it: never two at once.
    if (ev.some((e) => e.type === 'flaresDeployed' && e.taxiId === t.id)) continue;
    if (autoFlaresReady(t)) deployFlares(s, t, ev, true);
    else ev.push({ type: 'copilotUnable', taxiId: t.id, reason: t.flares <= 0 ? 'noFlares' : 'cooldown' });
  }
}
