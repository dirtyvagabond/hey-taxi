/**
 * "SUPERSONIC": a sleek delta-wing supersonic jetliner with an animated droop-snoot nose.
 * Long razor-slim white fuselage, swept delta wing with under-wing rectangular turbojet
 * nacelles, tall swept triangular tailfin, paint-colored cheatline & tailfin accent, row
 * of cabin windows, and tall tricycle landing gear resting directly on rubber tires.
 *
 * Signature animation: as landing gear deploys (p: 0 → 1), the sharp needle nose cone
 * smoothly tilts downward, revealing the angled flight-deck visor just like a real
 * supersonic airliner on landing approach.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended tricycle tires sit flush on the pad at y = 24 inside ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default accent color: classic supersonic cobalt-blue cheatline & tail accent. */
export const SUPERSONIC_BLUE = 0x4ea8ff;

const WHITE = 0xf2f5fc;
const WHITE_SHADE = 0xcfd8e8;
const PANEL = 0x9aa6bd;
const ENGINE_DARK = 0x262c3b;
const ENGINE_NOZZLE = 0x141822;
const GLASS = 0x101c30;
const GLASS_SHINE = 0x96d0ff;
const STRUT = 0xc6d0e3;
const STRUT_DARK = 0x626c82;
const TIRE = 0x151820;
const WARN = 0xff3b3b;

const SPARKS: readonly (readonly [number, number])[] = [
  [-18, 6.8],
  [-8, 6.2],
  [8, 3.8],
  [-20, -4.5],
];

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.poly([
    -23.8, -9.8, -19.2, -9.8, -11.4, -1.6, 12.8, -1.6, 23.8, 3.2,
    13.2, 6.2, -5.0, 7.6, -22.8, 9.2, -23.8, 5.6, -23.4, 0.2,
  ]);
  return g;
}

function drawFuselage(g: Graphics, accent: number): void {
  const accentShade = mix(accent, 0x000000, 0.25);

  // Tall swept triangular tailfin (x: -23.8..-11.4, y: -9.8..+0.4).
  g.poly([-23.4, 0.4, -23.8, -9.8, -19.4, -9.8, -11.4, -1.2]).fill(WHITE);
  g.poly([-23.8, -9.8, -21.6, -9.8, -20.8, 0.2, -23.4, 0.4]).fill(WHITE_SHADE);
  // Paint-colored diagonal livery stripe on the tailfin.
  g.poly([-23.6, -7.4, -17.0, -7.4, -15.2, -4.4, -23.5, -4.4]).fill(accent);
  g.moveTo(-19.4, -9.6).lineTo(-11.4, -1.3).stroke({ width: 0.55, color: PANEL, alpha: 0.8 });

  // Thicker, bolder supersonic fuselage (7.6u tall: y = -1.6..+6.0, same width).
  g.moveTo(-23.6, 1.4)
    .lineTo(-17.0, -1.6)
    .lineTo(12.8, -1.6)
    .lineTo(12.8, 6.0)
    .lineTo(-18.6, 6.2)
    .lineTo(-23.6, 3.8)
    .closePath()
    .fill(WHITE);

  // Lower fuselage underside shading.
  g.poly([-22.0, 3.6, 12.8, 3.6, 12.8, 6.0, -18.6, 6.2]).fill(WHITE_SHADE);
  // Upper fuselage specular highlight.
  g.moveTo(-16.2, -1.05).lineTo(12.2, -1.05).stroke({ width: 0.85, color: 0xffffff, alpha: 0.9, cap: 'round' });

  // Bold paint-colored supersonic cheatline stripe running the length of the fuselage.
  g.rect(-21.2, 2.2, 34.0, 1.55).fill(accent);
  g.rect(-21.2, 3.4, 34.0, 0.4).fill(accentShade);

  // Row of cabin windows along the thicker upper fuselage.
  for (let wx = -11.5; wx <= 3.0; wx += 3.0) {
    g.roundRect(wx, -0.2, 1.7, 1.4, 0.4).fill(GLASS);
  }
  // Larger forward cabin/flight-deck window just behind the droop-nose hinge (for setRider).
  g.poly([5.8, -1.1, 11.4, -1.1, 12.4, 2.1, 5.8, 2.1]).fill(GLASS);
  g.moveTo(6.8, -0.45).lineTo(10.6, -0.45).stroke({ width: 0.65, color: GLASS_SHINE, alpha: 0.8, cap: 'round' });

  // Swept ogival delta wing along the lower flank.
  g.poly([-22.0, 4.8, -4.5, 4.6, 8.8, 5.8, -3.5, 7.6, -22.2, 7.6]).fill(WHITE_SHADE);
  g.moveTo(-21.8, 4.8).lineTo(8.2, 5.8).stroke({ width: 0.6, color: PANEL, alpha: 0.8 });

  // Chunkier rectangular under-wing turbojet nacelle + exhaust box at the rear.
  g.roundRect(-23.2, 5.8, 11.8, 3.4, 0.7).fill(ENGINE_DARK);
  g.rect(-23.8, 6.3, 1.7, 2.4).fill(ENGINE_NOZZLE);
  g.moveTo(-22.0, 6.4).lineTo(-12.0, 6.4).stroke({ width: 0.5, color: 0x5c667e, alpha: 0.85 });
}

class SupersonicArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Container();
  readonly rider = new Graphics();
  private paint = new Graphics();
  /** Droop-snoot nose cone pivoted at (12.5, 2.4) so it tilts down smoothly as gear extends. */
  private nose = new Graphics();
  private warn = new Graphics();
  private marks = new Graphics();
  private sparks = new Graphics();
  private accent: number;
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    this.accent = color;
    drawFuselage(this.paint, color);

    // Draw the thicker needle nose cone in local coordinates relative to its hinge at (12.5, 2.4).
    this.nose.position.set(12.5, 2.4);
    this.nose
      .moveTo(0, -4.0)
      .lineTo(11.3, 0.4)
      .lineTo(11.3, 1.4)
      .lineTo(0, 3.6)
      .closePath()
      .fill(WHITE);
    this.nose.poly([0, 1.2, 11.2, 1.0, 11.2, 1.4, 0, 3.6]).fill(WHITE_SHADE);
    // Matching bolder cheatline tip & dark nose visor strip.
    this.nose.poly([0, -0.2, 8.6, 0.4, 8.6, 1.2, 0, 1.35]).fill(color);
    this.nose.poly([0.4, -3.5, 3.6, -2.1, 3.4, -0.6, 0.4, -0.8]).fill(GLASS);
    this.nose.moveTo(0.4, -3.5).lineTo(11.0, 0.5).stroke({ width: 0.7, color: 0xffffff, alpha: 0.85 });

    silhouette(this.warn).stroke({ width: 3.6, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.nose);
    this.scars.addChild(this.marks, this.sparks);
  }

  /**
   * Tall slender supersonic tricycle landing gear resting directly on rubber tires at y = 24,
   * synchronized with the signature droop-snoot nose tilting down (+14°) on approach!
   */
  setGear(p: number): void {
    const e = p * p * (3 - 2 * p);
    // Droop-snoot nose tilts smoothly downward as gear extends.
    this.nose.rotation = 0.24 * e; // ~13.8° droop

    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const locked = p >= 1;
    const top = 6.2;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    // [strutX, wheelR, isMain]
    const legs: readonly (readonly [number, number, boolean])[] = [
      [-11.5, 3.0, true],
      [13.0, 2.3, false],
    ];

    for (const [ax, wheelR, isMain] of legs) {
      const wy = top + (bottom - wheelR - top) * e;
      // Slender oleo strut + diagonal drag brace.
      g.moveTo(ax, top).lineTo(ax, wy).stroke({ width: isMain ? 2.0 : 1.5, color: STRUT, cap: 'round' });
      g.moveTo(ax - Math.sign(ax) * 3.4, top + 0.4)
        .lineTo(ax, top + (wy - top) * 0.58)
        .stroke({ width: 1.05, color: STRUT_DARK });
      // Dual-wheel depth hint on main gear + rubber tire resting flush on y = 24.
      if (isMain) g.circle(ax - 0.85, wy - 0.2, wheelR * 0.92).fill(0x0c0e14);
      g.circle(ax, wy, wheelR).fill(TIRE);
      g.circle(ax, wy, wheelR * 0.45).fill(STRUT);
      g.circle(ax, wy, wheelR * 0.18).fill(this.accent);
      if (locked) g.circle(ax, wy - wheelR - 1.8, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-14, 2.0).lineTo(-7, 2.6).stroke({ width: 0.55, color: 0x3b4252, alpha: 0.65 });
      }
      if (stage >= 2) {
        g.moveTo(7.4, 0.9).lineTo(10.0, 2.5).stroke({ width: 0.5, color: 0xffffff, alpha: 0.85 });
        g.ellipse(-15, 6.2, 4.8, 1.4).fill({ color: 0x161008, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(-20, -4.5, 2.4).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(4, 3.8, 2.5).fill({ color: 0x100b06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.nose.tint = this.paint.tint;
      this.warn.visible = stage === 4;
      if (stage < 3) this.sparks.clear();
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.9 + i * 0.41) % 1;
        const [sx, sy] = SPARKS[i]!;
        g.circle(sx + Math.sin(i * 6.9 + time * 3) * 2, sy + phase * 4.5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xfff1a8,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** Passenger visible in the forward cabin window just behind the droop-nose hinge. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(7.0, 0.4, 4.0, 1.4, 0.5).fill(look.shirt);
    g.circle(9.0, -0.9, 1.45).fill(look.skin);
    if (look.hat !== null) g.rect(7.5, -2.6, 3.0, 0.95).fill(look.hat);
  }
}

export const SUPERSONIC: SkinDef = {
  id: 'supersonic',
  name: 'SUPERSONIC',
  playerColor: SUPERSONIC_BLUE,
  thrusters: {
    tail: { x: -24, y: 7.5, scale: 1.1 },
    nose: { x: 24, y: 3.3, scale: 0.8 },
    top: { x: -2, y: -1.6, scale: 0.85 },
    bottom: [
      { x: -10, y: 8.4 },
      { x: 4, y: 7.0 },
    ],
  },
  flameColors: () => ({ outer: 0x4ea8ff, core: 0xfff4c2 }),
  create: (color) => new SupersonicArt(color),
};
