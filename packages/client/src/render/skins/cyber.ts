/**
 * "CYBER TAXI": an homage to the angular stainless pickup. A single-apex wedge with no
 * curves (a long straight hood-and-windshield line up to a peak behind center, then one
 * straight slope down to a squared tail), brushed-steel panels with a hard beltline crease,
 * dark armored glass, a full-width light bar at the nose, a red bar across the tail, and an
 * angular TAXI lamp on the apex.
 *
 * The body color tints the steel (30%) and lights the nose bar; the default gold leaves the
 * steel raw. Gear: hexagonal wheel pods that drop out of the trapezoid arches on pistons.
 * Damage: a dent crease, then a spiderweb crack in the glass, then a door knocked out of
 * line with sparks and a flickering bar, and finally a red strobe and warning outline.
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox; extended
 * skids sit at the bottom of the feet box (y 24), outer edges at ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default body color: classic gold, shown only on the light bar (the steel stays raw). */
export const CYBER_GOLD = 0xffc83d;
const STEEL = 0xb8bdc3;
const GLASS = 0x14171c;
const GLASS_SHINE = 0x4a5360;
const CLADDING = 0x2a2d33;
const TIRE = 0x17191d;
const TAIL = 0xff2a3a;
const WARN = 0xff3b3b;
/** How far the steel is tinted toward the body color. */
const TINT = 0.3;

/** The hull, nose at +x: hood line up to the apex (-8.6), slope down to the tail, floor at +9.0. */
const HULL: readonly number[] = [
  24, -0.4, -3, -8.6, -24, -4.0, -24, 7.2, -23, 9.0,
  -20, 9.0, -18, 4.6, -10, 4.6, -8, 9.0,
  8, 9.0, 10, 4.6, 18, 4.6, 20, 9.0,
  23, 9.0, 24, 6.2,
];
/** Below the beltline crease (y 2.0): the slightly darker lower flank. */
const LOWER: readonly number[] = [
  24, 2.0, 24, 6.2, 23, 9.0, 20, 9.0, 18, 4.6, 10, 4.6, 8, 9.0,
  -8, 9.0, -10, 4.6, -18, 4.6, -20, 9.0, -23, 9.0, -24, 7.2, -24, 2.0,
];
/** The armored glass: one long sharp-cornered pane under the roof lines. */
const PANE: readonly number[] = [-11.0, -1.6, -9.8, -5.9, -3, -7.2, 12.6, -2.5, 13.0, -1.6];
/** The TAXI lamp on the apex (its base sinks into the roof). */
const LAMP: readonly number[] = [-6.5, -7.4, -5.6, -10.0, -0.4, -10.0, 0.5, -7.2];
/** Wheel pod centers (x), one per arch. */
const PODS = [-14, 14] as const;
/** Where sparks fly from while critical, as [x, y]. */
const SPARKS: readonly (readonly [number, number])[] = [
  [10.4, 4.2],
  [-14, 3.8],
  [6, -1.9],
  [22, 5.5],
];

/** Lift dark colors toward white so the light bar always reads as lit. */
function litColor(color: number): number {
  const lum = 0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255);
  return lum >= 140 ? color : mix(color, 0xffffff, Math.min(0.7, (140 - lum) / 180));
}

/** A lit bar: soft halo, then a bright core. */
function lightBar(g: Graphics, x0: number, y0: number, x1: number, y1: number, color: number): void {
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3.2, color, alpha: 0.22, cap: 'round' });
  g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.1, color: mix(color, 0xffffff, 0.45), cap: 'round' });
}

