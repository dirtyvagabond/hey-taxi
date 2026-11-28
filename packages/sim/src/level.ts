import { EPS } from './constants';

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
export type LevelTheme = 'city' | 'winter' | 'singularity' | 'polarity' | 'vault' | 'canyon' | 'beach';

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
  /** Landing surface in world units: left edge, top (the surface), width. */
  x: number;
  y: number;
  w: number;
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
          runPad = { index: pads.length, label: ch, kind, x: c * tileSize, y: r * tileSize, w: 0 };
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

  return {
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
}

export function isSolid(level: Level, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return true;
  return level.solid[row * level.cols + col] === 1;
}

export function padIndexAt(level: Level, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= level.cols || row >= level.rows) return -1;
  return level.padIndex[row * level.cols + col]!;
}

/** Inclusive tile column range covered by the half-open span [x0, x1). */
export function tileSpan(level: Level, x0: number, x1: number): [number, number] {
  const ts = level.tileSize;
  return [Math.floor(x0 / ts), Math.floor((x1 - EPS) / ts)];
}

/** Does the half-open box [x0,x1)×[y0,y1) overlap any solid tile? */
export function boxHitsSolid(level: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  if (x1 <= x0 || y1 <= y0) return false;
  const [c0, c1] = tileSpan(level, x0, x1);
  const [r0, r1] = tileSpan(level, y0, y1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (isSolid(level, c, r)) return true;
    }
  }
  return false;
}
