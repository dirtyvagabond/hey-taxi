/**
 * "SURF BUS": a classic two-tone vintage split-window beach microbus. Cream-white upper
 * greenhouse with four rounded side windows (passenger visible in the front cab window),
 * paint-colored lower body with an iconic V-dipped front nose seam, chrome bumpers, round
 * vintage headlight, a contrasting striped surfboard strapped onto a chrome roof rack, and
 * whitewall tires with chrome hubcaps dropping straight onto the landing pad.
 *
 * The body color repaints the lower microbus body directly (default: coastal Seafoam Teal)
 * while keeping the cream upper greenhouse, striped surfboard, chrome trim, and whitewall
 * tires crisp and unbranded.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended whitewall tires sit flush on the pad at y = 24 inside ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default lower-body color: vintage coastal Seafoam Teal. */
export const SURF_BUS_TEAL = 0x36c9b8;

const CREAM = 0xf4f0e4;
const CREAM_SHADE = 0xdad3c0;
const GLASS = 0x162945;
const GLASS_SHINE = 0xa8d8ff;
const CHROME = 0xe2e9f7;
const CHROME_DARK = 0x7b869e;
const BOARD_BASE = 0xffc83d;
const BOARD_STRIPE = 0xff4d6d;
const TIRE = 0x151820;
const WHITEWALL = 0xf0f4fc;
const HEADLIGHT = 0xfff4b8;
const TAIL_RED = 0xe62e3d;
const WARN = 0xff3b3b;

const AXLES: readonly number[] = [-12.8, 12.8];
const WHEEL_R = 3.8;
const ARCH_Y = 6.6;
const ARCH_R = 4.4;
const ARCH_ANGLE = Math.asin((8.0 - ARCH_Y) / ARCH_R);

