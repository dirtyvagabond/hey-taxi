import { DT, EPS } from './constants';

/**
 * Level file format (JSON). `tiles` is an ASCII grid, one string per row:
 *   `#`        solid wall
 *   `.` or ` ` empty space
 *   `S`        spawn: the taxi starts landed on the first solid tile below this cell
 *   `1`–`9`    numbered pad (solid). A horizontal run of the same digit is one pad.
 *   `F`        fuel pad (solid). A horizontal run of `F` is one fuel pad.
 *   `E`        exit gate: solid while closed; opens once the fare quota is met.
 *              Flying into an open gate completes the level.
 * Anything outside the grid counts as solid.
 */
export type LevelTheme = 'city' | 'winter' | 'singularity' | 'polarity' | 'vault' | 'canyon' | 'beach' | 'asteroid';

export interface WindConfig {
  /** Steady horizontal acceleration (u/s²). */
  baseAx: number;
  /** Additional horizontal acceleration during a gust (u/s²). */
  gustAx: number;
  /** Full cycle duration in seconds. */
  period: number;
  /** How long each gust lasts (s). */
  gustDuration: number;
  /** Telegraph duration before a gust begins (s). */
  warnDuration: number;
  /** Alternate gust direction left/right each cycle. */
  alternate?: boolean;
}

export interface GravityWellData {
  col: number;
  row: number;
  /** Peak acceleration (u/s²) near the core. */
  strength: number;
  /** Outer radius of pull (in tiles). */
  radius: number;
  /** Damaging event-horizon radius (in tiles). */
  coreRadius: number;
}

export interface GravityWell {
  x: number;
  y: number;
  strength: number;
  radius: number;
  coreRadius: number;
}

export interface GravityZoneData {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  /** Gravity scale inside this zone (negative = inverted upward pull). */
  gyScale: number;
  /** Optional constant horizontal pull (u/s²). */
  gx?: number;
  label?: string;
}

export interface GravityZone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  gyScale: number;
  gx: number;
  label: string;
}

export interface LaserGateData {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  /** Cycle period in seconds (for pulsing gates, or full oscillation for sliding gaps). */
  period: number;
  /** Active duration per period (s). Ignored when gapTiles is set. */
  onDuration: number;
  /** Warning flicker duration before turning active (s). */
  warnDuration: number;
  /** Phase offset in seconds. */
  phase?: number;
  /** If set, an Electroid-style barrier with a sliding safe gap of this width (tiles). */
  gapTiles?: number;
}

export interface LaserGate {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  horizontal: boolean;
  period: number;
  onDuration: number;
  warnDuration: number;
  phase: number;
  gapWidth: number;
}

export interface MeteorConfig {
  /** Seconds between meteor spawns. */
  interval: number;
  /** Travel speed (u/s). */
  speed: number;
  /** Angle downward from horizontal right (degrees, e.g. 65 or 115). */
  angleDeg: number;
  /** Collision radius (u). */
  radius: number;
  /** Max simultaneous meteors. */
  maxActive: number;
}

export type AsteroidShape = 'chunky' | 'slab' | 'spire' | 'wedge' | 'crescent' | 'twin' | 'monolith' | 'jagged';

export interface CaveSpecData {
  /** Roof thickness (tiles). */
  roofH: number;
  /** Back (east) wall thickness (tiles). */
  backW: number;
  /** Floor thickness (tiles). */
  floorH: number;
  /** Horizontal offset of the interior pad from the asteroid's left edge (tiles). */
  padOffsetX: number;
  /** Width of the interior pad (tiles). */
  padW: number;
}

export interface CaveSpec {
  roofH: number;
  backW: number;
  floorH: number;
  padOffsetX: number;
  padW: number;
}

