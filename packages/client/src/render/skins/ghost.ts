/**
 * "GHOST NEON": a wedge cab drawn as glowing outline strokes over a faint dark backing (so
 * it still reads against bright skies). The body color is the glow color; dark paints are
 * lifted so the glow never goes dull. Damage shows as flicker, broken lines, a red shift
 * with sparks, and finally a pulsing red outline.
 *
 * Taxi-local units, facing right. The body stays inside the ±24 × ±10 hitbox; extended
 * feet sit at the bottom of the feet box (y 24), outer edges at ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default glow color: electric cyan. */
export const GHOST_CYAN = 0x3ff4ff;
const BACKING = 0x070814;
const WINDOW = 0x05040c;
const TAIL = 0xff3d7f;
const WARN = 0xff3b3b;

/** The cab's outline, nose at +x. */
const HULL: readonly number[] = [
  -23, 8, -23, 1, -17, -1, -11, -9, 5, -9, 12, -2, 22, 0, 24, 4, 21, 8,
];
/** The canopy window. */
const PANE: readonly number[] = [-12.5, -0.8, -8.6, -7.2, 4, -7.2, 9.4, -0.8];
/** Points on the outline where battered lines break (stage 2+), as [x, y, angle]. */
const BREAKS: readonly (readonly [number, number, number])[] = [
  [-14, -5, -0.93],
  [16.5, -1, 0.18],
  [-6, 8, 0],
  [-23, 4.5, Math.PI / 2],
];

/** Lift dark colors toward white so the glow stays visible. */
function glowColor(color: number): number {
  const lum = 0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255);
  return lum >= 150 ? color : mix(color, 0xffffff, Math.min(0.7, (150 - lum) / 200));
}

/** A glowing stroke: wide faint halo, mid glow, bright core. */
function glowStroke(g: Graphics, color: number, core = 1.1): Graphics {
  return g
    .stroke({ width: core + 4.5, color, alpha: 0.14, join: 'round', cap: 'round' })
    .stroke({ width: core + 1.8, color, alpha: 0.35, join: 'round', cap: 'round' })
    .stroke({ width: core, color: mix(color, 0xffffff, 0.55), alpha: 1, join: 'round', cap: 'round' });
}

function drawLines(g: Graphics, color: number): void {
  glowStroke(g.poly([...HULL]), color);
  glowStroke(g.poly([...PANE]), color, 0.8);
  // Speed stripe along the flank, and a short one under the canopy.
  glowStroke(g.moveTo(-19, 4).lineTo(18, 4), color, 0.7);
  glowStroke(g.moveTo(-10, 6.3).lineTo(6, 6.3), color, 0.5);
  // Headlamp and tail light.
  g.circle(21.4, 2.6, 2.6).fill({ color: 0xffffff, alpha: 0.18 });
  g.circle(21.4, 2.6, 1.1).fill(0xffffff);
  glowStroke(g.moveTo(-22.2, 3).lineTo(-22.2, 6), TAIL, 0.9);
}

class GhostArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  private backing = new Graphics();
  private lines = new Graphics();
  /** The last-point warning outline, behind the lines. */
  private warn = new Graphics();
  readonly scars = new Graphics();
  /** Sparks, redrawn each frame while critical. */
  private sparks = new Graphics();
  private breaks = new Graphics();
  readonly rider = new Graphics();
  private glow: number;
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    this.glow = glowColor(color);
    this.backing.poly([...HULL]).fill({ color: BACKING, alpha: 0.78 });
    this.backing.poly([...PANE]).fill({ color: WINDOW, alpha: 0.95 });
    drawLines(this.lines, this.glow);
    this.warn.poly([...HULL]).stroke({ width: 5, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.backing, this.warn, this.lines);
    this.scars.addChild(this.breaks, this.sparks);
  }

  /** Two telescoping struts that slide straight down, each ending in a glowing skid. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const top = 6;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const y = top + (bottom - 1 - top) * e;
    const footHalf = 6 * (0.4 + 0.6 * e);
    for (const s of [-1, 1]) {
      const x = s * (TAXI.feetHalfW - 6);
      glowStroke(g.moveTo(x, top).lineTo(x, y), this.glow, 0.9);
      glowStroke(g.moveTo(x - footHalf, y).lineTo(x + footHalf, y), this.glow, 1.1);
    }
    g.alpha = 0.35 + 0.65 * e;
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const b = this.breaks;
      b.clear();
      // Battered: gaps knocked out of the outline (dark dashes over the glow).
      for (const [x, y, a] of BREAKS.slice(0, stage >= 3 ? 4 : stage >= 2 ? 2 : 0)) {
        const dx = Math.cos(a) * 1.8;
        const dy = Math.sin(a) * 1.8;
        b.moveTo(x - dx, y - dy).lineTo(x + dx, y + dy).stroke({ width: 3.4, color: BACKING, cap: 'butt' });
      }
      // Critical: the glow shifts toward red.
      this.lines.tint = stage >= 3 ? 0xff9a9a : 0xffffff;
      this.gear.tint = this.lines.tint;
      this.warn.visible = stage === 4;
      if (stage < 3) this.sparks.clear();
    }
    // Flicker: more often, and deeper, as the hull fails.
    const noise = Math.sin(time * 37.1) * Math.sin(time * 13.7 + 1.3);
    const threshold = [2, 0.93, 0.8, 0.6, 0.4][stage]!;
    this.lines.alpha = noise > threshold ? 0.35 : 1;
    if (stage === 4) this.warn.alpha = 0.5 + 0.5 * Math.abs(Math.sin(time * 5));
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.7 + i * 0.37) % 1;
        const [bx, by] = BREAKS[i]!;
        g.circle(bx + Math.sin(i * 9.1 + time * 3) * 2, by + phase * 5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xfff1a8,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** A passenger in the canopy. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(0, -2.6, 5.6, 1.8, 0.8).fill(look.shirt);
    g.circle(2.8, -4.4, 1.9).fill(look.skin);
    if (look.hat !== null) g.rect(0.7, -6.8, 4.2, 1.3).fill(look.hat);
  }
}

export const GHOST_NEON: SkinDef = {
  id: 'ghostNeon',
  name: 'GHOST NEON',
  playerColor: GHOST_CYAN,
  create: (color) => new GhostArt(color),
};
