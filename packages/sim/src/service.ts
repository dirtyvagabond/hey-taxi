/**
 * Flying convenience service: a non-combat, indestructible support craft that any parked taxi
 * (away from a store) can summon. It flies in through clear airspace, lands beside the taxi
 * (or hovers nearby if on a narrow ledge), offers every store item at `servicePriceMultiplier`
 * normal store prices, and departs once the taxi takes off or is destroyed.
 */
import { DT, Input, TAXI, TICK_RATE } from './constants';
import { boxHitsSolid, type Level } from './level';
import { arrivalPoint, atStore, feetSupported, isActive, type SimEvent, type SimState, type Taxi } from './sim';

export type ServiceCraftStatus = 'arriving' | 'docked' | 'departing';

export interface ServiceCraft {
  id: number;
  /** The taxi that summoned this craft. */
  taxiId: string;
  status: ServiceCraftStatus;
  /** Center of the craft body (same coordinate convention as Taxi). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Landing gear deployment, 0 = retracted, 1 = fully down. */
  gear: number;
  /** Which way it faces: 1 right, -1 left. */
  facing: 1 | -1;
  /** Active thruster bits for rendering flames. */
  thrust: number;
  /** Target docked position beside the taxi. */
  targetX: number;
  targetY: number;
  /** Hover point directly above target for a vertical final approach. */
  hoverX: number;
  hoverY: number;
  /** Flattened [x0, y0, x1, y1, ...] waypoints between origin and hover. */
  route: number[];
  /** Current waypoint index (pair offset: 0, 2, 4, ...). */
  routeIdx: number;
  /** Entry / exit position. */
  originX: number;
  originY: number;
  /** True when resting on a solid surface; false if hovering beside a narrow ledge. */
  landedOnGround: boolean;
  /** Ticks spent departing (safety cap so departure always finishes). */
  departTicks: number;
}

const CRUISE_SPEED = 260;
const APPROACH_SPEED = 110;
const DEPART_SPEED = 280;
const MAX_DEPART_TICKS = TICK_RATE * 6;
const GEAR_RATE = DT / 0.35;

/** Active (arriving or docked) service craft assigned to `taxiId`, if any. */
export function serviceCraftFor(s: SimState, taxiId: string): ServiceCraft | undefined {
  return (s.serviceCrafts ?? []).find((c) => c.taxiId === taxiId && c.status !== 'departing');
}

/** True while a service craft is docked beside this parked taxi (ready to shop). */
export function atService(s: SimState, t: Taxi): boolean {
  if (t.status !== 'landed') return false;
  return (s.serviceCrafts ?? []).some((c) => c.taxiId === t.id && c.status === 'docked');
}

/** True when a taxi is allowed to summon a flying convenience service right now. */
export function canSummonService(s: SimState, t: Taxi): boolean {
  return t.status === 'landed' && !atStore(s, t) && !serviceCraftFor(s, t.id);
}

/** Summon a flying convenience service to land next to `t`. */
export function summonService(s: SimState, t: Taxi, ev: SimEvent[]): ServiceCraft | null {
  if (!canSummonService(s, t)) return null;
  s.serviceCrafts ??= [];
  s.nextServiceCraftId ??= 1;

  const spot = pickDockSpot(s, t);
  const hover = pickHoverAbove(s.level, spot.x, spot.y);
  const origin = pickOrigin(s, hover.x, hover.y);
  const route = planServiceRoute(s.level, origin.x, origin.y, hover.x, hover.y);

  const craft: ServiceCraft = {
    id: s.nextServiceCraftId++,
    taxiId: t.id,
    status: 'arriving',
    x: origin.x,
    y: origin.y,
    vx: 0,
    vy: 0,
    gear: 0,
    facing: spot.x >= origin.x ? 1 : -1,
    thrust: Input.UP,
    targetX: spot.x,
    targetY: spot.y,
    hoverX: hover.x,
    hoverY: hover.y,
    route,
    routeIdx: 0,
    originX: origin.x,
    originY: origin.y,
    landedOnGround: spot.landedOnGround,
    departTicks: 0,
  };
  s.serviceCrafts.push(craft);
  ev.push({ type: 'serviceSummoned', taxiId: t.id, craftId: craft.id });
  return craft;
}

