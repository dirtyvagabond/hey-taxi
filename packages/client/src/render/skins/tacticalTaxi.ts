/**
 * "TACTICAL TAXI": a modern armored tactical cab with a long stepped armored hood and intake
 * scoop, steep raked armored windshield, beveled louvered roof shroud, angular trapezoidal
 * flared fenders, tubular side running board, caged square LED headlights, twin roof LED pods,
 * a horizontal checkered taxi beltline stripe, and oversized matte-black knobby off-road tires
 * with a thin accent rim-edge ring that drop down on heavy-duty hydraulic suspension struts.
 *
 * Accent-tinted: the faceted dark gunmetal/obsidian armor hull stays fixed while `color`
 * drives the checkered beltline stripe, suspension collars, and rim-edge rings (default Classic Gold).
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox with flush
 * thruster anchors; extended tires sit at the bottom of the feet box (y 24) inside ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default accent color: Classic Taxi Gold. */
export const TACTICAL_TAXI_GOLD = 0xffc83d;

const ARMOR_LOWER = 0x1a1e29;
const ARMOR_MID = 0x282e3d;
const ARMOR_UPPER = 0x454e63;
const BEVEL_HI = 0x828ea8;
const BEVEL_DARK = 0x0d1017;
const GLASS = 0x132036;
const GLASS_SHINE = 0x8bc6ff;
const BUMPER = 0x161922;
const CHROME = 0xd2dae8;
const CHROME_DARK = 0x6f7991;
const TIRE = 0x13161e;
const TIRE_TREAD = 0x262c3b;
const RIM_DARK = 0x1f2431;
const LED_COOL = 0xe8f6ff;
const LED_HALO = 0x7cd4ff;
const TAIL_RED = 0xff3848;
const WARN = 0xff3b3b;

/** Oversized off-road wheel axles (outer tire edges at ±17.5, inside ±feetHalfW = ±20). */
const AXLES: readonly number[] = [-13.4, 13.4];
const WHEEL_R = 4.1;
const ARCH_TOP_Y = 1.6;
const SILL_Y = 7.8;

/** Ensure very dark custom paint swatches stay crisp on the stripe and rim-edge rings. */
function accentColor(color: number): number {
  const lum = 0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255);
  return lum >= 72 ? color : mix(color, 0xffffff, Math.min(0.45, (72 - lum) / 110));
}

/**
 * Faceted armored tactical silhouette (nose at +x) with open trapezoidal wheel-arch
 * cutouts along y = 7.8 so the oversized knobby tires show cleanly through when retracted.
 */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-15.8, -8.8)
    .lineTo(6.2, -8.8)
    .lineTo(10.8, -1.8)
    .lineTo(20.6, -1.0)
    .lineTo(21.6, 0.2)
    .lineTo(21.6, 6.8)
    .lineTo(20.6, SILL_Y)
    // Open front trapezoidal wheel arch (right-to-left over wheel well).
    .lineTo(18.6, SILL_Y)
    .lineTo(16.6, ARCH_TOP_Y)
    .lineTo(10.2, ARCH_TOP_Y)
    .lineTo(8.2, SILL_Y)
    // Under-door sill between axles.
    .lineTo(-8.2, SILL_Y)
    // Open rear trapezoidal wheel arch.
    .lineTo(-10.2, ARCH_TOP_Y)
    .lineTo(-16.6, ARCH_TOP_Y)
    .lineTo(-18.6, SILL_Y)
    .lineTo(-20.6, SILL_Y)
    .lineTo(-21.2, 6.2)
    .lineTo(-20.2, -4.6)
    .lineTo(-15.8, -8.8)
    .closePath();
  return g;
}

