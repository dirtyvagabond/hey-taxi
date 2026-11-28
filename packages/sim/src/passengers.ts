import { post, toCents } from './accounts';
import { DT, TAXI, TICK_RATE } from './constants';
import type { Pad } from './level';
import { acceptsDriver, canBoardHere, needsTransfer, newResident, setJourneyTarget, walkable } from './journeys';
import { stepPassengerFlight } from './passenger-flight';
import { nextRandom } from './rng';
import { isActive, type Passenger, type SimEvent, type SimState, type Taxi } from './sim';

/** Passenger hitbox, relative to their feet (x, y). */
export const PASSENGER = { halfW: 5, height: 22 } as const;
export const PASSENGER_KINDS = 4;

const LEAVE_SECONDS = 1.2;
/** Passengers never stand closer than this to a pad edge. */
const PAD_MARGIN = 8;
/** Passengers wait within this distance (beyond PAD_MARGIN) of one end of their pad. */
const CURB_ZONE = 14;
/** Gap between a boarding/leaving passenger and the taxi's side. */
const DOOR_GAP = 2;
/** Horizontal clearance from a nearby taxi required to spawn a passenger. */
const SPAWN_CLEARANCE = 12;

/** Advance all passengers one tick. Runs after the taxis have moved; `ev` holds this tick's taxi events. */
export function stepPassengers(s: SimState, ev: SimEvent[], allowNewResident = true): void {
  const removed = new Set<Passenger>();
  applyTaxiEvents(s, ev.slice(), ev, removed);
  for (const p of s.passengers) {
    if (p.ejectGraceTicks) p.ejectGraceTicks--;
    if (p.state === 'waiting') p.waitTicks++;
    if (!removed.has(p)) updatePassenger(s, p, ev, removed);
  }
  checkHits(s, ev, removed);
  if (removed.size) s.passengers = s.passengers.filter((p) => !removed.has(p));
  if (allowNewResident || s.resting?.length) spawn(s, ev);
}

/** Put a passenger on a pad directly (tests, scripted levels). Does not emit an event. */
export function spawnPassenger(
  s: SimState,
  o: { padIndex: number; destPadIndex: number; x: number; kind?: number },
): Passenger {
  const pad = s.level.pads[o.padIndex]!;
  const id = s.nextPassengerId++;
  const locale = s.localeId ?? s.level.name;
  const pool = s.resting;
  const samePad = pool?.findIndex(r => r.padIndex === o.padIndex) ?? -1;
  const resident = pool?.splice(Math.max(0, samePad), 1)[0]?.person ?? newResident(locale, id, o.kind ?? 0);
  const p: Passenger = {
    id, person: resident, destination: { localeId: locale, padIndex: o.destPadIndex, arrivalDistance: 0 },
    temporaryStop: false, refusedDrivers: [], refusalHeard: [], vx: 0, vy: 0,
    kind: resident.kind,
    state: 'waiting',
    padIndex: o.padIndex,
    destPadIndex: o.destPadIndex,
    x: o.x,
    y: pad.y,
    dir: o.x < pad.x + pad.w / 2 ? 1 : -1,
    taxiId: null,
    fare: 0,
    tip: 0,
    tipPercent: 0,
    tipCuts: 0,
    tipForfeited: false,
    rideTicks: 0,
    dueTicks: 0,
    annoyance: 0,
    leaveTicks: 0,
    waitTicks: 0,
  };
  s.passengers.push(p);
  return p;
}

export function riderOf(s: SimState, taxiId: string): Passenger | undefined {
  return s.passengers.find((p) => p.state === 'riding' && p.taxiId === taxiId);
}

