/**
 * "HOVER BOT": a 1985-era hovering cylindrical utility robot. Brushed metallic cylindrical
 * chassis with ribbed cooling vents, a recessed dark panoramic visor band featuring an
 * animated back-and-forth glowing scanner light, a clear top viewport dome showcasing the
 * passenger, twin side stabilizer pods, cool cyan plasma thruster flames, and telescoping
 * tripod robotic landing legs.
 *
 * The body color tints the metallic robot shell and scanner glow (default: electric robot
 * teal-cyan) while keeping the dark visor band, metallic vents, and tripod joints crisp.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended tripod footpads sit flush on the pad at y = 24, outer edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default chassis color: retro utility-bot cyan-steel. */
export const HOVER_BOT_CYAN = 0x4ef2f2;

const VISOR_BG = 0x0a0d16;
const METAL_DARK = 0x252c3b;
const METAL_MID = 0x5c6780;
const METAL_HI = 0xcbd5e8;
const DOME_GLASS = 0x162945;
const DOME_SHINE = 0x9cd6ff;
const SCAN_RED = 0xff3b4e;
const WARN = 0xff3b3b;

const SPARKS: readonly (readonly [number, number])[] = [
  [-12, 4.2],
  [12, 4.2],
  [0, 8.6],
  [6, -2.5],
];

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-11.0, -3.5)
    .bezierCurveTo(-11.0, -10.8, 11.0, -10.8, 11.0, -3.5)
    .lineTo(15.5, -2.0)
    .lineTo(15.5, 6.4)
    .lineTo(11.5, 9.4)
    .lineTo(-11.5, 9.4)
    .lineTo(-15.5, 6.4)
    .lineTo(-15.5, -2.0)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shell = mix(0xbec8db, color, 0.56);
  const shade = mix(shell, 0x000000, 0.24);
  const deep = mix(shell, 0x000000, 0.48);
  const hi = mix(shell, 0xffffff, 0.58);

  // Side stabilizer thruster pods (rear & front flanks).
  g.roundRect(-16.8, 0.2, 3.2, 5.2, 1.0).fill(METAL_DARK);
  g.roundRect(13.6, 0.2, 3.2, 5.2, 1.0).fill(METAL_DARK);
  g.rect(-16.2, 1.0, 1.6, 3.6).fill(METAL_MID);
  g.rect(14.6, 1.0, 1.6, 3.6).fill(METAL_MID);

  // Clear upper viewport dome (behind the passenger layer, so rider sits cleanly inside).
  g.moveTo(-9.6, -2.6)
    .bezierCurveTo(-9.6, -11.4, 9.6, -11.4, 9.6, -2.6)
    .closePath()
    .fill({ color: DOME_GLASS, alpha: 0.9 });
  g.moveTo(-9.6, -2.6)
    .bezierCurveTo(-9.6, -11.4, 9.6, -11.4, 9.6, -2.6)
    .stroke({ width: 0.9, color: hi, alpha: 0.85 });
  g.moveTo(-6.6, -4.8)
    .quadraticCurveTo(-4.8, -8.4, -0.8, -8.8)
    .stroke({ width: 1.0, color: DOME_SHINE, alpha: 0.7, cap: 'round' });

  // Main cylindrical armored robot torso (x: -14.8..+14.8, y: -3.2..+9.2).
  g.roundRect(-14.8, -3.2, 29.6, 11.0, 4.0).fill(shell);
  // Lower beveled hover-skirt collar.
  g.poly([-14.2, 6.0, 14.2, 6.0, 11.4, 9.4, -11.4, 9.4]).fill(shade);
  g.ellipse(0, 9.0, 8.2, 1.1).fill(METAL_DARK);

  // Cylindrical vertical shading (left edge darker, front-right highlight).
  g.roundRect(-14.8, -3.2, 6.4, 10.6, 3.0).fill({ color: shade, alpha: 0.65 });
  g.moveTo(4.0, -2.6).lineTo(4.0, 7.2).stroke({ width: 2.2, color: hi, alpha: 0.45, cap: 'round' });
  g.roundRect(-14.8, -3.2, 29.6, 11.0, 4.0).stroke({ width: 0.6, color: deep, alpha: 0.55 });

  // Dark horizontal collar seam under the dome.
  g.roundRect(-12.2, -3.4, 24.4, 1.2, 0.5).fill(METAL_DARK);

  // Recessed panoramic dark scanner visor slot across the upper torso.
  g.roundRect(-11.6, -1.4, 23.2, 3.0, 1.2).fill(VISOR_BG);
  g.roundRect(-11.6, -1.4, 23.2, 3.0, 1.2).stroke({ width: 0.55, color: METAL_MID });

  // Ribbed cooling louver vents & subtle checkered cab badge on the lower torso.
  for (let i = 0; i < 4; i++) {
    g.roundRect(-10.2 + i * 2.3, 3.0, 1.4, 2.5, 0.4).fill(METAL_DARK);
  }
  for (let i = 0; i < 4; i++) {
    g.rect(2.2 + i * 2.0, 3.2 + (i % 2) * 1.1, 2.0, 1.1).fill(i % 2 === 0 ? METAL_DARK : 0xffc83d);
  }
}

class HoverBotArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Container();
  readonly rider = new Graphics();
  private paint = new Graphics();
  /** Animated scanning visor light sweeping back and forth inside the recessed visor band. */
  private scanner = new Graphics();
  private warn = new Graphics();
  private marks = new Graphics();
  private sparks = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;
  private scanColor: number;

  constructor(color: number) {
    this.scanColor = color === HOVER_BOT_CYAN ? SCAN_RED : mix(color, 0xffffff, 0.25);
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.6, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.scanner);
    this.scars.addChild(this.marks, this.sparks);
  }

  /**
   * Telescoping robotic tripod landing legs extending from the hover skirt down to wide
   * footpads flush on y = 24 (outer edges at ±20 = TAXI.feetHalfW).
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const top = 8.0;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    // Center rear-depth tripod leg.
    const midY = top + (bottom - 2.6 - top) * e;
    g.moveTo(0, top).lineTo(0, midY).stroke({ width: 1.6, color: METAL_MID, alpha: 0.8 });
    g.roundRect(-3.4, midY, 6.8, 2.0, 0.9).fill({ color: METAL_DARK, alpha: 0.85 });

    // Outer left & right articulated robotic legs.
    for (const s of [-1, 1]) {
      const hx = s * 8.6;
      const fx = s * (8.6 + 6.4 * e); // reaches ±15.0; pad half-width 5.0 → ±20.0
      const fy = top + (bottom - 2.4 - top) * e;
      g.moveTo(hx, top).lineTo(fx, fy).stroke({ width: 2.3, color: METAL_HI, cap: 'round' });
      g.moveTo(hx, top)
        .lineTo(hx + (fx - hx) * 0.45, top + (fy - top) * 0.45)
        .stroke({ width: 3.3, color: METAL_DARK, cap: 'round' });
      // Robotic footpad (10u wide → outer edge at ±20, bottom at y = 24).
      g.roundRect(fx - 5.0, fy, 10.0, 2.4, 1.0).fill(METAL_MID);
      g.roundRect(fx - 5.0, fy + 1.3, 10.0, 1.1, 0.5).fill(METAL_DARK);
      if (locked) g.circle(fx, fy - 2.0, 1.15).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-8, 2.0).lineTo(-2, 3.0).stroke({ width: 0.6, color: 0x161b26, alpha: 0.65 });
      }
      if (stage >= 2) {
        g.moveTo(-3.2, -7.2).lineTo(-0.6, -4.6).lineTo(-2.4, -3.0).stroke({ width: 0.5, color: 0xffffff, alpha: 0.85 });
        g.circle(9.5, 4.4, 2.6).fill({ color: 0x120d08, alpha: 0.55 });
      }
      if (stage >= 3) {
        g.circle(-9.5, 4.8, 2.8).fill({ color: 0x0d0906, alpha: 0.6 });
        g.moveTo(3.5, -6.8).lineTo(1.8, -3.8).stroke({ width: 0.5, color: 0xffffff, alpha: 0.8 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.warn.visible = stage === 4;
      if (stage < 3) this.sparks.clear();
    }

    // Animated back-and-forth 1980s scanner light inside the recessed visor band.
    const sc = this.scanner;
    sc.clear();
    const isCrit = stage === 4;
    const flick = stage >= 3 && Math.sin(time * 37.3) * Math.sin(time * 11.1) > 0.5;
    if (!flick) {
      const col = isCrit ? WARN : this.scanColor;
      const sx = Math.sin(time * (isCrit ? 6.5 : 3.2)) * 8.4;
      const tail = Math.cos(time * (isCrit ? 6.5 : 3.2)) * -2.8;
      // Soft trailing glow + bright scanner eye.
      sc.moveTo(sx + tail, 0.1).lineTo(sx, 0.1).stroke({ width: 2.2, color: col, alpha: 0.35, cap: 'round' });
      sc.circle(sx, 0.1, 2.2).fill({ color: col, alpha: 0.28 });
      sc.roundRect(sx - 1.5, -0.7, 3.0, 1.6, 0.7).fill(col);
      sc.circle(sx, 0.1, 0.65).fill(0xffffff);
    }

    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.9 + i * 0.41) % 1;
        const [sx, sy] = SPARKS[i]!;
        g.circle(sx + Math.sin(i * 7.1 + time * 3) * 2, sy + phase * 4.5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xd8f8ff,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** Passenger sitting inside the clear top dome viewport. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-2.8, -5.0, 5.6, 2.0, 0.8).fill(look.shirt);
    g.circle(0, -6.8, 1.85).fill(look.skin);
    if (look.hat !== null) g.rect(-2.0, -9.2, 4.0, 1.25).fill(look.hat);
  }
}

export const HOVER_BOT: SkinDef = {
  id: 'hoverBot',
  name: 'HOVER BOT',
  playerColor: HOVER_BOT_CYAN,
  thrusters: {
    tail: { x: -17.0, y: 2.8, scale: 0.9 },
    nose: { x: 17.0, y: 2.8, scale: 0.9 },
    top: { x: 0, y: -9.5, scale: 0.85 },
    bottom: [
      { x: -5.5, y: 9.4 },
      { x: 5.5, y: 9.4 },
    ],
  },
  flameColors: () => ({ outer: 0x4ef2f2, core: 0xeaffff }),
  create: (color) => new HoverBotArt(color),
};
