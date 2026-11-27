/**
 * "Jet Retro": a rounded atomic-age bubble-cab with a cubic-arch dome, split tinted glass,
 * hooked nose with a warm glowing roof lamp, brushed chrome side spear, tapered jet tailcone
 * with a metallic thruster nozzle, smooth shading, and hinged folding landing struts.
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox; extended pads
 * sit at the bottom of the feet box (y 24), outer edges at ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

const WINDOW = 0x262142;
const WINDOW_SHINE = 0x9aa8d9;
const SLOT = 0x181724;
const CHROME_HI = 0xe8eefc;
const CHROME_MID = 0xa7b3cc;
const CHROME_DARK = 0x56607a;
const LAMP_WARM = 0xffe48a;
const LAMP_CORE = 0xfff8d6;

/** Default body color: Crimson. */
export const JET_RETRO_COLOR = 0xff4d6d;

/** The dome's outline: a cubic arch from (x0, base) to (x1, base) peaking near `top`. */
function arch(g: Graphics, x0: number, x1: number, base: number, top: number): Graphics {
  const ctrl = base + ((top - base) * 4) / 3;
  return g.moveTo(x0, base).bezierCurveTo(x0, ctrl, x1, ctrl, x1, base).closePath();
}

/** Tapered jet tailcone joining the rear of the cab cleanly to the thruster collar. */
function tailcone(g: Graphics): Graphics {
  return g
    .moveTo(-10, -2.6)
    .quadraticCurveTo(-16.5, -1.8, -20.5, 1.8)
    .lineTo(-20.5, 7.2)
    .quadraticCurveTo(-16.5, 9.6, -10, 9.8)
    .closePath();
}

/** The whole silhouette (tailcone, nozzle, dome, hull, nose), for the stage-4 warning glow. */
function silhouette(g: Graphics): Graphics {
  tailcone(g);
  g.roundRect(-24, 1.9, 4.5, 5.2, 1.5);
  arch(g, -16, 9, 3, -9.6);
  g.roundRect(-15, 0, 28, 10, 5);
  g.roundRect(4, -1, 20, 10, 5);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.16);
  const deep = mix(color, 0x000000, 0.38);
  const shine = mix(color, 0xffffff, 0.65);

  // Brushed chrome thruster nozzle bell (behind tailcone collar).
  g.moveTo(-20, 1.8).lineTo(-24, 2.3).lineTo(-24, 6.7).lineTo(-20, 7.2).closePath().fill(CHROME_MID);
  g.moveTo(-20, 1.8).lineTo(-24, 2.3).lineTo(-24, 3.6).lineTo(-20, 3.4).closePath().fill({ color: CHROME_HI, alpha: 0.7 });
  g.moveTo(-20, 5.6).lineTo(-24, 5.4).lineTo(-24, 6.7).lineTo(-20, 7.2).closePath().fill({ color: CHROME_DARK, alpha: 0.75 });
  g.roundRect(-24, 2.7, 1.3, 3.6, 0.6).fill(0x13111f);

  // Tapered jet tailcone.
  tailcone(g).fill(color);
  g.moveTo(-10, 6.6).lineTo(-20.3, 5.8).lineTo(-20.5, 7.2).quadraticCurveTo(-16.5, 9.6, -10, 9.8).closePath().fill(shade);
  g.moveTo(-11.5, -1.6).quadraticCurveTo(-16, -0.9, -19.2, 1.6).stroke({ width: 1, color: shine, alpha: 0.75, cap: 'round' });

  // Chrome thruster collar ring.
  g.roundRect(-21.2, 1.4, 2.1, 6.2, 1).fill(CHROME_HI);
  g.roundRect(-21.2, 5.1, 2.1, 2.5, 0.9).fill({ color: CHROME_DARK, alpha: 0.55 });

  // Main rounded hull and hooked nose.
  g.roundRect(-15, 0, 28, 10, 5).fill(color);
  g.roundRect(4, -1, 20, 10, 5).fill(color);
  g.roundRect(-14, 6.5, 36, 3.5, 1.75).fill(shade);

  // Sleek brushed-chrome side spear.
  g.moveTo(-18.5, 4.3)
    .lineTo(6.5, 4.3)
    .lineTo(8.5, 5.1)
    .lineTo(6.5, 5.9)
    .lineTo(-18.5, 5.9)
    .closePath()
    .fill(CHROME_MID);
  g.moveTo(-18, 4.5).lineTo(6.2, 4.5).stroke({ width: 0.7, color: CHROME_HI, cap: 'round' });

  // Nose intake slot.
  g.roundRect(10.5, 3.4, 6, 1.6, 0.8).fill(SLOT);

  // Bubble dome.
  arch(g, -16, 9, 3, -9.6).fill(color);
  arch(g, -16, 9, 3, -9.6).stroke({ width: 0.8, color: deep, alpha: 0.45 });

  // Split tinted window with curved specular shine.
  arch(g, -13, 6, 1.6, -6.8).fill(WINDOW);
  g.rect(-4.2, -7.4, 1.4, 9.2).fill(color);
  g.moveTo(-10.8, -2.2).quadraticCurveTo(-9.9, -5.2, -7, -5.9).stroke({ width: 1.1, color: WINDOW_SHINE, cap: 'round' });
  g.moveTo(-0.4, -5.9).quadraticCurveTo(2.4, -5.4, 3.6, -2.6).stroke({ width: 1.1, color: WINDOW_SHINE, cap: 'round' });

  // Dome rim and nose highlights.
  g.moveTo(-13.4, -3.2).quadraticCurveTo(-10.2, -9, -3.2, -8.9).stroke({ width: 1.1, color: shine, alpha: 0.9, cap: 'round' });
  g.roundRect(17, 0.6, 5, 1.4, 0.7).fill({ color: shine, alpha: 0.85 });

  // Chrome-bezel roof lamp with warm glowing core.
  g.roundRect(11.3, -4.6, 6.9, 4.1, 1.9).fill(CHROME_MID);
  g.roundRect(11.8, -4.2, 5.9, 2.7, 1.3).fill(LAMP_WARM);
  g.roundRect(12.6, -3.9, 4.3, 1.1, 0.55).fill(LAMP_CORE);
  g.roundRect(11.3, -1.5, 6.9, 1, 0.5).fill(CHROME_DARK);
}

class JetRetroArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  private paint = new Graphics();
  private glow = new Graphics();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private scarStage: HullStage | -1 = -1;
  private riderKind: number | null = null;
  private pad: number;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.glow).stroke({ width: 4, color: 0xff3b3b, alpha: 1 });
    this.glow.visible = false;
    this.body.addChild(this.glow, this.paint);
    this.pad = color;
  }

  /** Two angled chrome struts, hinged inside the hull, folding down smoothly onto the ground line. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const hy = 6;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    for (const s of [-1, 1]) {
      const hx = s * 9;
      const reachX = TAXI.feetHalfW - 6 - Math.abs(hx);
      const reachY = bottom - 3 - hy;
      const from = Math.atan2(1, -s * 15);
      const to = Math.atan2(reachY, s * reachX);
      const a = from + (to - from) * e;
      const len = Math.hypot(reachX, reachY);
      const fx = hx + Math.cos(a) * len;
      const fy = hy + Math.sin(a) * len;
      g.moveTo(hx, hy).lineTo(fx, fy).stroke({ width: 2.6, color: CHROME_MID, cap: 'round' });
      g.roundRect(fx - 6, fy, 12, 3, 1.5).fill(this.pad);
      g.roundRect(fx - 6, fy + 1.8, 12, 1.2, 0.6).fill({ color: 0x000000, alpha: 0.18 });
      if (locked) g.circle(fx, fy - 2.2, 1.15).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.scarStage) {
      this.scarStage = stage;
      g.clear();
      g.alpha = 1;
      this.paint.tint = stage >= 3 ? 0xd1d1d1 : stage === 2 ? 0xe6e6e6 : 0xffffff;
      if (stage >= 2) {
        const blot = (x: number, y: number, r: number) => {
          g.circle(x, y, r).fill({ color: 0x1a1208, alpha: 0.55 });
          g.circle(x + r * 0.5, y - r * 0.3, r * 0.55).fill({ color: 0x000000, alpha: 0.45 });
        };
        blot(-14, 5, 3.4);
        blot(-8, 7.5, 2.3);
        if (stage >= 3) {
          blot(18, 5, 4);
          blot(11, 7, 2.4);
          blot(-12, -3.5, 2.2);
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

export const JET_RETRO: SkinDef = {
  id: 'jetRetro',
  name: 'Jet Retro',
  playerColor: JET_RETRO_COLOR,
  thrusters: {
    tail: { x: -24, y: 4.5 },
    nose: { x: 24, y: 4 },
    top: { x: -3.5, y: -9.5 },
  },
  create: (color) => new JetRetroArt(color),
};