function applyTaxiEvents(s: SimState, taxiEvents: SimEvent[], ev: SimEvent[], removed: Set<Passenger>): void {
  const c = s.config;
  const wrongLanded = new Set<string>();
  for (const e of taxiEvents) {
    if (e.type !== 'landed') continue;
    const p = riderOf(s, e.taxiId);
    if (p && !requestedStop(s, p, e.padIndex)) wrongLanded.add(e.taxiId);
  }
  for (const e of taxiEvents) {
    if (e.type === 'taxiDamaged') {
      // Shaken, not stirred: hull damage costs tip. A hard landing is one cut in all: its
      // "rough" rating plus the hard-landing extra, not a second full cut for the damage.
      // If the landing was at the wrong destination, the wrong-landing forfeit zeroes the whole tip.
      const p = riderOf(s, e.taxiId);
      if (!p) continue;
      if (e.reason === 'hardLanding') {
        if (!wrongLanded.has(e.taxiId)) loseTip(s, p, c.tipCutHardLanding, 'roughLanding', ev);
      } else {
        loseTip(s, p, c.tipCutDamage, 'bump', ev);
      }
      continue;
    }
    if (e.type === 'taxiBump') {
      // A hard bump between taxis jostles both riders.
      if (e.speed < 40) continue;
      for (const id of e.taxiIds) {
        const p = riderOf(s, id);
        if (p) loseTip(s, p, c.tipCutBump, 'bump', ev);
      }
      continue;
    }
    if (e.type !== 'crashed' && e.type !== 'landed' && e.type !== 'skidBump') continue;
    const p = riderOf(s, e.taxiId);
    if (!p) continue;
    if (e.type === 'crashed') {
      removed.add(p);
      taxiById(s, e.taxiId)!.passengerId = -1;
      ev.push({ type: 'passengerLost', passengerId: p.id, taxiId: e.taxiId });
    } else if (e.type === 'skidBump') {
      loseTip(s, p, c.tipCutBump, 'bump', ev);
    } else if (!requestedStop(s, p, e.padIndex)) {
      forfeitTip(s, p, ev);
      ev.push({ type: 'wrongLanding', passengerId: p.id, taxiId: e.taxiId, padIndex: e.padIndex });
    } else if (e.rating === 'rough') {
      loseTip(s, p, c.tipCutRough, 'roughLanding', ev);
    } else if (e.rating === 'ok') {
      loseTip(s, p, c.tipCutOk, 'okLanding', ev);
    }
  }
}

function requestedStop(s: SimState, p: Passenger, padIndex: number): boolean {
  return padIndex === p.destPadIndex || (s.level.pads[padIndex]?.kind === 'teleport' && needsTransfer(s, p));
}

/** Landing anywhere other than the destination forfeits the entire tip (no early bonus can rescue it). */
function forfeitTip(s: SimState, p: Passenger, ev: SimEvent[]): void {
  ensureRideFields(s, p);
  const lost = p.tipPercent;
  p.tipForfeited = true;
  p.tipCuts = Math.max(p.tipCuts, s.config.tipPercent);
  updateTip(s, p);
  if (lost <= 0) return;
  const shown = Math.floor(p.fare * lost) / 100;
  if (shown > 0) ev.push({ type: 'tipLost', passengerId: p.id, taxiId: p.taxiId!, amount: shown, points: lost, reason: 'wrongLanding' });
}

/** A service cut of `points` percentage points (never more than what's left of the tip). */
function loseTip(
  s: SimState,
  p: Passenger,
  points: number,
  reason: 'roughLanding' | 'okLanding' | 'bump',
  ev: SimEvent[],
): void {
  ensureRideFields(s, p);
  // Remember the bump even when there's no tip left to cut: it still sours the passenger's mood.
  p.jostled = true;
  const lost = Math.min(p.tipPercent, points);
  if (lost <= 0) return;
  p.tipCuts += lost;
  updateTip(s, p);
  // Shown in whole cents, rounded down (a cut never shows more than it took).
  const shown = Math.floor(p.fare * lost) / 100;
  if (shown > 0) ev.push({ type: 'tipLost', passengerId: p.id, taxiId: p.taxiId!, amount: shown, points: lost, reason });
}

/** Service so far, in percent of the fare: the full tip less cuts and lateness, never below 0. */
function servicePercent(s: SimState, p: Passenger): number {
  if (p.tipForfeited) return 0;
  const c = s.config;
  const lateSeconds = Math.max(0, p.rideTicks - p.dueTicks) / TICK_RATE;
  return Math.max(0, c.tipPercent - p.tipCuts - lateSeconds * c.tipLatePerSecond);
}

