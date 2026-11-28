/**
 * "MINI SUB": a riveted brass-and-yellow deep-sea mini-submarine. Plump rounded submersible
 * hull with hull rivets, a crystal-clear glass nose dome showcasing the passenger front-and-
 * center, conning tower with a pop-up periscope that rises smoothly when landing gear deploys,
 * spinning rear brass propeller, and fold-down brass landing skids.
 *
 * The body color repaints the riveted submarine hull directly (default: Classic Yellow Sub
 * Gold) while keeping the clear glass nose dome, brass fittings, and periscope crisp.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended landing skids sit flush on the pad at y = 24, outer edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default submersible color: Classic Submarine Gold. */
export const MINI_SUB_YELLOW = 0xffc83d;

const GLASS = 0x163152;
const GLASS_SHINE = 0xa8e0ff;
const BRASS = 0xc99432;
const BRASS_DARK = 0x6b4b12;
const BRASS_HI = 0xffe48c;
const WARN = 0xff3b3b;

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.roundRect(-8.5, -9.2, 10.5, 5.2, 1.8);
  g.ellipse(0.0, 2.2, 20.5, 7.4);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.22);
  const deep = mix(color, 0x000000, 0.44);
  const hi = mix(color, 0xffffff, 0.55);

  // Rear tapered tailcone + horizontal stern dive planes.
  g.poly([-22.4, 0.6, -15.0, -2.0, -15.0, 6.4, -22.4, 3.8]).fill(shade);
  g.poly([-21.2, -3.4, -17.2, -2.2, -17.2, 6.6, -21.2, 7.8]).fill(BRASS);

  // Conning tower sail on top (x: -8.2..+2.0, y: -9.2..-3.6).
  g.roundRect(-8.2, -9.2, 10.2, 6.2, 2.0).fill(color).stroke({ width: 0.55, color: deep, alpha: 0.5 });
  g.moveTo(-7.0, -8.5).lineTo(0.8, -8.5).stroke({ width: 0.75, color: hi, alpha: 0.8, cap: 'round' });
  g.circle(-3.0, -6.4, 1.5).fill(GLASS).stroke({ width: 0.5, color: BRASS });

  // Main plump riveted submarine hull (x: -18.5..+18.5, y: -5.2..+9.4).
  g.ellipse(-1.2, 2.2, 19.2, 7.2).fill(color);
  // Lower ballast-tank shading.
  g.ellipse(-1.2, 5.4, 17.6, 3.6).fill({ color: shade, alpha: 0.85 });
  // Glossy crown highlight.
  g.moveTo(-13.5, -2.8).quadraticCurveTo(-1.0, -5.6, 10.5, -2.8).stroke({ width: 1.0, color: hi, alpha: 0.85, cap: 'round' });

  // Riveted hull band & small mid-hull brass porthole.
  g.moveTo(-16.5, 2.4).lineTo(10.5, 2.4).stroke({ width: 0.65, color: deep, alpha: 0.55 });
  for (let rx = -14.5; rx <= 8.5; rx += 3.2) {
    g.circle(rx, 1.2, 0.4).fill(deep);
  }
  g.circle(-7.5, 2.0, 2.3).fill(BRASS);
  g.circle(-7.5, 2.0, 1.75).fill(GLASS);
  g.moveTo(-8.4, 1.1).quadraticCurveTo(-7.5, 0.6, -6.6, 1.2).stroke({ width: 0.55, color: GLASS_SHINE, alpha: 0.75, cap: 'round' });

  // Crystal-clear front glass nose observation dome (passenger sits front-and-center here!).
  g.moveTo(9.8, -4.0)
    .bezierCurveTo(22.2, -4.0, 22.2, 8.2, 9.8, 8.2)
    .closePath()
    .fill({ color: GLASS, alpha: 0.9 });
  g.moveTo(9.8, -4.0)
    .bezierCurveTo(22.2, -4.0, 22.2, 8.2, 9.8, 8.2)
    .stroke({ width: 1.0, color: BRASS });
  g.moveTo(12.2, -2.4)
    .quadraticCurveTo(16.8, -1.8, 17.6, 1.6)
    .stroke({ width: 0.95, color: GLASS_SHINE, alpha: 0.72, cap: 'round' });
  // Brass nose collar ring framing the glass dome.
  g.rect(9.0, -4.4, 1.6, 13.0).fill(BRASS);
}

class MiniSubArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  /** Animated pop-up brass periscope rising out of the conning tower when gear deploys. */
  private periscope = new Graphics();
  /** Animated spinning rear brass propeller. */
  private prop = new Graphics();
  private warn = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.6, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.periscope, this.paint, this.prop);
  }

  /**
   * Fold-down brass landing skids resting flush on y = 24 (±20), synchronized with the
   * conning-tower periscope popping up smoothly as a tactile gear-lock cue!
   */
  setGear(p: number): void {
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;

    // Pop-up periscope rising smoothly from the conning tower top (-9.2 → -14.2).
    const per = this.periscope;
    per.clear();
    if (e > 0.05) {
      const topY = -9.0 - 4.8 * e;
      per.moveTo(-3.0, -8.8).lineTo(-3.0, topY).stroke({ width: 1.5, color: BRASS, cap: 'round' });
      per.roundRect(-3.6, topY - 1.1, 3.6, 1.8, 0.6).fill(BRASS_HI).stroke({ width: 0.35, color: BRASS_DARK });
      per.rect(-0.5, topY - 0.8, 0.7, 1.2).fill(GLASS_SHINE);
    }

    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const hy = 7.6;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    for (const s of [-1, 1]) {
      const hx = s * 9.0;
      const fx = s * (TAXI.feetHalfW - 5.5);
      const curX = hx + (fx - hx) * e;
      const fy = hy + (bottom - 2.4 - hy) * e;
      g.moveTo(hx, hy).lineTo(curX, fy).stroke({ width: 2.1, color: BRASS, cap: 'round' });
      g.moveTo(hx, hy)
        .lineTo(hx + (curX - hx) * 0.45, hy + (fy - hy) * 0.45)
        .stroke({ width: 3.0, color: BRASS_DARK, cap: 'round' });
      g.roundRect(curX - 5.5, fy, 11.0, 2.4, 1.0).fill(BRASS);
      g.roundRect(curX - 5.5, fy + 1.3, 11.0, 1.1, 0.5).fill(BRASS_DARK);
      if (locked) g.circle(curX, fy - 2.0, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.scars;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-10, 4.2).lineTo(-3, 5.2).stroke({ width: 0.6, color: 0x3b2808, alpha: 0.65 });
      }
      if (stage >= 2) {
        g.moveTo(12.2, -1.8).lineTo(15.2, 1.2).lineTo(13.6, 3.4).stroke({ width: 0.55, color: 0xe6f6ff, alpha: 0.85 });
        g.circle(-13, 3.6, 2.6).fill({ color: 0x161008, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(4, 5.6, 2.8).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(-4, -6.2, 2.2).fill({ color: 0x100b06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.warn.visible = stage === 4;
    }

    // Animate spinning rear brass propeller.
    const pr = this.prop;
    pr.clear();
    const h = 3.2 * Math.abs(Math.sin(time * (stage >= 3 ? 8 : 22)));
    pr.moveTo(-23.0, 2.2 - h).lineTo(-23.0, 2.2 + h).stroke({ width: 1.5, color: BRASS_HI, cap: 'round' });
    pr.circle(-22.6, 2.2, 1.0).fill(BRASS_DARK);

    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger front-and-center inside the clear glass nose observation dome. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(11.0, 2.4, 4.8, 2.0, 0.7).fill(look.shirt);
    g.circle(13.4, 0.7, 1.85).fill(look.skin);
    if (look.hat !== null) g.rect(11.6, -1.6, 3.6, 1.15).fill(look.hat);
  }
}

export const MINI_SUB: SkinDef = {
  id: 'miniSub',
  name: 'MINI SUB',
  playerColor: MINI_SUB_YELLOW,
  thrusters: {
    tail: { x: -23.6, y: 2.2 },
    nose: { x: 20.6, y: 2.2, scale: 0.75 },
    top: { x: -3.0, y: -9.2, scale: 0.8 },
    bottom: [
      { x: -6.5, y: 9.4 },
      { x: 5.5, y: 9.2 },
    ],
  },
  create: (color) => new MiniSubArt(color),
};
