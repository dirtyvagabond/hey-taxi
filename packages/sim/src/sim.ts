import { post, toCents, type LedgerCategory } from './accounts';
import { DEFAULT_CONFIG, type SimConfig } from './config';
import { DT, EPS, Input, MAX_SUBSTEP, TAXI, TICK_RATE, type TaxiSkin } from './constants';
import { envForceAt, stepEnvironment, type Meteor } from './env';
import { boxHitsSolid, isSolid, padIndexAt, tileSpan, type Level } from './level';
import { npcInput, stepNpcMemory, type AiState } from './ai';
import { buy, deployFlares, fillUp, fireMissile, stepMissiles, type Decoy, type Missile } from './missiles';
import { ejectPassenger } from './passenger-flight';
import { releaseBoardingPassengers, stepPassengers } from './passengers';
import { newCoPilot, stepCoPilots, type CoPilot } from './copilot';
import { rollPersonality, type Personality } from './personality';
import { nextRandom } from './rng';
import { stepServiceCrafts, summonService, type ServiceCraft } from './service';

/** offstage – not yet in the level (an NPC waiting to arrive); counts down like a crash. */
/** destroyed is permanent: the taxi stays in the state (for history) but never returns. */
export type TaxiStatus = 'flying' | 'landed' | 'destroyed' | 'offstage';
export type LandingRating = 'smooth' | 'ok' | 'rough';
/**
 * body        – the hull hit something
 * gearUp      – touched down without the gear fully deployed
 * hardLanding – gear down, but too fast vertically or horizontally
 * badFooting  – skids not fully supported (landed on an edge)
 * missile     – hit by another taxi's missile
 * outOfFuel    – the tank ran dry: the taxi explodes on the spot
 * selfDestruct – player triggered manual self-destruct
 */
export type CrashReason = 'body' | 'gearUp' | 'hardLanding' | 'badFooting' | 'missile' | 'outOfFuel' | 'selfDestruct';

export interface Taxi {
  id: string;
  /** Center of the body box. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  status: TaxiStatus;
  /** Gear target state (toggled by the player). */
  gearDown: boolean;
  /** Gear deployment, 0 = retracted, 1 = fully down. Only 1 can land. */
  gear: number;
  fuel: number;
  /** Balance in integer cents. Changed only through `post` (accounts.ts), which records it. */
  cents: number;
  /** Pad the taxi is landed on, or -1. */
  padIndex: number;
  /** Input bits of thrusters that actually fired this tick (for rendering). */
  thrust: number;
  /** Input bits from the previous tick, for press detection. */
  prevInput: number;
  /** Persistent pilot account, or the taxi id for rivals. */
  driverId?: string;
  qualifiedLocales?: string[];
  /** Ticks until a rival that hasn't arrived yet (offstage) arrives. */
  respawnTicks: number;
  crashes: number;
  /** Id of the passenger riding in this taxi, or -1. */
  passengerId: number;
  /** The co-pilot: fixed attributes rolled when the taxi was created. */
  copilot: CoPilot;
  /** NPC only: D&D-style rolled personality attributes (3–18), fixed at creation. */
  personality?: Personality | null;
  /** NPC only: taxi ID this NPC currently has a vendetta against (null if none). */
  vendettaTargetId?: string | null;
  /** NPC only: taxi ID this timid NPC is currently fleeing from (null if none). */
  fleeFromId?: string | null;
  /**
   * NPC only: a locale the world coordinator has asked this taxi to move to. It finishes any
   * delivery, flies to a teleport pad and waits there to be transferred.
   */
  relocateTo: string | null;
  /** How it looks (TAXI_SKINS). Defaults to `shortBus`. */
  skin: TaxiSkin;
  /** Optional custom 24-bit RGB paint color (undefined = skin default / rival palette). */
  color?: number;
  /**
   * Which way it faces (cosmetic): 1 right, -1 left. A player turns it by pressing ◀ or ▶
   * alone (landed or flying, gear up or down); motion never does. A rival faces its sustained
   * horizontal travel direction (≥ NPC_FACE_VX for NPC_FACE_TICKS) so cruising faces forward
   * and braking or small hover corrections never flip it backwards. Missing in older saves: right.
   */
  facing: 1 | -1;
  /** Ticks a rival has moved in the same horizontal direction (≥ NPC_FACE_VX); signed, + right / - left. */
  sideHeld: number;
  /** Fares delivered. */
  fares: number;
  /** Computer-controlled rival: the sim generates its input; its fares don't count toward the quota. */
  npc: boolean;
  /** Autopilot memory (NPCs only). */
  ai: AiState | null;
  /** Heat-seeking missiles carried, ticks until the next one regenerates, ticks until able to fire. */
  missiles: number;
  missileReloadTicks: number;
  fireCooldownTicks: number;
  /** Countermeasure flare bursts carried, and ticks until another burst can be popped. */
  flares: number;
  flareCooldownTicks: number;
  /** Hull points left (missile hits). Other crashes destroy the taxi regardless. */
  hp: number;
  /** Ticks left during which collisions do no further damage. */
  damageGraceTicks: number;
}

/**
 * Parked at a convenience store (landed on a fuel pad): a safe zone. Missiles can't see or
 * hit a taxi here.
 */
export function atStore(s: SimState, t: Taxi): boolean {
  return t.status === 'landed' && t.padIndex >= 0 && s.level.pads[t.padIndex]!.kind === 'fuel';
}

/** Parked on a teleport pad (safe from missiles, like a store). */
export function atTeleport(s: SimState, t: Taxi): boolean {
  return t.status === 'landed' && t.padIndex >= 0 && s.level.pads[t.padIndex]!.kind === 'teleport';
}

/** Parked in a safe zone (store or teleport): fully invulnerable and weapons locked. */
export function inSafeZone(s: SimState, t: Taxi): boolean {
  return atStore(s, t) || atTeleport(s, t);
}

/** In the level and solid (not crashed, not offstage). */
export function isActive(t: Taxi): boolean {
  return t.status === 'flying' || t.status === 'landed';
}