function updateTip(s: SimState, p: Passenger): void {
  p.tipPercent = servicePercent(s, p);
  p.tip = (p.fare * p.tipPercent) / 100;
}

/** On-time limit for a ride between two pads, in ticks. */
function dueTicksFor(s: SimState, from: Pad, to: Pad): number {
  return Math.round((s.config.tripAllowance + padDistance(from, to) / s.config.tripPace) * TICK_RATE);
}

/**
 * A rider saved before tips were a percentage of the fare (their old dollar tip, no ride
 * clock): carry the tip over as a percentage and start the clock now.
 */
function ensureRideFields(s: SimState, p: Passenger): void {
  if (p.dueTicks !== undefined && p.tipCuts !== undefined) return;
  const old = p.fare > 0 ? (100 * (p.tip ?? 0)) / p.fare : 0;
  p.tipCuts = s.config.tipPercent - Math.min(s.config.tipPercent, old);
  p.rideTicks = 0;
  p.dueTicks = dueTicksFor(s, s.level.pads[p.padIndex]!, s.level.pads[p.destPadIndex]!);
  updateTip(s, p);
}

function updatePassenger(s: SimState, p: Passenger, ev: SimEvent[], removed: Set<Passenger>): void {
  const c = s.config;
  const stepLen = c.walkSpeed * DT;
  switch (p.state) {
    case 'parachuting':
    case 'hopping':
      if (!stepPassengerFlight(s, p, ev)) {
        removed.add(p);
        ev.push({ type: 'passengerDied', passengerId: p.id, x: p.x, y: p.y });
      }
      break;
    case 'waiting': {
      if (p.leaveTicks > 0) {
        // After a low ejection, take a few steps away from the door before hailing again.
        const next = p.x + p.dir * stepLen;
        const pad = s.level.pads[p.padIndex];
        if ((!pad || (next >= pad.x + PASSENGER.halfW && next <= pad.x + pad.w - PASSENGER.halfW)) &&
            walkable(s, p.x, next, p.y)) p.x = next;
        p.leaveTicks--;
        break;
      }
      let taxi: Taxi | undefined;
      for (const t of s.taxis) {
        if (!canBoardHere(s, p, t)) continue;
        if (acceptsDriver(s, p, t)) { taxi ??= t; continue; }
        const driver = t.driverId ?? t.id;
        if (p.refusedDrivers.includes(driver) && !p.refusalHeard.includes(driver)) {
          p.refusalHeard.push(driver);
          ev.push({ type: 'passengerRemark', passengerId: p.id, reason: 'refused' });
        }
      }
      if (taxi) {
        p.state = 'walking';
        p.taxiId = taxi.id;
      }
      break;
    }
    case 'walking': {
      const taxi = taxiById(s, p.taxiId);
      if (!taxi || !canBoardHere(s, p, taxi) || !acceptsDriver(s, p, taxi)) {
        p.state = 'waiting';
        p.taxiId = null;
        p.annoyance++;
        ev.push({ type: 'passengerAnnoyed', passengerId: p.id });
        break;
      }
      const side = p.x < taxi.x ? -1 : 1;
      const doorX = taxi.x + side * (TAXI.halfW + DOOR_GAP + PASSENGER.halfW);
      const dx = doorX - p.x;
      if (Math.abs(dx) <= stepLen) {
        board(s, p, taxi, ev);
      } else {
        p.dir = dx > 0 ? 1 : -1;
        p.x += p.dir * stepLen;
      }
      break;
    }
    case 'riding': {
      const taxi = taxiById(s, p.taxiId)!;
      // Self-destruct can occur after the locale's passenger step.
      if (taxi.status === 'destroyed') {
        removed.add(p);
        taxi.passengerId = -1;
        ev.push({ type: 'passengerLost', passengerId: p.id, taxiId: taxi.id });
        break;
      }
      p.x = taxi.x;
      p.y = taxi.y;
      ensureRideFields(s, p);
      p.rideTicks++;
      if (p.rideTicks === p.dueTicks + 1) ev.push({ type: 'rideLate', passengerId: p.id, taxiId: taxi.id });
      updateTip(s, p);
      if (taxi.status === 'landed' && taxi.padIndex === p.destPadIndex && !needsTransfer(s, p)) deliver(s, p, taxi, ev);
      break;
    }
    case 'leaving': {
      if (walkable(s, p.x, p.x + p.dir * stepLen, p.y)) p.x += p.dir * stepLen;
      if (--p.leaveTicks <= 0) {
        if (s.localeId) (s.resting ??= []).push({ person: p.person, padIndex: p.padIndex });
        removed.add(p);
      }
      break;
    }
  }
}

