/**
 * "BATH CAB": a glossy vinyl rubber duckie. Plump floating body with an upturned tail,
 * round head with a friendly eye and orange bill, sculpted flank wing, checkered cab collar,
 * a cozy recessed glass cockpit behind the head for passengers, and webbed orange duck feet
 * that swing down for landing gear.
 *
 * The body color tints the vinyl duck directly (default: bright rubber-duck yellow), so
 * players and rivals can fly crimson, cobalt, emerald, or hot-pink bath ducks.
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox; extended
 * webbed feet sit at the bottom of the feet box (y 24), outer edges at ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default vinyl body color: Classic Gold. */
export const BATH_CAB_YELLOW = 0xffc83d;
const BILL = 0xff7b1c;
const BILL_SHADE = 0xd65600;
const BILL_HI = 0xffb36b;
const EYE = 0x141724;
const GLASS = 0x1b2b4d;
const GLASS_SHINE = 0x7cb0ff;
const WARN = 0xff3b3b;

function silhouette(g: Graphics): Graphics {
  // Tail flick, plump body, head, and bill.
  g.poly([-23.2, -3.2, -16, -0.5, -16, 6.5, -21, 5.5]);
  g.ellipse(-2.5, 4.2, 17.5, 5.6);
  g.circle(10.5, -3.6, 6);
  g.ellipse(19.2, -2, 4.8, 2.4);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.18);
  const deep = mix(color, 0x000000, 0.36);
  const hi = mix(color, 0xffffff, 0.65);

  // Upturned duck tail on the rear left.
  g.moveTo(-23.2, -3.2)
    .quadraticCurveTo(-18.5, -2.5, -14.5, 0.5)
    .lineTo(-15.5, 7.2)
    .quadraticCurveTo(-21.5, 6.2, -23.2, -3.2)
    .closePath()
    .fill(color);

  // Recessed glass passenger cockpit behind the head.
  g.moveTo(-10.5, 1.2)
    .bezierCurveTo(-10.5, -7.2, 4.5, -7.2, 4.5, 1.2)
    .closePath()
    .fill(GLASS);
  g.moveTo(-10.5, 1.2)
    .bezierCurveTo(-10.5, -7.2, 4.5, -7.2, 4.5, 1.2)
    .stroke({ width: 0.9, color: deep, alpha: 0.7 });
  g.moveTo(-8.2, -1.6)
    .quadraticCurveTo(-6.2, -4.6, -2.5, -4.8)
    .stroke({ width: 0.9, color: GLASS_SHINE, alpha: 0.75, cap: 'round' });

  // Plump floating duck body.
  g.ellipse(-2.5, 4.2, 17.5, 5.6).fill(color);
  // Belly shading.
  g.ellipse(-2.5, 6.8, 15.2, 2.7).fill({ color: shade, alpha: 0.9 });

  // Orange bill at the nose (+x).
  g.ellipse(19.2, -2.1, 4.8, 2.2).fill(BILL);
  g.ellipse(19.2, -1.1, 4.3, 1.1).fill(BILL_SHADE);
  // Bill smile seam & glossy highlight.
  g.moveTo(15.2, -1.8).quadraticCurveTo(19.2, -1.1, 23.4, -1.9).stroke({ width: 0.55, color: 0x7a2b00, alpha: 0.75 });
  g.ellipse(18.6, -3.1, 2.3, 0.65).fill({ color: BILL_HI, alpha: 0.85 });

  // Round duck head.
  g.circle(10.5, -3.6, 6).fill(color);
  g.circle(10.5, -3.6, 6).stroke({ width: 0.6, color: deep, alpha: 0.35 });
  // Glossy vinyl crown highlight.
  g.moveTo(6.8, -6.8)
    .quadraticCurveTo(9.8, -8.8, 13.4, -7.2)
    .stroke({ width: 1.2, color: hi, alpha: 0.9, cap: 'round' });

  // Friendly eye with bright catchlight.
  g.circle(12.6, -4.4, 1.55).fill(EYE);
  g.circle(13.1, -5, 0.55).fill(0xffffff);

  // Checkered taxi collar around the neck/chest.
  for (let i = 0; i < 6; i++) {
    g.rect(4.6 + i * 1.9, 0.9 + (i % 2) * 1.1, 1.9, 1.1).fill(i % 2 === 0 ? EYE : 0xffffff);
  }

  // Sculpted teardrop wing on the flank.
  g.moveTo(-12.5, 2.4)
    .quadraticCurveTo(-3.5, 0.5, 3.2, 4.2)
    .quadraticCurveTo(-4.2, 8.2, -12.5, 5.4)
    .quadraticCurveTo(-14, 3.9, -12.5, 2.4)
    .closePath()
    .fill(mix(color, 0xffffff, 0.14));
  g.moveTo(-12.2, 5.2)
    .quadraticCurveTo(-4.2, 7.9, 2.8, 4.4)
    .stroke({ width: 0.8, color: deep, alpha: 0.55, cap: 'round' });
  g.moveTo(-10.5, 3.1)
    .quadraticCurveTo(-5, 2.2, -0.5, 3.6)
    .stroke({ width: 0.8, color: hi, alpha: 0.75, cap: 'round' });
}

class BathCabArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  private paint = new Graphics();
  private warn = new Graphics();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 4, color: WARN, alpha: 0.9 });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint);
  }

  /**
   * Two webbed orange duck feet swinging down from under the belly to stand flat on the pad.
   * Extended outer toe edge sits at ±feetHalfW (±20), bottom at y 24.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const hy = 7.5;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    for (const s of [-1, 1]) {
      const hx = s * 9;
      const reachX = TAXI.feetHalfW - 6 - Math.abs(hx);
      const reachY = bottom - 2.6 - hy;
      const from = Math.atan2(1, -s * 14);
      const to = Math.atan2(reachY, s * reachX);
      const a = from + (to - from) * e;
      const len = Math.hypot(reachX, reachY);
      const fx = hx + Math.cos(a) * len;
      const fy = hy + Math.sin(a) * len;

      // Duck leg.
      g.moveTo(hx, hy).lineTo(fx, fy).stroke({ width: 2.6, color: BILL, cap: 'round' });
      // Webbed foot pad (12u wide → outer edge at ±20).
      g.roundRect(fx - 6, fy, 12, 2.6, 1.3).fill(BILL);
      g.roundRect(fx - 6, fy + 1.5, 12, 1.1, 0.55).fill(BILL_SHADE);
      // Little webbed toe ridges.
      for (const tx of [-3.5, 0, 3.5]) {
        g.moveTo(fx + tx, fy + 0.3).lineTo(fx + tx, fy + 2.3).stroke({ width: 0.6, color: BILL_SHADE, alpha: 0.7 });
      }
      if (locked) g.circle(fx, fy - 2.2, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      // Stage 1: light scuff on the wing.
      if (stage >= 1) {
        g.moveTo(-8, 3.2).lineTo(-3.5, 4.6).stroke({ width: 0.7, color: 0x3a2810, alpha: 0.55, cap: 'round' });
      }
      // Stage 2: cartoon adhesive bandage on the flank + soot blotch.
      if (stage >= 2) {
        g.poly([-9.2, 2.1, -3.2, 4.1, -4.1, 6.4, -10.1, 4.4]).fill(0xf3d7b3);
        g.poly([-7.4, 2.7, -5.2, 3.4, -5.8, 5.7, -8, 5]).fill(0xe4be90);
        g.circle(-16, 4.5, 2.6).fill({ color: 0x1a1208, alpha: 0.45 });
      }
      // Stage 3: dizzy X-eye + extra scorch marks.
      if (stage >= 3) {
        g.circle(12.6, -4.4, 1.8).fill(0xffe033);
        g.moveTo(11.4, -5.6).lineTo(13.8, -3.2).stroke({ width: 0.9, color: EYE, cap: 'round' });
        g.moveTo(13.8, -5.6).lineTo(11.4, -3.2).stroke({ width: 0.9, color: EYE, cap: 'round' });
        g.circle(4, 6.2, 2.8).fill({ color: 0x120c06, alpha: 0.5 });
        g.circle(16, -2, 1.8).fill({ color: 0x120c06, alpha: 0.45 });
      }
      this.paint.tint = stage >= 3 ? 0xe8c4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.65 + 0.35 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger riding in the recessed bubble cockpit behind the duck's head. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-5.6, -1.6, 5.6, 2.2, 0.8).fill(look.shirt);
    g.circle(-2.8, -3.4, 1.9).fill(look.skin);
    if (look.hat !== null) g.rect(-4.9, -5.8, 4.2, 1.3).fill(look.hat);
  }
}

export const BATH_CAB: SkinDef = {
  id: 'bathCab',
  name: 'BATH CAB',
  playerColor: BATH_CAB_YELLOW,
  create: (color) => new BathCabArt(color),
};