/** Rounded flat-front vintage microbus silhouette with open wheel arches along y = 8.0. */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-17.0, -7.2)
    .lineTo(15.2, -7.2)
    .quadraticCurveTo(19.2, -7.2, 20.2, -2.0)
    .lineTo(20.6, 6.4)
    .quadraticCurveTo(20.6, 8.0, 19.0, 8.0)
    // Open front wheel arch.
    .arc(AXLES[1]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    // Open rear wheel arch.
    .arc(AXLES[0]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    .lineTo(-18.6, 8.0)
    .quadraticCurveTo(-20.4, 8.0, -20.4, 6.2)
    .lineTo(-20.2, -3.2)
    .quadraticCurveTo(-20.0, -7.2, -17.0, -7.2)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.2);
  const deep = mix(color, 0x000000, 0.42);
  const hi = mix(color, 0xffffff, 0.5);

  // --- 1. Chrome roof rack + striped surfboard strapped on top (y: -9.8..-7.2) ---
  g.moveTo(-13.5, -7.2).lineTo(-13.5, -8.2).stroke({ width: 0.9, color: CHROME_DARK });
  g.moveTo(8.5, -7.2).lineTo(8.5, -8.2).stroke({ width: 0.9, color: CHROME_DARK });
  g.moveTo(-14.5, -8.0).lineTo(9.5, -8.0).stroke({ width: 0.7, color: CHROME });
  // Sleek surfboard pointing forward (+x) with contrasting sunset racing stripe.
  g.moveTo(-17.5, -8.8)
    .quadraticCurveTo(-2.0, -10.3, 14.5, -8.8)
    .quadraticCurveTo(-2.0, -7.7, -17.5, -8.8)
    .closePath()
    .fill(BOARD_BASE)
    .stroke({ width: 0.4, color: 0x996b14 });
  g.moveTo(-15.5, -8.8).lineTo(12.2, -8.8).stroke({ width: 0.7, color: BOARD_STRIPE, cap: 'round' });
  // Little roof fin & tie-down straps.
  g.poly([-15.8, -8.3, -13.2, -8.3, -14.8, -7.4]).fill(BOARD_STRIPE);
  g.rect(-10.5, -9.5, 0.85, 1.6).fill(0x222633);
  g.rect(5.5, -9.5, 0.85, 1.6).fill(0x222633);

  // --- 2. Two-tone vintage microbus hull (cream upper + paint-colored lower) ---
  silhouette(g).fill(CREAM);
  // Lower painted body below the classic horizontal beltline (y = 0.0).
  g.poly([
    -20.3, 0.0, 20.4, 0.0, 20.6, 6.4, 19.0, 8.0,
    -18.6, 8.0, -20.4, 6.2,
  ]).fill(color);
  // Re-cut wheel arch interiors clean via shading strips between arches.
  g.rect(-8.2, 4.4, 16.4, 3.6).fill({ color: shade, alpha: 0.75 });

  // Classic cream roof highlight & chrome beltline trim molding.
  g.moveTo(-16.2, -6.6).lineTo(14.8, -6.6).stroke({ width: 0.85, color: 0xffffff, alpha: 0.85, cap: 'round' });
  g.moveTo(-20.3, 0.0).lineTo(20.4, 0.0).stroke({ width: 0.9, color: CHROME });
  g.moveTo(-20.3, 0.65).lineTo(20.4, 0.65).stroke({ width: 0.45, color: hi, alpha: 0.7 });

  // --- 3. Four rounded vintage side windows (front cab window frames the passenger) ---
  for (const wx of [-17.4, -10.4, -3.4, 3.6] as const) {
    g.roundRect(wx, -5.6, 5.4, 4.4, 1.2).fill(GLASS).stroke({ width: 0.45, color: CREAM_SHADE });
    g.moveTo(wx + 0.9, -4.7).lineTo(wx + 2.8, -4.7).stroke({ width: 0.6, color: GLASS_SHINE, alpha: 0.55, cap: 'round' });
  }
  // Curved front split-windshield wrap on the nose (+x).
  g.poly([11.0, -5.6, 16.4, -5.6, 19.4, -1.2, 11.0, -1.2]).fill(GLASS);
  g.moveTo(12.4, -4.8).lineTo(15.6, -4.8).stroke({ width: 0.7, color: GLASS_SHINE, alpha: 0.65, cap: 'round' });

  // Subtle rear engine cooling louvers + door seams.
  for (let i = 0; i < 3; i++) {
    g.rect(-19.2, 1.8 + i * 1.1, 3.2, 0.45).fill(deep);
  }
  g.moveTo(10.0, -6.2).lineTo(10.0, 7.2).stroke({ width: 0.45, color: deep, alpha: 0.45 });

  // Chrome bumpers, round vintage headlight, and rear taillight.
  g.roundRect(19.2, 5.2, 2.4, 2.3, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.roundRect(-21.6, 5.2, 2.4, 2.3, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.circle(20.0, 2.6, 1.35).fill(HEADLIGHT).stroke({ width: 0.45, color: CHROME });
  g.roundRect(-20.6, 2.6, 1.1, 2.2, 0.35).fill(TAIL_RED);
}

/** Classic whitewall tire with chrome moon hubcap. */
function drawWhitewall(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r).fill(TIRE);
  g.circle(x, y, r * 0.72).stroke({ width: 0.8, color: WHITEWALL });
  g.circle(x, y, r * 0.46).fill(CHROME);
  g.circle(x, y, r * 0.22).fill(CHROME_DARK);
}

class SurfBusArt implements SkinArt {
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

  /** Whitewall tires tucked into the arches in flight and dropping straight onto y = 24. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = TAXI.halfH - WHEEL_R; // 6.2 (tucked, bottom at +10)
    const downY = bottom - WHEEL_R; // 20.2 (whitewall flush on y = 24)
    const wy = restY + (downY - restY) * e;
    const mountY = ARCH_Y - ARCH_R + 0.8;

    for (const ax of AXLES) {
      if (e > 0.02) {
        g.moveTo(ax, mountY).lineTo(ax, wy).stroke({ width: 1.5, color: CHROME });
        g.moveTo(ax, mountY).lineTo(ax, mountY + Math.min(wy - mountY, 5.5)).stroke({ width: 2.7, color: 0x222633 });
        const braceX = ax < 0 ? ax + 3.2 : ax - 3.2;
        g.moveTo(braceX, mountY + 0.8).lineTo(ax, wy - 1.5).stroke({ width: 1.0, color: CHROME_DARK });
      }
      drawWhitewall(g, ax, wy, WHEEL_R);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-6.0, 2.4).lineTo(-1.0, 3.2).stroke({ width: 0.6, color: 0x161210, alpha: 0.6, cap: 'round' });
      }
      if (stage >= 2) {
        g.moveTo(12.2, -5.0).lineTo(15.2, -2.5).lineTo(17.4, -1.4).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(-14.5, 3.6, 2.5).fill({ color: 0x161008, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(15.5, 3.2, 2.8).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(-8.0, 4.4, 2.6).fill({ color: 0x100b06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger peeking out of the front side window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(4.3, -2.4, 4.0, 1.3, 0.45).fill(look.shirt);
    g.circle(6.3, -3.7, 1.45).fill(look.skin);
    if (look.hat !== null) g.rect(4.9, -5.5, 2.8, 0.95).fill(look.hat);
  }
}

export const SURF_BUS: SkinDef = {
  id: 'surfBus',
  name: 'SURF BUS',
  playerColor: SURF_BUS_TEAL,
  thrusters: {
    tail: { x: -21.6, y: 4.0 },
    nose: { x: 21.6, y: 4.0 },
    top: { x: -2.0, y: -9.4 },
    bottom: [
      { x: -5.5, y: 8.2 },
      { x: 5.5, y: 8.2 },
    ],
  },
  create: (color) => new SurfBusArt(color),
};
