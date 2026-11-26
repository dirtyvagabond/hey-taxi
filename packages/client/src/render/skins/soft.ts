/**
 * "Soft Retro": the rounded take from the concept sheet. A domed cab with a split purple
 * window, a red tail fin, a lavender rear bumper, a hooked nose with a roof lamp, smooth
 * shading, and angled landing struts with flat foot pads.
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox; extended
 * pads sit at the bottom of the feet box (y 24), outer edges at ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

const WINDOW = 0x31204f;
const WINDOW_SHINE = 0x7a62c0;
const RED = 0xbd5a52;
const PURPLE = 0x8064b9;
const SLOT = 0x1b1426;
/** Default body color, from the concept sheet. */
export const SOFT_YELLOW = 0xf9e26c;

/** The dome's outline: a cubic arch from (x0, base) to (x1, base) peaking near `top`. */
function arch(g: Graphics, x0: number, x1: number, base: number, top: number): Graphics {
  const ctrl = base + ((top - base) * 4) / 3; // a cubic with both controls here peaks at `top`
  return g.moveTo(x0, base).bezierCurveTo(x0, ctrl, x1, ctrl, x1, base).closePath();
}

/** The whole silhouette (dome, hull, nose, bumper), for soot and the warning glow. */
function silhouette(g: Graphics): Graphics {
  arch(g, -17, 9, 3, -9.6);
  g.roundRect(-17, 0, 30, 10, 5);
  g.roundRect(4, -1, 20, 10, 5);
  g.roundRect(-24, 1, 11, 8, 3.5);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.16);
  const deep = mix(color, 0x000000, 0.4);
  const shine = mix(color, 0xffffff, 0.65);
  // Tail fin, behind everything.
  g.ellipse(-12, -2, 11, 7.5).fill(RED);
  g.ellipse(-14, 1, 8, 4).fill({ color: 0x000000, alpha: 0.12 });
  // Rear bumper.
  g.roundRect(-24, 1, 11, 8, 3.5).fill(PURPLE);
  g.roundRect(-24, 5.5, 11, 3.5, 1.75).fill(mix(PURPLE, 0x000000, 0.2));
  // Hull and nose, shaded underneath.
  g.roundRect(-17, 0, 30, 10, 5).fill(color);
  g.roundRect(4, -1, 20, 10, 5).fill(color);
  g.roundRect(-16, 6.5, 38, 3.5, 1.75).fill(shade);
  // The nose's slot (the hook under the lamp).
  g.roundRect(9.5, 3.6, 6.5, 1.8, 0.9).fill(SLOT);
  // Dome.
  arch(g, -17, 9, 3, -9.6).fill(color);
  arch(g, -17, 9, 3, -9.6).stroke({ width: 0.8, color: deep, alpha: 0.45 });
  // Split window with shine.
  arch(g, -14, 6, 1.6, -6.8).fill(WINDOW);
  g.rect(-4.6, -7.4, 1.4, 9.2).fill(color);
  g.moveTo(-11.5, -2.2).quadraticCurveTo(-10.6, -5.2, -7.6, -5.9).stroke({ width: 1.1, color: WINDOW_SHINE, cap: 'round' });
  g.moveTo(-0.6, -5.9).quadraticCurveTo(2.4, -5.4, 3.6, -2.6).stroke({ width: 1.1, color: WINDOW_SHINE, cap: 'round' });
  // Highlights: dome rim and nose.
  g.moveTo(-14.2, -3.2).quadraticCurveTo(-11, -9, -3.6, -8.9).stroke({ width: 1.1, color: shine, alpha: 0.9, cap: 'round' });
  g.roundRect(17, 0.6, 5, 1.4, 0.7).fill({ color: shine, alpha: 0.85 });
  // Red side panel.
  g.roundRect(-12.5, 3, 6, 3.2, 1).fill(RED);
  // Roof lamp on the nose.
  g.roundRect(11.5, -4.6, 6.5, 4, 1.8).fill(color);
  g.rect(11.5, -3.3, 6.5, 1.4).fill(PURPLE);
  g.roundRect(12.3, -4.4, 4.9, 0.9, 0.45).fill({ color: shine, alpha: 0.9 });
}

class SoftArt implements SkinArt {
  readonly gear = new Graphics();
  /** The paint, with the last-point glow behind it (so only the outer edge shows). */
  readonly body = new Container();
  private paint = new Graphics();
  private glow = new Graphics();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private scarStage: HullStage | -1 = -1;
  private riderKind: number | null = null;
  private strut: number;
  private pad: number;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.glow).stroke({ width: 4, color: 0xff3b3b, alpha: 1 });
    this.glow.visible = false;
    this.body.addChild(this.glow, this.paint);
    this.strut = mix(color, 0x000000, 0.06);
    this.pad = color;
  }

  /**
   * Two angled struts, hinged inside the hull. Retracted, each lies folded inward behind
   * the hull; extending swings it down and outward until its pad rests on the ground line.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const hy = 6;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    for (const s of [-1, 1]) {
      const hx = s * 9;
      // Extended: the pad's center 6u inside the feet edge, its top 3u above the ground.
      const reachX = TAXI.feetHalfW - 6 - Math.abs(hx);
      const reachY = bottom - 3 - hy;
      const from = Math.atan2(1, -s * 15); // folded inward
      const to = Math.atan2(reachY, s * reachX);
      const a = from + (to - from) * e;
      const len = Math.hypot(reachX, reachY);
      const fx = hx + Math.cos(a) * len;
      const fy = hy + Math.sin(a) * len;
      g.moveTo(hx, hy).lineTo(fx, fy).stroke({ width: 2.6, color: this.strut, cap: 'round' });
      g.roundRect(fx - 6, fy, 12, 3, 1.5).fill(this.pad);
      g.roundRect(fx - 6, fy + 1.8, 12, 1.2, 0.6).fill({ color: 0x000000, alpha: 0.18 });
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.scarStage) {
      this.scarStage = stage;
      g.clear();
      g.alpha = 1;
      // Soot darkens the paint evenly (a translucent overlay would double up where the
      // rounded parts overlap).
      this.paint.tint = stage >= 3 ? 0xd1d1d1 : stage === 2 ? 0xe6e6e6 : 0xffffff;
      if (stage >= 2) {
        const blot = (x: number, y: number, r: number) => {
          g.circle(x, y, r).fill({ color: 0x1a1208, alpha: 0.55 });
          g.circle(x + r * 0.5, y - r * 0.3, r * 0.55).fill({ color: 0x000000, alpha: 0.45 });
        };
        blot(-15, 5, 3.5);
        blot(-9, 7.5, 2.3);
        if (stage >= 3) {
          blot(18, 5, 4);
          blot(11, 7, 2.4);
          blot(-12, -4, 2.2);
          g.moveTo(-1, -9).lineTo(2, -6).lineTo(0, -3).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
        }
      }
      this.glow.visible = stage === 4;
    }
    if (stage === 4) this.glow.alpha = 0.75 + 0.25 * Math.abs(Math.sin(time * 5));
  }

  /** A passenger in the front pane. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-1.6, -1.2, 6.4, 2.6, 1).fill(look.shirt);
    g.circle(1.6, -3.4, 2.3).fill(look.skin);
    if (look.hat !== null) g.rect(-0.7, -6, 4.6, 1.5).fill(look.hat);
  }
}

export const SOFT_RETRO: SkinDef = {
  id: 'softRetro',
  name: 'Soft Retro',
  playerColor: SOFT_YELLOW,
  create: (color) => new SoftArt(color),
};