/**
 * waiting – standing on their pad, hailing
 * walking – walking to a taxi that landed on their pad
 * riding  – inside a taxi (position follows the taxi)
 * leaving – walking off to rest after reaching the intended destination
 * hopping / parachuting – outside the cab after ejection, subject to local forces
 */
export type PassengerState = 'waiting' | 'walking' | 'riding' | 'leaving' | 'parachuting' | 'hopping';

export interface Resident {
  id: string;
  name: string;
  originLocale: string;
  kind: number;
  voiceSeed: number;
  rides: number;
}

export interface Passenger {
  person: Resident;
  /** The agreed destination survives changes to the local navigation target. */
  destination: { localeId: string; padIndex: number; arrivalDistance: number };
  temporaryStop: boolean;
  refusedDrivers: string[];
  refusalHeard: string[];
  /** Brief grace after ejection so the ejecting cab does not immediately run over the passenger. */
  ejectGraceTicks?: number;
  vx: number;
  vy: number;
  id: number;
  /** Appearance/voice variant, 0–3. */
  kind: number;
  state: PassengerState;
  /** Pad they are standing on (waiting/walking/leaving). */
  padIndex: number;
  destPadIndex: number;
  /** Feet position: x, and y = the pad surface. While riding, the taxi's position. */
  x: number;
  y: number;
  /** Facing / walking direction. */
  dir: -1 | 1;
  taxiId: string | null;
  /** Base fare, fixed at boarding. */
  fare: number;
  /** Current tip in dollars: fare × tipPercent while riding; the amount paid once delivered. */
  tip: number;
  /** Tip as a percentage of the fare (service so far, before any early bonus; final once paid). */
  tipPercent: number;
  /** Percentage points lost to service cuts (landings, bumps, damage, annoyance). */
  tipCuts: number;
  /** True once the taxi landed anywhere other than the destination: tip is permanently 0. */
  tipForfeited?: boolean;
  /** True once this ride had any bump: a less-than-smooth landing, a skid or taxi bump, or hull damage. */
  jostled?: boolean;
  /** Ticks riding so far, and the ride's on-time limit (ticks), set at boarding. */
  rideTicks: number;
  dueTicks: number;
  /** Times a taxi took off while they were walking to it. */
  annoyance: number;
  leaveTicks: number;
  /** Ticks spent waiting for a taxi (demand checks use it). */
  waitTicks: number;
}

export interface SimState {
  tick: number;
  level: Level;
  config: SimConfig;
  taxis: Taxi[];
  /** Seeded PRNG state; see rng.ts. */
  rng: number;
  passengers: Passenger[];
  missiles: Missile[];
  /** Burning countermeasure flares in the air (decoys). */
  decoys: Decoy[];
  /** Active falling meteors (Overdrive Canyon). */
  meteors: Meteor[];
  /** Ticks until next meteor spawn. */
  meteorSpawnTicks: number;
  /** Active flying convenience service crafts (non-combat, indestructible). */
  serviceCrafts: ServiceCraft[];
  nextServiceCraftId: number;
  nextMissileId: number;
  /** Fares delivered by player taxis this level (NPC fares don't count toward the quota). */
  faresDelivered: number;
  /** Exit gate is open (fare quota met). */
  exitOpen: boolean;
  /** Level finished; step() does nothing more. */
  complete: boolean;
  nextPassengerId: number;
  localeId?: string;
  resting?: { person: Resident; padIndex: number }[];
  /** Ticks until the next passenger may spawn (counts down only while below the passenger cap). */
  passengerSpawnTicks: number;
  /** Events produced outside a tick (e.g. opening balances at creation), emitted by the next step. */
  pending: SimEvent[];
}

