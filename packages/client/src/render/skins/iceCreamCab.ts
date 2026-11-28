/**
 * "ICE CREAM CAB": a cheerful 1980s neighborhood ice-cream step-van. Boxy cream-white upper
 * cab over a paint-tinted pastel lower body, a giant fixed waffle cone with vanilla/pink
 * swirl scoop and cherry mounted on the roof, a red-and-white striped awning over the open
 * serving window (where the passenger rides), chrome bumpers, and retro white-rimmed tires
 * dropping straight onto the landing pad.
 *
 * The body color repaints the lower van body & pastel trim stripe (default: Strawberry Pink)
 * while keeping the cream upper cab, roof waffle cone, striped awning, and tires fixed.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended tires sit flush on the pad at y = 24 inside ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default lower-body color: pastel Strawberry Pink. */
export const ICE_CREAM_PINK = 0xff7eb3;

const CREAM = 0xfaf5eb;
const CREAM_SHADE = 0xe3dac8;
const CONE = 0xd99b4e;
const CONE_DARK = 0xa36c2a;
const SCOOP_PINK = 0xffa6c9;
const CHERRY = 0xe62634;
const AWNING_RED = 0xe63946;
const GLASS = 0x182b47;
const GLASS_SHINE = 0xa8d8ff;
const CHROME = 0xe2e9f7;
const CHROME_DARK = 0x7b869e;
const TIRE = 0x151820;
const HEADLIGHT = 0xfff4b8;
const TAIL_RED = 0xe62e3d;
const WARN = 0xff3b3b;

const AXLES: readonly number[] = [-12.6, 12.6];
const WHEEL_R = 3.8;
const ARCH_Y = 6.6;
const ARCH_R = 4.4;
const ARCH_ANGLE = Math.asin((8.0 - ARCH_Y) / ARCH_R);

/** Boxy neighborhood ice-cream step-van silhouette with open wheel arches along y = 8.0. */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-18.8, -6.4)
    .lineTo(13.6, -6.4)
    .quadraticCurveTo(15.6, -6.4, 16.4, -4.4)
    .lineTo(17.6, -0.4)
    .lineTo(19.8, 0.2)
    .quadraticCurveTo(20.8, 0.6, 20.8, 2.0)
    .lineTo(20.8, 6.8)
    .quadraticCurveTo(20.8, 8.0, 19.4, 8.0)
    // Open front wheel arch.
    .arc(AXLES[1]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    // Open rear wheel arch.
    .arc(AXLES[0]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    .lineTo(-18.8, 8.0)
    .quadraticCurveTo(-20.4, 8.0, -20.4, 6.4)
    .lineTo(-20.4, -4.8)
    .quadraticCurveTo(-20.4, -6.4, -18.8, -6.4)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.18);
  const deep = mix(color, 0x000000, 0.38);

  // --- 1. Giant fixed roof ice-cream cone sign (y: -9.8..-6.2) ---
  // Waffle cone tilted slightly back like a classic truck rooftop sign.
  g.poly([-5.6, -6.4, -0.4, -6.4, -3.0, -9.2]).fill(CONE).stroke({ width: 0.4, color: CONE_DARK });
  // Creamy ice-cream scoops + red cherry on top.
  g.circle(-3.8, -8.3, 1.5).fill(CREAM);
  g.circle(-2.0, -8.3, 1.45).fill(SCOOP_PINK);
  g.circle(-2.9, -9.1, 1.25).fill(CREAM);
  g.circle(-2.9, -9.7, 0.55).fill(CHERRY);
  // Roof mounting base.
  g.roundRect(-6.8, -6.9, 7.6, 0.7, 0.3).fill(CHROME_DARK);

  // --- 2. Boxy cream-white upper + pastel lower step-van body ---
  silhouette(g).fill(CREAM);
  g.poly([-20.4, 1.2, 20.8, 1.2, 20.8, 6.8, 19.4, 8.0, -18.8, 8.0, -20.4, 6.4]).fill(color);
  // Re-shade lower rocker between arches.
  g.rect(-8.0, 4.8, 16.0, 3.2).fill({ color: shade, alpha: 0.75 });
  // Pastel waist stripe + roof highlight.
  g.rect(-20.4, 0.4, 41.2, 0.9).fill(mix(color, 0xffffff, 0.35));
  g.moveTo(-18.2, -5.9).lineTo(13.2, -5.9).stroke({ width: 0.8, color: 0xffffff, alpha: 0.9, cap: 'round' });

  // --- 3. Wide open serving window (passenger sits here) + red/white striped awning ---
  g.roundRect(-12.6, -4.6, 12.2, 4.6, 0.8).fill(GLASS).stroke({ width: 0.55, color: CREAM_SHADE });
  // Serving counter ledge.
  g.roundRect(-13.2, -0.3, 13.4, 1.0, 0.4).fill(CHROME);
  // Scalloped red-and-white striped awning over the serving window.
  for (let i = 0; i < 6; i++) {
    g.rect(-13.0 + i * 2.15, -5.6, 2.15, 1.5).fill(i % 2 === 0 ? AWNING_RED : 0xffffff);
  }
  g.moveTo(-13.0, -5.6).lineTo(-0.1, -5.6).stroke({ width: 0.45, color: CHROME_DARK });

  // Small colorful popsicle/menu squares on the rear panel.
  g.roundRect(-18.6, -4.4, 4.2, 3.6, 0.5).fill(0xffffff).stroke({ width: 0.35, color: deep, alpha: 0.5 });
  g.rect(-17.8, -3.7, 1.0, 1.8).fill(SCOOP_PINK);
  g.rect(-16.1, -3.7, 1.0, 1.8).fill(0x5ee0b0);

  // Front step-van windshield & cab window.
  g.poly([7.8, -5.0, 14.2, -5.0, 16.6, -0.4, 7.8, -0.4]).fill(GLASS);
  g.moveTo(9.0, -4.2).lineTo(13.2, -4.2).stroke({ width: 0.7, color: GLASS_SHINE, alpha: 0.65, cap: 'round' });
  g.moveTo(6.6, -5.6).lineTo(6.6, 7.2).stroke({ width: 0.45, color: deep, alpha: 0.45 });

  // Chrome bumpers, round headlight, and rear taillight.
  g.roundRect(19.6, 5.2, 2.2, 2.3, 0.7).fill(CHROME).stroke({ width: 0.35, color: CHROME_DARK });
  g.roundRect(-21.6, 5.2, 2.2, 2.3, 0.7).fill(CHROME).stroke({ width: 0.35, color: CHROME_DARK });
  g.circle(20.0, 2.5, 1.2).fill(HEADLIGHT).stroke({ width: 0.4, color: CHROME });
  g.roundRect(-20.6, 2.2, 1.1, 2.2, 0.35).fill(TAIL_RED);
}

