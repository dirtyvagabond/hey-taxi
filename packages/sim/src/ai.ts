/**
 * NPC taxi autopilot. Produces an Input bitfield each tick, flying with exactly the same
 * physics and landing rules as a player. Deliberately careful: modest speed caps, braking
 * margins, and a slow, centered final approach. Deterministic (no randomness, no clocks).
 *
 * How it works:
 *  1. Pick a goal: deliver the rider → else refuel if low (buying gas by the gallon) → else the nearest free waiting
 *     passenger → else land somewhere quiet and wait.
 *  2. Plan a route on the tile grid (cells are 2×1 tiles, big enough for the taxi), preferring
 *     open space, from the taxi to the air above the landing spot. Replanned periodically.
 *  3. Follow the route, cutting corners where the straight line is clear, then hover over the
 *     landing spot and descend slowly.
 */
import { DT, Input, TAXI, TICK_RATE } from './constants';
import { envForceAt, laserState, pointInGravityCore, windAt } from './env';
import { boxHitsSolid, padIndexAt, type Level, type Pad } from './level';
import { hasLineOfFire, shopMultiplier, storeItem, targetable, type StoreItem } from './missiles';
import { acceptsDriver, canBoardHere, walkable } from './journeys';
import { PASSENGER, riderOf } from './passengers';
import { aiProfile, type AiProfile } from './personality';
import { nextRandom } from './rng';
import { atService, canSummonService, serviceCraftFor } from './service';
import { atStore, atTeleport, isActive, type Passenger, type SimEvent, type SimState, type Taxi } from './sim';

export interface AiState {
  /** Identifies the current goal; a new goal triggers a replan. */
  goal: string;
  padIndex: number;
  landX: number;
  /** Surface elevation for a roadside pickup outside the numbered pads. */
  surfaceY?: number;
  /** Planned route as flattened [x0, y0, x1, y1, …] waypoints (world units). */
  route: number[];
  replanIn: number;
  /** Stuck detection: position at the last check, and ticks until the next check. */
  checkX: number;
  checkY: number;
  checkIn: number;
  /** Ticks left of a "climb straight up" maneuver used to get unstuck. */
  unstick: number;
  /** On final approach to the current goal's landing spot. */
  landing: boolean;
  /** Ticks until the rival may consider firing another missile. */
  fireIn: number;
  /** Dynamic grudge/threat score against other taxis (player or NPC); decays over time. */
  grudges?: Record<string, number>;
  /** Set when a timid NPC has been harassed enough to want to escape to another locale. */
  wantEscapeLocale?: boolean;
  /** Last planned target coordinates when hunting a moving taxi. */
  huntX?: number;
  huntY?: number;
}

/** First shot delay after arriving (seconds). */
const FIRST_SHOT_DELAY = 8;
/** Grudge/threat heat added by hostile or irritating events (symmetric: player or NPC). */
const HEAT_MISSILE_FIRED = 26;
const HEAT_MISSILE_HIT = 55;
const HEAT_COLLISION_DAMAGE = 24;
const HEAT_BUMP = 14;
const HEAT_POACH_BASE = 12;

interface Goal {
  key: string;
  padIndex: number;
  landX: number;
  /** Surface elevation for a roadside pickup outside the numbered pads. */
  surfaceY?: number;
  /** Stay put (landed): waiting for a passenger to board, refueling, or idle. */
  stay?: boolean;
  /** Airborne pursuit target (for Vendetta hunting, no landing). */
  hunt?: { x: number; y: number };
}

const LOOKAHEAD = 6;
const STUCK_CHECK_TICKS = 120;
const REFUEL_UNTIL = 0.95;
/** Picking a store: one that's taken (someone parked there or heading in) counts as this much farther. */
const TAKEN_STORE_DETOUR = 500;

function ensureAi(t: Taxi): AiState {
  const ai = (t.ai ??= {
    goal: '',
    padIndex: -1,
    landX: 0,
    route: [],
    replanIn: 0,
    checkX: t.x,
    checkY: t.y,
    checkIn: STUCK_CHECK_TICKS,
    unstick: 0,
    landing: false,
    fireIn: Math.round(FIRST_SHOT_DELAY * TICK_RATE),
    grudges: {},
  });
  ai.grudges ??= {};
  // If a vendetta was carried across a teleport, seed its grudge so it doesn't cool off on tick 1.
  if (t.vendettaTargetId && ai.grudges[t.vendettaTargetId] === undefined) {
    const prof = aiProfile(t.personality);
    if (Number.isFinite(prof.vendettaThreshold)) {
      ai.grudges[t.vendettaTargetId] = prof.vendettaThreshold + 35;
    }
  }
  return ai;
}

export function npcInput(s: SimState, t: Taxi): number {
  const ai = ensureAi(t);
  const prof = aiProfile(t.personality);
  const emergency = t.passengerId >= 0 && t.status === 'flying' && (t.fuel <= 0 ||
    (t.hp <= s.config.missileDamage && t.flares === 0 && s.missiles.some(m =>
      m.targetId === t.id && Math.hypot(t.x - m.x, t.y - m.y) < 150)));
  return (emergency ? Input.EJECT : 0) | moveInput(s, t, ai, prof) | combatInput(s, t, ai, prof) | shopInput(s, t, prof);
}

// ── Dynamic relationship memory (vendettas & fear) ───────────────────────────

function addGrudge(t: Taxi, otherId: string, amount: number): void {
  if (!t.npc || !isActive(t) || otherId === t.id || amount <= 0) return;
  const ai = ensureAi(t);
  ai.grudges![otherId] = Math.min(200, (ai.grudges![otherId] ?? 0) + amount);
}

/**
 * Update every active NPC's grudge/threat memory from the events of this tick, decay old
 * grudges according to Vengeance, and transition into/out of Vendetta or Flee mode.
 * Symmetric: treats player and NPC actors identically.
 */