function drawBody(g: Graphics, rawColor: number): void {
  const accent = accentColor(rawColor);
  const accentHi = mix(accent, 0xffffff, 0.35);
  const accentShade = mix(accent, 0x000000, 0.3);

  // Main armored chassis in dark obsidian-charcoal.
  silhouette(g).fill(ARMOR_LOWER);

  // Faceted mid-body armor plate (door + rear quarter).
  g.poly([
    -19.6, -4.6,
    -15.6, -7.2,
    6.0, -7.2,
    10.4, -1.6,
    20.4, -0.8,
    20.4, 2.4,
    -20.4, 2.4,
  ]).fill(ARMOR_MID);

  // Beveled louvered tactical roof shroud (lighter gunmetal catches sky light).
  g.poly([-15.8, -8.8, 6.2, -8.8, 7.2, -7.0, -19.8, -5.2]).fill(ARMOR_UPPER);
  g.moveTo(-15.5, -8.4).lineTo(6.0, -8.4).stroke({ width: 0.75, color: BEVEL_HI, alpha: 0.85, cap: 'round' });

  // Angled gill-like armored roof louvers along the chamfer.
  for (let lx = -14.8; lx <= 2.4; lx += 2.15) {
    g.moveTo(lx, -8.3).lineTo(lx - 0.7, -7.2).stroke({ width: 0.55, color: BEVEL_DARK, alpha: 0.8 });
  }

  // Faceted hexagonal rear armor panel inset.
  g.poly([-18.8, -4.4, -15.4, -6.5, -1.8, -6.5, -0.4, -4.4, -1.8, 0.2, -18.8, 0.2])
    .fill({ color: ARMOR_UPPER, alpha: 0.35 })
    .stroke({ width: 0.5, color: BEVEL_HI, alpha: 0.35 });

  // Raised armored hood intake scoop.
  g.poly([11.8, -1.7, 13.0, -2.8, 17.8, -2.6, 18.6, -1.2]).fill(ARMOR_UPPER);
  g.moveTo(13.1, -2.6).lineTo(17.7, -2.4).stroke({ width: 0.65, color: BEVEL_HI, alpha: 0.8 });

  // Horizontal two-row checkered tactical taxi stripe along the armored beltline.
  const stripeX0 = -19.6;
  const stripeY0 = -0.7;
  const cellW = 2.1;
  const cellH = 1.1;
  const cols = 14; // spans -19.6..+9.8 across rear quarter & cab door
  g.rect(stripeX0, stripeY0, cols * cellW, cellH * 2).fill(BEVEL_DARK);
  for (let i = 0; i < cols; i++) {
    const cx = stripeX0 + i * cellW;
    const row = i % 2;
    g.rect(cx, stripeY0 + row * cellH, cellW, cellH).fill(accent);
    g.rect(cx, stripeY0 + row * cellH, cellW, 0.3).fill({ color: accentHi, alpha: 0.65 });
  }
  g.moveTo(stripeX0, stripeY0).lineTo(stripeX0 + cols * cellW, stripeY0).stroke({ width: 0.4, color: accentShade, alpha: 0.8 });
  g.moveTo(stripeX0, stripeY0 + cellH * 2)
    .lineTo(stripeX0 + cols * cellW, stripeY0 + cellH * 2)
    .stroke({ width: 0.4, color: BEVEL_DARK, alpha: 0.9 });

  // Subtle metallic bevel rim around the armored silhouette for dark-sky contrast.
  silhouette(g).stroke({ width: 0.75, color: BEVEL_HI, alpha: 0.55 });

  // Compact trapezoidal armored front cab window (passenger sits here via setRider).
  g.poly([2.2, -6.2, 6.2, -6.2, 9.2, -1.6, 2.2, -1.6]).fill(GLASS);
  g.poly([2.2, -6.2, 6.2, -6.2, 9.2, -1.6, 2.2, -1.6]).stroke({ width: 0.75, color: BEVEL_DARK });
  g.moveTo(3.2, -5.4).lineTo(5.6, -5.4).stroke({ width: 0.7, color: GLASS_SHINE, alpha: 0.6, cap: 'round' });

  // Heavy external door seam, tactical door hinges, diagonal chrome handle & side mirror.
  g.moveTo(1.2, -6.8).lineTo(1.2, 7.6).stroke({ width: 0.65, color: BEVEL_DARK, alpha: 0.85 });
  g.rect(0.5, -1.2, 1.5, 1.0).fill(BUMPER).stroke({ width: 0.35, color: BEVEL_HI, alpha: 0.6 });
  g.rect(0.5, 2.6, 1.5, 1.0).fill(BUMPER).stroke({ width: 0.35, color: BEVEL_HI, alpha: 0.6 });
  g.moveTo(4.0, 1.6).lineTo(5.4, 0.2).stroke({ width: 0.9, color: CHROME, cap: 'round' });
  g.roundRect(7.4, -3.4, 2.0, 2.1, 0.4).fill(BUMPER).stroke({ width: 0.45, color: BEVEL_HI, alpha: 0.65 });

  // Bold angular trapezoidal armored fender flares with bright metallic bevel highlights.
  for (const ax of AXLES) {
    const outer = [
      ax - 5.6, SILL_Y,
      ax - 3.6, ARCH_TOP_Y - 1.1,
      ax + 3.6, ARCH_TOP_Y - 1.1,
      ax + 5.6, SILL_Y,
    ];
    g.moveTo(outer[0]!, outer[1]!)
      .lineTo(outer[2]!, outer[3]!)
      .lineTo(outer[4]!, outer[5]!)
      .lineTo(outer[6]!, outer[7]!)
      .stroke({ width: 1.5, color: BUMPER, join: 'bevel' });
    g.moveTo(outer[0]! + 0.3, outer[1]! - 0.3)
      .lineTo(outer[2]! + 0.2, outer[3]! - 0.2)
      .lineTo(outer[4]! - 0.2, outer[5]! - 0.2)
      .lineTo(outer[6]! - 0.3, outer[7]! - 0.3)
      .stroke({ width: 0.6, color: BEVEL_HI, alpha: 0.75, join: 'bevel' });
  }

  // Heavy tubular side running board slung between the wheels.
  g.roundRect(-7.4, 8.2, 14.8, 1.3, 0.5).fill(BUMPER).stroke({ width: 0.45, color: BEVEL_HI, alpha: 0.75 });
  g.moveTo(-6.6, 8.5).lineTo(6.6, 8.5).stroke({ width: 0.45, color: CHROME, alpha: 0.55 });

  // Twin roof tactical LED light pods mounted above the windshield.
  g.roundRect(3.4, -9.8, 2.0, 1.3, 0.35).fill(BUMPER).stroke({ width: 0.45, color: BEVEL_HI, alpha: 0.75 });
  g.roundRect(5.8, -9.8, 2.0, 1.3, 0.35).fill(BUMPER).stroke({ width: 0.45, color: BEVEL_HI, alpha: 0.75 });
  g.rect(4.9, -9.5, 0.45, 0.8).fill(LED_COOL);
  g.rect(7.3, -9.5, 0.45, 0.8).fill(LED_COOL);

  // Caged square LED headlight on the front nose (+x).
  g.roundRect(19.6, 0.4, 2.2, 2.4, 0.4).fill(LED_COOL).stroke({ width: 0.55, color: BUMPER });
  // Protective headlight cage grid.
  g.moveTo(20.7, 0.5).lineTo(20.7, 2.7).stroke({ width: 0.4, color: BUMPER });
  g.moveTo(19.7, 1.6).lineTo(21.7, 1.6).stroke({ width: 0.4, color: BUMPER });

  // Chunky armored front & rear bumpers + rear LED taillight.
  g.roundRect(20.6, 3.8, 2.2, 3.4, 0.5).fill(BUMPER).stroke({ width: 0.45, color: BEVEL_HI, alpha: 0.65 });
  g.roundRect(-22.2, 4.4, 2.0, 2.8, 0.5).fill(BUMPER).stroke({ width: 0.45, color: BEVEL_HI, alpha: 0.6 });
  g.roundRect(-21.1, 1.6, 1.0, 2.1, 0.3).fill(TAIL_RED);
}

