import { DT, MAX_SUBSTEP, TAXI, TICK_RATE } from './constants';
import { envForceAt, pointHitsLaser, pointInGravityCore } from './env';
import { setJourneyTarget } from './journeys';
import { boxHitsSolid, isSolid, padIndexAt, platformSolidBoxes, wrapCoord, wrapDelta } from './level';
import type { Passenger, SimEvent, SimState, Taxi } from './sim';

const HEIGHT = 22;
const HALF_WIDTH = 5;
const clear = (s: SimState, x: number, y: number) =>
  !boxHitsSolid(s.level, x - HALF_WIDTH, y - HEIGHT, x + HALF_WIDTH, y);

export function ejectPassenger(s: SimState, t: Taxi, events: SimEvent[]): void {
  const p = s.passengers.find(p => p.state === 'riding' && p.taxiId === t.id);
  if (!p) return;
  const side = TAXI.halfW + HALF_WIDTH + 4;
  const ts = s.level.tileSize;
  let feet = t.y + TAXI.halfH + TAXI.gearLength * t.gear;
  // With gear retracted, a 22u passenger extends 2u above the 20u cab roof; nudge down if skimming a ceiling.
  const belowCeiling = (Math.floor((feet - HEIGHT) / ts) + 1) * ts + HEIGHT;
  if (!clear(s, t.x, feet) && belowCeiling - feet <= 6 && clear(s, t.x, belowCeiling)) {
    feet = belowCeiling;
  }
  const surface = Math.ceil((feet - 0.001) / ts) * ts;
  const preferredSide = Math.abs(t.vx) >= 20 ? -Math.sign(t.vx) : t.facing;
  const exits = [t.x + preferredSide * side, t.x - preferredSide * side].filter(x => clear(s, x, feet));
  const curb = exits.find(x => surface - feet < HEIGHT && isSolid(s.level, Math.floor(x / ts), Math.round(surface / ts)));
  const hop = curb !== undefined && Math.abs(t.vx) < 80 && Math.abs(t.vy) < 100;
  p.x = (hop ? curb : exits[0]) ?? t.x;
  p.y = feet;
  p.dir = p.x < t.x ? -1 : 1;
  p.state = hop ? 'hopping' : 'parachuting';
  p.vx = hop ? 0 : t.vx;
  p.vy = hop ? -24 : t.vy;
  p.padIndex = -1;
  p.refusedDrivers.push(t.driverId ?? t.id);
  p.ejectGraceTicks = Math.round(0.45 * TICK_RATE);
  p.taxiId = null;
  p.fare = p.tip = p.tipPercent = 0;
  t.passengerId = -1;
  events.push({ type: 'passengerRemark', passengerId: p.id, reason: 'ejected' });
}