export type SimEvent =
  /** A balance change (or a zero-amount history entry); see accounts.ts. */
  /** A missile's motor burned out (end of its range): it now falls and explodes on impact. */
  | { type: 'missileBurnout'; missileId: number; x: number; y: number }
  /** The tank just ran dry in flight: the taxi is falling (it explodes on impact). */
  | { type: 'fuelEmpty'; taxiId: string }
  | { type: 'ledger'; taxiId: string; tick: number; category: LedgerCategory; amount: number; balance: number; ref: string }
  | { type: 'landed'; taxiId: string; padIndex: number; vx: number; vy: number; rating: LandingRating }
  | { type: 'tookOff'; taxiId: string }
  /** `byTaxiId`: whose missile destroyed it, or the taxi it collided with (else null). */
  | { type: 'crashed'; taxiId: string; reason: CrashReason; x: number; y: number; vx: number; vy: number; byTaxiId: string | null }
  /** A rival flew into the level (or a taxi was placed at its start). */
  | { type: 'arrived'; taxiId: string }
  /** Gear toggle started moving. */
  | { type: 'gear'; taxiId: string; down: boolean }
  /** Gear finished moving and locked fully down or fully up. */
  | { type: 'gearLocked'; taxiId: string; down: boolean }
  /** Gear-down skids bumped a ledge sideways (no crash). */
  | { type: 'skidBump'; taxiId: string }
  | { type: 'passengerSpawned'; passengerId: number; padIndex: number }
  | { type: 'passengerDied'; passengerId: number; x: number; y: number }
  | { type: 'passengerRemark'; passengerId: number; reason: 'detour' | 'arrival' | 'ejected' | 'refused' | 'stranded' | 'landed' }
  | { type: 'passengerBoarded'; passengerId: number; taxiId: string; destPadIndex: number }
  /** The taxi took off while the passenger was walking to it. */
  | { type: 'passengerAnnoyed'; passengerId: number }
  /** A service cut: `amount` dollars (`points` percentage points of the fare). */
  | { type: 'tipLost'; passengerId: number; taxiId: string; amount: number; points: number; reason: 'roughLanding' | 'okLanding' | 'bump' | 'wrongLanding' }
  /** The taxi landed anywhere other than the passenger's destination (tip forfeited). */
  | { type: 'wrongLanding'; passengerId: number; taxiId: string; padIndex: number }
  /** The ride just ran past its on-time limit: from now on the tip shrinks every second. */
  | { type: 'rideLate'; passengerId: number; taxiId: string }
  /** Paid: `tipPercent` is the final percentage, including `earlyBonus` points for arriving early. */
  | { type: 'fareCompleted'; passengerId: number; taxiId: string; padIndex: number; fare: number; tip: number; tipPercent: number; earlyBonus: number; /** No bumps at all this ride (see Passenger.jostled). */ smooth: boolean; /** Delivered after the on-time limit. */ late: boolean }
  /** Passenger was aboard when the taxi crashed. */
  | { type: 'passengerLost'; passengerId: number; taxiId: string }
  | { type: 'passengerHit'; passengerId: number; taxiId: string; x: number; y: number; penalty: number }
  /** Fare quota met: the exit gate is open (or the level completes at once if it has no gate). */
  | { type: 'exitOpened' }
  /** Two taxis touched and were pushed apart (no crash). `speed` = relative speed before. */
  | { type: 'taxiBump'; taxiIds: [string, string]; speed: number; x: number; y: number }
  | { type: 'levelComplete'; taxiId: string }
  | { type: 'missileFired'; missileId: number; ownerId: string; x: number; y: number }
  /** `hitTaxiId` is the taxi it destroyed, or null if it hit a wall or burned out. */
  /** `decoyed`: it was fooled by flares and blew up on one; `flareOwnerId` popped that flare. */
  | {
      type: 'missileExploded';
      missileId: number;
      x: number;
      y: number;
      hitTaxiId: string | null;
      decoyed?: boolean;
      flareOwnerId?: string;
    }
  /** A taxi popped flares; `decoyed` missiles were fooled (each rolled flareSuccess). */
  /** `auto`: popped by the co-pilot rather than the pilot. */
  | { type: 'flaresDeployed'; taxiId: string; x: number; y: number; decoyed: number; threats: number; auto: boolean }
  /** The co-pilot noticed a new missile and reacted in time (or too late). */
  | { type: 'copilotReaction'; taxiId: string; missileId: number; timely: boolean }
  /** The co-pilot reacted in time but couldn't pop flares. */
  | { type: 'copilotUnable'; taxiId: string; reason: 'noFlares' | 'cooldown' }
  /** A store or mobile service sale. For gas, `gallons` is how much was pumped (fractions when topping off). */
  | { type: 'purchase'; taxiId: string; item: 'missile' | 'flare' | 'repair' | 'gas'; price: number; gallons?: number; service?: boolean }
  /** Flying convenience service lifecycle events. */
  | { type: 'serviceSummoned'; taxiId: string; craftId: number }
  | { type: 'serviceArrived'; taxiId: string; craftId: number; x: number; y: number }
  | { type: 'serviceDeparted'; taxiId: string; craftId: number }
  /** A missile hit that didn't destroy the taxi; `hp` is what's left. */
  /**
   * Lost hull points without being destroyed. `cause` missile (byTaxiId = shooter) or
   * collision (byTaxiId = the other taxi in a taxi-on-taxi collision, else null).
   */
  | {
      type: 'taxiDamaged';
      taxiId: string;
      byTaxiId: string | null;
      cause: 'missile' | 'collision';
      reason?: CrashReason;
      hp: number;
      x: number;
      y: number;
    }
  /** An NPC has locked onto another taxi (player or NPC) in Vendetta Mode. */
  | { type: 'vendettaStarted'; taxiId: string; targetId: string }
  /** An NPC's vendetta ended (target destroyed or grudge cooled off). */
  | { type: 'vendettaEnded'; taxiId: string; targetId: string; reason: 'destroyed' | 'cooledOff' }
  /** A timid NPC has entered Flee/Avoidance Mode against a threatening taxi. */
  | { type: 'npcFleeing'; taxiId: string; fromTaxiId: string };

export interface CreateSimOptions {
  config?: Partial<SimConfig>;
  playerIds?: string[];
  /** Computer-controlled rival taxis. They arrive `npcArrivalDelay` seconds into the level. */
  npcIds?: string[];
  seed?: number;
  /**
   * Balances (cents) of taxis that already exist in the game (e.g. carried over from the
   * previous level). Any other taxi is new and gets an opening credit of startMoney.
   */
  balances?: Readonly<Record<string, number>>;
}

function newTaxi(id: string, npc: boolean): Taxi {
  return {
    id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    status: 'landed',
    gearDown: true,
    gear: 1,
    fuel: 0,
    cents: 0,
    padIndex: -1,
    thrust: 0,
    prevInput: 0,
    respawnTicks: 0,
    crashes: 0,
    passengerId: -1,
    relocateTo: null,
    skin: 'shortBus',
    facing: 1,
    sideHeld: 0,
    copilot: { countermeasureProficiency: 80 }, // replaced by a seeded roll at creation
    personality: null,
    vendettaTargetId: null,
    fleeFromId: null,
    fares: 0,
    npc,
    ai: null,
    missiles: 0,
    flares: 0,
    flareCooldownTicks: 0,
    hp: 0,
    damageGraceTicks: 0,
    missileReloadTicks: 0,
    fireCooldownTicks: 0,
  };
}