export interface MovingPlatformData {
  /** Center / initial top-left of the platform, in tiles. */
  cx: number;
  cy: number;
  /** Size in tiles. */
  w: number;
  h: number;
  /** Sinusoidal oscillation amplitude in tiles (unused when vx/vy free-drift is set). */
  ampX: number;
  ampY: number;
  /** Full oscillation period in seconds (unused when vx/vy free-drift is set). */
  period: number;
  /** Phase offset in seconds. */
  phase?: number;
  /** Phase shift (radians) between X and Y; Math.PI/2 = oval orbit, 0 = diagonal. */
  yPhaseRad?: number;
  /** Initial velocity (u/s) for Asteroids-style free-drifting & bouncing platforms. */
  vx?: number;
  vy?: number;
  /** Visual rock silhouette variant for asteroid themes. */
  shape?: AsteroidShape;
  /** Optional hollowed-out cavern geometry (no static tile blocks needed). */
  cave?: CaveSpecData;
  /** Optional pad bolted onto this platform (top surface, or cavern floor if `cave` is set). */
  pad?: { label: string; kind?: PadKind };
}

export interface MovingPlatform {
  index: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  ampX: number;
  ampY: number;
  period: number;
  phase: number;
  yPhaseRad: number;
  /** True when this platform drifts freely with wrap-around & elastic asteroid bounces. */
  freeDrift: boolean;
  vx0: number;
  vy0: number;
  mass: number;
  shape: AsteroidShape;
  cave: CaveSpec | null;
  /** Index into `level.pads`, or -1 for an unpadded obstacle. */
  padIndex: number;
}

