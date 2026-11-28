/**
 * "WOODY WAGON": a classic 1970s/80s family road-trip station wagon. Boxy long-roof wagon
 * body with fixed fake-woodgrain side paneling and warm tan trim, chrome bumpers, three big
 * side windows (passenger visible in the middle window), a chrome roof luggage rack piled
 * with strapped vintage suitcases, and whitewall tires with chrome hubcaps dropping directly
 * onto the landing pad.
 *
 * The body color repaints the wagon roof, pillars, and hood (default: classic 70s sage-green)
 * while keeping the faux-woodgrain side panels, chrome trim, roof suitcases, and whitewall
 * tires fixed so every swatch and rival color keeps that unmistakable retro woody charm.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended whitewall tires sit flush on the pad at y = 24 inside ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default body color: classic 1970s road-trip sage-green. */
export const WOODY_SAGE = 0x7aa66a;

const WOOD_BASE = 0x8a5126;
const WOOD_GRAIN = 0x613515;
const WOOD_TRIM = 0xd9b37c;
const GLASS = 0x17263d;
const GLASS_SHINE = 0xa4d0ff;
const CHROME = 0xdce4f2;
const CHROME_DARK = 0x7b869e;
const TIRE = 0x151820;
const WHITEWALL = 0xeff3fa;
const BAG_TAN = 0xc98c4a;
const BAG_TEAL = 0x3b8c9e;
const BAG_RED = 0xc93b42;
const HEADLIGHT = 0xfff2b2;
const TAIL_RED = 0xe62e3d;
const WARN = 0xff3b3b;

const AXLES: readonly number[] = [-13.4, 13.4];
const WHEEL_R = 3.8;
const ARCH_Y = 6.6;
const ARCH_R = 4.4;
const ARCH_ANGLE = Math.asin((8.0 - ARCH_Y) / ARCH_R);

