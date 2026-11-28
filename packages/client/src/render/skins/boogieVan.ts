/**
 * "BOOGIE VAN": a groovy 1970s custom conversion van. Rounded cab-forward body with a
 * fixed three-band 1970s sunset-gradient side stripe (gold → tangerine → burnt crimson),
 * chrome-rimmed teardrop rear porthole window, front cab window showcasing the passenger,
 * tinted roof sun-visor, gleaming chrome side exhaust pipes along the rocker sill, chrome
 * bumpers, and chunky 70s slotted-mag tires dropping straight onto the landing pad.
 *
 * The body color repaints the main van hull directly (default: deep 70s Midnight Cobalt)
 * while keeping the retro sunset stripe, teardrop porthole, chrome side pipes, and mag
 * wheels fixed so every swatch and rival color keeps its 1970s custom-van flair.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended mag tires sit flush on the pad at y = 24 inside ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default body color: deep 1970s Midnight Cobalt. */
export const BOOGIE_COBALT = 0x3b68c4;

const SUNSET_TOP = 0xffd147;
const SUNSET_MID = 0xff8529;
const SUNSET_BOT = 0xd9383a;
const GLASS = 0x13223b;
const GLASS_SHINE = 0x9cd0ff;
const CHROME = 0xe2e9f7;
const CHROME_DARK = 0x7b869e;
const TIRE = 0x151820;
const RIM_MAG = 0xd4dceb;
const HEADLIGHT = 0xfff2b2;
const TAIL_RED = 0xe62e3d;
const WARN = 0xff3b3b;

const AXLES: readonly number[] = [-13.2, 13.2];
const WHEEL_R = 3.9;
const ARCH_Y = 6.6;
const ARCH_R = 4.5;
const ARCH_ANGLE = Math.asin((8.2 - ARCH_Y) / ARCH_R);

/** Rounded 1970s cab-forward custom van silhouette with open wheel arches along y = 8.2. */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-18.2, -9.0)
    .lineTo(7.4, -9.0)
    .quadraticCurveTo(10.0, -9.0, 11.2, -6.2)
    .lineTo(13.8, -1.2)
    .lineTo(19.6, -0.4)
    .quadraticCurveTo(21.4, -0.1, 21.4, 2.0)
    .lineTo(21.4, 7.0)
    .quadraticCurveTo(21.4, 8.2, 20.0, 8.2)
    // Open front wheel arch.
    .arc(AXLES[1]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    // Open rear wheel arch.
    .arc(AXLES[0]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    .lineTo(-19.4, 8.2)
    .quadraticCurveTo(-20.8, 8.2, -20.8, 6.8)
    .lineTo(-20.8, -6.2)
    .quadraticCurveTo(-20.8, -9.0, -18.2, -9.0)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.22);
  const deep = mix(color, 0x000000, 0.44);
  const hi = mix(color, 0xffffff, 0.52);

  // Main rounded 70s custom van body.
  silhouette(g).fill(color);
  // Lower flank shading.
  g.rect(-8.6, 4.4, 17.2, 3.8).fill({ color: shade, alpha: 0.78 });
  // Roofline & hood specular highlights.
  g.moveTo(-17.4, -8.4).lineTo(7.0, -8.4).stroke({ width: 0.85, color: hi, alpha: 0.8, cap: 'round' });
  g.moveTo(14.2, -0.8).lineTo(19.4, -0.1).stroke({ width: 0.7, color: hi, alpha: 0.7, cap: 'round' });

  // Fixed 3-band 1970s horizontal sunset-gradient stripe (gold → tangerine → crimson).
  g.rect(-20.6, -0.6, 41.6, 1.15).fill(SUNSET_TOP);
  g.rect(-20.6, 0.55, 41.6, 1.15).fill(SUNSET_MID);
  g.rect(-20.6, 1.7, 41.6, 1.15).fill(SUNSET_BOT);

  // Iconic chrome-rimmed teardrop rear porthole window!
  g.moveTo(-16.8, -3.6)
    .bezierCurveTo(-16.8, -7.2, -10.8, -6.4, -9.2, -3.6)
    .bezierCurveTo(-10.8, -0.8, -16.8, 0.0, -16.8, -3.6)
    .closePath()
    .fill(GLASS)
    .stroke({ width: 0.85, color: CHROME });
  g.moveTo(-15.4, -4.8).quadraticCurveTo(-13.8, -5.6, -12.0, -4.6).stroke({ width: 0.65, color: GLASS_SHINE, alpha: 0.65, cap: 'round' });

  // Front cab window (passenger clearly visible via setRider).
  g.poly([4.6, -6.8, 9.6, -6.8, 12.6, -1.2, 4.6, -1.2]).fill(GLASS);
  g.poly([4.6, -6.8, 9.6, -6.8, 12.6, -1.2, 4.6, -1.2]).stroke({ width: 0.6, color: CHROME });
  g.moveTo(5.6, -5.8).lineTo(8.8, -5.8).stroke({ width: 0.7, color: GLASS_SHINE, alpha: 0.65, cap: 'round' });

  // Tinted roof sun-visor overhanging the windshield + roof vent bubble.
  g.poly([8.4, -9.0, 12.6, -8.2, 12.0, -7.0, 8.8, -7.4]).fill(deep);
  g.roundRect(-14.5, -9.8, 6.2, 1.0, 0.45).fill(CHROME_DARK);

  // Gleaming chrome side exhaust pipe slung along the rocker between the wheels.
  g.roundRect(-8.2, 7.6, 16.4, 1.5, 0.7).fill(CHROME).stroke({ width: 0.35, color: CHROME_DARK });
  g.moveTo(-7.6, 8.0).lineTo(7.6, 8.0).stroke({ width: 0.45, color: 0xffffff, alpha: 0.85 });

  // Door seam, chrome door handle, and side mirror.
  g.moveTo(3.6, -7.4).lineTo(3.6, 7.4).stroke({ width: 0.5, color: deep, alpha: 0.55 });
  g.rect(5.4, 0.6, 2.2, 0.75).fill(CHROME);
  g.roundRect(11.4, -3.2, 1.6, 2.0, 0.4).fill(CHROME).stroke({ width: 0.35, color: CHROME_DARK });

  // Chrome front & rear bumpers, round headlight, and vertical taillight.
  g.roundRect(19.8, 5.4, 2.4, 2.4, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.roundRect(-22.0, 5.4, 2.4, 2.4, 0.7).fill(CHROME).stroke({ width: 0.4, color: CHROME_DARK });
  g.circle(20.6, 2.4, 1.15).fill(HEADLIGHT);
  g.roundRect(-21.0, 2.0, 1.1, 2.6, 0.35).fill(TAIL_RED);
}

/** 1970s fat tire with 5-slot chrome mag wheel. */
function drawMagWheel(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r).fill(TIRE);
  g.circle(x, y, r * 0.6).fill(RIM_MAG);
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    g.circle(x + Math.cos(a) * (r * 0.36), y + Math.sin(a) * (r * 0.36), 0.55).fill(TIRE);
  }
  g.circle(x, y, r * 0.18).fill(CHROME_DARK);
}