export interface PlatformPose {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface LevelData {
  name: string;
  theme?: LevelTheme;
  tileSize?: number;
  gravityScale?: number;
  thrustScale?: number;
  burnScale?: number;
  maxSpeedScale?: number;
  wind?: WindConfig;
  gravityWells?: GravityWellData[];
  gravityZones?: GravityZoneData[];
  laserGates?: LaserGateData[];
  meteors?: MeteorConfig;
  movingPlatforms?: MovingPlatformData[];
  /** When true, both X and Y wrap toroidally (no outer walls). */
  wrap?: boolean;
  /** Fares to deliver to complete the level. 0 or missing = endless (sandbox). */
  fares?: number;
  /** Rival NPC taxis allowed in the level at once (default 1). */
  rivals?: number;
  /** When true, no rival NPCs may spawn in or enter this locale. */
  noRivals?: boolean;
  /** When true, passengers stay local until a player has delivered at least one fare here. */
  firstFareLocalOnly?: boolean;
  /** One-line tip shown on the level intro card. */
  hint?: string;
  /** Multiplies the distance-based base fare here (tips are not multiplied). Default 1. */
  fareMultiplier?: number;
  /**
   * Passenger demand here, independent of how many taxis there are: a new passenger about
   * every `passengerInterval` seconds while fewer than `maxWaiting` are waiting. Without it,
   * the older "one per taxi" supply is used (test maps).
   */
  passengerInterval?: number;
  maxWaiting?: number;
  tiles: string[];
}

export interface ExitGate {
  /** Tile indices (row-major) that make up the gate. */
  tiles: number[];
  /** Bounding box in world units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** pad: passengers come and go; fuel: a store; teleport: travel to another locale. */
export type PadKind = 'pad' | 'fuel' | 'teleport';

export interface Pad {
  index: number;
  /** "1"–"9" for numbered pads, "F" for stores, "T" for teleports. */
  label: string;
  kind: PadKind;
  /** Landing surface in world units: left edge, top (the surface), width. Updated live for moving pads. */
  x: number;
  y: number;
  w: number;
  /** Static position (or orbital center for moving pads), used for deterministic fare distances. */
  baseX: number;
  baseY: number;
  /** Index into `level.movingPlatforms`, or -1 if static. */
  platformIndex: number;
}

export interface Level {
  name: string;
  theme: LevelTheme;
  tileSize: number;
  cols: number;
  rows: number;
  /** World size in units. */
  width: number;
  height: number;
  gravityScale: number;
  thrustScale: number;
  burnScale: number;
  maxSpeedScale: number;
  wind: WindConfig | null;
  gravityWells: GravityWell[];
  gravityZones: GravityZone[];
  laserGates: LaserGate[];
  meteors: MeteorConfig | null;
  movingPlatforms: MovingPlatform[];
  /** Live poses of `movingPlatforms`, kept in sync with `sim.tick`. */
  platformPoses: PlatformPose[];
  /** When true, X and Y wrap seamlessly around [0, width) × [0, height). */
  wrap: boolean;
  /** True if `solid` contains at least one static solid tile. */
  hasStaticSolid: boolean;
  /** Multiplies the distance-based base fare (tips are not multiplied). */
  fareMultiplier: number;
  /** Seconds between passenger arrivals (0 = the older per-taxi supply), and the waiting cap. */
  passengerInterval: number;
  maxWaiting: number;
  fareQuota: number;
  /** Rival NPC taxis allowed at once. */
  rivals: number;
  /** When true, rival NPCs are banned from spawning in or entering this locale. */
  noRivals: boolean;
  /** When true, cross-locale passengers wait until at least one player fare is delivered here. */
  firstFareLocalOnly: boolean;
  hint: string;
  /**
   * 1 = solid, row-major. Note: the sim clears the exit gate's tiles when it opens,
   * so parse a fresh Level for each play-through.
   */
  solid: Uint8Array;
  exit: ExitGate | null;
  /** Pad index per tile, or -1. Row-major. */
  padIndex: Int16Array;
  pads: Pad[];
  spawnCol: number;
  spawnRow: number;
}

const DEFAULT_TILE_SIZE = 40;

export function parseLevel(data: LevelData): Level {
  const name = data.name;
  const tileSize = data.tileSize ?? DEFAULT_TILE_SIZE;
  const rows = data.tiles.length;
  if (rows === 0) throw new Error(`Level "${name}": no tiles`);
  const cols = data.tiles[0]!.length;
  if (cols === 0) throw new Error(`Level "${name}": empty first row`);

  const solid = new Uint8Array(cols * rows);
  const padIndex = new Int16Array(cols * rows).fill(-1);
  const pads: Pad[] = [];
  const usedLabels = new Set<string>();
  let spawn: { col: number; row: number } | null = null;
  const exitTiles: number[] = [];

  for (let r = 0; r < rows; r++) {
    const line = data.tiles[r]!;
    if (line.length !== cols) {
      throw new Error(`Level "${name}": row ${r} has ${line.length} columns, expected ${cols}`);
    }
    let runPad: Pad | null = null;
    let runChar = '';
    for (let c = 0; c < cols; c++) {
      const ch = line[c]!;
      const i = r * cols + c;
      if (ch !== runChar) runPad = null;
      runChar = ch;

      if (ch === '#') {
        solid[i] = 1;
      } else if (ch === '.' || ch === ' ') {
        // empty
      } else if (ch === 'E') {
        solid[i] = 1;
        exitTiles.push(i);
      } else if (ch === 'S') {
        if (spawn) throw new Error(`Level "${name}": more than one spawn (S)`);
        spawn = { col: c, row: r };
      } else if (ch === 'F' || ch === 'T' || (ch >= '1' && ch <= '9')) {
        solid[i] = 1;
        if (!runPad) {
          const kind: PadKind = ch === 'F' ? 'fuel' : ch === 'T' ? 'teleport' : 'pad';
          if (kind === 'pad') {
            if (usedLabels.has(ch)) throw new Error(`Level "${name}": pad ${ch} appears more than once`);
            usedLabels.add(ch);
          }
          runPad = {
            index: pads.length,
            label: ch,
            kind,
            x: c * tileSize,
            y: r * tileSize,
            w: 0,
            baseX: c * tileSize,
            baseY: r * tileSize,
            platformIndex: -1,
          };
          pads.push(runPad);
        }
        runPad.w += tileSize;
        padIndex[i] = runPad.index;
      } else {
        throw new Error(`Level "${name}": unknown tile '${ch}' at row ${r}, col ${c}`);
      }
    }
  }
  if (!spawn) throw new Error(`Level "${name}": no spawn (S)`);

  let exit: ExitGate | null = null;
  if (exitTiles.length) {
    const cs = exitTiles.map((i) => i % cols);
    const rs = exitTiles.map((i) => Math.floor(i / cols));
    const c0 = Math.min(...cs);
    const r0 = Math.min(...rs);
    exit = {
      tiles: exitTiles,
      x: c0 * tileSize,
      y: r0 * tileSize,
      w: (Math.max(...cs) - c0 + 1) * tileSize,
      h: (Math.max(...rs) - r0 + 1) * tileSize,
    };
  }

  const gravityWells: GravityWell[] = (data.gravityWells ?? []).map((w) => ({
    x: (w.col + 0.5) * tileSize,
    y: (w.row + 0.5) * tileSize,
    strength: w.strength,
    radius: w.radius * tileSize,
    coreRadius: w.coreRadius * tileSize,
  }));

  const gravityZones: GravityZone[] = (data.gravityZones ?? []).map((z) => ({
    x0: z.c0 * tileSize,
    y0: z.r0 * tileSize,
    x1: (z.c1 + 1) * tileSize,
    y1: (z.r1 + 1) * tileSize,
    gyScale: z.gyScale,
    gx: z.gx ?? 0,
    label: z.label ?? '',
  }));

  const laserGates: LaserGate[] = (data.laserGates ?? []).map((g) => {
    const horizontal = g.r0 === g.r1;
    return {
      x0: horizontal ? g.c0 * tileSize : (g.c0 + 0.5) * tileSize,
      y0: horizontal ? (g.r0 + 0.5) * tileSize : g.r0 * tileSize,
      x1: horizontal ? (g.c1 + 1) * tileSize : (g.c1 + 0.5) * tileSize,
      y1: horizontal ? (g.r1 + 0.5) * tileSize : (g.r1 + 1) * tileSize,
      horizontal,
      period: g.period,
      onDuration: g.onDuration,
      warnDuration: g.warnDuration,
      phase: g.phase ?? 0,
      gapWidth: (g.gapTiles ?? 0) * tileSize,
    };
  });

  const movingPlatforms: MovingPlatform[] = (data.movingPlatforms ?? []).map((mp, idx) => {
    const cave: CaveSpec | null = mp.cave
      ? {
          roofH: mp.cave.roofH * tileSize,
          backW: mp.cave.backW * tileSize,
          floorH: mp.cave.floorH * tileSize,
          padOffsetX: mp.cave.padOffsetX * tileSize,
          padW: mp.cave.padW * tileSize,
        }
      : null;
    const w = mp.w * tileSize;
    const h = mp.h * tileSize;
    let mpPadIndex = -1;
    if (mp.pad) {
      const ch = mp.pad.label;
      const kind: PadKind = mp.pad.kind ?? (ch === 'F' ? 'fuel' : ch === 'T' ? 'teleport' : 'pad');
      if (kind === 'pad') {
        if (usedLabels.has(ch)) throw new Error(`Level "${name}": pad ${ch} appears more than once`);
        usedLabels.add(ch);
      }
      mpPadIndex = pads.length;
      const px = mp.cx * tileSize + (cave ? cave.padOffsetX : 0);
      const py = mp.cy * tileSize + (cave ? h - cave.floorH : 0);
      const pw = cave ? cave.padW : w;
      pads.push({
        index: mpPadIndex,
        label: ch,
        kind,
        x: px,
        y: py,
        w: pw,
        baseX: px,
        baseY: py,
        platformIndex: idx,
      });
    }
    const freeDrift = mp.vx !== undefined || mp.vy !== undefined;
    return {
      index: idx,
      cx: mp.cx * tileSize,
      cy: mp.cy * tileSize,
      w,
      h,
      ampX: mp.ampX * tileSize,
      ampY: mp.ampY * tileSize,
      period: mp.period,
      phase: mp.phase ?? 0,
      yPhaseRad: mp.yPhaseRad ?? 0,
      freeDrift,
      vx0: mp.vx ?? 0,
      vy0: mp.vy ?? 0,
      mass: Math.max(4, mp.w * mp.h),
      shape: mp.shape ?? 'chunky',
      cave,
      padIndex: mpPadIndex,
    };
  });

  const level: Level = {
    name,
    theme: data.theme ?? 'city',
    tileSize,
    cols,
    rows,
    width: cols * tileSize,
    height: rows * tileSize,
    gravityScale: data.gravityScale ?? 1,
    thrustScale: data.thrustScale ?? 1,
    burnScale: data.burnScale ?? 1,
    maxSpeedScale: data.maxSpeedScale ?? 1,
    wind: data.wind ?? null,
    gravityWells,
    gravityZones,
    laserGates,
    meteors: data.meteors ?? null,
    movingPlatforms,
    platformPoses: movingPlatforms.map((p) => platformPose(p, 0)),
    wrap: Boolean(data.wrap),
    hasStaticSolid: solid.some((v) => v === 1),
    fareMultiplier: data.fareMultiplier ?? 1,
    passengerInterval: data.passengerInterval ?? 0,
    maxWaiting: data.maxWaiting ?? 0,
    fareQuota: data.fares ?? 0,
    rivals: data.noRivals ? 0 : Math.max(0, Math.min(3, data.rivals ?? 1)),
    noRivals: Boolean(data.noRivals),
    firstFareLocalOnly: Boolean(data.firstFareLocalOnly),
    hint: data.hint ?? '',
    solid,
    exit,
    padIndex,
    pads,
    spawnCol: spawn.col,
    spawnRow: spawn.row,
  };
  syncMovingPlatforms(level, 0);
  return level;
}

/** Deterministic pose (top-left position & velocity in world units) of a moving platform at `tick`. */
export function platformPose(p: MovingPlatform, tick: number): PlatformPose {
  if (p.freeDrift) {
    return { x: p.cx, y: p.cy, vx: p.vx0, vy: p.vy0 };
  }
  const omega = (2 * Math.PI) / Math.max(0.5, p.period);
  const a = omega * (tick * DT + p.phase);
  const ay = a + p.yPhaseRad;
  return {
    x: p.cx + p.ampX * Math.sin(a),
    y: p.cy + p.ampY * Math.sin(ay),
    vx: p.ampX * omega * Math.cos(a),
    vy: p.ampY * omega * Math.cos(ay),
  };
}

/** World-space solid sub-boxes `[x0, y0, x1, y1]` for a moving platform (3 boxes for a cave asteroid, 1 otherwise). */
export function platformSolidBoxes(p: MovingPlatform, pose: PlatformPose): [number, number, number, number][] {
  if (!p.cave) {
    return [[pose.x, pose.y, pose.x + p.w, pose.y + p.h]];
  }
  const { roofH, backW, floorH } = p.cave;
  return [
    [pose.x, pose.y, pose.x + p.w, pose.y + roofH], // cave roof
    [pose.x + p.w - backW, pose.y + roofH, pose.x + p.w, pose.y + p.h - floorH], // back (east) wall
    [pose.x, pose.y + p.h - floorH, pose.x + p.w, pose.y + p.h], // cave floor (carries Pad)
  ];
}

/** Update `level.platformPoses` and any moving pads' `(x, y)` to match `tick` or explicit `poses`. */
export function syncMovingPlatforms(level: Level, tick: number, poses?: readonly PlatformPose[]): void {
  for (let i = 0; i < level.movingPlatforms.length; i++) {
    const p = level.movingPlatforms[i]!;
    const pose = poses?.[i] ?? platformPose(p, tick);
    level.platformPoses[i] = pose;
    if (p.padIndex >= 0) {
      const pad = level.pads[p.padIndex]!;
      pad.x = pose.x + (p.cave ? p.cave.padOffsetX : 0);
      pad.y = pose.y + (p.cave ? p.h - p.cave.floorH : 0);
      if (level.wrap) {
        pad.x = wrapCoord(pad.x, level.width);
        pad.y = wrapCoord(pad.y, level.height);
      }
    }
  }
}

/** Wrap a coordinate into [0, size). */
export function wrapCoord(v: number, size: number): number {
  return ((v % size) + size) % size;
}

/** Shortest signed displacement from `from` to `to` on a periodic axis of length `size`. */
export function wrapDelta(from: number, to: number, size: number): number {
  let d = ((to - from) % size + size) % size;
  if (d > size * 0.5) d -= size;
  return d;
}

/** Signed delta (dx, dy) and distance from a to b, respecting `level.wrap`. */
export function wrapDist(level: Level, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const dx = level.wrap ? wrapDelta(ax, bx, level.width) : bx - ax;
  const dy = level.wrap ? wrapDelta(ay, by, level.height) : by - ay;
  return [dx, dy, Math.hypot(dx, dy)];
}

function rectHitsSubBox(
  level: Level,
  bx: number,
  by: number,
  bhw: number,
  bhh: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
): boolean {
  if (level.wrap) {
    const scx = (sx0 + sx1) * 0.5;
    const scy = (sy0 + sy1) * 0.5;
    return (
      Math.abs(wrapDelta(bx, scx, level.width)) < bhw + (sx1 - sx0) * 0.5 &&
      Math.abs(wrapDelta(by, scy, level.height)) < bhh + (sy1 - sy0) * 0.5
    );
  }
  return x1 > sx0 && x0 < sx1 && y1 > sy0 && y0 < sy1;
}

/** Does the half-open box [x0,x1)×[y0,y1) overlap any moving platform at its current synced pose? (Zero-alloc.) */
export function boxHitsPlatforms(level: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  const bx = (x0 + x1) * 0.5;
  const by = (y0 + y1) * 0.5;
  const bhw = (x1 - x0) * 0.5;
  const bhh = (y1 - y0) * 0.5;
  const mps = level.movingPlatforms;
  const poses = level.platformPoses;
  for (let i = 0; i < mps.length; i++) {
    const p = mps[i]!;
    const pose = poses[i]!;
    const px = pose.x;
    const py = pose.y;
    const cave = p.cave;
    if (!cave) {
      if (rectHitsSubBox(level, bx, by, bhw, bhh, x0, y0, x1, y1, px, py, px + p.w, py + p.h)) return true;
    } else {
      // Fast outer AABB reject before testing the 3 cave sub-boxes
      if (!rectHitsSubBox(level, bx, by, bhw, bhh, x0, y0, x1, y1, px, py, px + p.w, py + p.h)) continue;
      if (rectHitsSubBox(level, bx, by, bhw, bhh, x0, y0, x1, y1, px, py, px + p.w, py + cave.roofH)) return true;
      if (rectHitsSubBox(level, bx, by, bhw, bhh, x0, y0, x1, y1, px + p.w - cave.backW, py + cave.roofH, px + p.w, py + p.h - cave.floorH)) return true;
      if (rectHitsSubBox(level, bx, by, bhw, bhh, x0, y0, x1, y1, px, py + p.h - cave.floorH, px + p.w, py + p.h)) return true;
    }
  }
  return false;
}

/** Does a point (x, y) with radius `r` hit any moving platform at its current synced pose? (Zero-alloc.) */
export function pointHitsPlatforms(level: Level, x: number, y: number, r = 0): boolean {
  return boxHitsPlatforms(level, x - r, y - r, x + r, y + r);
}

export function isSolid(level: Level, col: number, row: number): boolean {
  if (level.wrap) {
    const c = ((col % level.cols) + level.cols) % level.cols;
    const r = ((row % level.rows) + level.rows) % level.rows;
    return level.solid[r * level.cols + c] === 1;
  }
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return true;
  return level.solid[row * level.cols + col] === 1;
}

export function padIndexAt(level: Level, col: number, row: number): number {
  if (level.wrap) {
    const c = ((col % level.cols) + level.cols) % level.cols;
    const r = ((row % level.rows) + level.rows) % level.rows;
    return level.padIndex[r * level.cols + c]!;
  }
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return -1;
  return level.padIndex[row * level.cols + col]!;
}

/** Inclusive tile column range covered by the half-open span [x0, x1). */
export function tileSpan(level: Level, x0: number, x1: number): [number, number] {
  const ts = level.tileSize;
  return [Math.floor(x0 / ts), Math.floor((x1 - EPS) / ts)];
}

/** Does the half-open box [x0,x1)×[y0,y1) overlap any solid tile or moving platform? */
export function boxHitsSolid(level: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 <= x0 || y1 <= y0) return false;
  if (level.movingPlatforms.length && boxHitsPlatforms(level, x0, y0, x1, y1)) return true;
  if (!level.hasStaticSolid && level.wrap) return false;
  const [c0, c1] = tileSpan(level, x0, x1);
  const [r0, r1] = tileSpan(level, y0, y1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (isSolid(level, c, r)) return true;
    }
  }
  return false;
}
