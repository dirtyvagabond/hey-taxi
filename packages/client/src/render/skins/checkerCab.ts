/**
 * "CHECKER CAB": a smooth-vector classic 1980s NYC boxy 3-box sedan taxi. Flat trunk,
 * boxy greenhouse with front & rear side windows (passenger visible in the rear seat),
 * long flat hood, glowing amber rooftop TAXI lamp, bold two-row black-and-white checkered
 * side stripe, gleaming chrome bumpers, and black sedan tires with chrome dog-dish hubcaps
 * dropping straight onto the landing pad.
 *
 * The body color repaints the classic sedan hull directly (default: Classic Taxi Gold)
 * while keeping the bold checkered band, glowing roof lamp, chrome bumpers, and tires fixed.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended tires sit flush on the pad at y = 24 inside ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default body color: Classic NYC Taxi Gold. */
export const CHECKER_GOLD = 0xffc83d;

const GLASS = 0x162640;
const GLASS_SHINE = 0xa4d2ff;
const CHECK_DARK = 0x141720;
const CHROME = 0xe2e9f7;
const CHROME_DARK = 0x7b869e;
const LAMP_AMBER = 0xffe066;
const LAMP_CORE = 0xfff8d6;
const TIRE = 0x151820;
const HEADLIGHT = 0xfff4b8;
const TAIL_RED = 0xe62e3d;
const WARN = 0xff3b3b;

const AXLES: readonly number[] = [-13.4, 13.4];
const WHEEL_R = 3.8;
const ARCH_Y = 6.6;
const ARCH_R = 4.4;
const ARCH_ANGLE = Math.asin((8.0 - ARCH_Y) / ARCH_R);