/** Advance all active service crafts by one tick. */
export function stepServiceCrafts(s: SimState, ev: SimEvent[]): void {
  const crafts = s.serviceCrafts;
  if (!crafts?.length) return;

  const alive: ServiceCraft[] = [];
  for (const c of crafts) {
    const t = s.taxis.find((o) => o.id === c.taxiId);
    if (c.status !== 'departing' && (!t || t.status !== 'landed')) {
      beginDeparture(c);
      ev.push({ type: 'serviceDeparted', taxiId: c.taxiId, craftId: c.id });
    }

    if (c.status === 'arriving') {
      stepArriving(c, t, ev);
      alive.push(c);
    } else if (c.status === 'docked') {
      c.vx = 0;
      c.vy = 0;
      c.gear = c.landedOnGround ? 1 : 0.6;
      c.thrust = c.landedOnGround ? 0 : Input.UP;
      if (t) c.facing = t.x >= c.x ? 1 : -1;
      alive.push(c);
    } else {
      if (stepDeparting(c)) alive.push(c);
    }
  }
  s.serviceCrafts = alive;
}

function beginDeparture(c: ServiceCraft): void {
  c.status = 'departing';
  c.departTicks = 0;
  // Reverse the route from hover back to origin.
  const rev: number[] = [c.hoverX, c.hoverY];
  for (let i = c.route.length - 2; i >= 0; i -= 2) {
    rev.push(c.route[i]!, c.route[i + 1]!);
  }
  rev.push(c.originX, c.originY);
  c.route = rev;
  c.routeIdx = 0;
}

function stepArriving(c: ServiceCraft, t: Taxi | undefined, ev: SimEvent[]): void {
  if (c.routeIdx < c.route.length) {
    const wx = c.route[c.routeIdx]!;
    const wy = c.route[c.routeIdx + 1]!;
    const dist = moveToward(c, wx, wy, CRUISE_SPEED);
    const nearEnd = c.routeIdx >= c.route.length - 2 && dist < 80;
    c.gear = nearEnd ? Math.min(1, c.gear + GEAR_RATE) : Math.max(0, c.gear - GEAR_RATE);
    if (dist <= 6) c.routeIdx += 2;
    return;
  }

  // Final descent from hover point to target docking spot.
  c.gear = Math.min(1, c.gear + GEAR_RATE);
  const dx = c.targetX - c.x;
  const dy = c.targetY - c.y;
  const dist = Math.hypot(dx, dy);
  const speed = Math.min(APPROACH_SPEED, Math.max(36, dist * 2.5));
  moveToward(c, c.targetX, c.targetY, speed);

  if (Math.hypot(c.targetX - c.x, c.targetY - c.y) <= 2.5 && (!c.landedOnGround || c.gear >= 1)) {
    c.x = c.targetX;
    c.y = c.targetY;
    c.vx = 0;
    c.vy = 0;
    c.gear = c.landedOnGround ? 1 : 0.6;
    c.thrust = c.landedOnGround ? 0 : Input.UP;
    if (t) c.facing = t.x >= c.x ? 1 : -1;
    c.status = 'docked';
    ev.push({ type: 'serviceArrived', taxiId: c.taxiId, craftId: c.id, x: c.x, y: c.y });
  }
}

/** Returns true while still in the level, false once gone. */
function stepDeparting(c: ServiceCraft): boolean {
  c.departTicks++;
  if (c.departTicks > MAX_DEPART_TICKS) return false;
  c.gear = Math.max(0, c.gear - GEAR_RATE);
  if (c.routeIdx >= c.route.length) return false;
  const wx = c.route[c.routeIdx]!;
  const wy = c.route[c.routeIdx + 1]!;
  const dist = moveToward(c, wx, wy, DEPART_SPEED);
  if (dist <= 8) c.routeIdx += 2;
  return c.routeIdx < c.route.length;
}

