/**
 * "CHROME ROCKET": a classic 1950s sci-fi silver torpedo rocket. Fixed gleaming brushed-chrome
 * teardrop fuselage with horizontal specular bands and panel rivets, sharp needle nose spire,
 * three circular portholes (passenger visible in the forward porthole), paint-colored swept
 * retro tailfins (default: raygun Crimson), rear bell nozzle, and retractable 3-leg chrome
 * landing struts.
 *
 * The body color repaints the swept tailfins and nose-collar accent band while keeping the
 * mirror-chrome torpedo hull fixed.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended landing pads sit flush on the pad at y = 24, outer edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default fin accent color: classic 1950s raygun Crimson. */
export const CHROME_ROCKET_RED = 0xe63946;

const CHROME_TOP = 0xf2f6ff;
const CHROME_MID = 0xbec8dc;
const CHROME_SHADE = 0x7b869e;
const CHROME_DARK = 0x3b4254;
const GLASS = 0x132440;
const GLASS_SHINE = 0xa8dcff;
const BRASS = 0xd4a442;
const NOZZLE = 0x262c3b;
const WARN = 0xff3b3b;

const SPARKS: readonly (readonly [number, number])[] = [
  [-18, 4.2],
  [-12, -5.5],
  [8, 3.8],
  [16, 0.5],
];

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-22.8, -1.8)
    .lineTo(-22.8, -9.6)
    .lineTo(-15.5, -9.2)
    .lineTo(-9.5, -4.6)
    .quadraticCurveTo(6.0, -7.2, 20.5, 0.0)
    .lineTo(24.0, 0.0)
    .lineTo(20.5, 0.4)
    .quadraticCurveTo(6.0, 7.6, -9.5, 5.0)
    .lineTo(-15.5, 9.4)
    .lineTo(-22.8, 9.6)
    .lineTo(-22.8, 2.2)
    .closePath();
  return g;
}

function drawBody(g: Graphics, accent: number): void {
  const accentShade = mix(accent, 0x000000, 0.25);
  const accentHi = mix(accent, 0xffffff, 0.45);

  // Swept upper & lower retro rocket fins (paint-colored).
  g.poly([-22.8, -9.6, -15.8, -9.0, -8.5, -3.6, -19.5, -2.6]).fill(accent);
  g.moveTo(-22.4, -9.2).lineTo(-15.8, -8.7).lineTo(-9.0, -3.7).stroke({ width: 0.7, color: accentHi, alpha: 0.8 });
  g.poly([-22.8, 9.6, -15.8, 9.0, -8.5, 4.0, -19.5, 3.0]).fill(accentShade);

  // Rear rocket engine bell (-23.8).
  g.poly([-23.8, -2.6, -18.5, -2.2, -18.5, 2.6, -23.8, 3.0]).fill(NOZZLE);
  g.rect(-24.0, -2.0, 1.3, 4.4).fill(0x10131c);

  // Gleaming brushed-chrome 1950s teardrop torpedo hull (fixed chrome).
  g.moveTo(-19.5, -2.8)
    .bezierCurveTo(-8.0, -7.6, 10.0, -6.6, 21.4, 0.2)
    .bezierCurveTo(10.0, 7.0, -8.0, 8.0, -19.5, 3.2)
    .closePath()
    .fill(CHROME_MID);

  // Lower chrome cylinder shading & bright upper specular gleam.
  g.moveTo(-19.0, 1.4)
    .quadraticCurveTo(2.0, 3.6, 20.5, 0.2)
    .bezierCurveTo(10.0, 7.0, -8.0, 8.0, -19.5, 3.2)
    .closePath()
    .fill(CHROME_SHADE);
  g.moveTo(-15.5, -2.8)
    .quadraticCurveTo(2.0, -5.6, 17.5, -1.0)
    .stroke({ width: 1.8, color: CHROME_TOP, alpha: 0.9, cap: 'round' });

  // Center side fin projecting outward along the flank.
  g.poly([-22.0, -0.8, -11.0, -0.5, -11.0, 1.2, -22.0, 1.6]).fill(accent).stroke({ width: 0.4, color: accentShade });

  // Painted nose collar ring + chrome needle nose spire (+24).
  g.poly([12.8, -3.5, 16.0, -2.4, 16.0, 2.8, 12.8, 3.9]).fill(accent);
  g.moveTo(20.6, 0.2).lineTo(24.0, 0.2).stroke({ width: 1.0, color: CHROME_TOP, cap: 'round' });

  // Panel seam rings & rivets along the chrome hull.
  g.moveTo(-8.0, -5.4).lineTo(-8.0, 5.8).stroke({ width: 0.4, color: CHROME_DARK, alpha: 0.55 });
  g.moveTo(1.5, -5.6).lineTo(1.5, 6.0).stroke({ width: 0.4, color: CHROME_DARK, alpha: 0.55 });

  // Three brass-rimmed circular portholes (front porthole frames the passenger via setRider).
  for (const [px, pr] of [[-4.8, 2.1], [5.8, 2.9]] as const) {
    g.circle(px, -0.2, pr + 0.55).fill(BRASS);
    g.circle(px, -0.2, pr).fill(GLASS);
    g.moveTo(px - pr * 0.5, -0.2 - pr * 0.45)
      .quadraticCurveTo(px, -0.2 - pr * 0.7, px + pr * 0.45, -0.2 - pr * 0.25)
      .stroke({ width: 0.65, color: GLASS_SHINE, alpha: 0.75, cap: 'round' });
  }
}

class ChromeRocketArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Container();
  readonly rider = new Graphics();
  private paint = new Graphics();
  private warn = new Graphics();
  private marks = new Graphics();
  private sparks = new Graphics();
  private accent: number;
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    this.accent = color;
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.6, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint);
    this.scars.addChild(this.marks, this.sparks);
  }

  /** Three retractable chrome landing struts unfolding from the belly down to y = 24. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const top = 5.4;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    // Central depth-hint 3rd leg.
    const midY = top + (bottom - 2.6 - top) * e;
    g.moveTo(-2, top).lineTo(-2, midY).stroke({ width: 1.5, color: CHROME_SHADE, alpha: 0.85 });
    g.roundRect(-5.0, midY, 6.0, 1.8, 0.9).fill({ color: CHROME_DARK, alpha: 0.85 });

    // Outer front & rear chrome tripod struts.
    for (const s of [-1, 1]) {
      const hx = s * 9.0;
      const fx = s * (9.0 + 6.0 * e); // ±15.0; pad half-width 5.0 → ±20.0
      const fy = top + (bottom - 2.2 - top) * e;
      g.moveTo(hx, top).lineTo(fx, fy).stroke({ width: 2.1, color: CHROME_TOP, cap: 'round' });
      g.moveTo(hx, top)
        .lineTo(hx + (fx - hx) * 0.45, top + (fy - top) * 0.45)
        .stroke({ width: 3.0, color: CHROME_DARK, cap: 'round' });
      g.roundRect(fx - 5.0, fy, 10.0, 2.2, 1.0).fill(this.accent);
      g.roundRect(fx - 5.0, fy + 1.2, 10.0, 1.0, 0.5).fill(CHROME_DARK);
      if (locked) g.circle(fx, fy - 2.0, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-12, 2.2).lineTo(-5, 3.0).stroke({ width: 0.6, color: CHROME_DARK, alpha: 0.7 });
      }
      if (stage >= 2) {
        g.moveTo(4.0, -2.0).lineTo(7.0, 1.2).stroke({ width: 0.5, color: 0xffffff, alpha: 0.85 });
        g.circle(-16, -5.2, 2.4).fill({ color: 0x161008, alpha: 0.55 });
      }
      if (stage >= 3) {
        g.circle(10, 3.2, 2.8).fill({ color: 0x100b06, alpha: 0.6 });
        g.circle(-14, 4.6, 2.6).fill({ color: 0x100b06, alpha: 0.55 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
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

  /** Passenger peeking out of the forward brass-rimmed porthole. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(3.8, 0.3, 4.0, 1.5, 0.5).fill(look.shirt);
    g.circle(5.8, -1.0, 1.45).fill(look.skin);
    if (look.hat !== null) g.rect(4.4, -2.7, 2.8, 0.9).fill(look.hat);
  }
}

export const CHROME_ROCKET: SkinDef = {
  id: 'chromeRocket',
  name: 'CHROME ROCKET',
  playerColor: CHROME_ROCKET_RED,
  thrusters: {
    tail: { x: -24.0, y: 0.2, scale: 1.15 },
    nose: { x: 24.0, y: 0.2, scale: 0.75 },
    top: { x: 0, y: -5.4, scale: 0.85 },
    bottom: [
      { x: -6.0, y: 6.2 },
      { x: 6.0, y: 5.8 },
    ],
  },
  create: (color) => new ChromeRocketArt(color),
};
