/** Simulation ticks per second. The sim only ever advances in whole ticks. */
export const TICK_RATE = 60;
/** Seconds per tick. */
export const DT = 1 / TICK_RATE;

/**
 * Taxi geometry in world units (1 unit = 1 px at 1280×720). The taxi never rotates.
 * Position (x, y) is the center of the body box.
 */
export const TAXI = {
  /** Half-width of the body hitbox. */
  halfW: 24,
  /** Half-height of the body hitbox. */
  halfH: 10,
  /** Half-width of the landing skids (feet box), measured to the outside of each foot. */
  feetHalfW: 20,
  /** How far the fully-deployed gear extends below the body. */
  gearLength: 14,
} as const;

/** Max distance moved per collision sub-step, so fast taxis can't tunnel through tiles. */
export const MAX_SUBSTEP = 4;

/** Per-tick input bitfield. Held state, not edges; the sim detects presses itself. */
export const Input = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  GEAR: 16,
  FIRE: 32,
  /** Pop a burst of countermeasure flares. */
  FLARE: 64,
  /** Buy one missile / one flare pack while parked at a convenience store (fuel pad). */
  BUY_MISSILE: 128,
  BUY_FLARE: 256,
  /** Repair one hull point at a store. */
  BUY_REPAIR: 512,
  /** Buy one gallon of gas / fill the tank (as far as you can afford) at a store. */
  BUY_GAS: 1024,
  BUY_FILL: 2048,
  /** Summon the flying convenience service while parked away from a store. */
  SUMMON_SERVICE: 4096,
  EJECT: 8192,
} as const;

export const EPS = 1e-6;

/**
 * Built-in taxi skins (how a taxi looks; no effect on play). The player picks one for each new
 * taxi; rivals get one at random. Unknown skins default to THE SHORT BUS (`shortBus`).
 * Optional runtime skin plug-ins may register additional IDs via `registerExtraSkins`.
 */
export const TAXI_SKINS = [
  'pixelCab',
  'jetRetro',
  'shortBus',
  'neonGhost',
  'cyberTaxi',
  'shuttle',
  'bathCab',
  'uap',
  'tacticalTaxi',
  'trailRunner',
  'lunarLander',
  'supersonic',
  'woodyWagon',
  'hoverBot',
  'boogieVan',
  'surfBus',
  'iceCreamCab',
  'checkerCab',
  'stadiumBlimp',
  'chromeRocket',
  'miniSub',
  'boombox',
] as const;
export type BuiltinTaxiSkin = (typeof TAXI_SKINS)[number];
export type TaxiSkin = BuiltinTaxiSkin | (string & {});

const extraSkins: string[] = [];
let extraRivalShare = 0.75;

/**
 * Register additional cosmetic skin IDs loaded from a runtime plug-in.
 * `rivalShare` (0–1, default 0.75) is the probability a newly spawned rival picks a plug-in skin.
 */
export function registerExtraSkins(ids: readonly string[], rivalShare = 0.75): void {
  extraRivalShare = Math.max(0, Math.min(1, rivalShare));
  for (const id of ids) {
    if (typeof id === 'string' && id.length > 0 && !TAXI_SKINS.includes(id as BuiltinTaxiSkin) && !extraSkins.includes(id)) {
      extraSkins.push(id);
    }
  }
}

/** Clear any registered runtime plug-in skins (primarily for tests). */
export function clearExtraSkins(): void {
  extraSkins.length = 0;
  extraRivalShare = 0.75;
}

/** Extra skin IDs currently registered from runtime plug-ins. */
export function extraTaxiSkins(): readonly string[] {
  return extraSkins;
}

/** Every valid taxi skin ID (built-in plus any loaded runtime plug-ins). */
export function allTaxiSkins(): readonly TaxiSkin[] {
  return [...TAXI_SKINS, ...extraSkins];
}

/** Pick a rival skin using two uniform [0, 1) draws, favoring plug-in skins when loaded. */
export function pickWeightedSkin(rPool: number, rPick: number): TaxiSkin {
  const pool: readonly string[] = extraSkins.length > 0 && rPool < extraRivalShare ? extraSkins : TAXI_SKINS;
  return pool[Math.min(pool.length - 1, Math.floor(rPick * pool.length))]!;
}

/** A valid skin (built-in or registered plug-in), or `shortBus` for anything else. */
export function taxiSkin(s: unknown): TaxiSkin {
  if (typeof s === 'string' && (TAXI_SKINS.includes(s as BuiltinTaxiSkin) || extraSkins.includes(s))) {
    return s;
  }
  return 'shortBus';
}

/** A valid 24-bit RGB taxi paint color (0x000000–0xffffff), or undefined for the skin default. */
export function taxiColor(c: unknown): number | undefined {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : undefined;
}