function board(s: SimState, p: Passenger, taxi: Taxi, ev: SimEvent[]): void {
  const c = s.config;
  const from = s.level.pads[p.padIndex] ?? { x: p.x, y: p.y, w: 0 };
  const to = s.level.pads[p.destPadIndex]!;
  const distance = padDistance(from, to) + (needsTransfer(s, p) ? p.destination.arrivalDistance : 0);
  p.tipForfeited = false;
  p.person.rides++;
  p.state = 'riding';
  p.x = taxi.x;
  p.y = taxi.y;
  // The locale's multiplier applies to the distance-based base fare, rounded to cents.
  p.fare = round2((c.baseFare + c.farePerDistance * distance) * s.level.fareMultiplier);
  // The tip: a percentage of the fare, less a cut for each time they were left behind.
  p.tipCuts = Math.min(c.tipPercent, p.annoyance * c.tipCutAnnoyed);
  p.rideTicks = 0;
  p.dueTicks = Math.round((c.tripAllowance + distance / c.tripPace) * TICK_RATE);
  p.jostled = false;
  updateTip(s, p);
  taxi.passengerId = p.id;
  ev.push({ type: 'passengerBoarded', passengerId: p.id, taxiId: taxi.id, destPadIndex: p.destPadIndex });
}

function deliver(s: SimState, p: Passenger, taxi: Taxi, ev: SimEvent[]): void {
  const pad = s.level.pads[p.destPadIndex]!;
  const roomLeft = taxi.x - pad.x;
  const roomRight = pad.x + pad.w - taxi.x;
  p.dir = roomRight >= roomLeft ? 1 : -1;
  p.state = 'leaving';
  p.padIndex = p.destPadIndex;
  p.x = taxi.x + p.dir * (TAXI.halfW + DOOR_GAP + PASSENGER.halfW);
  p.y = pad.y;
  p.leaveTicks = Math.round(LEAVE_SECONDS * TICK_RATE);
  if (p.temporaryStop) {
    // The requested curb in an unwanted city ends this ride, but not the journey.
    const driver = taxi.driverId ?? taxi.id;
    if (!p.refusedDrivers.includes(driver)) p.refusedDrivers.push(driver);
    if (!p.refusalHeard.includes(driver)) p.refusalHeard.push(driver);
    taxi.passengerId = -1;
    p.taxiId = null;
    p.state = 'waiting';
    p.leaveTicks = Math.round(0.35 * TICK_RATE);
    p.waitTicks = p.annoyance = 0;
    p.fare = p.tip = p.tipPercent = 0;
    setJourneyTarget(s, p);
    ev.push({ type: 'passengerRemark', passengerId: p.id, reason: 'stranded' });
    return;
  }
  // Arriving early earns a bonus (up to tipPercentMax in all), unless the tip was forfeited.
  const c = s.config;
  const service = servicePercent(s, p);
  const earlySeconds = p.tipForfeited ? 0 : Math.max(0, p.dueTicks - p.rideTicks) / TICK_RATE;
  const percent = p.tipForfeited ? 0 : Math.min(c.tipPercentMax, service + earlySeconds * c.tipEarlyPerSecond);
  const earlyBonus = Math.max(0, percent - service);
  // Paid in whole cents; tips are never negative (also avoids "-0.00").
  const fareCents = toCents(p.fare);
  const tipCents = Math.max(0, Math.round((fareCents * percent) / 100));
  p.tipPercent = percent;
  p.tip = tipCents / 100;
  taxi.passengerId = -1;
  ev.push({
    type: 'fareCompleted',
    passengerId: p.id,
    taxiId: taxi.id,
    padIndex: p.destPadIndex,
    fare: fareCents / 100,
    tip: p.tip,
    tipPercent: round2(percent),
    earlyBonus: round2(earlyBonus),
    smooth: !p.jostled,
    late: p.rideTicks > p.dueTicks,
  });
  post(s, taxi, 'fare', fareCents, residentRef(p), ev);
  if (tipCents > 0) post(s, taxi, 'tip', tipCents, residentRef(p), ev);
  taxi.fares++;
  if (!taxi.npc) s.faresDelivered++;
}

