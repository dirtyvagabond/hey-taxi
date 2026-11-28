/**
 * "LUNAR LANDER": an Apollo-era lunar excursion module (~1.28× body scale for crisp
 * gameplay visibility). Dark metallic octagonal descent stage with a restrained gold
 * Kapton thermal blanket inset, micro American flag, paint-tinted angular ascent cabin,
 * triangular forward window, and pure titanium-silver splayed spider landing struts that
 * stay visibly extended in flight and telescope smoothly onto y = 24 to land.
 *
 * Taxi-local units, facing right (+x = nose). Extended spider footpads sit flush on the
 * pad at y = 24, outer edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default ascent-cabin color: lunar silver-grey. */
export const LUNAR_SILVER = 0xd6deeb;

const BODY_SCALE = 1.28;
const BODY_OFFSET_Y = -2.2;

const GOLD_ACCENT = 0xc99228;
const GOLD_HI = 0xf2cf72;
const GOLD_DEEP = 0x6e4b0e;
const STAGE_MID = 0x3a4254;
const STAGE_SHADE = 0x262c3a;
const STAGE_HI = 0x6b7690;
const FOIL_DARK = 0x1b1f2a;
const BELL_METAL = 0x454d60;
const BELL_DARK = 0x161922;
const GLASS = 0x0e192b;
const GLASS_SHINE = 0x8cc8ff;
const STRUT_HI = 0xcfd7e6;
const STRUT_METAL = 0x8e99b0;
const STRUT_DARK = 0x424a5e;
const PAD_METAL = 0x768199;
const PAD_DARK = 0x2a303f;
const FLAG_RED = 0xdc2626;
const FLAG_BLUE = 0x1d4ed8;
const WARN = 0xff3b3b;

