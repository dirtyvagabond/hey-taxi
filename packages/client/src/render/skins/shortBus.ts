/**
 * "THE SHORT BUS": a stubby, boxy school bus with a rounded roof, three square side windows,
 * an angled windshield, twin black rub-rails, a stepped engine hood with chrome grille and
 * headlight, amber/red roof warning lights, chunky rubber bus tires that drop down on
 * suspension struts for landing gear, and a mini red STOP sign arm that swings out above the
 * hood when the gear locks down.
 *
 * The body color tints the yellow bus paint directly so rivals fly crimson, cobalt, emerald,
 * or pink short buses while the black stripes, chrome grille, windows, and tires stay neutral.
 *
 * Taxi-local units, facing right. The body (~42u wide) stays inside the ±24 × ±10 hitbox with
 * flush thruster anchors; extended tires sit at the bottom of the feet box (y 24) inside ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default body color: Classic School-Bus Gold. */
export const SHORT_BUS_YELLOW = 0xffc83d;

const GLASS = 0x17243d;
const GLASS_SASH = 0x2a4069;
const STRIPE = 0x16181f;
const BUMPER = 0x222633;
const CHROME = 0xd4dbe8;
const CHROME_DARK = 0x7b859c;
const TIRE = 0x171920;
const TIRE_SIDE = 0x2d3240;
const RIM = 0xbec7d8;
const STOP_RED = 0xe62634;
const AMBER = 0xffaa22;
const RED_LIGHT = 0xff3848;
const WARN = 0xff3b3b;

/** Wheel axle X positions (rear under cab, front under hood; outer tire edges stay inside ±feetHalfW). */
const AXLES: readonly number[] = [-13.2, 13.2];
const WHEEL_R = 3.9;
const ARCH_Y = 6.6;
const ARCH_R = 4.5;
const ARCH_ANGLE = Math.asin((8.2 - ARCH_Y) / ARCH_R); // where the arch meets the y = 8.2 sill

/**
 * Stepped short-bus silhouette path (cab + hood) with open wheel arch cutouts along the
 * bottom sill so the tires on `this.gear` show cleanly through the arches when retracted.
 */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-17.5, -9.2)
    .lineTo(5.2, -9.2)
    .quadraticCurveTo(7.8, -9.2, 8.2, -6.4)
    .lineTo(8.8, -1.2)
    .lineTo(19.2, -0.3)
    .quadraticCurveTo(21.0, 0.0, 21.0, 2.0)
    .lineTo(21.0, 7.2)
    .quadraticCurveTo(21.0, 8.2, 19.8, 8.2)
    // Open front wheel arch (right-to-left over the top of the wheel well).
    .arc(AXLES[1]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    // Open rear wheel arch.
    .arc(AXLES[0]!, ARCH_Y, ARCH_R, ARCH_ANGLE, Math.PI - ARCH_ANGLE, true)
    .lineTo(-19.2, 8.2)
    .quadraticCurveTo(-20.4, 8.2, -20.4, 7.0)
    .lineTo(-20.4, -6.2)
    .quadraticCurveTo(-20.4, -9.2, -17.5, -9.2)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.18);
  const deep = mix(color, 0x000000, 0.36);
  const hi = mix(color, 0xffffff, 0.48);

  // Rear exhaust tailpipe peeking behind the rear bumper.
  g.roundRect(-22.2, 7.1, 3.0, 1.3, 0.5).fill(CHROME_DARK);

  // Main stepped bus hull (with open wheel arches).
  silhouette(g).fill(color);

  // Lower flank shadow band (segmented around the open wheel arches).
  g.roundRect(-20.2, 4.2, 2.6, 3.8, 0.8).fill({ color: shade, alpha: 0.75 });
  g.rect(-8.6, 4.2, 17.2, 3.9).fill({ color: shade, alpha: 0.75 });
  g.roundRect(17.7, 4.2, 3.1, 3.8, 0.8).fill({ color: shade, alpha: 0.75 });

  // Roof highlight and top-of-hood glint.
  g.roundRect(-17.0, -8.7, 22.0, 1.2, 0.6).fill({ color: hi, alpha: 0.65 });
  g.moveTo(9.0, -0.7).lineTo(19.0, 0.1).stroke({ width: 0.9, color: hi, alpha: 0.6, cap: 'round' });

  // Subtle hood seam line separating cab from engine compartment.
  g.moveTo(8.6, -1.0).lineTo(8.6, 7.8).stroke({ width: 0.6, color: deep, alpha: 0.45 });

  // Three square side windows (middle window frames the passenger via setRider).
  const winX = [-18.2, -10.8, -3.4];
  for (const wx of winX) {
    g.roundRect(wx, -6.4, 6.0, 5.4, 0.9).fill(GLASS);
    // Sliding upper sash bar.
    g.rect(wx + 0.3, -4.1, 5.4, 0.65).fill(GLASS_SASH);
    // Subtle glass glint.
    g.moveTo(wx + 1.0, -5.8).lineTo(wx + 2.4, -5.8).stroke({ width: 0.7, color: 0xffffff, alpha: 0.35, cap: 'round' });
  }

  // Angled front windshield above the hood step.
  g.poly([4.0, -6.4, 7.4, -6.4, 8.2, -1.0, 4.0, -1.0]).fill(GLASS);
  g.moveTo(5.0, -5.6).lineTo(6.6, -5.6).stroke({ width: 0.7, color: 0xffffff, alpha: 0.4, cap: 'round' });

  // Twin black rub-rail stripes (upper runs full cab length; lower runs cleanly between arches).
  g.rect(-20.3, 0.2, 28.9, 1.4).fill(STRIPE);
  g.rect(-8.4, 2.3, 17.0, 0.85).fill(STRIPE);
  g.rect(8.6, 0.9, 11.4, 0.85).fill(STRIPE);

  // Dark rubber fender lips tracing the open wheel arches.
  const lipR = ARCH_R + 0.15;
  const lipStart = Math.PI - ARCH_ANGLE;
  for (const ax of AXLES) {
    g.moveTo(ax + Math.cos(lipStart) * lipR, ARCH_Y + Math.sin(lipStart) * lipR)
      .arc(ax, ARCH_Y, lipR, lipStart, ARCH_ANGLE)
      .stroke({ width: 0.9, color: STRIPE });
  }

  // Front chrome grille & warm headlight.
  g.roundRect(18.6, 1.6, 2.3, 3.8, 0.5).fill(BUMPER);
  for (const gy of [2.3, 3.4, 4.5]) {
    g.rect(18.9, gy, 1.9, 0.55).fill(CHROME);
  }
  g.circle(20.1, 0.8, 1.0).fill(0xfff2b2);

  // Chunky front and rear bumpers.
  g.roundRect(-21.6, 5.4, 2.4, 2.6, 0.8).fill(BUMPER);
  g.roundRect(19.6, 5.4, 2.4, 2.6, 0.8).fill(BUMPER);

  // Rear taillight + roof warning light pods (amber + red).
  g.roundRect(-20.6, 3.3, 1.0, 1.8, 0.3).fill(RED_LIGHT);
  g.roundRect(-18.6, -9.8, 2.0, 1.1, 0.4).fill(AMBER);
  g.roundRect(3.6, -9.8, 1.9, 1.1, 0.4).fill(AMBER);
  g.roundRect(5.6, -9.7, 1.8, 1.1, 0.4).fill(RED_LIGHT);
}