export function createSim(level: Level, opts: CreateSimOptions = {}): SimState {
  const config: SimConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const state: SimState = {
    tick: 0,
    level,
    config,
    taxis: [],
    rng: opts.seed ?? 1,
    passengers: [],
    missiles: [],
    decoys: [],
    meteors: [],
    meteorSpawnTicks: level.meteors ? Math.round(level.meteors.interval * TICK_RATE) : 0,
    serviceCrafts: [],
    nextServiceCraftId: 1,
    nextMissileId: 1,
    faresDelivered: 0,
    exitOpen: false,
    complete: false,
    nextPassengerId: 1,
    passengerSpawnTicks: Math.round(config.firstPassengerDelay * TICK_RATE),
    pending: [],
  };
  for (const id of opts.playerIds ?? ['p1']) {
    const taxi = newTaxi(id, false);
    taxi.copilot = newCoPilot(state);
    resetTaxi(state, taxi);
    state.taxis.push(taxi);
  }
  // Rivals arrive one at a time: the first after npcArrivalDelay, each next one an interval
  // (plus a little seeded jitter) after the previous.
  let arriveAt = config.npcArrivalDelay;
  for (const [i, id] of (opts.npcIds ?? []).entries()) {
    const taxi = freshRival(config, id);
    taxi.copilot = newCoPilot(state);
    taxi.personality = rollPersonality(() => nextRandom(state));
    if (i > 0) arriveAt += config.npcArrivalInterval + nextRandom(state) * config.npcArrivalJitter;
    taxi.respawnTicks = Math.max(1, Math.round(arriveAt * TICK_RATE));
    state.taxis.push(taxi);
  }
  // Balances: carried over as they are, or an opening credit for a brand-new taxi.
  for (const taxi of state.taxis) {
    const carried = opts.balances?.[taxi.id];
    if (carried !== undefined) taxi.cents = carried;
    else post(state, taxi, 'opening', toCents(config.startMoney), 'new-taxi', state.pending);
  }
  return state;
}

/** A brand-new rival taxi with starting supplies, waiting offstage. */
function freshRival(config: SimConfig, id: string): Taxi {
  const taxi = newTaxi(id, true);
  taxi.missiles = config.startMissiles;
  taxi.flares = config.startFlares;
  taxi.fuel = config.fuelMax;
  taxi.hp = config.taxiMaxHp;
  taxi.status = 'offstage';
  return taxi;
}

/**
 * Add an entirely new rival to a running locale (the world coordinator does this when
 * demand calls for it): fresh supplies, an opening credit of startMoney (posted on the next
 * step), and it flies in at a clear arrival point after `arriveInTicks`.
 */
export function addRival(state: SimState, id: string, arriveInTicks = 1): Taxi {
  if (state.taxis.some((t) => t.id === id)) throw new Error(`taxi "${id}" already exists`);
  const taxi = freshRival(state.config, id);
  taxi.copilot = newCoPilot(state);
  taxi.personality = rollPersonality(() => nextRandom(state));
  taxi.respawnTicks = Math.max(1, arriveInTicks);
  state.taxis.push(taxi);
  post(state, taxi, 'opening', toCents(state.config.startMoney), 'new-taxi', state.pending);
  return taxi;
}

/**
 * Add a fresh player taxi to a running locale: parked on the spawn pad with the starting kit
 * (fuel, hull, missiles, flares) and a new co-pilot. When `balanceCents` is given (respawning
 * with an existing account balance), the taxi carries that exact balance and records a zero-cent
 * `spawn` entry; otherwise it receives an opening credit of `startMoney`. A moment's grace from
 * bumps in case another taxi is nearby.
 */
export function addPlayer(state: SimState, id: string, opts?: { balanceCents?: number }): Taxi {
  if (state.taxis.some((t) => t.id === id)) throw new Error(`taxi "${id}" already exists`);
  const taxi = newTaxi(id, false);
  taxi.copilot = newCoPilot(state);
  state.taxis.push(taxi);
  resetTaxi(state, taxi);
  taxi.damageGraceTicks = Math.round(state.config.collisionGrace * TICK_RATE) * 2;
  if (opts?.balanceCents !== undefined) {
    taxi.cents = opts.balanceCents;
    post(state, taxi, 'spawn', 0, 'respawn', state.pending);
  } else {
    post(state, taxi, 'opening', toCents(state.config.startMoney), 'new-taxi', state.pending);
  }
  return taxi;
}

/** Ids for a level's rival taxis: "npc1", "npc2", … up to level.rivals. */
export function rivalIds(level: Level): string[] {
  return Array.from({ length: level.rivals }, (_, i) => `npc${i + 1}`);
}

/** Full reset: spawn position, fuel, hull, ammo, crash and fare counts. Any rider is dropped. */
export function resetTaxi(state: SimState, taxi: Taxi): void {
  releaseBoardingPassengers(state, taxi);
  taxi.passengerId = -1;
  respawn(state, taxi);
  taxi.fuel = state.config.fuelMax;
  taxi.hp = state.config.taxiMaxHp;
  taxi.missiles = state.config.startMissiles;
  taxi.flares = state.config.startFlares;
  taxi.missileReloadTicks = 0;
  taxi.crashes = 0;
  taxi.fares = 0;
  taxi.prevInput = 0;
}

/**
 * Advance the simulation by one fixed tick (DT seconds). Mutates `state` in place
 * and returns the events that happened during the tick.
 * `inputs` maps taxi id → Input bitfield (held buttons). Missing ids mean no input.
 */
export function step(state: SimState, inputs: Readonly<Record<string, number>>, allowNewResident = true): SimEvent[] {
  const events: SimEvent[] = state.pending.splice(0);
  if (state.complete) return events;
  for (const taxi of state.taxis) {
    const input = taxi.npc ? (isActive(taxi) ? npcInput(state, taxi) : 0) : (inputs[taxi.id] ?? 0);
    stepTaxi(state, taxi, input, events);
  }
  resolveTaxiBumps(state, events);
  stepEnvironment(state, events, (t, pushX, pushY, speed) => {
    if (collide(state, t, 'body', speed, events)) return;
    t.vx = pushX;
    t.vy = pushY;
  });
  stepCoPilots(state, events); // automatic flares, after the pilots' own inputs
  stepMissiles(state, events);
  stepPassengers(state, events, allowNewResident);
  stepServiceCrafts(state, events);
  stepNpcMemory(state, events);
  checkExit(state, events);
  state.tick++;
  return events;
}