/** Returns false on fatal contact. Only the simulation decides where a passenger lands. */
export function stepPassengerFlight(s: SimState, p: Passenger, events: SimEvent[]): boolean {
  const { level } = s;
  const ts = level.tileSize;
  const target = level.pads[p.destPadIndex];
  const direction = target ? Math.sign(target.x + target.w / 2 - p.x) : 0;
  const { ax, ay } = envForceAt(level, s.config, s.tick, p.x, p.y - HEIGHT / 2);
  // If gravity pulls a short hop clear of its supporting surface, open the chute.
  if (p.state === 'hopping' && !boxHitsSolid(level, p.x - HALF_WIDTH, p.y, p.x + HALF_WIDTH, p.y + HEIGHT + 2)) {
    p.state = 'parachuting';
  }
  const canopy = p.state === 'parachuting';
  p.vx += (ax + (canopy ? direction * 110 - 1.8 * p.vx : 0)) * DT;
  p.vy += (ay - (canopy ? 2.4 * p.vy : 0)) * DT;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) * DT / MAX_SUBSTEP));
  for (let i = 0; i < steps; i++) {
    const nx = level.wrap ? wrapCoord(p.x + (p.vx * DT) / steps, level.width) : p.x + (p.vx * DT) / steps;
    if (clear(s, nx, p.y)) p.x = nx;
    else p.vx = 0;
    const ny = level.wrap ? wrapCoord(p.y + (p.vy * DT) / steps, level.height) : p.y + (p.vy * DT) / steps;
    const cy = ny - HEIGHT / 2;
    if (pointInGravityCore(level, p.x, cy) || pointHitsLaser(level, s.tick, p.x, cy) ||
        s.meteors.some(m => m.warnTicks <= 0 && Math.hypot(m.x - p.x, m.y - cy) < m.radius + HALF_WIDTH)) return false;
    if (clear(s, p.x, ny)) { p.y = ny; continue; }
    if (p.vy <= 0) { p.vy = 0; continue; }
    // Only treat downward contact at the feet as a landing; moving down out of a ceiling overlap is not a floor hit.
    if (!boxHitsSolid(level, p.x - HALF_WIDTH, Math.min(p.y, ny), p.x + HALF_WIDTH, ny)) {
      p.y = ny;
      continue;
    }
    if (p.vy > 180) return false;
    // Check if the passenger landed on a moving platform surface first.
    let landedMoving = false;
    for (let mi = 0; mi < level.movingPlatforms.length && !landedMoving; mi++) {
      const mp = level.movingPlatforms[mi]!;
      const pose = level.platformPoses[mi]!;
      const boxes = platformSolidBoxes(mp, pose);
      for (let bi = 0; bi < boxes.length; bi++) {
        const [sx0, sy0, sx1, sy1] = boxes[bi]!;
        const scx = (sx0 + sx1) * 0.5;
        const scy = (sy0 + sy1) * 0.5;
        const rx = level.wrap ? scx + wrapDelta(scx, p.x, level.width) : p.x;
        const ry = level.wrap ? scy + wrapDelta(scy, ny, level.height) : ny;
        if (rx + HALF_WIDTH > sx0 && rx - HALF_WIDTH < sx1 && ry >= sy0 && ry <= sy1) {
          p.y = level.wrap ? wrapCoord(sy0, level.height) : sy0;
          const isPadSurface = mp.padIndex >= 0 && (!mp.cave || bi === 2);
          p.padIndex = isPadSurface ? mp.padIndex : -1;
          landedMoving = true;
          break;
        }
      }
    }
    if (!landedMoving) {
      const row = Math.floor(ny / ts);
      p.y = row * ts;
      // If only an edge of the passenger's feet caught a ledge, nudge center onto the supporting tile so walkable() holds.
      if (!isSolid(level, Math.floor(p.x / ts), row)) {
        const leftNudge = Math.floor(p.x / ts) * ts - HALF_WIDTH;
        const rightNudge = (Math.floor(p.x / ts) + 1) * ts + HALF_WIDTH;
        if (isSolid(level, Math.floor((p.x - HALF_WIDTH) / ts), row) && clear(s, leftNudge, p.y)) p.x = leftNudge;
        else if (isSolid(level, Math.floor((p.x + HALF_WIDTH) / ts), row) && clear(s, rightNudge, p.y)) p.x = rightNudge;
      }
      p.padIndex = padIndexAt(level, Math.floor(p.x / ts), row);
    }
    p.vx = p.vy = 0;
    const reached = p.destination.localeId === (s.localeId ?? level.name) && p.padIndex === p.destination.padIndex;
    p.state = reached ? 'leaving' : 'waiting';
    p.leaveTicks = reached ? Math.round(1.2 * TICK_RATE) : canopy ? 0 : Math.round(0.35 * TICK_RATE);
    p.waitTicks = p.annoyance = 0;
    setJourneyTarget(s, p);
    events.push({ type: 'passengerRemark', passengerId: p.id, reason: reached ? 'landed' : 'stranded' });
    break;
  }
  return true;
}