/** Long-roof 1970s station wagon silhouette with open wheel arches along y = 8.0. */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-20.4, -6.2)
    .lineTo(4.2, -6.2)
    .lineTo(7.4, -1.0)
    .lineTo(20.6, -0.5)
    .quadraticCurveTo(22.0, -0.3, 22.0, 1.4)
    .lineTo(22.0, 6.8)
    .quadraticCurveTo(22.0, 8.0, 20.8, 8.0)
    // Front wheel arch.
    .arc(AXLES[1]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    // Rear wheel arch.
    .arc(AXLES[0]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    .lineTo(-20.6, 8.0)
    .quadraticCurveTo(-22.0, 8.0, -22.0, 6.6)
    .lineTo(-21.8, -0.4)
    .lineTo(-20.4, -6.2)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.2);
  const deep = mix(color, 0x000000, 0.42);
  const hi = mix(color, 0xffffff, 0.5);

  // --- 1. Chrome roof luggage rack piled with strapped vintage suitcases (y: -9.8..-6.2) ---
  g.roundRect(-18.2, -7.0, 19.6, 0.9, 0.35).fill(CHROME_DARK);
  // Vintage tan suitcase (rear) + teal suitcase (middle) + red overnight bag (front).
  g.roundRect(-16.8, -9.6, 7.2, 3.0, 0.7).fill(BAG_TAN).stroke({ width: 0.45, color: 0x6b441d });
  g.rect(-15.0, -9.6, 0.85, 3.0).fill(0x523415);
  g.rect(-11.8, -9.6, 0.85, 3.0).fill(0x523415);
  g.roundRect(-9.2, -9.4, 5.8, 2.8, 0.6).fill(BAG_TEAL).stroke({ width: 0.45, color: 0x1e4f5c });
  g.rect(-6.8, -9.4, 0.8, 2.8).fill(WOOD_TRIM);
  g.roundRect(-3.0, -8.8, 3.8, 2.2, 0.6).fill(BAG_RED).stroke({ width: 0.4, color: 0x6e1a20 });
  // Chrome roof rack side rail over the base of the bags.
  g.moveTo(-18.0, -6.9).lineTo(1.2, -6.9).stroke({ width: 0.6, color: CHROME });

  // --- 2. Main boxy station wagon hull ---
  silhouette(g).fill(color);
  // Roof & hood highlights.
  g.moveTo(-19.8, -5.7).lineTo(3.8, -5.7).stroke({ width: 0.75, color: hi, alpha: 0.8, cap: 'round' });
  g.moveTo(8.0, -0.4).lineTo(20.4, 0.0).stroke({ width: 0.7, color: hi, alpha: 0.75, cap: 'round' });

  // --- 3. Three large classic wagon side windows (middle frames the passenger) ---
  // Rear cargo window.
  g.poly([-19.8, -5.2, -11.4, -5.2, -11.4, -0.6, -20.6, -0.6]).fill(GLASS);
  // Middle passenger door window.
  g.rect(-9.8, -5.2, 7.6, 4.6).fill(GLASS);
  // Front cab window.
  g.poly([-0.6, -5.2, 3.8, -5.2, 6.4, -0.6, -0.6, -0.6]).fill(GLASS);
  // Crisp glass specular glints.
  for (const [x0, x1] of [[-18.6, -14.2], [-8.6, -4.6], [0.4, 3.0]] as const) {
    g.moveTo(x0, -4.4).lineTo(x1, -4.4).stroke({ width: 0.65, color: GLASS_SHINE, alpha: 0.55, cap: 'round' });
  }
  // Thin chrome window beltline trim.
  g.moveTo(-20.8, -0.5).lineTo(6.6, -0.5).stroke({ width: 0.55, color: CHROME });

  // --- 4. Signature fixed faux-woodgrain side paneling with warm tan trim ---
  // Rear wood panel behind rear arch.
  g.roundRect(-21.6, 0.8, 4.0, 5.2, 0.6).fill(WOOD_BASE);
  // Main center wood panel across both doors.
  g.roundRect(-9.2, 0.8, 18.4, 6.0, 0.7).fill(WOOD_BASE);
  // Front fender wood panel ahead of front arch.
  g.roundRect(17.6, 0.8, 4.0, 5.2, 0.6).fill(WOOD_BASE);
  // Subtle woodgrain horizontal lines.
  for (const gy of [2.1, 3.5, 4.9, 6.0]) {
    g.moveTo(-8.8, gy).lineTo(8.8, gy).stroke({ width: 0.4, color: WOOD_GRAIN, alpha: 0.7 });
  }
  g.moveTo(-21.2, 2.8).lineTo(-18.0, 2.8).stroke({ width: 0.4, color: WOOD_GRAIN, alpha: 0.7 });
  g.moveTo(18.0, 2.8).lineTo(21.2, 2.8).stroke({ width: 0.4, color: WOOD_GRAIN, alpha: 0.7 });
  // Warm tan woodgrain border molding.
  g.roundRect(-9.2, 0.8, 18.4, 6.0, 0.7).stroke({ width: 0.65, color: WOOD_TRIM });
  g.roundRect(-21.6, 0.8, 4.0, 5.2, 0.6).stroke({ width: 0.55, color: WOOD_TRIM });
  g.roundRect(17.6, 0.8, 4.0, 5.2, 0.6).stroke({ width: 0.55, color: WOOD_TRIM });

  // Door seam & chrome door handles.
  g.moveTo(-1.4, -0.5).lineTo(-1.4, 7.6).stroke({ width: 0.45, color: deep, alpha: 0.55 });
  g.rect(-0.2, 1.4, 2.0, 0.7).fill(CHROME);
  g.rect(-7.4, 1.4, 2.0, 0.7).fill(CHROME);

  // Subtle rocker shade under woodgrain.
  g.rect(-8.6, 6.9, 17.2, 1.1).fill(shade);

  // Chrome front & rear bumpers + headlight & taillight.
  g.roundRect(20.6, 5.0, 2.4, 2.4, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.roundRect(-23.0, 5.0, 2.4, 2.4, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.roundRect(20.6, 0.8, 1.5, 2.1, 0.4).fill(HEADLIGHT);
  g.roundRect(-22.1, 1.0, 1.2, 2.5, 0.35).fill(TAIL_RED);
}

/** Classic 1970s whitewall tire with shiny chrome hubcap. */
function drawWhitewall(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r).fill(TIRE);
  g.circle(x, y, r * 0.72).stroke({ width: 0.75, color: WHITEWALL });
  g.circle(x, y, r * 0.46).fill(CHROME);
  g.circle(x, y, r * 0.18).fill(CHROME_DARK);
}

class WoodyWagonArt implements SkinArt {
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
    const restY = TAXI.halfH - WHEEL_R; // 6.2 (bottom at +10)
    const downY = bottom - WHEEL_R; // 20.2 (whitewall bottom flush on y = 24)
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
        g.moveTo(-6.5, 3.0).lineTo(-1.0, 4.2).stroke({ width: 0.65, color: 0x3b2210, alpha: 0.75, cap: 'round' });
      }
      if (stage >= 2) {
        g.moveTo(-17.8, -4.6).lineTo(-15.0, -2.2).lineTo(-13.2, -0.8).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(15.2, 1.2, 2.5).fill({ color: 0x1a1208, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(16.0, 0.8, 3.4).fill({ color: 0x120c06, alpha: 0.55 });
        g.circle(-16.5, 3.6, 2.8).fill({ color: 0x120c06, alpha: 0.5 });
        g.moveTo(7.6, -0.9).lineTo(20.5, -1.6).stroke({ width: 1.0, color: 0x222633, cap: 'round' });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger peeking out of the middle wagon window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-8.4, -2.1, 4.8, 1.5, 0.5).fill(look.shirt);
    g.circle(-6.0, -3.5, 1.65).fill(look.skin);
    if (look.hat !== null) g.rect(-7.7, -5.5, 3.4, 1.05).fill(look.hat);
  }
}

export const WOODY_WAGON: SkinDef = {
  id: 'woodyWagon',
  name: 'WOODY WAGON',
  playerColor: WOODY_SAGE,
  thrusters: {
    tail: { x: -23.0, y: 4.5 },
    nose: { x: 23.0, y: 4.5 },
    top: { x: -6.0, y: -9.4 },
    bottom: [
      { x: -6.0, y: 8.2 },
      { x: 6.0, y: 8.2 },
    ],
  },
  create: (color) => new WoodyWagonArt(color),
};