/** Open the gate once the quota is met; finish the level when a taxi flies into it. */
function checkExit(s: SimState, ev: SimEvent[]): void {
  const quota = s.level.fareQuota;
  if (!s.exitOpen && quota > 0 && s.faresDelivered >= quota) {
    s.exitOpen = true;
    for (const i of s.level.exit?.tiles ?? []) s.level.solid[i] = 0;
    ev.push({ type: 'exitOpened' });
    if (!s.level.exit) {
      s.complete = true;
      ev.push({ type: 'levelComplete', taxiId: s.taxis.find((t) => !t.npc)?.id ?? '' });
      return;
    }
  }
  const gate = s.level.exit;
  if (!s.exitOpen || !gate) return;
  for (const t of s.taxis) {
    if (t.npc || !isActive(t)) continue; // only a player flying out finishes the level
    const inside =
      t.x + TAXI.halfW > gate.x &&
      t.x - TAXI.halfW < gate.x + gate.w &&
      t.y - TAXI.halfH < gate.y + gate.h &&
      t.y + TAXI.halfH > gate.y;
    if (inside) {
      s.complete = true;
      ev.push({ type: 'levelComplete', taxiId: t.id });
      return;
    }
  }
}

/**
 * Taxis that overlap are pushed apart along the shallower axis and bounce off each other, and
 * (if hard enough) each loses a hull point like any collision. Landed taxis don't move; a push
 * that would shove a taxi into a wall is skipped.
 */
function resolveTaxiBumps(s: SimState, ev: SimEvent[]): void {
  const active = s.taxis.filter(isActive);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const aFixed = a.status === 'landed';
      const bFixed = b.status === 'landed';
      if (aFixed && bFixed) continue;
      const bottom = (t: Taxi) => t.y + TAXI.halfH + TAXI.gearLength * t.gear;
      const ox = Math.min(a.x, b.x) + TAXI.halfW - (Math.max(a.x, b.x) - TAXI.halfW);
      const oy = Math.min(bottom(a), bottom(b)) - Math.max(a.y - TAXI.halfH, b.y - TAXI.halfH);
      if (ox <= 0 || oy <= 0) continue;

      const speed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
      // Share of the separation each taxi takes.
      const shareA = aFixed ? 0 : bFixed ? 1 : 0.5;
      const shareB = 1 - shareA;
      if (ox < oy) {
        const dir = a.x < b.x ? -1 : 1; // direction a gets pushed
        shove(s, a, dir * (ox + 0.5) * shareA, 0);
        shove(s, b, -dir * (ox + 0.5) * shareB, 0);
        const [avx, bvx] = [a.vx, b.vx];
        if (!aFixed) a.vx = (bFixed ? -avx : bvx) * 0.5 + dir * 30;
        if (!bFixed) b.vx = (aFixed ? -bvx : avx) * 0.5 - dir * 30;
      } else {
        const dir = a.y < b.y ? -1 : 1;
        shove(s, a, 0, dir * (oy + 0.5) * shareA);
        shove(s, b, 0, -dir * (oy + 0.5) * shareB);
        const [avy, bvy] = [a.vy, b.vy];
        if (!aFixed) a.vy = (bFixed ? -avy : bvy) * 0.5 + dir * 30;
        if (!bFixed) b.vy = (aFixed ? -bvy : avy) * 0.5 - dir * 30;
      }
      if (speed > 25) {
        ev.push({ type: 'taxiBump', taxiIds: [a.id, b.id], speed, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      }
      // A collision like any other: each taxi loses a hull point if it was hard enough,
      // unless parked in a safe zone (store or teleport), where taxis are fully invulnerable.
      if (!inSafeZone(s, a)) collide(s, a, 'body', speed, ev, b.id);
      if (!inSafeZone(s, b)) collide(s, b, 'body', speed, ev, a.id);
    }
  }
}

function shove(s: SimState, t: Taxi, dx: number, dy: number): void {
  if (!dx && !dy) return;
  t.x += dx;
  t.y += dy;
  if (bodyHits(s.level, t) || feetHit(s.level, t)) {
    t.x -= dx;
    t.y -= dy;
  }
}

/** Ticks a rival must move one way (at ≥ NPC_FACE_VX) before it turns that way (see Taxi.facing). */
export const NPC_FACE_TICKS = 15; // quarter second: turns promptly with motion, never a flicker
/** Minimum horizontal speed (u/s) that counts as directional travel for rival facing. */
export const NPC_FACE_VX = 20;

/**
 * Players: ◀ or ▶ pressed alone turns the taxi that way (both, or neither, leaves it as it is).
 * Rivals: face their sustained horizontal travel direction so cruising faces forward and
 * braking or small hover corrections never flip them backwards.
 */
function faceFor(t: Taxi, input: number): void {
  if (!t.npc) {
    const side = input & (Input.LEFT | Input.RIGHT);
    const dir = side === Input.RIGHT ? 1 : side === Input.LEFT ? -1 : 0;
    if (dir) t.facing = dir;
    return;
  }
  const dir = t.status === 'flying' && Math.abs(t.vx) >= NPC_FACE_VX ? (t.vx > 0 ? 1 : -1) : 0;
  const held = t.sideHeld ?? 0;
  t.sideHeld = dir === 0 ? 0 : Math.sign(held) === dir ? Math.sign(dir) * Math.min(NPC_FACE_TICKS, Math.abs(held) + 1) : dir;
  if (dir && Math.abs(t.sideHeld) >= NPC_FACE_TICKS) t.facing = dir;
}