/** Retro tire with cream rim & chrome center cap. */
function drawWheel(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r).fill(TIRE);
  g.circle(x, y, r * 0.56).fill(CREAM);
  g.circle(x, y, r * 0.3).fill(CHROME);
  g.circle(x, y, r * 0.14).fill(CHROME_DARK);
}

class IceCreamCabArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  private warn = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.5, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint);
    this.setGear(0);
  }

  /** Tires tucked in the wheel arches in flight and dropping straight onto y = 24. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = TAXI.halfH - WHEEL_R; // 6.2
    const downY = bottom - WHEEL_R; // 20.2 (flush on y = 24)
    const wy = restY + (downY - restY) * e;
    const mountY = ARCH_Y - ARCH_R + 0.8;

    for (const ax of AXLES) {
      if (e > 0.02) {
        g.moveTo(ax, mountY).lineTo(ax, wy).stroke({ width: 1.5, color: CHROME });
        g.moveTo(ax, mountY).lineTo(ax, mountY + Math.min(wy - mountY, 5.5)).stroke({ width: 2.7, color: 0x222633 });
        const braceX = ax < 0 ? ax + 3.2 : ax - 3.2;
        g.moveTo(braceX, mountY + 0.8).lineTo(ax, wy - 1.5).stroke({ width: 1.0, color: CHROME_DARK });
      }
      drawWheel(g, ax, wy, WHEEL_R);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-6, 3.0).lineTo(1, 4.0).stroke({ width: 0.6, color: 0x2a1a22, alpha: 0.6, cap: 'round' });
      }
      if (stage >= 2) {
        g.moveTo(9.2, -4.4).lineTo(12.2, -2.0).lineTo(14.0, -0.8).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(-14.5, 4.2, 2.5).fill({ color: 0x161008, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(15.2, 3.6, 2.8).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(-4.0, 4.6, 2.6).fill({ color: 0x100b06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger peeking right out of the ice-cream serving window! */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-9.2, -2.0, 5.2, 1.6, 0.5).fill(look.shirt);
    g.circle(-6.6, -3.5, 1.65).fill(look.skin);
    if (look.hat !== null) g.rect(-8.4, -5.5, 3.6, 1.05).fill(look.hat);
  }
}

export const ICE_CREAM_CAB: SkinDef = {
  id: 'iceCreamCab',
  name: 'ICE CREAM CAB',
  playerColor: ICE_CREAM_PINK,
  thrusters: {
    tail: { x: -21.6, y: 4.0 },
    nose: { x: 21.8, y: 4.0 },
    top: { x: 2.0, y: -6.4 },
    bottom: [
      { x: -5.5, y: 8.2 },
      { x: 5.5, y: 8.2 },
    ],
  },
  create: (color) => new IceCreamCabArt(color),
};