const SPARKS: readonly (readonly [number, number])[] = [
  [-12, 4.5],
  [12, 4.2],
  [0, 8.8],
  [7, -4.5],
];

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.poly([
    -13.5, -2.5, -10.5, -7.8, -3.5, -9.2, 6.5, -8.8, 12.2, -4.5, 12.2, 1.5,
    15.2, 2.2, 15.2, 7.6, 10.5, 8.8, 4.2, 9.8, -4.2, 9.8, -10.5, 8.8, -15.2, 7.6, -15.2, 2.2, -13.5, 1.5,
  ]);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const isDefault = color === LUNAR_SILVER;
  const cabin = isDefault ? LUNAR_SILVER : mix(LUNAR_SILVER, color, 0.58);
  const cabinShade = mix(cabin, 0x000000, 0.24);
  const cabinDeep = mix(cabin, 0x000000, 0.48);
  const cabinHi = mix(cabin, 0xffffff, 0.55);

  // --- 1. Central descent engine bell peeking below the descent stage ---
  g.poly([-4.6, 7.6, 4.6, 7.6, 5.8, 9.8, -5.8, 9.8]).fill(BELL_METAL);
  g.poly([-3.4, 7.8, 3.4, 7.8, 4.4, 9.8, -4.4, 9.8]).fill(BELL_DARK);
  g.moveTo(-5.4, 9.6).lineTo(5.4, 9.6).stroke({ width: 0.6, color: 0x7c869e });

  // --- 2. Dark metallic octagonal descent stage with restrained gold thermal blanket inset ---
  g.poly([-14.8, 2.2, 14.8, 2.2, 14.8, 7.2, 10.4, 8.4, -10.4, 8.4, -14.8, 7.2]).fill(STAGE_MID);
  g.poly([-14.8, 2.2, -8.2, 2.2, -8.2, 8.4, -10.4, 8.4, -14.8, 7.2]).fill(STAGE_SHADE);
  g.poly([8.2, 2.2, 14.8, 2.2, 14.8, 7.2, 10.4, 8.4, 8.2, 8.4]).fill(STAGE_SHADE);
  g.roundRect(-7.2, 3.2, 14.4, 4.2, 0.7).fill(GOLD_ACCENT);
  g.moveTo(-6.2, 4.1).lineTo(-1.8, 5.2).lineTo(2.6, 4.0).lineTo(6.0, 5.4).stroke({ width: 0.45, color: GOLD_HI, alpha: 0.75 });
  g.roundRect(-7.2, 3.2, 14.4, 4.2, 0.7).stroke({ width: 0.5, color: GOLD_DEEP, alpha: 0.7 });
  g.moveTo(-8.2, 2.2).lineTo(-8.2, 8.4).stroke({ width: 0.55, color: FOIL_DARK, alpha: 0.75 });
  g.moveTo(8.2, 2.2).lineTo(8.2, 8.4).stroke({ width: 0.55, color: FOIL_DARK, alpha: 0.75 });
  g.moveTo(-14.2, 2.6).lineTo(14.2, 2.6).stroke({ width: 0.5, color: STAGE_HI, alpha: 0.65 });
  g.rect(-13.6, 1.2, 27.2, 1.3).fill(FOIL_DARK);

  // Small boarding ladder on the forward flank of the descent stage.
  g.moveTo(10.8, 2.2).lineTo(10.8, 8.4).stroke({ width: 0.55, color: STRUT_METAL });
  g.moveTo(13.0, 2.2).lineTo(13.0, 8.4).stroke({ width: 0.55, color: STRUT_METAL });
  for (let ly = 3.2; ly <= 7.6; ly += 1.4) {
    g.moveTo(10.8, ly).lineTo(13.0, ly).stroke({ width: 0.45, color: 0xe6edf8 });
  }

  // --- 3. Angular faceted ascent cabin (paint-tinted) ---
  g.poly([-13.6, -2.6, -10.8, -7.2, -4.6, -7.8, -4.6, 1.4, -13.6, 1.4]).fill(FOIL_DARK);
  g.poly([-12.4, -2.2, -10.0, -6.2, -5.4, -6.6, -5.4, 0.8, -12.4, 0.8]).fill(mix(cabinShade, FOIL_DARK, 0.45));

  g.poly([-5.6, -8.8, 6.4, -8.6, 12.0, -4.6, 12.2, 1.4, -5.6, 1.4]).fill(cabin);
  g.poly([-5.6, -1.2, 12.2, -1.2, 12.2, 1.4, -5.6, 1.4]).fill(cabinShade);
  g.moveTo(-5.0, -8.3).lineTo(6.1, -8.1).lineTo(11.4, -4.4).stroke({ width: 0.75, color: cabinHi, alpha: 0.9, cap: 'round' });
  g.poly([-5.6, -8.8, 6.4, -8.6, 12.0, -4.6, 12.2, 1.4, -5.6, 1.4]).stroke({ width: 0.55, color: cabinDeep, alpha: 0.55 });

  // Forward docking hatch & triangular cockpit window (passenger sits inside via setRider).
  g.roundRect(7.4, -2.8, 3.6, 3.6, 0.6).fill(cabinDeep);
  g.poly([-1.8, -7.2, 6.6, -7.0, 9.6, -3.4, -1.8, -3.4]).fill(GLASS);
  g.poly([-1.8, -7.2, 6.6, -7.0, 9.6, -3.4, -1.8, -3.4]).stroke({ width: 0.55, color: FOIL_DARK });
  g.moveTo(0.2, -6.3).lineTo(5.6, -6.1).stroke({ width: 0.7, color: GLASS_SHINE, alpha: 0.7, cap: 'round' });

  // Crisp micro American flag on the ascent cabin flank.
  const fx = -4.6;
  const fy = -2.4;
  g.rect(fx, fy, 4.6, 2.6).fill(0xffffff);
  for (let i = 0; i < 4; i++) {
    g.rect(fx, fy + i * 0.7, 4.6, 0.35).fill(FLAG_RED);
  }
  g.rect(fx, fy, 2.0, 1.4).fill(FLAG_BLUE);
  g.rect(fx, fy, 4.6, 2.6).stroke({ width: 0.25, color: FOIL_DARK, alpha: 0.65 });

  // S-band dish antenna & rendezvous radar mast on the roof.
  g.moveTo(-2.4, -8.8).lineTo(-2.4, -9.8).stroke({ width: 0.8, color: STRUT_METAL });
  g.moveTo(-4.4, -9.6).quadraticCurveTo(-2.4, -8.8, -0.4, -9.6).stroke({ width: 0.85, color: STRUT_HI });
  g.moveTo(4.2, -8.6).lineTo(5.0, -9.8).stroke({ width: 0.65, color: STRUT_METAL });
  g.circle(5.1, -9.7, 0.55).fill(STRUT_HI);

  // Quad RCS thruster pods on rear & nose flanks.
  g.roundRect(-15.0, -3.2, 2.0, 2.4, 0.5).fill(BELL_METAL);
  g.roundRect(11.6, -3.4, 2.2, 2.4, 0.5).fill(BELL_METAL);
}

class LunarLanderArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Container();
  readonly rider = new Graphics();
  private paint = new Graphics();
  private warn = new Graphics();
  private marks = new Graphics();
  private sparks = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.2, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint);
    this.scars.addChild(this.marks, this.sparks);
    // Upscale the lunar lander body (~1.28×) for stronger gameplay visibility.
    for (const layer of [this.body, this.scars, this.rider]) {
      layer.scale.set(BODY_SCALE);
      layer.position.set(0, BODY_OFFSET_Y);
    }
    this.setGear(0);
  }

  /**
   * Four titanium-silver spider landing struts anchored to the upscaled descent stage,
   * visibly splayed in flight and telescoping cleanly onto y = 24 (±20) to land.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const clamped = Math.max(0, Math.min(1, p));
    const e = clamped * clamped * (3 - 2 * clamped);
    const locked = clamped >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const stageBottomY = 8.4 * BODY_SCALE + BODY_OFFSET_Y; // ~8.55

    // Central rear-depth silver spider leg.
    const midY = 14.2 + (bottom - 2.6 - 14.2) * e;
    g.moveTo(0, stageBottomY).lineTo(0, midY).stroke({ width: 1.7, color: STRUT_DARK, alpha: 0.85 });
    g.roundRect(-3.8, midY, 7.6, 2.0, 0.9).fill({ color: PAD_DARK, alpha: 0.9 });

    // Primary left & right spider legs anchored to the wider upscaled descent stage.
    for (const s of [-1, 1]) {
      const topX = s * 14.0;
      const topY = 4.6 * BODY_SCALE + BODY_OFFSET_Y; // ~3.7
      const footX = s * (15.2 + 0.8 * e); // reaches ±16.0 (pad outer edge ±20.0)
      const footY = 14.6 + (bottom - 2.0 - 14.6) * e;
      const padHalf = 3.6 + 0.4 * e;
      const padH = 1.8 + 0.2 * e;

      g.moveTo(topX, topY).lineTo(footX, footY).stroke({ width: 2.1, color: STRUT_HI, cap: 'round' });
      g.moveTo(topX, topY)
        .lineTo(topX + (footX - topX) * 0.42, topY + (footY - topY) * 0.42)
        .stroke({ width: 3.0, color: STRUT_DARK, cap: 'round' });

      g.moveTo(s * 11.4, stageBottomY - 0.3)
        .lineTo(topX + (footX - topX) * 0.58, topY + (footY - topY) * 0.58)
        .stroke({ width: 1.25, color: STRUT_METAL, cap: 'round' });

      g.moveTo(s * 8.6, stageBottomY)
        .lineTo(footX - s * 1.4, footY - 1.0)
        .stroke({ width: 1.0, color: STRUT_METAL, alpha: 0.85 });

      g.poly([
        footX - padHalf, footY + padH,
        footX - padHalf * 0.7, footY,
        footX + padHalf * 0.7, footY,
        footX + padHalf, footY + padH,
      ]).fill(PAD_METAL);
      g.moveTo(footX - padHalf + 0.2, footY + padH - 0.2)
        .lineTo(footX + padHalf - 0.2, footY + padH - 0.2)
        .stroke({ width: 0.65, color: PAD_DARK });
      if (locked) g.circle(footX, footY - 2.1, 1.15).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-6, 4.2).lineTo(1, 5.4).stroke({ width: 0.65, color: GOLD_DEEP, alpha: 0.7, cap: 'round' });
      }
      if (stage >= 2) {
        g.moveTo(1.2, -6.5).lineTo(4.0, -4.6).lineTo(2.4, -3.5).stroke({ width: 0.5, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(-8.5, 5.2, 2.6).fill({ color: 0x161008, alpha: 0.55 });
      }
      if (stage >= 3) {
        g.circle(8.2, 4.8, 2.8).fill({ color: 0x100b06, alpha: 0.6 });
        g.circle(-7.2, -3.4, 2.6).fill({ color: 0x100b06, alpha: 0.55 });
      }
      this.paint.tint = stage >= 3 ? 0xecc4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
      if (stage < 3) this.sparks.clear();
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.85 + i * 0.41) % 1;
        const [sx, sy] = SPARKS[i]!;
        g.circle(sx + Math.sin(i * 7.3 + time * 3) * 2, sy + phase * 4.5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xfff1a8,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** Passenger peeking out of the forward triangular ascent-cabin window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(0.6, -4.6, 4.6, 1.5, 0.5).fill(look.shirt);
    g.circle(2.9, -5.9, 1.55).fill(look.skin);
    if (look.hat !== null) g.rect(1.3, -7.8, 3.2, 1.0).fill(look.hat);
  }
}

export const LUNAR_LANDER: SkinDef = {
  id: 'lunarLander',
  name: 'LUNAR LANDER',
  playerColor: LUNAR_SILVER,
  thrusters: {
    tail: { x: -19.4, y: -4.8, scale: 0.9 },
    nose: { x: 17.8, y: -5.0, scale: 0.9 },
    top: { x: 1.2, y: -13.4, scale: 0.9 },
    bottom: { x: 0, y: 10.4, scale: 1.2 },
  },
  create: (color) => new LunarLanderArt(color),
};