function stepTaxi(s: SimState, t: Taxi, input: number, ev: SimEvent[]): void {
  const c = s.config;
  const pressed = input & ~t.prevInput;
  t.prevInput = input;
  t.thrust = 0;

  if (t.status === 'destroyed') return; // permanent
  if (t.status === 'offstage') {
    if (--t.respawnTicks <= 0) {
      respawn(s, t);
      ev.push({ type: 'arrived', taxiId: t.id });
    }
    return;
  }
  faceFor(t, input);
  if (pressed & Input.EJECT) ejectPassenger(s, t, ev);

  // Landing gear: can't be toggled while resting on it. Weapons are locked in safe zones.
  const safe = inSafeZone(s, t);
  if (!safe && pressed & Input.FIRE) fireMissile(s, t, ev);
  if (!safe && pressed & Input.FLARE) deployFlares(s, t, ev);
  if (pressed & Input.BUY_MISSILE) buy(s, t, 'missile', ev);
  if (pressed & Input.BUY_FLARE) buy(s, t, 'flare', ev);
  if (pressed & Input.BUY_REPAIR) buy(s, t, 'repair', ev);
  if (pressed & Input.BUY_GAS) buy(s, t, 'gas', ev);
  if (pressed & Input.BUY_FILL) fillUp(s, t, ev);
  if (pressed & Input.SUMMON_SERVICE) summonService(s, t, ev);
  if (t.damageGraceTicks > 0) t.damageGraceTicks--;

  if (pressed & Input.GEAR && (t.status === 'flying' || t.gear < 1)) {
    t.gearDown = !t.gearDown;
    ev.push({ type: 'gear', taxiId: t.id, down: t.gearDown });
  }
  const gearStep = DT / Math.max(c.gearTime, DT);
  const gearBefore = t.gear;
  t.gear = t.gearDown ? Math.min(1, t.gear + gearStep) : Math.max(0, t.gear - gearStep);
  if (t.gear !== gearBefore && (t.gear === 0 || t.gear === 1)) {
    ev.push({ type: 'gearLocked', taxiId: t.id, down: t.gear === 1 });
  }
  // Lowering the gear while resting on the belly (after a gear-up touchdown) pushes the
  // taxi up onto its skids instead of driving them into the ground.
  if (t.gear > gearBefore && feetHit(s.level, t)) {
    const y0 = t.y;
    for (let k = 0; k <= TAXI.gearLength && feetHit(s.level, t); k++) t.y -= 1;
    if (bodyHits(s.level, t) || feetHit(s.level, t)) {
      t.y = y0; // no room to lift: the gear stays where it was
      t.gear = gearBefore;
    }
  }

  if (t.status === 'landed') {
    if (input & Input.UP && t.fuel > 0) {
      t.status = 'flying';
      t.padIndex = -1;
      ev.push({ type: 'tookOff', taxiId: t.id });
    } else {
      return; // parked (gas is bought at stores; see buy / fillUp)
    }
  }

  // Thrusters. The side thrusters only work with the gear fully retracted: from the moment
  // it starts deploying until it is fully up again, LEFT/RIGHT do nothing (no push, exhaust
  // or fuel). Momentum is kept.
  if (!sideThrustAvailable(t)) input &= ~(Input.LEFT | Input.RIGHT);
  const env = envForceAt(s.level, c, s.tick, t.x, t.y);
  let ax = env.ax;
  let ay = env.ay;
  const ts = s.level.thrustScale;
  const bs = s.level.burnScale;
  if (t.fuel > 0) {
    let burn = 0;
    if (input & Input.UP) {
      ay -= c.thrustUp * ts;
      burn += c.burnUp * bs;
      t.thrust |= Input.UP;
    }
    if (input & Input.DOWN) {
      ay += c.thrustDown * ts;
      burn += c.burnDown * bs;
      t.thrust |= Input.DOWN;
    }
    if (input & Input.LEFT) {
      ax -= c.thrustSide * ts;
      burn += c.burnSide * bs;
      t.thrust |= Input.LEFT;
    }
    if (input & Input.RIGHT) {
      ax += c.thrustSide * ts;
      burn += c.burnSide * bs;
      t.thrust |= Input.RIGHT;
    }
    if (burn > 0) {
      t.fuel = Math.max(0, t.fuel - burn * DT);
      // Ran dry: the engines die and the taxi falls; it explodes on the first thing it hits.
      if (t.fuel === 0) ev.push({ type: 'fuelEmpty', taxiId: t.id });
    }
  }

  t.vx += ax * DT;
  t.vy += ay * DT;
  const drag = Math.max(0, 1 - (t.gearDown ? c.dragGearDown : c.dragGearUp) * DT);
  t.vx *= drag;
  t.vy *= drag;
  const maxSpd = c.maxSpeed * s.level.maxSpeedScale;
  const speed = Math.hypot(t.vx, t.vy);
  if (speed > maxSpd) {
    t.vx *= maxSpd / speed;
    t.vy *= maxSpd / speed;
  }

  move(s, t, ev);
}

/** Move by one tick of velocity in small sub-steps, x then y, resolving contacts. */
function move(s: SimState, t: Taxi, ev: SimEvent[]): void {
  const dx = t.vx * DT;
  const dy = t.vy * DT;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
  const sx = dx / n;
  const sy = dy / n;
  let sxLeft = sx;
  let syLeft = sy;
  for (let i = 0; i < n; i++) {
    t.x += sxLeft;
    if (bodyHits(s.level, t)) {
      // Hull hit a wall: lose a hull point (if hard enough) and bounce back.
      t.x -= sxLeft;
      if (collide(s, t, 'body', Math.abs(t.vx), ev)) return;
      t.vx = -t.vx * s.config.collisionBounce;
      sxLeft = 0;
    } else if (feetHit(s.level, t)) {
      // Skids bumped a ledge sideways: the gear is sturdy, so stop (no damage).
      if (Math.abs(t.vx) > 15) ev.push({ type: 'skidBump', taxiId: t.id });
      t.x -= sxLeft;
      t.vx = 0;
      sxLeft = 0;
    }
    const prevFeetBottom = feetBottom(t);
    t.y += syLeft;
    if (bodyHits(s.level, t)) {
      // Ceiling, or the belly with the gear up: damage and bounce.
      t.y -= syLeft;
      if (collide(s, t, syLeft > 0 && t.gear < 1 ? 'gearUp' : 'body', Math.abs(t.vy), ev)) return;
      t.vy = -t.vy * s.config.collisionBounce;
      // Once a gear-up taxi comes to rest on a supported surface, treat it as parked so it
      // can use stores, summon mobile service, and take off again.
      if (syLeft > 0 && t.gear < 1 && Math.abs(t.vy) < 12 && Math.abs(t.vx) < 15) {
        const ts = s.level.tileSize;
        const surface = Math.floor((t.y + TAXI.halfH + syLeft - EPS) / ts) * ts;
        if (feetSupported(s.level, t.x, surface, s.config.landMinSupport)) {
          const { vx, vy } = t;
          t.y = surface - TAXI.halfH - TAXI.gearLength * t.gear;
          t.vx = 0;
          t.vy = 0;
          t.status = 'landed';
          t.padIndex = padUnderFeet(s.level, t.x, surface);
          ev.push({ type: 'landed', taxiId: t.id, padIndex: t.padIndex, vx, vy, rating: 'rough' });
          return;
        }
      }
      syLeft = 0;
    } else if (feetHit(s.level, t)) {
      touchdown(s, t, prevFeetBottom, syLeft, ev);
      return;
    }
  }
}