class BoogieVanArt implements SkinArt {
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

  /** Fat 70s mag-wheel tires tucked in the arches in flight and dropping straight onto y = 24. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = TAXI.halfH - WHEEL_R; // 6.1 (tucked, bottom at +10)
    const downY = bottom - WHEEL_R; // 20.1 (tire bottom flush on y = 24)
    const wy = restY + (downY - restY) * e;
    const mountY = ARCH_Y - ARCH_R + 0.8;

    for (const ax of AXLES) {
      if (e > 0.02) {
        g.moveTo(ax, mountY).lineTo(ax, wy).stroke({ width: 1.5, color: CHROME });
        g.moveTo(ax, mountY).lineTo(ax, mountY + Math.min(wy - mountY, 5.5)).stroke({ width: 2.8, color: 0x222633 });
        const braceX = ax < 0 ? ax + 3.2 : ax - 3.2;
        g.moveTo(braceX, mountY + 0.8).lineTo(ax, wy - 1.5).stroke({ width: 1.0, color: CHROME_DARK });
      }
      drawMagWheel(g, ax, wy, WHEEL_R);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-7.5, 1.4).lineTo(-2.0, 2.2).stroke({ width: 0.65, color: 0x161210, alpha: 0.65, cap: 'round' });
      }
      if (stage >= 2) {
        g.moveTo(6.2, -6.0).lineTo(8.8, -3.5).lineTo(10.8, -1.6).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(-14.5, 3.8, 2.6).fill({ color: 0x161008, alpha: 0.5 });
      }
      if (stage >= 3) {
        g.circle(16.2, 2.4, 3.0).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(-16.0, 4.2, 2.8).fill({ color: 0x100b06, alpha: 0.5 });
        g.moveTo(-7.8, 8.2).lineTo(0, 9.2).lineTo(7.6, 8.0).stroke({ width: 1.1, color: CHROME_DARK, cap: 'round' });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger riding in the front cab window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(5.6, -2.8, 4.2, 1.5, 0.5).fill(look.shirt);
    g.circle(7.7, -4.3, 1.55).fill(look.skin);
    if (look.hat !== null) g.rect(6.2, -6.2, 3.0, 1.0).fill(look.hat);
  }
}

export const BOOGIE_VAN: SkinDef = {
  id: 'boogieVan',
  name: 'BOOGIE VAN',
  playerColor: BOOGIE_COBALT,
  thrusters: {
    tail: { x: -21.8, y: 4.0 },
    nose: { x: 22.0, y: 4.0 },
    top: { x: -5.0, y: -9.0 },
    bottom: [
      { x: -6.0, y: 8.6 },
      { x: 6.0, y: 8.6 },
    ],
  },
  create: (color) => new BoogieVanArt(color),
};