export function stepNpcMemory(s: SimState, ev: SimEvent[]): void {
  const npcs = s.taxis.filter((t) => t.npc && isActive(t));
  if (!npcs.length) return;
  const byId = new Map(s.taxis.map((t) => [t.id, t]));

  // 1. Decay existing grudges.
  for (const t of npcs) {
    const ai = ensureAi(t);
    const prof = aiProfile(t.personality);
    const decay = prof.grudgeDecayPerSec * DT;
    const grudges = ai.grudges!;
    for (const [id, val] of Object.entries(grudges)) {
      // Don't decay a vendetta target's grudge while they are in another locale being pursued.
      if (id === t.vendettaTargetId && !byId.has(id)) continue;
      const next = val - decay;
      if (next <= 0) delete grudges[id];
      else grudges[id] = next;
    }
  }

  // 2. Apply this tick's events to grudge/threat scores.
  const tickEvents = ev.slice();
  for (const e of tickEvents) {
    switch (e.type) {
      case 'missileFired': {
        const m = s.missiles.find((x) => x.id === e.missileId);
        if (m?.targetId) {
          const victim = byId.get(m.targetId);
          if (victim) addGrudge(victim, e.ownerId, HEAT_MISSILE_FIRED);
        }
        break;
      }
      case 'taxiDamaged': {
        if (e.byTaxiId) {
          const victim = byId.get(e.taxiId);
          if (victim) addGrudge(victim, e.byTaxiId, e.cause === 'missile' ? HEAT_MISSILE_HIT : HEAT_COLLISION_DAMAGE);
        }
        break;
      }
      case 'taxiBump': {
        if (e.speed >= 40) {
          const [aId, bId] = e.taxiIds;
          const a = byId.get(aId);
          const b = byId.get(bId);
          if (a) addGrudge(a, bId, HEAT_BUMP);
          if (b) addGrudge(b, aId, HEAT_BUMP);
        }
        break;
      }
      case 'passengerBoarded': {
        const key = `pick:${e.passengerId}`;
        for (const t of npcs) {
          if (t.id !== e.taxiId && t.ai?.goal === key) {
            const hustle = t.personality?.hustle ?? 10;
            const bonus = Math.round(((hustle - 3) / 15) * 14);
            addGrudge(t, e.taxiId, HEAT_POACH_BASE + bonus);
          }
        }
        break;
      }
      case 'crashed': {
        for (const t of npcs) {
          const ai = ensureAi(t);
          delete ai.grudges![e.taxiId];
          if (t.vendettaTargetId === e.taxiId) {
            t.vendettaTargetId = null;
            ev.push({ type: 'vendettaEnded', taxiId: t.id, targetId: e.taxiId, reason: 'destroyed' });
          }
          if (t.fleeFromId === e.taxiId) {
            t.fleeFromId = null;
            ai.wantEscapeLocale = false;
          }
        }
        break;
      }
    }
  }

  // 3. Evaluate Vendetta & Fear/Flee state transitions.
  for (const t of npcs) {
    const ai = ensureAi(t);
    const prof = aiProfile(t.personality);
    const grudges = ai.grudges!;

    // Existing vendetta check
    if (t.vendettaTargetId) {
      const target = byId.get(t.vendettaTargetId);
      if (target && !isActive(target)) {
        const old = t.vendettaTargetId;
        t.vendettaTargetId = null;
        delete grudges[old];
        ev.push({ type: 'vendettaEnded', taxiId: t.id, targetId: old, reason: 'destroyed' });
      } else if (target && (grudges[t.vendettaTargetId] ?? 0) < prof.vendettaThreshold * 0.45) {
        const old = t.vendettaTargetId;
        t.vendettaTargetId = null;
        ev.push({ type: 'vendettaEnded', taxiId: t.id, targetId: old, reason: 'cooledOff' });
      }
    }

    // Trigger new vendetta?
    if (!t.vendettaTargetId && Number.isFinite(prof.vendettaThreshold)) {
      let bestId: string | null = null;
      let bestScore = prof.vendettaThreshold;
      for (const [id, score] of Object.entries(grudges)) {
        const other = byId.get(id);
        if (other && isActive(other) && score >= bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      if (bestId) {
        t.vendettaTargetId = bestId;
        t.fleeFromId = null;
        ai.wantEscapeLocale = false;
        ev.push({ type: 'vendettaStarted', taxiId: t.id, targetId: bestId });
      }
    }

    // Fear / Fleeing (only if not on a vendetta)
    if (!t.vendettaTargetId && Number.isFinite(prof.fleeThreshold)) {
      let topId: string | null = null;
      let topScore = 0;
      for (const [id, score] of Object.entries(grudges)) {
        const other = byId.get(id);
        if (other && isActive(other) && score > topScore) {
          topScore = score;
          topId = id;
        }
      }
      if (topId && topScore >= prof.fleeThreshold) {
        if (t.fleeFromId !== topId) {
          t.fleeFromId = topId;
          ev.push({ type: 'npcFleeing', taxiId: t.id, fromTaxiId: topId });
        }
        if (topScore >= prof.escapeLocaleThreshold) ai.wantEscapeLocale = true;
      } else if (t.fleeFromId) {
        const cur = grudges[t.fleeFromId] ?? 0;
        const other = byId.get(t.fleeFromId);
        if (!other || !isActive(other) || cur < prof.fleeThreshold * 0.4) {
          t.fleeFromId = null;
          ai.wantEscapeLocale = false;
        }
      }
    } else if (t.fleeFromId) {
      t.fleeFromId = null;
      ai.wantEscapeLocale = false;
    }
  }
}

// ── Combat & shopping ────────────────────────────────────────────────────────

/** Fire missiles according to Aggression, Vengeance (vendetta priority), and rider policy. */
function combatInput(s: SimState, t: Taxi, ai: AiState, prof: AiProfile): number {
  // (Flares are the co-pilot's job: see copilot.ts.)
  let input = 0;

  if (ai.fireIn > 0) ai.fireIn--;
  if (ai.fireIn <= 0 && t.missiles > 0 && t.fireCooldownTicks === 0 && !(t.prevInput & Input.FIRE)) {
    const hasRider = riderOf(s, t.id) !== undefined;
    const nemesis = t.vendettaTargetId
      ? s.taxis.find((o) => o.id === t.vendettaTargetId && o !== t && targetable(s, o))
      : undefined;

    // 1. Vendetta target gets priority, slightly longer range, and faster follow-up shots.
    if (
      nemesis &&
      (!hasRider || prof.fireWithRider || prof.huntWithRider) &&
      Math.hypot(nemesis.x - t.x, nemesis.y - t.y) < prof.fireRange * 1.15 &&
      hasLineOfFire(s, t.x, t.y - TAXI.halfH - 6, nemesis.x, nemesis.y)
    ) {
      input |= Input.FIRE;
      ai.fireIn = Math.round((prof.firePauseMin * 0.55 + nextRandom(s) * prof.firePauseJitter * 0.5) * TICK_RATE);
      return input;
    }

    // 2. General opportunistic or self-defense shot.
    if (!hasRider || prof.fireWithRider) {
      const others = s.taxis.filter((o) => o !== t && targetable(s, o));
      const nearestOther = others.length ? nearest(others, t, (o) => [o.x, o.y]) : undefined;
      const provoked = nearestOther ? (ai.grudges?.[nearestOther.id] ?? 0) > 0 : false;
      const allowed = prof.canInitiate || provoked;
      const target =
        allowed &&
        nearestOther &&
        Math.hypot(nearestOther.x - t.x, nearestOther.y - t.y) < prof.fireRange &&
        hasLineOfFire(s, t.x, t.y - TAXI.halfH - 6, nearestOther.x, nearestOther.y)
          ? nearestOther
          : undefined;
      if (target) {
        input |= Input.FIRE;
        ai.fireIn = Math.round((prof.firePauseMin + nextRandom(s) * prof.firePauseJitter) * TICK_RATE);
      }
    }
  }
  return input;
}

/** Physical fuel estimate needed to fly from `t` to `(tx, ty)` and touch down safely. */
function minFuelToReach(s: SimState, t: Taxi, tx: number, ty: number): number {
  const c = s.config;
  const dist = Math.hypot(tx - t.x, ty - t.y);
  const heavy = Math.max(1, s.level.gravityScale) ** 2;
  return Math.min(c.fuelMax * 0.75, dist * 0.05 * (c.burnUp / 3) * heavy + c.fuelMax * 0.06);
}

/** Nearest fuel pad to `t`, if the level has one. */
function nearestFuelPad(s: SimState, t: Taxi): Pad | null {
  const fuelPads = s.level.pads.filter((p) => p.kind === 'fuel');
  if (!fuelPads.length) return null;
  return nearest(fuelPads, t, (p) => [p.x + p.w / 2, p.y]);
}

/** Target fuel level when buying gas from a 2× mobile service craft (enough to reach a store). */
function serviceGasTarget(s: SimState, t: Taxi): number {
  const c = s.config;
  const fp = nearestFuelPad(s, t);
  if (!fp) return c.fuelMax * 0.45;
  const toStore = minFuelToReach(s, t, fp.x + fp.w / 2, fp.y);
  return Math.min(c.fuelMax * 0.55, Math.max(c.fuelMax * 0.3, toStore + c.fuelMax * 0.12));
}

/** At a store or mobile service craft, would we buy one more of this? */
function wantsToBuy(s: SimState, t: Taxi, item: StoreItem, prof: AiProfile, mult = 1): boolean {
  const c = s.config;
  const { price, have, cap } = storeItem(s, t, item, mult);
  const vendettaBoost = t.vendettaTargetId && item === 'missile' ? 2 : 0;
  const fullWant =
    item === 'missile'
      ? Math.min(prof.wantMissiles + vendettaBoost, cap)
      : item === 'flare'
        ? Math.min(prof.wantFlares, cap)
        : c.taxiMaxHp;
  if (mult > 1) {
    // At 2× mobile service prices, only buy urgent amounts unless flush with cash.
    const flush = t.cents / 100 >= price + prof.cashReserve + 40;
    const urgentWant =
      item === 'repair'
        ? Math.min(c.taxiMaxHp, prof.repairAtHp + 1)
        : item === 'missile'
          ? Math.min(fullWant, 2)
          : Math.min(fullWant, 1);
    const want = flush ? fullWant : urgentWant;
    return have < want && t.cents / 100 >= price + prof.cashReserve;
  }
  return have < fullWant && t.cents / 100 >= price + prof.cashReserve;
}

/**
 * How much gas to buy: at a store, fill the tank if that leaves the cash reserve (else up to
 * REFUEL_UNTIL). At a 2× mobile service craft, buy enough to reach a store unless flush.
 */
function wantsGas(s: SimState, t: Taxi, prof: AiProfile, mult = 1): boolean {
  const c = s.config;
  if ((c.fuelMax - t.fuel) / c.fuelPerGallon < 0.005 || !canAffordGas(s, t)) return false;
  const fillCost = ((c.fuelMax - t.fuel) / c.fuelPerGallon) * c.gallonPrice * mult;
  if (mult > 1) {
    if (t.fuel < serviceGasTarget(s, t)) return true;
    return t.cents / 100 >= fillCost + prof.cashReserve + 40;
  }
  if (t.cents / 100 >= fillCost + prof.cashReserve) return true;
  return t.fuel < c.fuelMax * REFUEL_UNTIL;
}

/** Can we pay for at least a useful splash (a tenth of a gallon)? */
const canAffordGas = (_s: SimState, t: Taxi) => t.cents > 0; // any cash buys some (fractions of a gallon)

const wantsAnything = (s: SimState, t: Taxi, prof: AiProfile, mult = 1) =>
  wantsToBuy(s, t, 'repair', prof, mult) || wantsToBuy(s, t, 'missile', prof, mult) || wantsToBuy(s, t, 'flare', prof, mult);

/** Badly damaged, or out of missiles/flares we want, and able to afford more: worth a store/service trip. */
function needsSupplies(s: SimState, t: Taxi, prof: AiProfile, mult = 1): boolean {
  const c = s.config;
  const needMissiles = (prof.wantMissiles > 0 || !!t.vendettaTargetId) && t.missiles === 0;
  return (
    (t.hp <= prof.repairAtHp && t.hp < c.taxiMaxHp && t.cents / 100 >= c.repairPrice * mult + prof.cashReserve) ||
    (needMissiles && t.cents / 100 >= c.missilePrice * mult + prof.cashReserve) ||
    (prof.wantFlares > 0 && t.flares === 0 && t.cents / 100 >= c.flarePrice * mult + prof.cashReserve)
  );
}

/**
 * Should this landed NPC summon the flying convenience service right now?
 * True when stranded (out of fuel or unable to reach a store), or when a wealthy/impatient
 * personality (or active Vendetta) prefers paying 2× over detouring to a distant/busy store.
 */
function wantsServiceSummon(s: SimState, t: Taxi, prof: AiProfile): boolean {
  if (!canSummonService(s, t) || !canAffordGas(s, t)) return false;
  // Don't summon while a passenger is walking over to board us.
  if (s.passengers.some((p) => p.state === 'walking' && p.taxiId === t.id)) return false;

  const c = s.config;
  const fp = nearestFuelPad(s, t);
  const mult = c.servicePriceMultiplier;

  // 1. Stranded / emergency: empty tank or not enough fuel to safely reach a store.
  if (t.fuel <= 0) return true;
  if (!fp) {
    if (t.fuel < c.fuelMax * prof.refuelCritical) return true;
  } else {
    const toStore = minFuelToReach(s, t, fp.x + fp.w / 2, fp.y);
    if (t.fuel < toStore) return true;
  }

  // 2. Convenience / tactical summon: wealthy Hustler/Daredevil or active Vendetta far from a store.
  if (riderOf(s, t.id) !== undefined) return false;
  const cash = t.cents / 100;
  const willing =
    cash >= prof.convenienceServiceCash + prof.cashReserve || (!!t.vendettaTargetId && cash >= 65 + prof.cashReserve);
  if (!willing) return false;

  const storeDist = fp ? Math.hypot(fp.x + fp.w / 2 - t.x, fp.y - t.y) : Infinity;
  const storeBusy =
    fp !== null &&
    s.taxis.some((o) => o !== t && isActive(o) && o.status === 'landed' && o.padIndex === fp.index);
  if (storeDist < 360 && !storeBusy) return false;

  const wantFuel = t.fuel < c.fuelMax * prof.refuelBelow && wantsGas(s, t, prof, mult);
  return wantFuel || needsSupplies(s, t, prof, mult);
}

/** At a store or docked service craft: buy what we want, one item per press; or summon service if needed. */
function shopInput(s: SimState, t: Taxi, prof: AiProfile): number {
  if (wantsServiceSummon(s, t, prof) && !(t.prevInput & Input.SUMMON_SERVICE)) {
    return Input.SUMMON_SERVICE;
  }
  const mult = shopMultiplier(s, t);
  if (mult <= 0) return 0;
  const press = (item: StoreItem, bit: number) => wantsToBuy(s, t, item, prof, mult) && !(t.prevInput & bit);
  // Gas first (an empty tank is fatal), a gallon per press.
  if (wantsGas(s, t, prof, mult) && !(t.prevInput & Input.BUY_GAS)) return Input.BUY_GAS;
  if (wantsGas(s, t, prof, mult)) return 0; // release, press again next tick
  if (press('repair', Input.BUY_REPAIR)) return Input.BUY_REPAIR;
  if (press('missile', Input.BUY_MISSILE)) return Input.BUY_MISSILE;
  if (press('flare', Input.BUY_FLARE)) return Input.BUY_FLARE;
  return 0;
}

// ── Movement ─────────────────────────────────────────────────────────────────

function moveInput(s: SimState, t: Taxi, ai: AiState, prof: AiProfile): number {
  const goal = chooseGoal(s, t, prof);
  if (t.status === 'landed') ai.landing = false;
  if (t.status === 'landed' && (goal.stay || (!goal.hunt && goal.surfaceY === undefined && goal.padIndex === t.padIndex))) {
    ai.goal = '';
    return 0;
  }
  if (goal.key !== ai.goal) {
    ai.goal = goal.key;
    ai.replanIn = 0;
    ai.landing = false;
  }
  // The landing spot (or hunted target) can shift: replan when it moves enough.
  if (goal.hunt) {
    if (ai.huntX === undefined || ai.huntY === undefined || Math.hypot(goal.hunt.x - ai.huntX, goal.hunt.y - ai.huntY) > 60) {
      ai.replanIn = 0;
      ai.huntX = goal.hunt.x;
      ai.huntY = goal.hunt.y;
    }
    ai.landing = false;
  } else if (goal.padIndex !== ai.padIndex || Math.abs(goal.landX - ai.landX) > 4) {
    ai.replanIn = 0;
    ai.landing = false;
  }
  ai.surfaceY = goal.surfaceY;
  ai.padIndex = goal.padIndex;
  ai.landX = goal.landX;
  if (--ai.replanIn <= 0) {
    ai.route = plan(s, t, goal);
    ai.replanIn = goal.hunt ? Math.max(12, Math.round(prof.replanTicks * 0.7)) : prof.replanTicks;
  }

  if (--ai.checkIn <= 0) {
    const moved = Math.hypot(t.x - ai.checkX, t.y - ai.checkY);
    if (t.status === 'flying' && moved < 12) {
      ai.unstick = 40;
      ai.replanIn = 0;
      ai.landing = false;
    }
    ai.checkX = t.x;
    ai.checkY = t.y;
    ai.checkIn = STUCK_CHECK_TICKS;
  }
  if (ai.unstick > 0) {
    ai.unstick--;
    return steer(s, t, 0, -60, prof.steerDeadband) | gear(t, false);
  }
  // Once on final approach, stay on it (sinking below the hover point mustn't abort it).
  if (ai.landing && !goal.hunt) return land(s, t, ai, prof);
  return follow(s, t, ai, prof, goal.hunt);
}

/**
 * Operate the landing gear like a player: press GEAR (one tick at a time) until it is
 * going the way we want. Side thrusters only work with the gear fully up, so we retract it
 * to travel and lower it only once lined up over the landing spot.
 */
function gear(t: Taxi, down: boolean): number {
  if (t.status !== 'flying' || t.gearDown === down || t.prevInput & Input.GEAR) return 0;
  return Input.GEAR;
}

// ── Goals ────────────────────────────────────────────────────────────────────

function chooseGoal(s: SimState, t: Taxi, prof: AiProfile): Goal {
  const level = s.level;
  const c = s.config;
  const here = t.status === 'landed' ? t.padIndex : -1;
  const stay: Goal = { key: 'stay', padIndex: here, landX: t.x, stay: true };

  // Waiting for or shopping at a flying convenience service craft: stay put until done.
  if (t.status === 'landed') {
    const svc = serviceCraftFor(s, t.id);
    if (svc) {
      if (svc.status === 'arriving') return stay;
      const mult = c.servicePriceMultiplier;
      if (atService(s, t) && (wantsGas(s, t, prof, mult) || wantsAnything(s, t, prof, mult))) {
        return stay;
      }
    } else if (wantsServiceSummon(s, t, prof)) {
      return stay;
    }
  }

  const fuelPads = level.pads.filter((p) => p.kind === 'fuel');
  // Stores are narrow: prefer one nobody else is parked at or already heading for (we can't
  // squeeze in beside them with the side jets off on the final descent).
  const storeTaken = (index: number) =>
    s.taxis.some(
      (o) =>
        o !== t &&
        isActive(o) &&
        ((o.status === 'landed' && o.padIndex === index) || (o.npc && o.ai?.goal === 'fuel' && o.ai.padIndex === index)),
    );
  // A taken store counts as a detour, not a wall: a far-away free store is no better than
  // waiting our turn at a near one. Once on final approach, stick with the store we chose.
  const committedStore =
    t.ai?.goal === 'fuel' && t.ai.landing ? fuelPads.find((p) => p.index === t.ai!.padIndex) : undefined;
  const storeCost = (p: Pad) =>
    Math.hypot(p.x + p.w / 2 - t.x, p.y - t.y) +
    (storeTaken(p.index) && !(t.status === 'landed' && t.padIndex === p.index) ? TAKEN_STORE_DETOUR : 0);
  let fuelPad: Pad | null = committedStore ?? null;
  for (const p of fuelPads) if (!fuelPad || storeCost(p) < storeCost(fuelPad)) fuelPad = committedStore ?? p;
  const refuel = (): Goal => padGoal(s, t, fuelPad!.index, 'fuel');
  // At the store: stay until topped up and done shopping.
  if (
    here >= 0 &&
    level.pads[here]!.kind === 'fuel' &&
    (wantsGas(s, t, prof) || wantsAnything(s, t, prof))
  ) {
    return stay;
  }

  // A passenger is already walking over to board us: stay put until they're aboard rather than
  // lifting off mid-walk (which annoys them, and if fuel is critically low, prevents
  // wantsServiceSummon from firing once they board).
  if (t.status === 'landed' && s.passengers.some((p) => p.state === 'walking' && p.taxiId === t.id)) return stay;

  /** Fuel to fly `legs` (pad indices, in order) from here and still reach the fuel pad. */
  const fuelFor = (...legs: number[]): number => {
    if (!fuelPad) return 0;
    let [x, y] = [t.x, t.y];
    let dist = 0;
    for (const i of [...legs, fuelPad.index]) {
      const p = level.pads[i]!;
      dist += Math.hypot(p.x + p.w / 2 - x, p.y - y);
      [x, y] = [p.x + p.w / 2, p.y];
    }
    const heavy = Math.max(1, level.gravityScale) ** 2;
    return Math.min(
      c.fuelMax * 0.8,
      dist * 0.05 * (c.burnUp / 3) * heavy * prof.fuelEstimateScale + c.fuelMax * prof.fuelBuffer,
    );
  };

  // Emergency diversion: if flying with genuinely low fuel (not enough to safely reach a store,
  // or a teleport when relocating), set down on the nearest open pad and summon the mobile
  // convenience service instead of running dry.
  if (t.status === 'flying' && canAffordGas(s, t) && t.fuel < c.fuelMax * Math.max(prof.refuelBelow, 0.45)) {
    const nearestStore = nearestFuelPad(s, t);
    const storeDist = nearestStore
      ? Math.hypot(nearestStore.x + nearestStore.w / 2 - t.x, nearestStore.y - t.y)
      : Infinity;
    const fuelToStore = nearestStore
      ? minFuelToReach(s, t, nearestStore.x + nearestStore.w / 2, nearestStore.y)
      : c.fuelMax * prof.refuelCritical;
    // If relocating and heading to a teleport that we can still reach, don't abort for a pad.
    let canReachTeleport = false;
    if (t.relocateTo && t.ai?.goal === 'teleport') {
      const tp = level.pads[t.ai.padIndex];
      if (tp?.kind === 'teleport') {
        canReachTeleport = t.fuel >= minFuelToReach(s, t, tp.x + tp.w / 2, tp.y);
      }
    }
    if (!canReachTeleport && t.fuel < fuelToStore && storeDist > 260) {
      const emergencyPads = level.pads.filter(
        (p) =>
          p.kind !== 'fuel' &&
          padHasRoom(s, t, p.index) &&
          Math.hypot(p.x + p.w / 2 - t.x, p.y - t.y) < storeDist * 0.85,
      );
      if (emergencyPads.length) {
        const ep = nearest(emergencyPads, t, (p) => [p.x + p.w / 2, p.y]);
        return padGoal(s, t, ep.index, `emergency:${ep.index}`);
      }
    }
  }

  const rider = riderOf(s, t.id);
  const committed = rider !== undefined && t.ai?.goal === `drop:${rider.id}`;
  const gasOk = fuelPad !== null && canAffordGas(s, t);
  if (
    gasOk &&
    (t.fuel < c.fuelMax * prof.refuelCritical || (rider && !committed && t.fuel < fuelFor(rider.destPadIndex)))
  ) {
    return refuel();
  }

  // Fear / Fleeing: a timid NPC ducks into a safe zone (store or teleport) when threatened nearby.
  const threat = t.fleeFromId ? s.taxis.find((o) => o.id === t.fleeFromId && isActive(o)) : undefined;
  if (threat) {
    const threatDist = Math.hypot(threat.x - t.x, threat.y - t.y);
    if ((atStore(s, t) || atTeleport(s, t)) && threatDist < 480) return stay;
    if (!rider && threatDist < 420) {
      const safePads = level.pads.filter((p) => (p.kind === 'fuel' || p.kind === 'teleport') && padHasRoom(s, t, p.index));
      if (safePads.length) {
        // Pick the safe pad farthest from the threat (with slight preference for closer to us).
        let bestSafe = safePads[0]!;
        let bestScore = -Infinity;
        for (const p of safePads) {
          const px = p.x + p.w / 2;
          const score = Math.hypot(px - threat.x, p.y - threat.y) - Math.hypot(px - t.x, p.y - t.y) * 0.35;
          if (score > bestScore) {
            bestScore = score;
            bestSafe = p;
          }
        }
        return padGoal(s, t, bestSafe.index, `flee:${threat.id}`);
      }
    }
  }

  // Vendetta hunting: pursue our nemesis in this locale!
  const nemesis = t.vendettaTargetId ? s.taxis.find((o) => o.id === t.vendettaTargetId && isActive(o)) : undefined;
  if (nemesis && (!rider || prof.huntWithRider)) {
    if (t.missiles === 0 && fuelPad && t.cents / 100 >= c.missilePrice + prof.cashReserve) {
      return refuel();
    }
    if (t.missiles > 0 && targetable(s, nemesis)) {
      return {
        key: `hunt:${nemesis.id}`,
        padIndex: -1,
        landX: nemesis.x,
        // Aim slightly above the nemesis so pursuit stays clear of pad surfaces & waiting passengers.
        hunt: { x: nemesis.x, y: Math.max(TAXI.halfH + 40, nemesis.y - 55) },
      };
    }
  }

  if (rider) return padGoal(s, t, rider.destPadIndex, `drop:${rider.id}`);

  const goal = t.ai?.goal ?? '';
  const onTheWay = goal.startsWith('pick:') || goal === 'teleport';
  if (
    fuelPad &&
    !onTheWay &&
    ((gasOk && (t.fuel < c.fuelMax * prof.refuelBelow || t.fuel < fuelFor())) || needsSupplies(s, t, prof))
  ) {
    return refuel();
  }

  // Asked to move to another locale (coordinator, cross-locale vendetta, or timid escape):
  // fly to a teleport and wait there to be transferred (fuelled for the trip first).
  if (t.relocateTo) {
    const teleports = level.pads.filter((p) => p.kind === 'teleport' && padHasRoom(s, t, p.index));
    if (here >= 0 && level.pads[here]!.kind === 'teleport') return stay;
    if (teleports.length) {
      const tp = nearest(teleports, t, (p) => [p.x + p.w / 2, p.y]);
      if (fuelPad && gasOk && goal !== 'teleport' && t.fuel < fuelFor(tp.index)) return refuel();
      return padGoal(s, t, tp.index, 'teleport');
    }
  }

  // Waiting passengers: Hustlers ignore other rivals' claims (poaching!) and favor higher-value trips;
  // Timid NPCs avoid pads near a threat taxi.
  const occupied = (padIndex: number) =>
    s.taxis.some((o) => o !== t && o.status === 'landed' && o.padIndex === padIndex);
  const claimed = (id: number) => s.taxis.some((o) => o !== t && o.npc && isActive(o) && o.ai?.goal === `pick:${id}`);
  const nearThreat = (x: number, y: number) => !!threat && Math.hypot(x - threat.x, y - threat.y) < 260;
  const roadside = new Map<number, number>();
  const waiting = s.passengers.filter(
    (p) =>
      p.state === 'waiting' &&
      acceptsDriver(s, p, t) &&
      (p.padIndex >= 0 ? (!occupied(p.padIndex) || (p.refusedDrivers.length > 0 && padHasRoom(s, t, p.padIndex))) :
        roadsidePickup(s, p, t, roadside)) &&
      (prof.poachWilling || !claimed(p.id)) &&
      !nearThreat(p.x, p.y),
  );
  if (waiting.length) {
    let bestP = waiting[0]!;
    let bestScore = Infinity;
    for (const p of waiting) {
      const dist = Math.hypot(p.x - t.x, p.y - t.y);
      const destPad = level.pads[p.destPadIndex];
      const tripDist = destPad ? Math.hypot(destPad.x + destPad.w / 2 - p.x, destPad.y - p.y) : 0;
      const score = dist - tripDist * prof.fareValueWeight;
      if (score < bestScore) {
        bestScore = score;
        bestP = p;
      }
    }
    if (canBoardHere(s, bestP, t)) return stay;
    if (bestP.padIndex < 0) return { key: `pick:${bestP.id}`, padIndex: -1, landX: roadside.get(bestP.id)!, surfaceY: bestP.y };
    if (fuelPad && gasOk && goal !== `pick:${bestP.id}` && t.fuel < fuelFor(bestP.padIndex)) return refuel();
    return padGoal(s, t, bestP.padIndex, `pick:${bestP.id}`);
  }

  // Nothing to do: wait where we are, unless that's a store (others need it), else land
  // somewhere quiet.
  if (here >= 0 && level.pads[here]!.kind === 'pad') return stay;
  const quiet = level.pads.filter(
    (pad) =>
      pad.kind === 'pad' &&
      !occupied(pad.index) &&
      !s.passengers.some((p) => p.padIndex === pad.index && p.state !== 'riding') &&
      !nearThreat(pad.x + pad.w / 2, pad.y),
  );
  const pad = nearest(quiet.length ? quiet : level.pads, t, (p) => [p.x + p.w / 2, p.y]);
  return padGoal(s, t, pad.index, `idle:${pad.index}`);
}

/** Find a supported landing next to a stranded passenger on the same stretch of ground. */
function roadsidePickup(s: SimState, p: Passenger, t: Taxi, spots: Map<number, number>): boolean {
  for (const offset of [-56, 56, -88, 88, -120, 120]) {
    const x = p.x + offset;
    if (!walkable(s, p.x, x, p.y) || !walkable(s, x - TAXI.feetHalfW, x + TAXI.feetHalfW, p.y)) continue;
    if (boxHitsSolid(s.level, x - TAXI.halfW, p.y - 64, x + TAXI.halfW, p.y)) continue;
    if (s.taxis.some(o => o !== t && o.status === 'landed' && Math.abs(o.x - x) < 58 && Math.abs(o.y + 24 - p.y) < 30)) continue;
    spots.set(p.id, x);
    return true;
  }
  return false;
}

/** Is there a spot on this pad clear of any taxi parked there (a taxi's width plus a margin)? */
function padHasRoom(s: SimState, t: Taxi, padIndex: number): boolean {
  const pad = s.level.pads[padIndex]!;
  const parked = s.taxis.filter((o) => o !== t && o.status === 'landed' && o.padIndex === padIndex).map((o) => o.x);
  if (!parked.length) return true;
  const lo = pad.x + TAXI.halfW + 10;
  const hi = pad.x + pad.w - TAXI.halfW - 10;
  for (let x = lo; x <= hi; x += 4) if (parked.every((o) => Math.abs(o - x) >= 2 * TAXI.halfW + 12)) return true;
  return false;
}

/**
 * Landing goal on a pad: the spot (within the pad, body clear of its edges) farthest from
 * every passenger standing on it and any taxi parked there.
 */
function padGoal(s: SimState, t: Taxi, padIndex: number, key: string): Goal {
  const pad = s.level.pads[padIndex]!;
  const lo = pad.x + TAXI.halfW + 10;
  const hi = pad.x + pad.w - TAXI.halfW - 10;
  const center = pad.x + pad.w / 2;
  if (lo > hi) return { key, padIndex, landX: center };
  const obstacles = [
    ...s.passengers.filter((p) => p.padIndex === padIndex && (p.state === 'waiting' || p.state === 'walking')).map((p) => p.x),
    ...s.taxis.filter((o) => o !== t && o.status === 'landed' && o.padIndex === padIndex).map((o) => o.x),
  ];
  if (!obstacles.length) return { key, padIndex, landX: center };
  let landX = center;
  let best = -Infinity;
  for (let i = 0; i <= 8; i++) {
    const x = lo + ((hi - lo) * i) / 8;
    const clearance = Math.min(...obstacles.map((o) => Math.abs(o - x)));
    // Prefer more clearance; break near-ties toward the pad center.
    const score = clearance - Math.abs(x - center) * 0.01;
    if (score > best) {
      best = score;
      landX = x;
    }
  }
  return { key, padIndex, landX };
}

function nearest<T>(items: T[], t: Taxi, pos: (item: T) => [number, number]): T {
  let best = items[0] as T;
  let bestD = Infinity;
  for (const item of items) {
    const [x, y] = pos(item);
    const d = Math.hypot(x - t.x, y - t.y);
    if (d < bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

// ── Route planning ───────────────────────────────────────────────────────────

/** Grid cell (c, r) = tiles (c, r) and (c+1, r): room for the 48×34 taxi. */
function cellFree(level: Level, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c + 1 >= level.cols || r >= level.rows) return false;
  const i = r * level.cols + c;
  return !level.solid[i] && !level.solid[i + 1];
}

function cellX(level: Level, c: number): number {
  return (c + 1) * level.tileSize;
}

/** Taxi center height in a cell: 3u below the cell top, so body + gear fit inside the row. */
function cellY(level: Level, r: number): number {
  return r * level.tileSize + 3 + TAXI.halfH;
}

function nearestFreeCell(level: Level, c0: number, r0: number): [number, number] | null {
  for (let radius = 0; radius <= 3; radius++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius || !cellFree(level, c0 + dc, r0 + dr)) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) {
          best = [c0 + dc, r0 + dr];
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Route from the taxi to the hover point above the goal's landing spot (or toward a hunted target). */
function plan(s: SimState, t: Taxi, goal: Goal): number[] {
  const level = s.level;
  const ts = level.tileSize;
  const startCell = nearestFreeCell(level, Math.round(t.x / ts - 1), Math.floor((t.y - TAXI.halfH) / ts));
  if (goal.hunt) {
    const targetCell = nearestFreeCell(level, Math.round(goal.hunt.x / ts - 1), Math.floor((goal.hunt.y - TAXI.halfH) / ts));
    if (!startCell || !targetCell) return [goal.hunt.x, goal.hunt.y];
    const people = s.passengers.filter((p) => p.state === 'waiting' || p.state === 'walking');
    const cells = shortestPath(level, people, startCell, targetCell);
    const route: number[] = [];
    for (const [c, r] of cells) route.push(cellX(level, c), cellY(level, r));
    return route;
  }
  const padRow = Math.round((goal.surfaceY ?? level.pads[goal.padIndex]!.y) / ts);
  const hover = hoverPoint(level, goal);
  // Aim for the cell two rows above the pad if there's room (cleaner approach), else one row.
  const goalCol = Math.round(goal.landX / ts - 1);
  const goalCell =
    (cellFree(level, goalCol, padRow - 2) && cellFree(level, goalCol, padRow - 1) ? [goalCol, padRow - 2] : null) ??
    nearestFreeCell(level, goalCol, padRow - 1);
  if (!startCell || !goalCell) return hover;

  const people = s.passengers.filter((p) => p.state === 'waiting' || p.state === 'walking');
  const cells = shortestPath(level, people, startCell, goalCell as [number, number]);
  const route: number[] = [];
  for (const [c, r] of cells) route.push(cellX(level, c), cellY(level, r));
  route.push(...hover);
  return route;
}

/** Feet clearance while lining up over the landing spot: above a standing passenger's head. */
const HOVER_CLEARANCE = PASSENGER.height + 8;

function hoverPoint(level: Level, goal: Goal): [number, number] {
  const surface = goal.surfaceY ?? level.pads[goal.padIndex]!.y;
  return [goal.landX, surface - TAXI.gearLength - TAXI.halfH - HOVER_CLEARANCE];
}

/** Reusable scratch buffers for shortestPath() to avoid per-replan TypedArray allocations. */
let pathDist = new Float64Array(0);
let pathPrev = new Int32Array(0);
let pathHeap: MinHeap | null = null;

/**
 * Dijkstra on the cell grid. Cells next to walls cost more so routes keep to open air, and
 * cells skimming a surface (solid right below) cost much more so the taxi cruises above
 * passengers' heads instead of sweeping across pads. Cells where the taxi would clip a
 * standing passenger are all but forbidden.
 */
function shortestPath(
  level: Level,
  people: readonly Passenger[],
  from: [number, number],
  to: [number, number],
): [number, number][] {
  const { cols, rows } = level;
  const hasPeople = people.length > 0;
  const hasWells = level.gravityWells.length > 0;
  const hasLasers = level.laserGates.length > 0;
  const [toC, toR] = to;
  const clipsPerson = (x: number, y: number) => {
    for (let k = 0; k < people.length; k++) {
      const p = people[k]!;
      if (
        Math.abs(p.x - x) < TAXI.halfW + PASSENGER.halfW + 6 &&
        y - TAXI.halfH < p.y + 4 &&
        y + TAXI.halfH + TAXI.gearLength > p.y - PASSENGER.height - 6
      ) {
        return true;
      }
    }
    return false;
  };
  const idx = (c: number, r: number) => r * cols + c;
  const cells = cols * rows;
  if (pathDist.length < cells) {
    pathDist = new Float64Array(cells);
    pathPrev = new Int32Array(cells);
  }
  const dist = pathDist;
  const prev = pathPrev;
  dist.fill(Infinity, 0, cells);
  prev.fill(-1, 0, cells);
  const heap = (pathHeap ??= new MinHeap());
  heap.clear();
  const start = idx(from[0], from[1]);
  const goal = idx(toC, toR);
  dist[start] = 0;
  heap.push(Math.abs(from[0] - toC) + Math.abs(from[1] - toR), start);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  while (heap.size) {
    const [f, i] = heap.pop();
    if (i === goal) break;
    const c = i % cols;
    const r = (i - c) / cols;
    const d = dist[i]!;
    if (f > d + Math.abs(c - toC) + Math.abs(r - toR) + 1e-9) continue;
    for (let di = 0; di < 4; di++) {
      const [dc, dr] = dirs[di]!;
      const nc = c + dc;
      const nr = r + dr;
      if (!cellFree(level, nc, nr)) continue;
      const tight =
        !cellFree(level, nc + 1, nr) ||
        !cellFree(level, nc - 1, nr) ||
        !cellFree(level, nc, nr + 1) ||
        !cellFree(level, nc, nr - 1);
      const below = (nr + 1) * cols + nc;
      const skim = nr + 1 >= rows || level.solid[below] === 1 || level.solid[below + 1] === 1;
      // A one-row slot (blocked above and below) leaves the 34u-tall taxi ~6u of slack.
      const squeeze = !cellFree(level, nc, nr - 1) && !cellFree(level, nc, nr + 1);
      let extra = (tight ? 2 : 0) + (skim ? 8 : 0) + (squeeze ? 40 : 0);
      if (hasPeople || hasWells || hasLasers) {
        const cx = cellX(level, nc);
        const cy = cellY(level, nr);
        if (hasPeople && clipsPerson(cx, cy)) extra += 500;
        if (hasWells && pointInGravityCore(level, cx, cy, 85)) extra += 600;
        if (
          hasLasers &&
          level.laserGates.some(
            (g) =>
              cx >= Math.min(g.x0, g.x1) - 36 &&
              cx <= Math.max(g.x0, g.x1) + 36 &&
              cy >= Math.min(g.y0, g.y1) - 36 &&
              cy <= Math.max(g.y0, g.y1) + 36,
          )
        ) {
          extra += 35;
        }
      }
      const nd = d + 1 + extra;
      const ni = idx(nc, nr);
      if (nd < dist[ni]!) {
        dist[ni] = nd;
        prev[ni] = i;
        heap.push(nd + Math.abs(nc - toC) + Math.abs(nr - toR), ni);
      }
    }
  }
  if (dist[goal] === Infinity) return [from];
  const out: [number, number][] = [];
  for (let i = goal; i !== -1; i = prev[i]!) out.push([i % cols, Math.floor(i / cols)]);
  return out.reverse();
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  clear(): void {
    this.keys.length = 0;
    this.vals.length = 0;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0]!, v[0]!];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastK;
        if (l < k.length && k[l]! < mk) {
          m = l;
          mk = k[l]!;
        }
        if (r < k.length && k[r]! < mk) m = r;
        if (m === i) break;
        k[i] = k[m]!;
        v[i] = v[m]!;
        i = m;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}

// ── Flying ───────────────────────────────────────────────────────────────────

function follow(s: SimState, t: Taxi, ai: AiState, prof: AiProfile, hunt?: { x: number; y: number }): number {
  const level = s.level;
  const pts = ai.route;
  const n = pts.length / 2;
  if (n === 0) return steer(s, t, 0, 0, prof.steerDeadband);

  let near = 0;
  let nearD = Infinity;
  for (let k = 0; k < n; k++) {
    const d = Math.hypot(pts[2 * k]! - t.x, pts[2 * k + 1]! - t.y);
    if (d < nearD) {
      near = k;
      nearD = d;
    }
  }
  // Cut corners: aim at the farthest upcoming waypoint we can fly straight to without
  // touching a wall, a standing passenger, or a gravity well core.
  const people = s.passengers.filter((p) => p.state === 'waiting' || p.state === 'walking');
  let j = near;
  for (let k = Math.min(n - 1, near + LOOKAHEAD); k > near; k--) {
    if (clearLine(level, people, t.x, t.y, pts[2 * k]!, pts[2 * k + 1]!)) {
      j = k;
      break;
    }
  }
  if (j === near && nearD < 20 && near < n - 1) j = near + 1;

  const tx = pts[2 * j]!;
  const ty = pts[2 * j + 1]!;
  const dx = tx - t.x;
  const dy = ty - t.y;
  const d = Math.hypot(dx, dy);

  if (!hunt && j === n - 1 && d < 30) {
    ai.landing = true;
    return land(s, t, ai, prof);
  }

  // Pause before crossing an active or charging laser gate (or misaligned Electroid gap).
  if (level.laserGates.length && pathBlockedByLaser(level, s.tick, t.x, t.y, tx, ty)) {
    const [ax, ay] = separation(s, t, prof);
    return steer(s, t, ax, clamp(ay, -prof.climbSpeed, prof.descendSpeed), prof.steerDeadband) | gear(t, false);
  }

  // When hunting a nemesis, maintain a firing standoff (~160u) if already close with line of fire.
  const huntDist = hunt ? Math.hypot(hunt.x - t.x, hunt.y - t.y) : Infinity;
  const standoff = hunt && huntDist < 170;
  const spd = standoff ? 25 : Math.min(prof.cruiseSpeed, 20 + d * 1.8);
  const vxd = d > 0.5 ? (dx / d) * spd : 0;
  const vyd = d > 0.5 ? clamp((dy / d) * spd, -prof.climbSpeed, prof.descendSpeed) : 0;
  const [ax, ay] = separation(s, t, prof);
  // Traveling: gear up (once clear of the pad we lifted off from), so the side jets work.
  const climbingOff = nearPadBelow(level, t, PASSENGER.height + 4);
  return (
    steer(s, t, vxd + ax, clamp(vyd + ay, -prof.climbSpeed, prof.descendSpeed), prof.steerDeadband) |
    gear(t, climbingOff && t.gearDown)
  );
}

/** Drifted this far off the spot with the gear down: raise it and line up again. */
const DRIFT_ABORT = 14;

/**
 * Final approach, under the gear rule (no side thrust once the gear starts down):
 *  1. gear up: line up over the landing spot at hover height and brake to a stop;
 *  2. lower the gear (sideways motion now only coasts, damped by drag);
 *  3. with the gear fully down, descend straight onto the pad.
 * Drifting too far off the spot with the gear down raises it again to re-align.
 */
function land(s: SimState, t: Taxi, ai: AiState, prof: AiProfile): number {
  const surface = ai.surfaceY ?? s.level.pads[ai.padIndex]!.y;
  const [, hoverY] = hoverPoint(s.level, { key: ai.goal, padIndex: ai.padIndex, landX: ai.landX, surfaceY: ai.surfaceY });
  const dx = ai.landX - t.x;
  // Never descend onto someone standing on the pad (allow extra margin for lateral drift).
  const someoneBelow = s.passengers.some(
    (p) =>
      (ai.surfaceY !== undefined ? Math.abs(p.y - surface) < 40 : p.padIndex === ai.padIndex) &&
      (p.state === 'waiting' || p.state === 'walking') &&
      Math.abs(p.x - t.x) < TAXI.halfW + PASSENGER.halfW + 6,
  );
  // The landing spot already keeps clear of parked taxis; only moving ones make us hold off.
  // Right of way: when two of us are landing on the same pad, the lower id goes first (the
  // other one waits for it), so we never both hover politely until the tanks run dry.
  const [ax, ay] = separation(
    s,
    t,
    prof,
    true,
    (o) => o.npc && !!o.ai?.landing && o.ai.padIndex === ai.padIndex && o.id > t.id,
  );
  const aligned = Math.abs(dx) <= prof.alignX && Math.abs(t.vx) <= prof.alignVx;
  const drifted = Math.abs(dx) > DRIFT_ABORT;
  const nearHover = Math.abs(hoverY - t.y) < 40 || t.gearDown;
  const wind = s.level.wind ? windAt(s.level, s.tick, t.x, t.y) : null;
  // Wait out strong unsheltered wind gusts at hover height with gear up before descending.
  const strongGust = !!wind && (wind.gusting || wind.warning) && !wind.sheltered && Math.abs(wind.ax) > prof.gustWaitThreshold;
  // Low over the pad, the gear stays down (raising it there means touching down on the
  // belly); we climb back to hover height first, then raise it to line up again.
  const low = t.y > hoverY + 20;
  let wantDown = t.gearDown ? !drifted || low : aligned && nearHover && !someoneBelow && !strongGust;
  // Another taxi too close (it may be leaving the pad): hold position, gear up so we can dodge.
  if (ax || ay) wantDown = t.gearDown && (low || Math.abs(t.y - hoverY) > 40) ? true : false;

  let vyd: number;
  if (!t.gearDown || t.gear < 1 || drifted || someoneBelow || strongGust || ax || ay) {
    vyd = clamp((hoverY - t.y) * 3, -50, 40); // hold at hover height
  } else {
    const h = surface - (t.y + TAXI.halfH + TAXI.gearLength);
    vyd = clamp(18 + h * 0.7, 18, prof.landDescendMax);
  }
  const vxd = clamp(dx * 3, -40, 40);
  return steer(s, t, vxd + ax, Math.min(vyd + ay, prof.landDescendMax), Math.max(2, prof.steerDeadband - 2), t.gear >= 1) | gear(t, wantDown);
}

/**
 * Bang-bang thruster control toward a desired velocity (± deadband), with safety nets:
 * steer away from walls beside or ahead, brake before the ceiling, and (outside the final
 * approach) before the ground. Compensates for local wind and inverted/radial gravity.
 */
function steer(s: SimState, t: Taxi, vxd: number, vyd: number, deadband: number, landing = false): number {
  const level = s.level;
  const ahead = (dx: number, dy: number) =>
    boxHitsSolid(
      level,
      t.x - TAXI.halfW + dx,
      t.y - TAXI.halfH + dy,
      t.x + TAXI.halfW + dx,
      t.y + TAXI.halfH + TAXI.gearLength + dy,
    );
  // Lifting off a pad: go straight up until clear of anyone standing on it.
  if (!landing && nearPadBelow(level, t, PASSENGER.height + 4)) {
    vxd = 0;
    vyd = Math.min(vyd, -50);
  }
  // Wall within braking distance on the right/left: don't move toward it, ease away if close.
  if (ahead(Math.max(0, t.vx) * 0.35 + 6, 0)) vxd = Math.min(vxd, ahead(3, 0) ? -12 : 0);
  if (ahead(Math.min(0, t.vx) * 0.35 - 6, 0)) vxd = Math.max(vxd, ahead(-3, 0) ? 12 : 0);
  if (t.vy < 0 && ahead(0, t.vy * 0.35 - 6)) vyd = Math.max(vyd, 20);
  if (!landing && t.vy > 0 && ahead(0, t.vy * 0.4 + 6)) vyd = Math.min(vyd, -20);
  if (!landing && ahead(0, 2)) vyd = Math.min(vyd, -15); // never scrape along a surface

  // Anticipate strong horizontal forces (wind / radial well) and low/inverted gravity.
  const env = envForceAt(level, s.config, s.tick, t.x, t.y);
  if (Math.abs(env.ax) > 15) vxd -= env.ax * 0.1;
  const downBand = env.ay < 40 ? 4 : 50;

  let input = 0;
  if (t.vx < vxd - deadband) input |= Input.RIGHT;
  else if (t.vx > vxd + deadband) input |= Input.LEFT;
  if (t.vy > vyd) input |= Input.UP;
  else if (t.vy < vyd - downBand) input |= Input.DOWN;
  return input;
}

/** Strongest separation push (u/s) at zero distance. */
const SEPARATION_PUSH = 160;
/** Near miss threshold (u) and dodge push. */
const AVOID_MISS = 75;
const AVOID_PUSH = 220;
const AVOID_YIELD = 110;

/**
 * Desired-velocity nudge to stay clear of other taxis (collisions cost hull points):
 * scaled by Nerve (separation range) and Piloting Skill (avoidance horizon).
 * Fleeing NPCs give their threat taxi a much wider berth.
 */
function separation(
  s: SimState,
  t: Taxi,
  prof: AiProfile,
  ignoreParked = false,
  ignore: (o: Taxi) => boolean = () => false,
): [number, number] {
  let ax = 0;
  let ay = 0;
  for (const o of s.taxis) {
    if (o === t || !isActive(o) || (ignoreParked && o.status === 'landed') || ignore(o)) continue;
    const dx = t.x - o.x;
    const dy = t.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) continue;
    const fleeingThis = t.fleeFromId === o.id;
    const baseRange = fleeingThis ? prof.separationRange * 1.9 : prof.separationRange;
    const pushScale = fleeingThis ? 1.55 : 1;
    // A parked taxi doesn't move: only keep clear of actually touching it (unless fleeing it).
    const range = o.status === 'landed' && !fleeingThis ? 2 * TAXI.halfW + 10 : baseRange;
    if (d < range) {
      const k = ((range - d) / range) * SEPARATION_PUSH * pushScale;
      ax += (dx / d) * k;
      ay += (dy / d) * k;
    }
    const rvx = t.vx - o.vx;
    const rvy = t.vy - o.vy;
    const rv2 = rvx * rvx + rvy * rvy;
    if (rv2 < 1) continue;
    const tc = -(dx * rvx + dy * rvy) / rv2; // time of closest approach
    if (tc <= 0 || tc > prof.avoidHorizon) continue;
    const cx = dx + rvx * tc;
    const cy = dy + rvy * tc;
    const miss = Math.hypot(cx, cy);
    if (miss >= AVOID_MISS) continue;
    const urgency = 1 - tc / prof.avoidHorizon;
    // Dodge along the closest-approach offset (or perpendicular to the approach if head-on).
    let nx = cx;
    let ny = cy;
    if (miss < 1) [nx, ny] = [-rvy, rvx];
    const n = Math.hypot(nx, ny) || 1;
    ax += (nx / n) * AVOID_PUSH * pushScale * urgency;
    ay += (ny / n) * AVOID_PUSH * pushScale * urgency;
    if (t.id < o.id || !o.npc) ay -= AVOID_YIELD * urgency;
  }
  // Repel from gravity well event-horizon cores.
  for (const w of s.level.gravityWells) {
    const dx = t.x - w.x;
    const dy = t.y - w.y;
    const d = Math.hypot(dx, dy);
    const safe = w.coreRadius + 95;
    if (d > 1 && d < safe) {
      const k = ((safe - d) / safe) * 260;
      ax += (dx / d) * k;
      ay += (dy / d) * k;
    }
  }
  // Dodge nearby active meteors perpendicularly.
  for (const m of s.meteors) {
    if (m.warnTicks > 0) continue;
    const dx = t.x - m.x;
    const dy = t.y - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 1 && d < 170) {
      const sp = Math.hypot(m.vx, m.vy) || 1;
      const px = -m.vy / sp;
      const py = m.vx / sp;
      const side = dx * px + dy * py >= 0 ? 1 : -1;
      const k = ((170 - d) / 170) * 220;
      ax += px * side * k;
      ay += py * side * k;
    }
  }
  // Keep clear of airborne passengers so rivals don't run over parachutists.
  for (const p of s.passengers) {
    if (p.state !== 'parachuting' && p.state !== 'hopping') continue;
    const dx = t.x - p.x;
    const dy = t.y - (p.y - PASSENGER.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > 1 && d < 75) {
      const k = ((75 - d) / 75) * 140;
      ax += (dx / d) * k;
      ay += (dy / d) * k;
    }
  }
  return [ax, ay];
}

/** True if flying a short distance from (x0,y0) toward (x1,y1) would cross an active/warning laser. */
function pathBlockedByLaser(level: Level, tick: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 1) return false;
  const checkDist = Math.min(d, 90);
  const steps = Math.max(1, Math.ceil(checkDist / 14));
  const pad = TAXI.halfW + 4;
  for (const g of level.laserGates) {
    const ev = laserState(g, tick);
    if (ev.state === 'open') continue;
    for (let i = 1; i <= steps; i++) {
      const x = x0 + (dx / d) * ((checkDist * i) / steps);
      const y = y0 + (dy / d) * ((checkDist * i) / steps);
      for (const [sx0, sy0, sx1, sy1] of ev.segments) {
        const minX = Math.min(sx0, sx1) - pad;
        const maxX = Math.max(sx0, sx1) + pad;
        const minY = Math.min(sy0, sy1) - pad;
        const maxY = Math.max(sy0, sy1) + pad;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
      }
    }
  }
  return false;
}

/** Is there a pad surface within `dist` units below the taxi's skids? */
function nearPadBelow(level: Level, t: Taxi, dist: number): boolean {
  const ts = level.tileSize;
  const feet = t.y + TAXI.halfH + TAXI.gearLength;
  const r0 = Math.floor(feet / ts);
  const r1 = Math.floor((feet + dist) / ts);
  const c0 = Math.floor((t.x - TAXI.feetHalfW) / ts);
  const c1 = Math.floor((t.x + TAXI.feetHalfW - 1e-6) / ts);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (padIndexAt(level, c, r) >= 0 && r * ts >= feet - 1) return true;
    }
  }
  return false;
}

/** Can the taxi (with a small margin) fly in a straight line between two points? */
function clearLine(
  level: Level,
  people: readonly Passenger[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const m = 4;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    const bx0 = x - TAXI.halfW - m;
    const bx1 = x + TAXI.halfW + m;
    const by0 = y - TAXI.halfH - m;
    const by1 = y + TAXI.halfH + TAXI.gearLength + m;
    if (boxHitsSolid(level, bx0, by0, bx1, by1)) return false;
    if (level.gravityWells.length && pointInGravityCore(level, x, y, 75)) return false;
    for (const p of people) {
      if (bx1 > p.x - PASSENGER.halfW && bx0 < p.x + PASSENGER.halfW && by1 > p.y - PASSENGER.height && by0 < p.y) {
        return false;
      }
    }
  }
  return true;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