/** Draw one oversized knobby off-road wheel: matte-black multi-spoke rim + thin accent rim-edge ring. */
function drawOffroadWheel(g: Graphics, x: number, y: number, r: number, accent: number): void {
  const rimR = r * 0.58;
  // Aggressive knobby tire casing.
  g.circle(x, y, r).fill(TIRE);
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    g.circle(x + Math.cos(a) * (r - 0.15), y + Math.sin(a) * (r - 0.15), 0.48).fill(TIRE_TREAD);
  }
  g.circle(x, y, r - 0.65).stroke({ width: 0.45, color: TIRE_TREAD });

  // Matte-black tactical rim + iconic thin accent pinstripe ring around the rim edge.
  g.circle(x, y, rimR).fill(RIM_DARK);
  g.circle(x, y, rimR + 0.15).stroke({ width: 0.72, color: accent });

  // Multi-spoke matte-gunmetal pattern + dark hub cap.
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    g.moveTo(x + Math.cos(a) * (rimR * 0.32), y + Math.sin(a) * (rimR * 0.32))
      .lineTo(x + Math.cos(a) * (rimR * 0.88), y + Math.sin(a) * (rimR * 0.88))
      .stroke({ width: 0.55, color: CHROME_DARK, alpha: 0.8 });
  }
  g.circle(x, y, rimR * 0.3).fill(BUMPER).stroke({ width: 0.4, color: BEVEL_HI, alpha: 0.7 });
}

class TacticalTaxiArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  private warn = new Graphics();
  private ledGlow = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;
  private accent: number;
  private gearP = 0;

  constructor(color: number) {
    this.accent = accentColor(color);
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.6, color: WARN, alpha: 0.9, join: 'bevel' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.ledGlow);
    this.setGear(0);
  }

  /**
   * Oversized knobby off-road tires tucked into the trapezoidal armored arches in flight
   * (p = 0) and dropping on heavy-duty hydraulic off-road struts to y = 24 when extended
   * (p = 1). During the final 28% of extension, the caged LED headlights and twin roof
   * tactical pods flare bright cool-white.
   */
  setGear(p: number): void {
    this.gearP = p;
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = TAXI.halfH - WHEEL_R; // 5.9 (bottom at +10)
    const downY = bottom - WHEEL_R; // 19.9 (bottom at +24)
    const wy = restY + (downY - restY) * e;
    const mountY = ARCH_TOP_Y + 0.6;

    for (const ax of AXLES) {
      if (e > 0.02) {
        // Heavy-duty dual-stage hydraulic off-road lift strut + coil-over accent collar.
        g.moveTo(ax, mountY).lineTo(ax, wy).stroke({ width: 1.7, color: CHROME });
        g.moveTo(ax, mountY).lineTo(ax, mountY + Math.min(wy - mountY, 6.2)).stroke({ width: 3.1, color: BUMPER });
        const collarY = mountY + Math.min(wy - mountY, 5.2);
        g.moveTo(ax - 1.5, collarY).lineTo(ax + 1.5, collarY).stroke({ width: 1.0, color: this.accent });
        const braceX = ax < 0 ? ax + 3.4 : ax - 3.4;
        g.moveTo(braceX, mountY + 0.8).lineTo(ax, wy - 1.6).stroke({ width: 1.1, color: CHROME_DARK });
      }
      drawOffroadWheel(g, ax, wy, WHEEL_R, this.accent);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }

    this.drawLedPods(1, 1);
  }

  private drawLedPods(roofAlpha: number, noseAlpha: number): void {
    const f = this.ledGlow;
    f.clear();
    const t = Math.max(0, Math.min(1, (this.gearP - 0.72) / 0.28));
    if (t <= 0) return;
    const e = t * t * (3 - 2 * t);

    if (roofAlpha > 0.01) {
      const a = e * roofAlpha;
      // Crisp cool-white roof tactical beam cone + twin pod halos.
      f.poly([7.8, -9.6, 7.8 + 11.5 * a, -11.4, 7.8 + 11.5 * a, -6.8, 7.8, -8.6]).fill({
        color: LED_HALO,
        alpha: 0.2 * a,
      });
      f.circle(7.6, -9.1, 2.2 * a).fill({ color: LED_HALO, alpha: 0.35 * a });
      f.circle(7.6, -9.1, 0.95 * a).fill({ color: LED_COOL, alpha: 0.95 * a });
      f.circle(5.2, -9.1, 1.8 * a).fill({ color: LED_HALO, alpha: 0.28 * a });
    }

    if (noseAlpha > 0.01) {
      const a = e * noseAlpha;
      // Caged nose LED headlight beam flare.
      f.poly([21.8, 0.7, 21.8 + 10.0 * a, -0.6, 21.8 + 10.0 * a, 3.8, 21.8, 2.5]).fill({
        color: LED_HALO,
        alpha: 0.22 * a,
      });
      f.circle(21.4, 1.6, 2.4 * a).fill({ color: LED_HALO, alpha: 0.35 * a });
      f.circle(21.4, 1.6, 1.1 * a).fill({ color: LED_COOL, alpha: 0.95 * a });
    }
  }

  /**
   * Armored tactical battle damage:
   * - Stage 1: metallic ricochet scratches & dents on the armored rear flank.
   * - Stage 2: spiderweb-cracked armored windshield + hood scorch + gouged fender flare.
   * - Stage 3: heavy soot + buckled side running board + darkened cab window.
   * - Stage 4: pulsing red warning outline + strobing roof LED pods & flickering nose LED.
   */
  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      if (stage >= 1) {
        // Metallic ricochet slashes on armored rear quarter.
        g.moveTo(-12.5, -2.2).lineTo(-7.8, -1.2).stroke({ width: 0.65, color: CHROME, alpha: 0.75, cap: 'round' });
        g.moveTo(-9.0, 2.6).lineTo(-5.2, 3.4).stroke({ width: 0.6, color: BEVEL_HI, alpha: 0.7, cap: 'round' });
        g.circle(-14.2, -0.5, 0.7).fill(BEVEL_DARK).stroke({ width: 0.35, color: CHROME, alpha: 0.8 });
      }
      if (stage >= 2) {
        // Spiderweb crack in armored cab glass.
        g.moveTo(3.2, -5.5).lineTo(5.6, -3.7).lineTo(8.0, -2.0).stroke({ width: 0.55, color: 0xdbeeff, alpha: 0.85 });
        g.moveTo(5.6, -3.7).lineTo(7.4, -4.9).stroke({ width: 0.45, color: 0xdbeeff, alpha: 0.75 });
        g.moveTo(5.6, -3.7).lineTo(3.6, -2.3).stroke({ width: 0.45, color: 0xdbeeff, alpha: 0.7 });
        // Hood scorch & gouged front fender flare.
        g.circle(15.8, -0.8, 2.6).fill({ color: 0x120c06, alpha: 0.55 });
        g.moveTo(11.4, 0.9).lineTo(14.8, 0.4).stroke({ width: 0.8, color: BEVEL_DARK, alpha: 0.85 });
      }
      if (stage >= 3) {
        // Heavy hood & rear flank soot.
        g.circle(16.6, -0.6, 3.6).fill({ color: 0x0d0905, alpha: 0.6 });
        g.circle(-16.0, 1.8, 3.2).fill({ color: 0x0d0905, alpha: 0.55 });
        // Darkened cab glass.
        g.poly([2.2, -6.2, 6.2, -6.2, 9.2, -1.6, 2.2, -1.6]).fill({ color: 0x060910, alpha: 0.55 });
        // Buckled/bent side running board hanging slightly loose.
        g.moveTo(-7.2, 8.6)
          .lineTo(-0.5, 9.5)
          .lineTo(7.0, 8.4)
          .stroke({ width: 1.2, color: CHROME_DARK, cap: 'round' });
      }
      this.paint.tint = stage >= 3 ? 0xe8c4be : stage === 2 ? 0xeaeaea : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xeec8c2 : 0xffffff;
      this.warn.visible = stage === 4;
    }

    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
      const strobe = Math.sin(time * 14) > 0;
      const flicker = Math.sin(time * 23) * Math.sin(time * 7.3) > -0.2;
      if (this.gearP > 0.72) {
        this.drawLedPods(strobe ? 1 : 0.12, flicker ? 1 : 0.15);
      } else {
        const f = this.ledGlow;
        f.clear();
        if (strobe) {
          f.circle(7.6, -9.1, 2.4).fill({ color: LED_HALO, alpha: 0.45 });
          f.circle(7.6, -9.1, 1.0).fill(LED_COOL);
        }
        if (flicker) {
          f.circle(21.4, 1.6, 2.0).fill({ color: LED_HALO, alpha: 0.35 });
        }
      }
    } else if (this.stage < 4) {
      this.drawLedPods(1, 1);
    }
  }

  /** Passenger seated inside the compact trapezoidal armored cab window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(2.9, -2.8, 3.8, 1.3, 0.45).fill(look.shirt);
    g.circle(4.8, -4.1, 1.45).fill(look.skin);
    if (look.hat !== null) g.rect(3.4, -5.8, 2.8, 0.95).fill(look.hat);
  }
}

export const TACTICAL_TAXI: SkinDef = {
  id: 'tacticalTaxi',
  name: 'TACTICAL TAXI',
  playerColor: TACTICAL_TAXI_GOLD,
  thrusters: {
    tail: { x: -22.0, y: 5.4 },
    nose: { x: 22.6, y: 5.2 },
    top: { x: -5.5, y: -8.8 },
    bottom: [
      { x: -5.5, y: 9.2 },
      { x: 5.5, y: 9.2 },
    ],
  },
  create: (color) => new TacticalTaxiArt(color),
};