/** Relative speed (u/s) above which hitting an airborne passenger is fatal rather than a gentle bump. */
const AIRBORNE_HIT_SPEED = 95;

/** A taxi touching a waiting, walking, or airborne passenger knocks them over (slow aerial brushes bump them aside). */
function checkHits(s: SimState, ev: SimEvent[], removed: Set<Passenger>): void {
  for (const p of s.passengers) {
    const airborne = p.state === 'parachuting' || p.state === 'hopping';
    if (removed.has(p) || (!airborne && p.state !== 'waiting' && p.state !== 'walking')) continue;
    for (const t of s.taxis) {
      if (!isActive(t) || !touches(t, p)) continue;
      if (p.ejectGraceTicks && p.refusedDrivers.includes(t.driverId ?? t.id)) continue;
      if (airborne && Math.hypot(t.vx - p.vx, t.vy - p.vy) <= AIRBORNE_HIT_SPEED) {
        const pushDir = p.x < t.x ? -1 : 1;
        p.vx = t.vx * 0.6 + pushDir * 45;
        p.vy = Math.min(p.vy, t.vy * 0.5 - 20);
        continue;
      }
      removed.add(p);
      const penalty = toCents(s.config.hitPenalty);
      ev.push({ type: 'passengerHit', passengerId: p.id, taxiId: t.id, x: p.x, y: p.y, penalty: penalty / 100 });
      post(s, t, 'passengerHit', -penalty, residentRef(p), ev);
      break;
    }
  }
}

function touches(t: Taxi, p: Passenger): boolean {
  const px0 = p.x - PASSENGER.halfW;
  const px1 = p.x + PASSENGER.halfW;
  const py0 = p.y - PASSENGER.height;
  const py1 = p.y;
  const overlaps = (x0: number, y0: number, x1: number, y1: number) =>
    x1 > x0 && y1 > y0 && x0 < px1 && x1 > px0 && y0 < py1 && y1 > py0;
  const feetBottom = t.y + TAXI.halfH + TAXI.gearLength * t.gear;
  return (
    overlaps(t.x - TAXI.halfW, t.y - TAXI.halfH, t.x + TAXI.halfW, t.y + TAXI.halfH) ||
    overlaps(t.x - TAXI.feetHalfW, t.y + TAXI.halfH, t.x + TAXI.feetHalfW, feetBottom)
  );
}

function spawn(s: SimState, ev: SimEvent[]): void {
  if (s.level.passengerInterval > 0) return spawnByDemand(s, ev);
  const c = s.config;
  const inPlay = s.passengers.filter((p) => p.state !== 'leaving');
  // Count players always, but rivals only while they're actually in the level.
  const taxisOnDuty = s.taxis.filter((t) => !t.npc || isActive(t)).length;
  if (inPlay.length >= c.passengersPerTaxi * taxisOnDuty + c.extraPassengers) return;
  // Don't spawn more than the players still need. Passengers an NPC has claimed don't count,
  // so a rival taking fares means more passengers appear.
  const quota = s.level.fareQuota;
  const npcIds = new Set(s.taxis.filter((t) => t.npc).map((t) => t.id));
  const forPlayers = inPlay.filter((p) => p.taxiId === null || !npcIds.has(p.taxiId)).length;
  if (quota > 0 && s.faresDelivered + forPlayers >= quota) return;
  if (--s.passengerSpawnTicks > 0) return;
  const p = spawnRandom(s);
  if (!p) return; // no clear spot this tick; retry next tick
  ev.push({ type: 'passengerSpawned', passengerId: p.id, padIndex: p.padIndex });
  s.passengerSpawnTicks = Math.round(s.config.passengerSpawnDelay * TICK_RATE);
}