function moveToward(c: ServiceCraft, tx: number, ty: number, speed: number): number {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const dist = Math.hypot(dx, dy);
  const stepDist = speed * DT;
  if (dist <= stepDist || dist < 1e-3) {
    c.vx = dx / DT;
    c.vy = dy / DT;
    c.x = tx;
    c.y = ty;
  } else {
    c.vx = (dx / dist) * speed;
    c.vy = (dy / dist) * speed;
    c.x += c.vx * DT;
    c.y += c.vy * DT;
  }
  if (Math.abs(c.vx) > 8) c.facing = c.vx > 0 ? 1 : -1;
  let thrust = Input.UP; // always hovering/counteracting gravity
  if (c.vx > 20) thrust |= Input.RIGHT;
  else if (c.vx < -20) thrust |= Input.LEFT;
  if (c.vy > 140) thrust |= Input.DOWN;
  c.thrust = thrust;
  return Math.hypot(tx - c.x, ty - c.y);
}

/** Find a clean spot beside the parked taxi on the same surface, or hover nearby if narrow. */
function pickDockSpot(s: SimState, t: Taxi): { x: number; y: number; landedOnGround: boolean } {
  const level = s.level;
  const surface = t.y + TAXI.halfH + TAXI.gearLength * t.gear;
  const dockY = surface - TAXI.gearLength - TAXI.halfH;
  const preferSign = t.x < level.width / 2 ? 1 : -1;
  const mags = [60, 54, 68, 76, 48, 86];
  const offsets: number[] = [];
  for (const m of mags) {
    offsets.push(preferSign * m, -preferSign * m);
  }
  const clearOfTaxis = (x: number, y: number) =>
    s.taxis.every(
      (o) =>
        o === t ||
        !isActive(o) ||
        Math.abs(o.x - x) > TAXI.halfW * 2 + 4 ||
        Math.abs(o.y - y) > TAXI.halfH * 2 + TAXI.gearLength,
    );

  for (const dx of offsets) {
    const x = t.x + dx;
    if (x - TAXI.halfW < 4 || x + TAXI.halfW > level.width - 4) continue;
    if (!feetSupported(level, x, surface, s.config.landMinSupport)) continue;
    if (boxHitsSolid(level, x - TAXI.halfW, dockY - TAXI.halfH, x + TAXI.halfW, surface - 1)) continue;
    if (!clearOfTaxis(x, dockY)) continue;
    return { x, y: dockY, landedOnGround: true };
  }

  // Fallback for narrow ledges: hover right beside or above the taxi.
  const hoverCandidates: [number, number][] = [
    [t.x + preferSign * 56, t.y - 6],
    [t.x - preferSign * 56, t.y - 6],
    [t.x, t.y - 52],
    [t.x + preferSign * 44, t.y - 44],
    [t.x - preferSign * 44, t.y - 44],
  ];
  for (const [hx, hy] of hoverCandidates) {
    if (
      hx - TAXI.halfW >= 4 &&
      hx + TAXI.halfW <= level.width - 4 &&
      hy - TAXI.halfH >= 4 &&
      hy + TAXI.halfH + TAXI.gearLength <= level.height - 4 &&
      !boxHitsSolid(level, hx - TAXI.halfW, hy - TAXI.halfH, hx + TAXI.halfW, hy + TAXI.halfH + TAXI.gearLength)
    ) {
      return { x: hx, y: hy, landedOnGround: false };
    }
  }
  return { x: t.x, y: Math.max(TAXI.halfH + 8, t.y - 48), landedOnGround: false };
}

/** Pick a clear hover point directly above the dock spot (up to 48u up). */
function pickHoverAbove(level: Level, x: number, y: number): { x: number; y: number } {
  let bestY = y;
  for (let dy = 12; dy <= 48; dy += 12) {
    const hy = y - dy;
    if (hy - TAXI.halfH < 4) break;
    if (boxHitsSolid(level, x - TAXI.halfW, hy - TAXI.halfH, x + TAXI.halfW, hy + TAXI.halfH + TAXI.gearLength)) break;
    bestY = hy;
  }
  return { x, y: bestY };
}

