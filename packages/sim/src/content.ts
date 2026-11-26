/**
 * The game's level content, shared by the server (which simulates it) and the client (which
 * draws it). Each level has a stable ID (its file name) and a content version (a hash of its
 * data), so saves can tell exactly which content they were made with.
 */
import w1 from '../../../levels/world/1-first-shift.json';
import w2 from '../../../levels/world/2-midtown.json';
import w3 from '../../../levels/world/3-skyline.json';
import w4 from '../../../levels/world/4-frostbite-pass.json';
import w5 from '../../../levels/world/5-singularity-station.json';
import w6 from '../../../levels/world/6-polarity-yard.json';
import w7 from '../../../levels/world/7-gridlock-vault.json';
import w8 from '../../../levels/world/8-overdrive-canyon.json';
import type { LevelData } from './level';

export interface ContentLevel {
  /** Stable ID, e.g. "world/1-first-shift". */
  id: string;
  /** Changes whenever the level's data changes. */
  version: string;
  data: LevelData;
}

/** Wraps level data with its ID and content version. */
export const contentLevel = (id: string, data: LevelData): ContentLevel => ({ id, version: contentHash(data), data });
const entry = contentLevel;

/** The locale IDs, in world order (teleport menu order; the first is where new taxis start). */
export const WORLD_LEVELS = [
  'world/1-first-shift',
  'world/2-midtown',
  'world/3-skyline',
  'world/4-frostbite-pass',
  'world/5-singularity-station',
  'world/6-polarity-yard',
  'world/7-gridlock-vault',
  'world/8-overdrive-canyon',
] as const;

/**
 * The game's locales (they all exist at once; teleports connect them):
 * three cities plus five hazard locales (wind, gravity well, polarity, laser gates, meteors).
 */
export const WORLD: ContentLevel[] = [
  entry('world/1-first-shift', w1),
  entry('world/2-midtown', w2),
  entry('world/3-skyline', w3),
  entry('world/4-frostbite-pass', w4 as LevelData),
  entry('world/5-singularity-station', w5 as LevelData),
  entry('world/6-polarity-yard', w6 as LevelData),
  entry('world/7-gridlock-vault', w7 as LevelData),
  entry('world/8-overdrive-canyon', w8 as LevelData),
];

export const ALL_LEVELS: ContentLevel[] = WORLD;

export function levelById(id: string): ContentLevel | undefined {
  return ALL_LEVELS.find((l) => l.id === id);
}

export function levelByName(name: string): ContentLevel | undefined {
  return ALL_LEVELS.find((l) => l.data.name === name);
}

/** FNV-1a over the level's JSON: a short, stable content version. */
function contentHash(data: LevelData): string {
  const s = JSON.stringify(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