/**
 * A locale's own passenger demand, independent of how many taxis are around: a new passenger
 * every `passengerInterval` seconds (±30%, seeded), as long as fewer than `maxWaiting` are
 * waiting (or walking to a taxi).
 */
function spawnByDemand(s: SimState, ev: SimEvent[]): void {
  const waiting = s.passengers.filter((p) => p.state === 'waiting' || p.state === 'walking').length;
  if (waiting >= s.level.maxWaiting) return;
  if (--s.passengerSpawnTicks > 0) return;
  const p = spawnRandom(s);
  if (!p) return; // no clear spot this tick; retry next tick
  ev.push({ type: 'passengerSpawned', passengerId: p.id, padIndex: p.padIndex });
  const interval = s.level.passengerInterval * (0.7 + 0.6 * nextRandom(s));
  s.passengerSpawnTicks = Math.max(1, Math.round(interval * TICK_RATE));
}

function spawnRandom(s: SimState): Passenger | null {
  const pads = s.level.pads.filter((pad) => pad.kind === 'pad');
  if (pads.length < 2) return null;
  const busy = (pad: Pad) =>
    s.passengers.some((p) => p.padIndex === pad.index && (p.state === 'waiting' || p.state === 'walking')) ||
    (pads.length >= 3 && s.taxis.some((t) => t.status === 'landed' && t.padIndex === pad.index));
  const origins = pads.filter((pad) => !busy(pad));
  if (!origins.length) return null;
  const restingPads = s.resting?.length ? origins.filter(pad => s.resting!.some(r => r.padIndex === pad.index)) : [];
  const origin = pick(s, restingPads.length ? restingPads : origins);
  const dest = pick(
    s,
    pads.filter((pad) => pad !== origin),
  );
  for (let attempt = 0; attempt < 4; attempt++) {
    // Wait near one end of the pad (at the "curb"), leaving room for a taxi to land beside.
    const offset = PAD_MARGIN + nextRandom(s) * CURB_ZONE;
    const x = nextRandom(s) < 0.5 ? origin.x + offset : origin.x + origin.w - offset;
    if (clearOfTaxis(s, x, origin.y)) {
      const kind = Math.floor(nextRandom(s) * PASSENGER_KINDS);
      return spawnPassenger(s, { padIndex: origin.index, destPadIndex: dest.index, x, kind });
    }
  }
  return null;
}

function clearOfTaxis(s: SimState, x: number, surface: number): boolean {
  return !s.taxis.some(
    (t) =>
      isActive(t) &&
      Math.abs(t.x - x) < TAXI.halfW + PASSENGER.halfW + SPAWN_CLEARANCE &&
      t.y - TAXI.halfH < surface &&
      t.y + TAXI.halfH + TAXI.gearLength > surface - 100,
  );
}

function pick<T>(s: SimState, xs: T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(nextRandom(s) * xs.length))]!;
}

function taxiById(s: SimState, id: string | null): Taxi | undefined {
  return id === null ? undefined : s.taxis.find((t) => t.id === id);
}

function padDistance(a: Pick<Pad, 'x' | 'w' | 'y'>, b: Pad): number {
  return Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y - b.y);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Return riders to a valid pickup when a cab is stashed or reset. */
export function releaseBoardingPassengers(s: SimState, t: Taxi): void {
  for (const p of s.passengers) {
    if (p.taxiId !== t.id || (p.state !== 'walking' && p.state !== 'riding')) continue;
    if (p.state === 'riding') {
      const pad = s.level.pads[p.padIndex] ?? s.level.pads.find(q => q.kind === 'pad')!;
      p.padIndex = pad.index;
      p.x = pad.x + PAD_MARGIN;
      p.y = pad.y;
    }
    p.state = 'waiting';
    p.taxiId = null;
    p.waitTicks = p.annoyance = 0;
    setJourneyTarget(s, p);
  }
  t.passengerId = -1;
}

function residentRef(p: Passenger): string {
  return `resident:${p.person.id}:${p.person.rides}:${p.person.name}`;
}
