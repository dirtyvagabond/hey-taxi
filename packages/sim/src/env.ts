/**
 * Locale environmental forces and dynamic hazards:
 *  - Periodic directional wind gusts with terrain shelter (Frostbite Pass)
 *  - Radial gravity wells with damaging event-horizon cores (Singularity Station)
 *  - Zoned / inverted / low-G gravity bays (Polarity Yard)
 *  - Timed laser gates and Electroid sliding-gap barriers (Gridlock Vault)
 *  - Diagonal falling meteors with telegraph streaks (Overdrive Canyon)
 *
 * All deterministic from `state.tick` and `state.rng` so saves, replays, AI, and client
 * rendering agree identically.
 */
import type { SimConfig } from './config';
import { DT, TAXI, TICK_RATE } from './constants';
import { isSolid, type GravityZone, type LaserGate, type Level } from './level';
import { nextRandom } from './rng';
import type { SimEvent, SimState, Taxi } from './sim';

export interface Meteor {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Ticks of warning streak remaining before the meteor launches. */
  warnTicks: number;
}

export interface WindSample {
  /** Horizontal acceleration applied at (x, y) in u/s². */
  ax: number;
  /** Signed direction/intensity of the global wind (-1..1, 0 = calm). */
  globalDir: number;
  /** True during the telegraph window just before a gust hits. */
  warning: boolean;
  /** True while a gust is actively blowing. */
  gusting: boolean;
  /** True if terrain upwind shelters (x, y). */
  sheltered: boolean;
}

const SHELTER_RANGE = 180; // 4.5 tiles upwind

/** Global wind cycle state at `tick` (independent of position). */
export function globalWind(level: Level, tick: number): { ax: number; dir: number; warning: boolean; gusting: boolean } {
  const w = level.wind;
  if (!w || w.period <= 0) return { ax: 0, dir: 0, warning: false, gusting: false };
  const t = tick * DT;
  const cycle = Math.floor(t / w.period);
  const phase = t - cycle * w.period;
  const sign = w.alternate && cycle % 2 === 1 ? -1 : 1;
  const gustStart = Math.max(0, w.period - w.gustDuration);
  const warnStart = Math.max(0, gustStart - w.warnDuration);
  const gusting = phase >= gustStart;
  const warning = !gusting && phase >= warnStart;
  let ax = w.baseAx * sign;
  if (gusting) {
    // Smooth 0.35s ramp up/down at edges of the gust so it feels natural rather than a hard step.
    const into = phase - gustStart;
    const out = w.period - phase;
    const ramp = Math.min(1, into / 0.35, out / 0.35);
    ax += w.gustAx * sign * ramp;
  }
  const maxAx = Math.abs(w.baseAx) + Math.abs(w.gustAx);
  const dir = maxAx > 0 ? ax / maxAx : 0;
  return { ax, dir, warning, gusting };
}

/** True if a solid wall upwind within SHELTER_RANGE blocks the wind at (x, y). */
export function isSheltered(level: Level, x: number, y: number, windSign: number): boolean {
  if (windSign === 0) return false;
  const ts = level.tileSize;
  const step = 20;
  // Wind blows toward +windSign, so upwind is -windSign.
  for (let d = step; d <= SHELTER_RANGE; d += step) {
    const px = x - windSign * d;
    if (isSolid(level, Math.floor(px / ts), Math.floor(y / ts))) return true;
  }
  return false;
}

/** Wind acceleration and status at world point (x, y). */
export function windAt(level: Level, tick: number, x: number, y: number): WindSample {
  const g = globalWind(level, tick);
  if (g.ax === 0 && !g.warning) {
    return { ax: 0, globalDir: 0, warning: false, gusting: false, sheltered: false };
  }
  const sign = Math.sign(g.ax);
  const sheltered = sign !== 0 && isSheltered(level, x, y, sign);
  return {
    ax: sheltered ? g.ax * 0.15 : g.ax,
    globalDir: g.dir,
    warning: g.warning,
    gusting: g.gusting,
    sheltered,
  };
}

/** Gravity zone containing (x, y), if any. */
export function gravityZoneAt(level: Level, x: number, y: number): GravityZone | null {
  for (const z of level.gravityZones) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z;
  }
  return null;
}

/**
 * Total environmental acceleration (u/s²) at (x, y):
 * base gravity (or gravity zone override) + radial gravity wells + wind.
 */