/**
 * A collision: costs collisionDamage hull points if the impact is hard enough and the taxi
 * isn't still in its post-hit grace period. Returns true if that destroyed the taxi.
 */
export function collide(
  s: SimState,
  t: Taxi,
  reason: CrashReason,
  impact: number,
  ev: SimEvent[],
  byTaxiId: string | null = null,
): boolean {
  const c = s.config;
  if (!isActive(t) || impact < c.collisionMinSpeed || t.damageGraceTicks > 0) return false;
  t.damageGraceTicks = Math.round(c.collisionGrace * TICK_RATE);
  t.hp = Math.max(0, t.hp - c.collisionDamage);
  if (t.hp === 0) {
    crash(s, t, reason, ev, byTaxiId);
    return true;
  }
  ev.push({ type: 'taxiDamaged', taxiId: t.id, byTaxiId, cause: 'collision', reason, hp: t.hp, x: t.x, y: t.y });
  return false;
}

/** The skids touched something while moving down by `sy` this sub-step. */
function touchdown(s: SimState, t: Taxi, prevFeetBottom: number, sy: number, ev: SimEvent[]): void {
  const c = s.config;
  const level = s.level;
  const bounce = (reason: CrashReason) => {
    t.y -= sy;
    if (collide(s, t, reason, Math.abs(t.vy), ev)) return;
    t.vy = -Math.abs(t.vy) * c.collisionBounce;
  };
  // With a dry tank every bounce and hard touchdown below is an impact that destroys it
  // (see collide); only a clean landing at a store it can buy gas from is survivable.
  if (t.gear < 1) return bounce('gearUp');
  if (t.vy <= 0) return bounce('body');

  const ts = level.tileSize;
  const surface = Math.floor((feetBottom(t) - EPS) / ts) * ts;
  // Skids clipped something from the side rather than settling onto a top surface.
  if (prevFeetBottom > surface + EPS) return bounce('body');
  if (!feetSupported(level, t.x, surface, c.landMinSupport)) {
    // Mostly off the edge: bounce, and tip off toward the unsupported side.
    const leftSupport = feetSupport(level, t.x - TAXI.feetHalfW / 2, surface);
    const rightSupport = feetSupport(level, t.x + TAXI.feetHalfW / 2, surface);
    bounce('badFooting');
    if (t.status !== 'destroyed') t.vx += leftSupport > rightSupport ? 40 : -40;
    return;
  }
  // Too fast: it still lands, but the hard touchdown costs a hull point (or the last one).
  if (t.vy > landingMaxVy(c, t.vx) || Math.abs(t.vx) > c.landMaxVx) {
    if (collide(s, t, 'hardLanding', Math.max(t.vy, Math.abs(t.vx)), ev)) return;
  }

  const { vx, vy } = t;
  t.y = surface - TAXI.gearLength - TAXI.halfH;
  t.vx = 0;
  t.vy = 0;
  t.status = 'landed';
  t.padIndex = padUnderFeet(level, t.x, surface);
  let rating: LandingRating = vy <= c.landSmoothVy ? 'smooth' : vy <= c.landOkVy ? 'ok' : 'rough';
  if (Math.abs(vx) > c.landRoughVx) rating = 'rough';
  ev.push({ type: 'landed', taxiId: t.id, padIndex: t.padIndex, vx, vy, rating });
}

/** Side thrusters work only with the landing gear fully retracted (and not moving). */
export function sideThrustAvailable(t: Taxi): boolean {
  return !t.gearDown && t.gear <= 0;
}

/**
 * Highest safe downward touchdown speed for a given sideways speed: moving sideways at a
 * moderate clip ("gliding in") allows a harder drop.
 */
export function landingMaxVy(c: SimConfig, vx: number): number {
  return Math.abs(vx) >= c.landGlideVx ? c.landMaxVy + c.landGlideBonusVy : c.landMaxVy;
}

export function crash(s: SimState, t: Taxi, reason: CrashReason, ev: SimEvent[], byTaxiId: string | null = null): void {
  ev.push({ type: 'crashed', taxiId: t.id, reason, x: t.x, y: t.y, vx: t.vx, vy: t.vy, byTaxiId });
  // The ledger keeps who did it: "crash:missile:npc3" (a shooter, or the taxi it collided with).
  post(s, t, 'destroyed', 0, byTaxiId ? `crash:${reason}:${byTaxiId}` : `crash:${reason}`, ev);
  // Destruction is permanent: no respawn, for players and rivals alike. The taxi stays in the
  // state (with its history and final balance) but leaves the traffic.
  t.status = 'destroyed';
  t.respawnTicks = 0;
  t.crashes++;
  t.vx = 0;
  t.vy = 0;
  t.thrust = 0;
  t.padIndex = -1;
}

/**
 * A taxi arriving in this locale from another one (the world coordinator moves it): landed
 * at `spot` (a clear place on a teleport pad), or else at the start (players on the spawn
 * pad, rivals flying in); at rest, with a moment's grace from bumps. Everything it carries
 * (fuel, hull, ammo, money, cooldowns) is unchanged.
 */