function drawBody(g: Graphics, steel: number): void {
  const lower = mix(steel, 0x000000, 0.12);
  const seam = mix(steel, 0x000000, 0.55);
  const shine = mix(steel, 0xffffff, 0.6);
  g.poly([...HULL]).fill(steel);
  g.poly([...LOWER]).fill(lower);
  // Brushed grain: faint horizontal lines above the arches.
  for (const [y, x0, x1] of [[-0.9, -23, 22], [0.4, -23, 23], [2.7, -23, 23]] as const) {
    g.moveTo(x0, y).lineTo(x1, y).stroke({ width: 0.3, color: 0xffffff, alpha: 0.2 });
  }
  g.moveTo(-23, 3.2).lineTo(23, 3.2).stroke({ width: 0.3, color: 0x000000, alpha: 0.1 });
  // The beltline crease: a lit edge over a shadowed one.
  g.moveTo(-24, 1.75).lineTo(24, 1.75).stroke({ width: 0.5, color: shine, alpha: 0.9 });
  g.moveTo(-24, 2.25).lineTo(24, 2.25).stroke({ width: 0.4, color: seam, alpha: 0.5 });
  // Roof edges: the hood line catches the light; the rear slope sits in shade.
  g.moveTo(24, -0.4).lineTo(-3, -8.6).stroke({ width: 0.7, color: shine, cap: 'round' });
  g.moveTo(-3, -8.6).lineTo(-24, -4.0).stroke({ width: 0.6, color: seam, alpha: 0.6, cap: 'round' });
  // Door seams.
  for (const [x, y1] of [[-10.8, 4.6], [1, 9.0], [9.6, 5.4]] as const) {
    g.moveTo(x, -1.6).lineTo(x, y1).stroke({ width: 0.35, color: seam, alpha: 0.55 });
  }
  // Arch cladding, rocker, and bumpers.
  for (const ax of PODS) {
    g.poly([ax - 6.3, 9.0, ax - 4.2, 4.1, ax + 4.2, 4.1, ax + 6.3, 9.0], false).stroke({
      width: 1.3,
      color: CLADDING,
      join: 'miter',
    });
  }
  g.rect(-8, 7.6, 16, 1.4).fill(CLADDING);
  g.rect(20, 7.6, 3.2, 1.4).fill(CLADDING);
  g.rect(-23, 7.6, 3, 1.4).fill(CLADDING);
  // Armored glass, split at the pillar, with one sharp glint.
  g.poly([...PANE]).fill(GLASS);
  g.moveTo(1, -6.9).lineTo(1, -1.6).stroke({ width: 1, color: steel });
  g.moveTo(4, -3.9).lineTo(8.8, -2.7).stroke({ width: 0.55, color: GLASS_SHINE, cap: 'round' });
  // The TAXI lamp: a dark faceted housing around a lit panel.
  g.poly([...LAMP]).fill(mix(steel, 0x000000, 0.35));
}

/** One hexagonal wheel (tire, faceted aero cap, hub) centered at (x, y). */
function hexWheel(g: Graphics, x: number, y: number, r: number, cap: number): void {
  const hex = (rad: number) => {
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) pts.push(x + Math.cos((k * Math.PI) / 3) * rad, y + Math.sin((k * Math.PI) / 3) * rad);
    return pts;
  };
  g.poly(hex(r)).fill(TIRE);
  g.poly(hex(r * 0.62)).fill(cap);
  g.poly(hex(r * 0.62)).stroke({ width: 0.3, color: 0x000000, alpha: 0.4 });
  g.circle(x, y, r * 0.16).fill(0x000000);
}

class CyberArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  private paint = new Graphics();
  /** The nose light bar and the lamp panel (the body color); flickers when critical. */
  private bar = new Graphics();
  /** The red strobe that replaces the bar on the last point. */
  private strobe = new Graphics();
  private tail = new Graphics();
  /** The last-point warning outline, behind the paint. */
  private warn = new Graphics();
  readonly scars = new Container();
  private marks = new Graphics();
  private sparks = new Graphics();
  readonly rider = new Graphics();
  private steel: number;
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    this.steel = mix(STEEL, color, color === CYBER_GOLD ? 0 : TINT);
    const lit = litColor(color);
    drawBody(this.paint, this.steel);
    lightBar(this.bar, 23.6, -0.7, 18.4, -2.2, lit);
    this.bar.rect(-5, -9.5, 4, 1.5).fill(lit);
    lightBar(this.strobe, 23.6, -0.7, 18.4, -2.2, WARN);
    this.strobe.rect(-5, -9.5, 4, 1.5).fill(WARN);
    this.strobe.visible = false;
    lightBar(this.tail, -23.6, -3.8, -19, -4.8, TAIL);
    this.warn.poly([...HULL]).stroke({ width: 4, color: WARN, alpha: 0.9, join: 'miter' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.bar, this.strobe, this.tail);
    this.scars.addChild(this.marks, this.sparks);
  }

  /**
   * Retracted, each hex wheel sits tucked up in its arch. Extending drops it on a piston
   * (a dark sleeve with a chrome rod) so the tires rest flush on the pad at y = 24.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const r = 3.4;
    const top = 4.6;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = 6.6; // tucked: bottom at 10.0, flush with the hitbox
    const downY = bottom - r * Math.sin(Math.PI / 3); // flat bottom of hex tire rests flush on y = 24
    const y = restY + (downY - restY) * e;
    const cap = mix(this.steel, 0xffffff, 0.15);
    for (const ax of PODS) {
      if (e > 0) {
        g.moveTo(ax, top).lineTo(ax, y).stroke({ width: 1.3, color: mix(this.steel, 0xffffff, 0.4) });
        g.moveTo(ax, top).lineTo(ax, top + Math.min(y - top, 6)).stroke({ width: 2.6, color: CLADDING });
      }
      hexWheel(g, ax, y, r, cap);
      if (locked) g.circle(ax, y - r - 1.9, 1.15).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      const dark = { width: 0.45, color: 0x000000, alpha: 0.5, cap: 'round', join: 'round' } as const;
      const lite = { width: 0.35, color: 0xffffff, alpha: 0.45, cap: 'round', join: 'round' } as const;
      // Damaged: a dent creased into the flank.
      if (stage >= 1) {
        g.moveTo(-6, -0.6).lineTo(-3.2, 1).lineTo(-0.4, 0).stroke(dark);
        g.moveTo(-6, -0.1).lineTo(-3.2, 1.5).lineTo(-0.4, 0.5).stroke(lite);
      }
      // Battered: a spiderweb crack in the armored glass, and a second dent.
      if (stage >= 2) {
        const cx = 6;
        const cy = -2.9;
        const crack = { width: 0.4, color: 0xe8eef5, alpha: 0.85, cap: 'round' } as const;
        const rays: readonly (readonly [number, number])[] = [
          [3.2, 0.8], [2.6, -0.9], [0, -1.15], [-2.6, -1.0], [-3, 0.9], [0.4, 1.0],
        ];
        for (const [dx, dy] of rays) g.moveTo(cx, cy).lineTo(cx + dx, cy + dy).stroke(crack);
        const ring = rays.flatMap(([dx, dy]) => [cx + dx * 0.5, cy + dy * 0.5]);
        g.poly(ring).stroke({ ...crack, width: 0.3, alpha: 0.6 });
        g.circle(cx, cy, 0.5).fill({ color: 0xffffff, alpha: 0.9 });
        g.moveTo(-20, -0.8).lineTo(-17.5, 0.6).lineTo(-15, -0.2).stroke(dark);
      }
      // Critical: the front door knocked out of line (a dark gap and a lifted edge).
      if (stage >= 3) {
        g.poly([9.2, -1.6, 10.3, -1.6, 10.8, 4.3, 9.4, 4.5]).fill(0x0c0d10);
        g.moveTo(10.3, -1.6).lineTo(10.8, 4.3).stroke({ width: 0.5, color: 0xffffff, alpha: 0.7 });
      }
      // Soot dulls the steel; critical shifts it toward red.
      this.paint.tint = stage >= 3 ? 0xf0b8b0 : stage === 2 ? 0xe4e4e4 : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0c8c0 : 0xffffff;
      this.warn.visible = stage === 4;
      this.strobe.visible = stage === 4;
      this.bar.visible = stage !== 4;
      this.bar.alpha = 1;
      if (stage < 3) this.sparks.clear();
    }
    if (stage === 3) {
      // The bar flickers as its wiring fails.
      const noise = Math.sin(time * 41.3) * Math.sin(time * 11.9 + 0.7);
      this.bar.alpha = noise > 0.55 ? 0.2 : 1;
    }
    if (stage === 4) {
      // Hard red strobe, double-flash rhythm, and a pulsing outline.
      const t = (time * 2.2) % 1;
      this.strobe.alpha = t < 0.12 || (t > 0.24 && t < 0.36) ? 1 : 0.15;
      this.warn.alpha = 0.5 + 0.5 * Math.abs(Math.sin(time * 5));
    }
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.9 + i * 0.41) % 1;
        const [sx, sy] = SPARKS[i]!;
        g.circle(sx + Math.sin(i * 7.3 + time * 3) * 2, sy + phase * 5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xfff1a8,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** A passenger behind the rear glass. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-6.8, -3.2, 6.0, 1.7, 0.7).fill(look.shirt);
    g.circle(-3.8, -4.7, 1.75).fill(look.skin);
    if (look.hat !== null) g.rect(-5.7, -6.8, 3.8, 1.2).fill(look.hat);
  }
}

export const CYBER_TAXI: SkinDef = {
  id: 'cyberTaxi',
  name: 'CYBER TAXI',
  playerColor: 0xf0f4ff,
  thrusters: {
    tail: { x: -24, y: 2 },
    nose: { x: 24, y: 2.5 },
    top: { x: -3, y: -8.6 },
    bottom: [
      { x: -6, y: 9.0 },
      { x: 6, y: 9.0 },
    ],
  },
  create: (color) => new CyberArt(color),
};
