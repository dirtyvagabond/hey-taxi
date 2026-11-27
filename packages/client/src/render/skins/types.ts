import type { Container } from 'pixi.js';

/**
 * How damaged a taxi looks, from its hull points. The first point of damage shows nothing on
 * the taxi (only the HUD meter); each point after that adds a cue:
 * 0 clean (full, or one point down) · 1 damaged (wisp of smoke, pips) · 2 battered (smoke
 * trail, scorch) · 3 critical (2 left: dark smoke, sparks, red) · 4 last point (1 left: black
 * smoke and flames, sputtering engine, red glow, warning beep).
 */
export type HullStage = 0 | 1 | 2 | 3 | 4;

export type SkinId =
  | 'pixelCab'
  | 'jetRetro'
  | 'shortBus'
  | 'neonGhost'
  | 'cyberTaxi'
  | 'shuttle'
  | 'bathCab'
  | 'uap';

/**
 * One taxi's artwork in a given skin. Everything is drawn in taxi-local units around the
 * body center and fits the physics geometry (TAXI in @hey-taxi/sim): the body within its hitbox,
 * the extended gear down to the bottom of the feet box. Drawn facing right (nose at +x);
 * TaxiView mirrors it to face left.
 */
export interface SkinArt {
  /** Landing gear, behind the body. */
  readonly gear: Container;
  readonly body: Container;
  /** Soot, scorch marks and the last-point glow, over the body. */
  readonly scars: Container;
  /** The passenger in the window, over everything else. */
  readonly rider: Container;
  /** Gear position: 0 fully up … 1 fully down (and locked). */
  setGear(p: number): void;
  setDamage(stage: HullStage, time: number): void;
  /** A passenger look (see passengers.ts), or nobody. */
  setRider(kind: number | null): void;
}

/** A single thruster flame nozzle in right-facing taxi-local units. */
export interface ThrusterNozzle {
  x: number;
  y: number;
  /** Optional flame length/width multiplier (default 1). */
  scale?: number;
}

export type NozzleSpec = ThrusterNozzle | readonly ThrusterNozzle[];

/** Optional thruster flame anchors in right-facing taxi-local units (mirrored automatically when facing left). */
export interface SkinThrusters {
  /** Rear (tail) nozzle(s), firing -x when facing right (default: { x: -TAXI.halfW, y: 0 }). */
  tail?: NozzleSpec;
  /** Front (nose) nozzle(s), firing +x when facing right (default: { x: +TAXI.halfW, y: 0 }). */
  nose?: NozzleSpec;
  /** Top nozzle(s), firing -y for downward thrust (default: { x: 0, y: -TAXI.halfH }). */
  top?: NozzleSpec;
  /** Bottom nozzle(s), firing +y for upward thrust (default: [{ x: -6, y: +TAXI.halfH }, { x: 6, y: +TAXI.halfH }]). */
  bottom?: NozzleSpec;
}

export interface SkinDef {
  id: SkinId;
  /** Shown to the player when choosing. */
  name: string;
  /** The player's body color in this skin (rivals use their own colors). */
  playerColor: number;
  /** Optional custom thruster flame anchors so flames emerge flush with the hull. */
  thrusters?: SkinThrusters;
  /** `color`: the body color (the player's yellow, or a rival's own color). */
  create(color: number): SkinArt;
}

/** Blend `color` toward `target` by `t` (0–1), per channel. */
export function mix(color: number, target: number, t: number): number {
  const ch = (c: number, s: number) => ((c >> s) & 255) * (1 - t) + ((target >> s) & 255) * t;
  return (Math.round(ch(color, 16)) << 16) | (Math.round(ch(color, 8)) << 8) | Math.round(ch(color, 0));
}