export function admitTaxi(s: SimState, t: Taxi, spot?: { padIndex: number; x: number }): void {
  respawn(s, t);
  if (spot) {
    // Landed on the given pad (a teleport), at rest, gear down.
    const pad = s.level.pads[spot.padIndex]!;
    t.x = spot.x;
    t.y = pad.y - TAXI.gearLength - TAXI.halfH;
    t.status = 'landed';
    t.padIndex = pad.index;
  }
  t.prevInput = 0;
  t.thrust = 0;
  t.passengerId = -1;
  t.damageGraceTicks = Math.round(s.config.collisionGrace * TICK_RATE);
  s.taxis.push(t);
}

/** Put a taxi at its starting place: players on the spawn pad, rivals flying in. */
function respawn(s: SimState, t: Taxi): void {
  const p = t.npc ? arrivalPoint(s.level, s.taxis.filter((o) => o !== t && isActive(o))) : spawnPoint(s.level);
  t.x = p.x;
  t.y = p.y;
  t.vx = 0;
  t.vy = 0;
  t.status = t.npc ? 'flying' : 'landed';
  t.ai = null;
  t.gearDown = true;
  t.gear = 1;
  t.padIndex = p.padIndex;
  t.thrust = 0;
  t.respawnTicks = 0;
}

/**
 * Where an NPC taxi appears, hovering: just below the exit gate (it "flies in" through it),
 * or above the pad farthest from the player spawn if the level has no gate. Spots near another
 * taxi (`others`) are skipped so rivals don't arrive on top of anyone.
 */
export function arrivalPoint(level: Level, others: readonly Taxi[] = []): { x: number; y: number; padIndex: number } {
  const clear = (x: number, y: number) =>
    !boxHitsSolid(level, x - TAXI.halfW - 4, y - TAXI.halfH - 4, x + TAXI.halfW + 4, y + TAXI.halfH + TAXI.gearLength + 4);
  const candidates: { x: number; y: number }[] = [];
  if (level.exit) {
    const g = level.exit;
    candidates.push({ x: g.x + g.w / 2, y: g.y + g.h + TAXI.halfH + 10 });
  }
  const sx = (level.spawnCol + 0.5) * level.tileSize;
  const sy = (level.spawnRow + 0.5) * level.tileSize;
  const pads = [...level.pads].sort(
    (a, b) => Math.hypot(b.x + b.w / 2 - sx, b.y - sy) - Math.hypot(a.x + a.w / 2 - sx, a.y - sy),
  );
  for (const pad of pads) candidates.push({ x: pad.x + pad.w / 2, y: pad.y - 70 });
  const roomy = (c: { x: number; y: number }) => others.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > 100);
  const spot = candidates.find((c) => clear(c.x, c.y) && roomy(c)) ?? candidates.find((c) => clear(c.x, c.y));
  if (!spot) throw new Error(`Level "${level.name}": nowhere for an NPC taxi to arrive`);
  return { ...spot, padIndex: -1 };
}

/** Where the taxi starts: resting on the first solid surface below the S tile. Throws if unusable. */
export function spawnPoint(level: Level): { x: number; y: number; padIndex: number } {
  let row = level.spawnRow;
  while (row < level.rows && !isSolid(level, level.spawnCol, row)) row++;
  if (row >= level.rows) throw new Error(`Level "${level.name}": no ground below spawn`);
  const surface = row * level.tileSize;
  const x = (level.spawnCol + 0.5) * level.tileSize;
  const y = surface - TAXI.gearLength - TAXI.halfH;
  if (!feetSupported(level, x, surface)) {
    throw new Error(`Level "${level.name}": ground below spawn is too narrow for the taxi's skids`);
  }
  if (boxHitsSolid(level, x - TAXI.halfW, y - TAXI.halfH, x + TAXI.halfW, surface)) {
    throw new Error(`Level "${level.name}": not enough room for the taxi at spawn`);
  }
  return { x, y, padIndex: padUnderFeet(level, x, surface) };
}

/** Fraction (0–1) of the skid width resting on solid tiles whose top is at `surface`. */
export function feetSupport(level: Level, x: number, surface: number): number {
  return skidCoverage(level, x, surface, (c, row) => isSolid(level, c, row));
}

/** Does at least `minSupport` of the skid width rest on solid ground at `surface`? */
export function feetSupported(level: Level, x: number, surface: number, minSupport = 1): boolean {
  return feetSupport(level, x, surface) >= minSupport - EPS;
}

/** The pad that carries most of the skids (at least half), else -1. */
function padUnderFeet(level: Level, x: number, surface: number): number {
  let best = -1;
  let bestCover = 0;
  for (const pad of level.pads) {
    if (pad.y !== surface) continue;
    const cover = skidCoverage(level, x, surface, (c, row) => padIndexAt(level, c, row) === pad.index);
    if (cover > bestCover) {
      best = pad.index;
      bestCover = cover;
    }
  }
  return bestCover >= 0.5 - EPS ? best : -1;
}

function skidCoverage(level: Level, x: number, surface: number, covers: (c: number, row: number) => boolean): number {
  const ts = level.tileSize;
  const row = Math.round(surface / ts);
  const x0 = x - TAXI.feetHalfW;
  const x1 = x + TAXI.feetHalfW;
  const [c0, c1] = tileSpan(level, x0, x1);
  let covered = 0;
  for (let c = c0; c <= c1; c++) {
    if (covers(c, row)) covered += Math.min(x1, (c + 1) * ts) - Math.max(x0, c * ts);
  }
  return covered / (x1 - x0);
}

function feetBottom(t: Taxi): number {
  return t.y + TAXI.halfH + TAXI.gearLength * t.gear;
}

function bodyHits(level: Level, t: Taxi): boolean {
  return boxHitsSolid(level, t.x - TAXI.halfW, t.y - TAXI.halfH, t.x + TAXI.halfW, t.y + TAXI.halfH);
}

function feetHit(level: Level, t: Taxi): boolean {
  return boxHitsSolid(level, t.x - TAXI.feetHalfW, t.y + TAXI.halfH, t.x + TAXI.feetHalfW, feetBottom(t));
}
