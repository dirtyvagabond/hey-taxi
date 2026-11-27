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
} as const;

export const EPS = 1e-6;

/**
 * Taxi skins (how a taxi looks; no effect on play). The player picks one for each new taxi;
 * rivals get one at random. Taxis saved before skins existed are the original.
 */
export const TAXI_SKINS = [
  'pixelCab',
  'jetRetro',
  'original',
  'neonGhost',
  'cyberTaxi',
  'shuttle',
  'bathCab',
  'uap',
] as const;
export type TaxiSkin = (typeof TAXI_SKINS)[number];
/** A valid skin, or the original for anything else. */
export function taxiSkin(s: unknown): TaxiSkin {
  return TAXI_SKINS.includes(s as TaxiSkin) ? (s as TaxiSkin) : 'original';
}

/** A valid 24-bit RGB taxi paint color (0x000000–0xffffff), or undefined for the skin default. */
export function taxiColor(c: unknown): number | undefined {
  return typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : undefined;
}
