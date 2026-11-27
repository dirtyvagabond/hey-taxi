/**
 * "UAP": a classic 1950s sci-fi flying disc. Wide metallic dish with a beveled equator
 * flange, checkered rim strip, chasing rim beacon lights, a crystal-clear glass bubble dome
 * showcasing the passenger front-and-center, a glowing tractor-beam underbelly, and
 * telescoping tripod landing struts.
 *
 * The body color tints the craft's metallic hull and chasing rim beacons (default: atomic
 * mint-silver).
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox; extended
 * landing pads sit at the bottom of the feet box (y 24), outer edges at ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default UAP color: Emerald. */
export const UAP_MINT = 0x4ee68c;
const DOME_GLASS = 0x162945;
const DOME_SHINE = 0x9cd6ff;
const RIM_DARK = 0x1a2030;
const WARN = 0xff3b3b;

/** Beacon x-positions along the UAP equator. */
const BEACONS = [-18, -9, 0, 9, 18] as const;

const SPARKS: readonly (readonly [number, number])[] = [
  [0, 8.8],
  [-15, 2.5],
  [15, 2.5],
  [-6, -5.5],
];

function silhouette(g: Graphics): Graphics {
  g.moveTo(-12.5, -0.5)
    .bezierCurveTo(-12.5, -13.2, 12.5, -13.2, 12.5, -0.5)
    .closePath();
  g.ellipse(0, 2.4, 24, 6.0);
  g.ellipse(0, 6.6, 13.5, 3.2);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const hull = mix(0xd6deeb, color, 0.52);
  const hullHi = mix(hull, 0xffffff, 0.55);
  const hullShade = mix(hull, 0x000000, 0.26);
  const deep = mix(hull, 0x000000, 0.48);

  // Underbelly tractor-beam dish.
  g.ellipse(0, 6.6, 13.5, 3.2).fill(hullShade);
  g.ellipse(0, 8.1, 7.2, 1.6).fill(mix(color, 0xffffff, 0.35));

  // Clear glass bubble dome (behind the passenger layer, so the rider sits cleanly inside).
  g.moveTo(-12.5, 0.2)
    .bezierCurveTo(-12.5, -13.1, 12.5, -13.1, 12.5, 0.2)
    .closePath()
    .fill({ color: DOME_GLASS, alpha: 0.88 });
  g.moveTo(-12.5, 0.2)
    .bezierCurveTo(-12.5, -13.1, 12.5, -13.1, 12.5, 0.2)
    .stroke({ width: 0.95, color: hullHi, alpha: 0.85 });
  // Curved glass dome specular highlights.
  g.moveTo(-9.0, -2.3)
    .quadraticCurveTo(-7.2, -7.8, -1.8, -8.7)
    .stroke({ width: 1.15, color: DOME_SHINE, alpha: 0.72, cap: 'round' });
  g.moveTo(5.2, -7.2)
    .quadraticCurveTo(8.4, -5.5, 9.5, -2.5)
    .stroke({ width: 0.75, color: 0xffffff, alpha: 0.48, cap: 'round' });

  // Main upper disc.
  g.ellipse(0, 2.4, 24, 6.0).fill(hull);
  // Lower bevel shadow.
  g.ellipse(0, 4.4, 22.8, 3.8).fill({ color: hullShade, alpha: 0.8 });
  // Metallic collar ring around the base of the dome.
  g.ellipse(0, -0.3, 13.2, 1.9).fill(hullHi);
  g.ellipse(0, 0.0, 12.4, 1.4).fill(deep);

  // Equator flange & subtle checkered cab band.
  g.roundRect(-23.6, 1.4, 47.2, 2.4, 1.2).fill(RIM_DARK);
  for (let i = 0; i < 12; i++) {
    g.rect(-21 + i * 3.5, 1.65 + (i % 2) * 0.95, 1.8, 0.95).fill({ color: 0xffc83d, alpha: 0.72 });
  }
  // Upper metallic rim highlight.
  g.moveTo(-21, 0.4).quadraticCurveTo(0, -1.5, 21, 0.4).stroke({ width: 0.85, color: hullHi, alpha: 0.75 });
}

class UapArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  private paint = new Graphics();
  private lights = new Graphics();
  private warn = new Graphics();
  readonly scars = new Container();
  private marks = new Graphics();
  private sparks = new Graphics();
  readonly rider = new Graphics();
  private hullColor: number;
  private beaconColor: number;
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    this.hullColor = mix(0xd6deeb, color, 0.52);
    this.beaconColor = mix(color, 0xffffff, 0.25);
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 4, color: WARN, alpha: 0.9 });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.lights);
    this.scars.addChild(this.marks, this.sparks);
  }

  /**
   * Telescoping tripod landing struts extending down and outward from under the dish,
   * with wide rounded foot pads reaching ±feetHalfW (±20) and bottom at y 24.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const hy = 7;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const strutCol = mix(this.hullColor, 0x000000, 0.15);
    const padCol = locked ? 0xd6ddff : this.hullColor;

    // Subtle central stabilizer strut.
    const midY = hy + (bottom - 3 - hy) * e;
    g.moveTo(0, hy + 1).lineTo(0, midY).stroke({ width: 1.6, color: strutCol, alpha: 0.75 });
    g.roundRect(-3.2, midY, 6.4, 2, 1).fill({ color: padCol, alpha: 0.8 });

    // Outer tripod legs.
    for (const s of [-1, 1]) {
      const hx = s * 9.5;
      const fx = s * (TAXI.feetHalfW - 5.5);
      const fy = hy + (bottom - 2.6 - hy) * e;
      const curX = hx + (fx - hx) * e;
      g.moveTo(hx, hy).lineTo(curX, fy).stroke({ width: 2.3, color: strutCol, cap: 'round' });
      g.roundRect(curX - 5.5, fy, 11, 2.6, 1.3).fill(padCol);
      g.roundRect(curX - 5.5, fy + 1.5, 11, 1.1, 0.55).fill({ color: 0x000000, alpha: 0.22 });
      if (locked) g.circle(curX, fy - 2, 1.15).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-14, 0.4).lineTo(-9, 1.4).stroke({ width: 0.6, color: 0x161b28, alpha: 0.55 });
      }
      if (stage >= 2) {
        // Glass dome crack + rim scorch.
        g.moveTo(-4, -7.2).lineTo(-1.5, -4.5).lineTo(-3.2, -1.8).stroke({ width: 0.5, color: 0xffffff, alpha: 0.8 });
        g.circle(13, 3.2, 2.8).fill({ color: 0x140f0a, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(-14, 3.8, 3).fill({ color: 0x0e0a06, alpha: 0.55 });
        g.moveTo(4.5, -6.2).lineTo(2.5, -3).stroke({ width: 0.5, color: 0xffffff, alpha: 0.75 });
      }
      this.paint.tint = stage >= 3 ? 0xf0c0b8 : stage === 2 ? 0xe5e5e5 : 0xffffff;
      this.warn.visible = stage === 4;
      if (stage < 3) this.sparks.clear();
    }

    // Chasing rim beacons (flash red at stage 4, stutter at stage 3).
    const l = this.lights;
    l.clear();
    const activeIdx = Math.floor(time * 5.5) % BEACONS.length;
    BEACONS.forEach((bx, idx) => {
      if (stage >= 1 && idx === 1) return; // one dead bulb when damaged
      const isCrit = stage === 4;
      const lit = isCrit ? Math.sin(time * 12) > 0 : idx === activeIdx;
      const col = isCrit ? WARN : lit ? 0xffffff : this.beaconColor;
      const alpha = stage === 3 && Math.sin(time * 31 + idx * 3) > 0.4 ? 0.15 : lit ? 1 : 0.45;
      l.circle(bx, 2.6, lit ? 1.35 : 0.95).fill({ color: col, alpha });
    });

    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.9 + i * 0.43) % 1;
        const [sx, sy] = SPARKS[i]!;
        g.circle(sx + Math.sin(i * 6.3 + time * 3) * 2, sy + phase * 4.5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xfff1a8,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** Passenger front-and-center inside the transparent bubble dome. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-3.2, -2.8, 6.4, 2.4, 1).fill(look.shirt);
    g.circle(0, -4.9, 2.1).fill(look.skin);
    if (look.hat !== null) g.rect(-2.3, -7.6, 4.6, 1.4).fill(look.hat);
  }
}

export const UAP: SkinDef = {
  id: 'uap',
  name: 'UAP',
  playerColor: UAP_MINT,
  thrusters: {
    tail: { x: -24, y: 2.5 },
    nose: { x: 24, y: 2.5 },
    top: { x: 0, y: -9.8 },
    bottom: [
      { x: -5, y: 9.4 },
      { x: 5, y: 9.4 },
    ],
  },
  create: (color) => new UapArt(color),
};