export function envForceAt(
  level: Level,
  config: SimConfig,
  tick: number,
  x: number,
  y: number,
): { ax: number; ay: number } {
  const zone = gravityZoneAt(level, x, y);
  let ax = zone ? zone.gx : 0;
  let ay = config.gravity * (zone ? zone.gyScale : level.gravityScale);

  if (level.wind) {
    ax += windAt(level, tick, x, y).ax;
  }

  for (const w of level.gravityWells) {
    const dx = w.x - x;
    const dy = w.y - y;
    const d = Math.hypot(dx, dy);
    if (d > 1 && d < w.radius) {
      // Smooth inverse-falloff pull capped at w.strength near coreRadius so full thrust can escape.
      const t = Math.max(0, 1 - (d - w.coreRadius) / Math.max(1, w.radius - w.coreRadius));
      const mag = w.strength * (0.25 + 0.75 * t * t);
      ax += (dx / d) * mag;
      ay += (dy / d) * mag;
    }
  }

  return { ax, ay };
}

export type LaserPhase = 'open' | 'warn' | 'active';

export interface LaserEval {
  state: LaserPhase;
  /** Active (or warning) beam segments as [x0, y0, x1, y1]. */
  segments: [number, number, number, number][];
}

/** Evaluate a laser gate or Electroid sliding-gap barrier at `tick`. */
export function laserState(gate: LaserGate, tick: number): LaserEval {
  const t = tick * DT + gate.phase;
  if (gate.gapWidth > 0) {
    // Electroid barrier: always active except for a smoothly oscillating safe gap.
    const len = gate.horizontal ? gate.x1 - gate.x0 : gate.y1 - gate.y0;
    const travel = Math.max(0, len - gate.gapWidth);
    const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / Math.max(0.5, gate.period));
    const gapStart = travel * u;
    const gapEnd = gapStart + gate.gapWidth;
    const segments: [number, number, number, number][] = [];
    if (gate.horizontal) {
      if (gapStart > 4) segments.push([gate.x0, gate.y0, gate.x0 + gapStart, gate.y0]);
      if (len - gapEnd > 4) segments.push([gate.x0 + gapEnd, gate.y0, gate.x1, gate.y0]);
    } else {
      if (gapStart > 4) segments.push([gate.x0, gate.y0, gate.x0, gate.y0 + gapStart]);
      if (len - gapEnd > 4) segments.push([gate.x0, gate.y0 + gapEnd, gate.x0, gate.y1]);
    }
    return { state: 'active', segments };
  }

  const p = Math.max(0.5, gate.period);
  const phase = ((t % p) + p) % p;
  if (phase < gate.onDuration) {
    return { state: 'active', segments: [[gate.x0, gate.y0, gate.x1, gate.y1]] };
  }
  if (phase >= p - gate.warnDuration) {
    return { state: 'warn', segments: [[gate.x0, gate.y0, gate.x1, gate.y1]] };
  }
  return { state: 'open', segments: [] };
}

/** Does a point (x, y) with radius `r` touch any active laser beam? */
export function pointHitsLaser(level: Level, tick: number, x: number, y: number, r = 5): boolean {
  for (const g of level.laserGates) {
    const ev = laserState(g, tick);
    if (ev.state !== 'active') continue;
    for (const [x0, y0, x1, y1] of ev.segments) {
      if (distToSegment(x, y, x0, y0, x1, y1) <= r) return true;
    }
  }
  return false;
}

/** Does a taxi's body+gear box overlap any active laser segment? Returns push vector if hit. */
export function taxiHitsLaser(
  level: Level,
  tick: number,
  t: Taxi,
): { pushX: number; pushY: number } | null {
  const halfW = TAXI.halfW - 2;
  const top = t.y - TAXI.halfH + 2;
  const bot = t.y + TAXI.halfH + TAXI.gearLength * t.gear - 2;
  const left = t.x - halfW;
  const right = t.x + halfW;
  for (const g of level.laserGates) {
    const ev = laserState(g, tick);
    if (ev.state !== 'active') continue;
    for (const [x0, y0, x1, y1] of ev.segments) {
      const minX = Math.min(x0, x1) - 4;
      const maxX = Math.max(x0, x1) + 4;
      const minY = Math.min(y0, y1) - 4;
      const maxY = Math.max(y0, y1) + 4;
      if (right > minX && left < maxX && bot > minY && top < maxY) {
        if (g.horizontal) {
          return { pushX: 0, pushY: t.y < y0 ? -1 : 1 };
        }
        return { pushX: t.x < x0 ? -1 : 1, pushY: 0 };
      }
    }
  }
  return null;
}

