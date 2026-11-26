import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSim,
  DT,
  Input,
  parseLevel,
  spawnPassenger,
  step,
  TAXI,
  type Level,
  type LevelData,
  type SimEvent,
  type SimState,
} from '../src/index';

const CAMPAIGN_DIR = join(__dirname, 'fixtures/campaign');
const campaign = readdirSync(CAMPAIGN_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(CAMPAIGN_DIR, f), 'utf8')) as LevelData }));

function find<T extends SimEvent['type']>(ev: SimEvent[], type: T) {
  return ev.find((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/**
 * Coarse reachability: can a 2×2-tile box get from the spawn to the air above every pad and
 * to just below the exit gate? The taxi is 48×34 in 40u tiles, so this demands passages at
 * least two tiles wide and two tall: fair for players and for the NPC autopilot.
 */
function unreachable(level: Level): string[] {
  const { cols, rows } = level;
  const empty = (c: number, r: number) => !level.solid[r * cols + c];
  const open = (c: number, r: number) =>
    c >= 0 && r >= 0 && c + 1 < cols && r + 1 < rows &&
    empty(c, r) && empty(c + 1, r) && empty(c, r + 1) && empty(c + 1, r + 1);
  let start: [number, number] | undefined;
  for (const r of [level.spawnRow - 1, level.spawnRow]) {
    for (const c of [level.spawnCol - 1, level.spawnCol]) if (!start && open(c, r)) start = [c, r];
  }
  if (!start) return ['spawn boxed in'];
  const seen = new Set([`${start[0]},${start[1]}`]);
  const queue: [number, number][] = [start];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${c + dc},${r + dr}`;
      if (!seen.has(key) && open(c + dc, r + dr)) {
        seen.add(key);
        queue.push([c + dc, r + dr]);
      }
    }
  }
  const ts = level.tileSize;
  const above = (x: number, w: number, row: number) => {
    for (let c = Math.floor(x / ts); c < Math.floor((x + w) / ts) - 1; c++) if (seen.has(`${c},${row}`)) return true;
    return false;
  };
  const problems: string[] = [];
  for (const pad of level.pads) {
    if (!above(pad.x, pad.w, pad.y / ts - 2)) problems.push(`pad ${pad.label}`);
  }
  // Treat the (closed) gate as the target: the cell just below it must be reachable.
  const gate = level.exit!;
  if (!above(gate.x, gate.w, (gate.y + gate.h) / ts)) problems.push('exit');
  return problems;
}

describe('campaign levels', () => {
  it('has levels, in order, each a little longer than the first', () => {
    expect(campaign.length).toBeGreaterThanOrEqual(5);
    expect(campaign[0]!.data.fares).toBe(3);
    const fares = campaign.map((l) => l.data.fares!);
    for (let i = 1; i < fares.length; i++) expect(fares[i]).toBeGreaterThanOrEqual(fares[i - 1]!);
  });

  it.each(campaign)('$file is well-formed and completable', ({ data }) => {
    const level = parseLevel(data);
    expect(level.fareQuota).toBeGreaterThan(0);
    expect(level.hint.length).toBeGreaterThan(0);
    expect(level.exit).not.toBeNull();
    expect(level.exit!.w).toBeGreaterThanOrEqual(2 * level.tileSize);
    expect(level.pads.filter((p) => p.kind === 'pad').length).toBeGreaterThanOrEqual(3);
    for (const pad of level.pads) expect(pad.w).toBeGreaterThanOrEqual(2 * level.tileSize);
    expect(unreachable(level)).toEqual([]);
    const s = createSim(level);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 180; i++) ev.push(...step(s, {}));
    expect(s.taxis[0]!.status).toBe('landed');
    expect(find(ev, 'passengerSpawned')).toBeDefined();
  });
});

// Pads 1 (x 40–160) and 2 (x 280–440) on y=200; exit gate in the ceiling at x 160–280.
const GATED: LevelData = {
  name: 'gated',
  fares: 2,
  tiles: [
    '####EEE#####',
    '#..........#',
    '#..........#',
    '#..........#',
    '#.S........#',
    '#111...2222#',
    '############',
  ],
};

function deliverOne(s: SimState): SimEvent[] {
  const t = s.taxis[0]!;
  const pad1 = s.level.pads[0]!;
  const pad2 = s.level.pads[1]!;
  spawnPassenger(s, { padIndex: 1, destPadIndex: 0, x: pad2.x + pad2.w - 10 });
  const land = (x: number, y: number) => {
    Object.assign(t, { status: 'flying', padIndex: -1, x, y: y - 0.25 - TAXI.halfH - TAXI.gearLength, vx: 0, vy: 10 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120; i++) ev.push(...step(s, {}));
    return ev;
  };
  return [...land(pad2.x + 40, pad2.y), ...land(pad1.x + 60, pad1.y)];
}

describe('fare quota & exit gate', () => {
  it('the gate is solid until the quota is met', () => {
    const level = parseLevel(GATED);
    const s = createSim(level, { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    expect(level.solid[level.exit!.tiles[0]!]).toBe(1);
    expect(find(deliverOne(s), 'fareCompleted')).toBeDefined();
    expect(s.exitOpen).toBe(false);
    const ev = deliverOne(s);
    expect(find(ev, 'exitOpened')).toBeDefined();
    expect(s.exitOpen).toBe(true);
    expect(level.solid[level.exit!.tiles[0]!]).toBe(0);
  });

  it('stops spawning passengers once enough are in play to meet the quota', () => {
    const s = createSim(parseLevel({ ...GATED, fares: 1 }));
    for (let i = 0; i < 600; i++) step(s, {});
    expect(s.passengers).toHaveLength(1);
  });

  it('flying into the open gate completes the level, and the sim stops', () => {
    const s = createSim(parseLevel(GATED), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    deliverOne(s);
    deliverOne(s);
    const t = s.taxis[0]!;
    Object.assign(t, { status: 'flying', padIndex: -1, x: 220, y: 70, vx: 0, vy: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 120 && !s.complete; i++) ev.push(...step(s, { p1: Input.UP }));
    expect(find(ev, 'levelComplete')).toMatchObject({ taxiId: 'p1' });
    expect(find(ev, 'crashed')).toBeUndefined();
    const tick = s.tick;
    expect(step(s, { p1: Input.UP })).toEqual([]);
    expect(s.tick).toBe(tick);
  });

  it('a closed gate is a wall', () => {
    const s = createSim(parseLevel(GATED), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;
    Object.assign(t, { status: 'flying', padIndex: -1, x: 220, y: 70, vx: 0, vy: 0 });
    const ev: SimEvent[] = [];
    for (let i = 0; i < Math.round(2 / DT); i++) ev.push(...step(s, { p1: Input.UP }));
    // It bangs into the closed gate (losing hull) instead of flying out.
    expect(find(ev, 'taxiDamaged') ?? find(ev, 'crashed')).toBeDefined();
    expect(find(ev, 'levelComplete')).toBeUndefined();
    expect(t.y).toBeGreaterThan(s.level.exit!.y + s.level.exit!.h);
  });

  it('a level with a quota but no gate completes as soon as the quota is met', () => {
    const s = createSim(parseLevel({ ...GATED, tiles: GATED.tiles.map((r) => r.replace(/E/g, '#')) }), {
      config: { passengersPerTaxi: 0, extraPassengers: 0 },
    });
    deliverOne(s);
    const ev = deliverOne(s);
    expect(find(ev, 'levelComplete')).toBeDefined();
    expect(s.complete).toBe(true);
  });
});