/** Pick a clear arrival/departure point ~320-560u away from the target (or arrivalPoint fallback). */
function pickOrigin(s: SimState, tx: number, ty: number): { x: number; y: number } {
  const level = s.level;
  const ts = level.tileSize;
  const clear = (x: number, y: number) =>
    x - TAXI.halfW >= ts &&
    x + TAXI.halfW <= level.width - ts &&
    y - TAXI.halfH >= ts &&
    y + TAXI.halfH + TAXI.gearLength <= level.height - ts &&
    !boxHitsSolid(level, x - TAXI.halfW - 2, y - TAXI.halfH - 2, x + TAXI.halfW + 2, y + TAXI.halfH + TAXI.gearLength + 2);

  // Sample candidate points in rings around the target, preferring upper-left/right sky.
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let r = 1; r < level.rows - 1; r += 2) {
    for (let c = 1; c < level.cols - 1; c += 2) {
      const x = (c + 0.5) * ts;
      const y = (r + 0.5) * ts;
      const d = Math.hypot(x - tx, y - ty);
      if (d < 260 || d > 640) continue;
      if (!clear(x, y)) continue;
      // Prefer points near ~420u away and slightly above the target.
      const score = Math.abs(d - 420) + (y > ty + 60 ? 120 : 0);
      candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  if (candidates.length) return { x: candidates[0]!.x, y: candidates[0]!.y };
  const ap = arrivalPoint(level, s.taxis.filter(isActive));
  return { x: ap.x, y: ap.y };
}

/** Simple tile-grid BFS from (sx, sy) to (gx, gy) returning simplified [x, y, ...] waypoints. */
function planServiceRoute(level: Level, sx: number, sy: number, gx: number, gy: number): number[] {
  const ts = level.tileSize;
  const cols = level.cols;
  const rows = level.rows;
  const sc = Math.max(0, Math.min(cols - 1, Math.floor(sx / ts)));
  const sr = Math.max(0, Math.min(rows - 1, Math.floor(sy / ts)));
  const gc = Math.max(0, Math.min(cols - 1, Math.floor(gx / ts)));
  const gr = Math.max(0, Math.min(rows - 1, Math.floor(gy / ts)));

  const startIdx = sr * cols + sc;
  const goalIdx = gr * cols + gc;
  if (startIdx === goalIdx) return [gx, gy];

  const passable = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const x = (c + 0.5) * ts;
    const y = (r + 0.5) * ts;
    return !boxHitsSolid(level, x - TAXI.halfW + 4, y - TAXI.halfH + 2, x + TAXI.halfW - 4, y + TAXI.halfH + 6);
  };

  const prev = new Int32Array(cols * rows).fill(-1);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  prev[startIdx] = startIdx;
  queue[tail++] = startIdx;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  let found = false;
  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    for (const [dc, dr] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (prev[ni] !== -1) continue;
      if (ni !== goalIdx && !passable(nc, nr)) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }

  if (!found) return [gx, gy];

  // Reconstruct cell centers and drop collinear intermediate points.
  const cells: [number, number][] = [];
  for (let cur = goalIdx; cur !== startIdx; cur = prev[cur]!) {
    const c = cur % cols;
    const r = (cur - c) / cols;
    cells.push([(c + 0.5) * ts, (r + 0.5) * ts]);
  }
  cells.reverse();
  if (cells.length) cells[cells.length - 1] = [gx, gy];

  const out: number[] = [];
  let px = sx;
  let py = sy;
  for (let i = 0; i < cells.length; i++) {
    const [cx, cy] = cells[i]!;
    const next = cells[i + 1];
    if (next) {
      const dx1 = Math.sign(cx - px);
      const dy1 = Math.sign(cy - py);
      const dx2 = Math.sign(next[0] - cx);
      const dy2 = Math.sign(next[1] - cy);
      if (dx1 === dx2 && dy1 === dy2) {
        px = cx;
        py = cy;
        continue;
      }
    }
    out.push(cx, cy);
    px = cx;
    py = cy;
  }
  return out;
}