/** Does a point hit any gravity well's event-horizon core? */
export function pointInGravityCore(level: Level, x: number, y: number, margin = 0): boolean {
  for (const w of level.gravityWells) {
    if (Math.hypot(x - w.x, y - w.y) <= w.coreRadius + margin) return true;
  }
  return false;
}

/** Step meteors and check dynamic hazard collisions for taxis. */
export function stepEnvironment(
  s: SimState,
  ev: SimEvent[],
  onHazardHit: (t: Taxi, pushX: number, pushY: number, speed: number) => void,
): void {
  const { level } = s;

  // 1. Gravity well cores: bounce + damage flying taxis that enter the event horizon.
  if (level.gravityWells.length) {
    for (const t of s.taxis) {
      if (t.status !== 'flying') continue;
      for (const w of level.gravityWells) {
        const dx = t.x - w.x;
        const dy = t.y - w.y;
        const d = Math.hypot(dx, dy);
        const minDist = w.coreRadius + TAXI.halfH + 4;
        if (d < minDist) {
          const nx = d > 0.1 ? dx / d : 0;
          const ny = d > 0.1 ? dy / d : -1;
          t.x = w.x + nx * (minDist + 2);
          t.y = w.y + ny * (minDist + 2);
          onHazardHit(t, nx * 210, ny * 210, 150);
        }
      }
    }
  }

  // 2. Active laser beams: bounce + damage flying taxis.
  if (level.laserGates.length) {
    for (const t of s.taxis) {
      if (t.status !== 'flying') continue;
      const hit = taxiHitsLaser(level, s.tick, t);
      if (hit) {
        onHazardHit(t, hit.pushX * 170, hit.pushY * 170, 140);
      }
    }
  }

  // 3. Meteors (Overdrive Canyon).
  const mc = level.meteors;
  if (mc) {
    if (s.meteorSpawnTicks <= 0 && s.meteors.length < mc.maxActive) {
      spawnMeteor(s);
      s.meteorSpawnTicks = Math.max(15, Math.round(mc.interval * TICK_RATE * (0.7 + nextRandom(s) * 0.6)));
    } else if (s.meteorSpawnTicks > 0) {
      s.meteorSpawnTicks--;
    }

    const ts = level.tileSize;
    const alive: Meteor[] = [];
    for (const m of s.meteors) {
      if (m.warnTicks > 0) {
        m.warnTicks--;
        alive.push(m);
        continue;
      }
      m.x += m.vx * DT;
      m.y += m.vy * DT;
      if (
        m.x < -40 ||
        m.x > level.width + 40 ||
        m.y > level.height + 40 ||
        isSolid(level, Math.floor(m.x / ts), Math.floor(m.y / ts))
      ) {
        ev.push({ type: 'missileExploded', missileId: -m.id, x: m.x, y: m.y, hitTaxiId: null });
        continue;
      }
      let hitSomething = false;
      for (const t of s.taxis) {
        if (t.status !== 'flying') continue;
        if (
          m.x + m.radius > t.x - TAXI.halfW &&
          m.x - m.radius < t.x + TAXI.halfW &&
          m.y + m.radius > t.y - TAXI.halfH &&
          m.y - m.radius < t.y + TAXI.halfH + TAXI.gearLength * t.gear
        ) {
          const sp = Math.hypot(m.vx, m.vy) || 1;
          onHazardHit(t, (m.vx / sp) * 180, (m.vy / sp) * 180, 150);
          ev.push({ type: 'missileExploded', missileId: -m.id, x: m.x, y: m.y, hitTaxiId: null });
          hitSomething = true;
          break;
        }
      }
      if (!hitSomething) alive.push(m);
    }
    s.meteors = alive;
  }
}

function spawnMeteor(s: SimState): void {
  const mc = s.level.meteors!;
  const ts = s.level.tileSize;
  const rad = (mc.angleDeg * Math.PI) / 180;
  const vx = Math.cos(rad) * mc.speed;
  const vy = Math.sin(rad) * mc.speed;
  // Pick a clear column along row 1 (just under the ceiling).
  for (let tries = 0; tries < 12; tries++) {
    const col = 2 + Math.floor(nextRandom(s) * Math.max(1, s.level.cols - 4));
    if (!isSolid(s.level, col, 1) && !isSolid(s.level, col, 2)) {
      s.meteors.push({
        id: s.nextMissileId++,
        x: (col + 0.5) * ts,
        y: 1.5 * ts,
        vx,
        vy,
        radius: mc.radius,
        warnTicks: Math.round(0.85 * TICK_RATE),
      });
      return;
    }
  }
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}