/** Draw one chunky rubber bus wheel with steel rim and hubcap. */
function drawWheel(g: Graphics, x: number, y: number, r: number): void {
  g.circle(x, y, r).fill(TIRE);
  g.circle(x, y, r - 0.95).stroke({ width: 0.55, color: TIRE_SIDE });
  g.circle(x, y, r * 0.48).fill(RIM);
  g.circle(x, y, r * 0.22).fill(TIRE_SIDE);
}

/** Regular octagon vertices centered at (cx, cy) with radius r. */
function octagon(cx: number, cy: number, r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

class ShortBusArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  private warn = new Graphics();
  private stopArm = new Graphics();
  private flashers = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;
  private busColor: number;

  constructor(color: number) {
    this.busColor = color;
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.4, color: WARN, alpha: 0.9 });
    this.warn.visible = false;
    this.flashers.visible = false;
    this.body.addChild(this.warn, this.paint, this.stopArm, this.flashers);
    this.setGear(0);
  }

  /**
   * Chunky rubber bus tires tucked into the wheel arches in flight (p = 0) and dropping
   * down on suspension struts to y = 24 when extended (p = 1). During the final 25% of
   * extension, the mini red STOP arm swings out into the open space above the hood.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = TAXI.halfH - WHEEL_R; // 6.1 (tucked cleanly inside the open arch, bottom at +10)
    const downY = bottom - WHEEL_R; // 20.1 (tire bottom rests on pad at y = 24)
    const wy = restY + (downY - restY) * e;
    const mountY = ARCH_Y - ARCH_R + 0.8;

    for (const ax of AXLES) {
      if (e > 0.02) {
        // Upper shock housing + chrome piston rod + diagonal suspension brace.
        g.moveTo(ax, mountY).lineTo(ax, wy).stroke({ width: 1.5, color: CHROME });
        g.moveTo(ax, mountY).lineTo(ax, mountY + Math.min(wy - mountY, 5.5)).stroke({ width: 2.8, color: BUMPER });
        const braceX = ax < 0 ? ax + 3.2 : ax - 3.2;
        g.moveTo(braceX, mountY + 0.8).lineTo(ax, wy - 1.5).stroke({ width: 1.0, color: CHROME_DARK });
      }
      drawWheel(g, ax, wy, WHEEL_R);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }

    // Deployable mini red STOP sign arm swinging into the open space above the hood.
    const arm = this.stopArm;
    arm.clear();
    const t = Math.max(0, Math.min(1, (p - 0.72) / 0.28));
    if (t > 0) {
      const ae = t * t * (3 - 2 * t);
      const hx = 8.2;
      const hy = -2.2;
      const sx = hx + 6.0 * ae;
      const sy = hy - 2.8 * ae;
      const r = 2.9 * ae;
      arm.moveTo(hx, hy).lineTo(sx, sy).stroke({ width: 1.0, color: CHROME_DARK, cap: 'round' });
      arm.poly(octagon(sx, sy, r)).fill(STOP_RED).stroke({ width: 0.65, color: 0xffffff });
      if (ae > 0.5) {
        arm.rect(sx - 1.7 * ae, sy - 0.42, 3.4 * ae, 0.84).fill(0xffffff);
      }
    }
  }

  /**
   * Bus-specific damage:
   * - Stage 1: subtle scuff on the rub-rail.
   * - Stage 2: light soot, cracked rear window, hood scorch, rub-rail dent.
   * - Stage 3: heavy hood & rear scorch, darkened cracked second window, popped/tilted hood edge.
   * - Stage 4: pulsing red warning outline + alternating flashing red/amber roof warning lights.
   */
  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-14.0, 1.1).lineTo(-9.5, 1.9).stroke({ width: 0.65, color: 0x3a3d4a, alpha: 0.75, cap: 'round' });
      }
      if (stage >= 2) {
        // Cracked rear window.
        g.moveTo(-17.4, -5.8).lineTo(-15.0, -3.5).lineTo(-13.2, -1.5).stroke({ width: 0.55, color: 0xdbe6ff, alpha: 0.85 });
        g.moveTo(-15.0, -3.5).lineTo(-13.4, -4.7).stroke({ width: 0.45, color: 0xdbe6ff, alpha: 0.7 });
        // Initial scorch on the engine hood + dent along rub-rail.
        g.circle(14.5, 1.4, 2.6).fill({ color: 0x1a1208, alpha: 0.5 });
        g.moveTo(-4.0, 0.8).lineTo(-1.0, 2.2).lineTo(2.0, 1.2).stroke({ width: 0.8, color: 0x090a0e, alpha: 0.8 });
      }
      if (stage >= 3) {
        // Heavy engine hood & rear flank soot.
        g.circle(15.2, 1.0, 3.6).fill({ color: 0x120c06, alpha: 0.55 });
        g.circle(11.8, 2.6, 2.2).fill({ color: 0x000000, alpha: 0.45 });
        g.circle(-16.5, 4.2, 3.0).fill({ color: 0x120c06, alpha: 0.5 });
        // Second cracked/darkened window (front passenger window).
        g.roundRect(-3.4, -6.4, 6.0, 5.4, 0.9).fill({ color: 0x080c16, alpha: 0.65 });
        g.moveTo(-2.6, -5.6).lineTo(0.2, -3.2).lineTo(2.0, -1.6).stroke({ width: 0.55, color: 0xdbe6ff, alpha: 0.8 });
        // Popped/tilted hood edge (cartoon overheating bus).
        g.poly([8.6, -1.2, 19.6, -0.3, 19.2, -1.8, 8.6, -1.6]).fill(0x0c0e14);
        g.moveTo(8.6, -1.6).lineTo(19.4, -1.9).stroke({ width: 1.1, color: mix(this.busColor, 0x000000, 0.25), cap: 'round' });
      }
      this.paint.tint = stage >= 3 ? 0xecc0b8 : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
      this.flashers.visible = stage === 4;
    }

    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
      const f = this.flashers;
      f.clear();
      const pulse = Math.sin(time * 9);
      const amberOn = pulse >= 0;
      const redOn = pulse < 0;
      if (amberOn) {
        f.circle(4.5, -9.3, 2.6).fill({ color: AMBER, alpha: 0.35 });
        f.circle(4.5, -9.3, 1.3).fill(0xffe18a);
        f.circle(-17.6, -9.3, 2.2).fill({ color: AMBER, alpha: 0.3 });
        f.circle(-17.6, -9.3, 1.1).fill(0xffe18a);
      }
      if (redOn) {
        f.circle(6.5, -9.2, 2.8).fill({ color: RED_LIGHT, alpha: 0.4 });
        f.circle(6.5, -9.2, 1.35).fill(0xff9aa4);
      }
    }
  }

  /** Passenger peeking out of the middle side window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-10.1, -2.5, 4.6, 1.6, 0.5).fill(look.shirt);
    g.circle(-7.8, -3.9, 1.7).fill(look.skin);
    if (look.hat !== null) g.rect(-9.5, -5.9, 3.4, 1.1).fill(look.hat);
  }
}

export const SHORT_BUS: SkinDef = {
  id: 'shortBus',
  name: 'THE SHORT BUS',
  playerColor: SHORT_BUS_YELLOW,
  thrusters: { leftX: -21, rightX: 21, topY: -9.2, bottomY: 8.5 },
  create: (color) => new ShortBusArt(color),
};