/** Classic 1980s boxy 3-box sedan silhouette (trunk + greenhouse + long hood). */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-21.2, 0.2)
    .lineTo(-12.4, -0.4)
    .lineTo(-9.6, -6.6)
    .lineTo(6.4, -6.6)
    .lineTo(10.0, -0.6)
    .lineTo(20.6, -0.2)
    .quadraticCurveTo(22.0, 0.1, 22.0, 1.8)
    .lineTo(22.0, 6.8)
    .quadraticCurveTo(22.0, 8.0, 20.6, 8.0)
    // Front wheel arch.
    .arc(AXLES[1]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    // Rear wheel arch.
    .arc(AXLES[0]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    .lineTo(-20.4, 8.0)
    .quadraticCurveTo(-22.0, 8.0, -22.0, 6.4)
    .lineTo(-22.0, 1.4)
    .quadraticCurveTo(-22.0, 0.3, -21.2, 0.2)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.2);
  const deep = mix(color, 0x000000, 0.42);
  const hi = mix(color, 0xffffff, 0.55);

  // Glowing rooftop TAXI lamp box (y: -9.6..-6.6).
  g.roundRect(-4.4, -9.6, 7.6, 3.0, 0.9).fill(CHECK_DARK);
  g.roundRect(-3.6, -9.0, 6.0, 1.8, 0.55).fill(LAMP_AMBER);
  g.roundRect(-2.4, -8.7, 3.6, 0.85, 0.35).fill(LAMP_CORE);

  // Main boxy 3-box sedan body.
  silhouette(g).fill(color);
  // Lower flank shading.
  g.rect(-8.4, 4.6, 16.8, 3.4).fill({ color: shade, alpha: 0.78 });
  // Roof, trunk & hood specular highlights.
  g.moveTo(-9.0, -6.1).lineTo(5.8, -6.1).stroke({ width: 0.75, color: hi, alpha: 0.85, cap: 'round' });
  g.moveTo(10.6, -0.1).lineTo(20.4, 0.2).stroke({ width: 0.7, color: hi, alpha: 0.75, cap: 'round' });
  g.moveTo(-20.6, 0.6).lineTo(-13.0, 0.1).stroke({ width: 0.65, color: hi, alpha: 0.7, cap: 'round' });

  // Greenhouse side windows (rear passenger window + front driver window) with chrome pillar.
  g.poly([-10.8, -0.8, -8.6, -5.6, -1.6, -5.6, -1.6, -0.8]).fill(GLASS);
  g.poly([0.0, -5.6, 5.6, -5.6, 8.6, -0.8, 0.0, -0.8]).fill(GLASS);
  g.moveTo(-7.6, -4.8).lineTo(-3.2, -4.8).stroke({ width: 0.65, color: GLASS_SHINE, alpha: 0.6, cap: 'round' });
  g.moveTo(1.2, -4.8).lineTo(4.6, -4.8).stroke({ width: 0.65, color: GLASS_SHINE, alpha: 0.6, cap: 'round' });
  g.moveTo(-11.2, -0.7).lineTo(9.0, -0.7).stroke({ width: 0.55, color: CHROME });

  // Bold 2-row black-and-white checkered cab stripe running full length along the flank!
  const cols = 19;
  const cw = 2.1;
  const x0 = -20.0;
  for (let i = 0; i < cols; i++) {
    const cx = x0 + i * cw;
    g.rect(cx, 1.3, cw, 1.05).fill(i % 2 === 0 ? CHECK_DARK : 0xffffff);
    g.rect(cx, 2.35, cw, 1.05).fill(i % 2 === 0 ? 0xffffff : CHECK_DARK);
  }
  g.moveTo(x0, 1.3).lineTo(x0 + cols * cw, 1.3).stroke({ width: 0.35, color: CHECK_DARK });
  g.moveTo(x0, 3.4).lineTo(x0 + cols * cw, 3.4).stroke({ width: 0.35, color: CHECK_DARK });

  // Door seam & chrome door handles.
  g.moveTo(-0.8, -5.8).lineTo(-0.8, 7.4).stroke({ width: 0.45, color: deep, alpha: 0.55 });
  g.rect(-6.8, 0.2, 2.0, 0.65).fill(CHROME);
  g.rect(1.0, 0.2, 2.0, 0.65).fill(CHROME);

  // Gleaming chrome front & rear bumpers, twin headlights, and red taillight.
  g.roundRect(20.6, 5.0, 2.4, 2.4, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.roundRect(-23.0, 5.0, 2.4, 2.4, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.roundRect(20.4, 0.9, 1.7, 2.2, 0.4).fill(HEADLIGHT);
  g.roundRect(-22.1, 1.2, 1.2, 2.5, 0.35).fill(TAIL_RED);
}

/** Classic black sedan tire with chrome dog-dish hubcap. */
function drawSedanWheel(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r).fill(TIRE);
  g.circle(x, y, r * 0.68).stroke({ width: 0.45, color: 0x3b4254 });
  g.circle(x, y, r * 0.46).fill(CHROME);
  g.circle(x, y, r * 0.2).fill(CHROME_DARK);
}

class CheckerCabArt implements SkinArt {
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

  /** Sedan tires tucked in the arches in flight and dropping straight onto y = 24. */
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
      drawSedanWheel(g, ax, wy, WHEEL_R);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-6, 3.6).lineTo(1, 4.4).stroke({ width: 0.65, color: 0x161210, alpha: 0.65, cap: 'round' });
      }
      if (stage >= 2) {
        g.moveTo(2.4, -5.0).lineTo(5.2, -2.5).lineTo(7.0, -1.2).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(15.5, 2.0, 2.5).fill({ color: 0x161008, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(16.2, 1.4, 3.2).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(-16.5, 3.4, 2.8).fill({ color: 0x100b06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger riding in the rear cab seat! */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-8.0, -2.2, 4.6, 1.5, 0.5).fill(look.shirt);
    g.circle(-5.7, -3.6, 1.6).fill(look.skin);
    if (look.hat !== null) g.rect(-7.4, -5.5, 3.4, 1.0).fill(look.hat);
  }
}

export const CHECKER_CAB: SkinDef = {
  id: 'checkerCab',
  name: 'CHECKER CAB',
  playerColor: CHECKER_GOLD,
  thrusters: {
    tail: { x: -23.0, y: 4.2 },
    nose: { x: 23.0, y: 4.2 },
    top: { x: -0.6, y: -9.6 },
    bottom: [
      { x: -6.0, y: 8.2 },
      { x: 6.0, y: 8.2 },
    ],
  },
  create: (color) => new CheckerCabArt(color),
};
