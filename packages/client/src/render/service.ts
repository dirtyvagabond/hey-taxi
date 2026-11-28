import { CanvasSource, Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import { Input, TAXI, wrapCoord, wrapDelta, type ServiceCraft } from '@hey-taxi/sim';
import { makeText } from './text';

const { halfW: HW, halfH: HH, gearLength: GL } = TAXI;

/** Crisp white primary color and rescue-red accent for Rescue Service UI & effects. */
export const RESCUE_WHITE = 0xf5f7fa;
export const RESCUE_RED = 0xff4252;
/** Primary accent alias kept for existing callers. */
export const SERVICE_COLOR = RESCUE_RED;

/**
 * Blocky-ish retro homage to the OG ambulance:
 * 24×10 texels at 2 world units per texel = 48×20 (exact ±HW × ±HH body footprint).
 * Facing right: stepped white roof, dark-red '+' cross on the rear side, black cab window,
 * stepped forward hood, and symmetric wheel wells at x = ±13.
 */
const TEXEL = 2;
const BODY_LEFT = -HW;
const BODY_TOP = -HH;

const BODY = [
  '...WWWWWWWWWWW..........',
  '.WWWWWWWWWWWWWWW........',
  '.WWWWWWWWWWKKKWW........',
  '.WWWWWRWWWWKKKWW........',
  '.WWWWRRRWWWKKKWW........',
  '.WWWWWRWWWWKKKWW........',
  '.WWWWWWWWWWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWWWWWWWWWW.',
  '.WWWWWWWWWWWWWWWWWWWWWW.',
  '.WW.....WWWWWWWW.....WW.',
];

/** Chunky pale-yellow OG wheel (5×4 texels = 10×8 world units) with dark corners and hub dot. */
const WHEEL = [
  'DYYYD',
  'YYYYY',
  'YYDYY',
  '.YYY.',
];
const WHEEL_W = WHEEL[0]!.length * TEXEL; // 10u
const WHEEL_H = WHEEL.length * TEXEL; // 8u
/** Symmetric wheel pod centers (x), matching the body wheel wells. */
const WHEEL_PODS = [-13, 13] as const;

const INK: Record<string, number> = {
  W: 0xf7f9fc, // crisp white ambulance body
  R: 0xa63434, // OG dark crimson '+' cross
  K: 0x0b0d14, // solid black cab window
  Y: 0xe6e89a, // OG pale cream-yellow wheels
  D: 0x16181f, // wheel top-corner & center-hub detail
};

const PISTON_SLEEVE = 0x2a2d33;
const PISTON_ROD = 0xd8e0ec;

const textures = new Map<string, Texture>();

function gridTexture(key: string, rows: readonly string[]): Texture {
  let tex = textures.get(key);
  if (tex) return tex;
  const h = rows.length;
  const w = rows[0]!.length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let r = 0; r < h; r++) {
    const row = rows[r]!;
    for (let c = 0; c < w; c++) {
      const ch = row[c];
      if (!ch || ch === '.') continue;
      const color = INK[ch]!;
      ctx.fillStyle = `rgb(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255})`;
      ctx.fillRect(c, r, 1, 1);
    }
  }
  tex = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }) });
  textures.set(key, tex);
  return tex;
}

class ServiceCraftView {
  readonly root = new Container();
  private art = new Container();
  private flames = new Graphics();
  private gear = new Graphics();
  private body: Sprite;
  private wheels: [Sprite, Sprite];
  private beacon = new Graphics();
  private tag: Text;

  constructor() {
    this.body = new Sprite(gridTexture('rescue:body', BODY));
    this.body.roundPixels = true;
    this.body.scale.set(TEXEL);
    this.body.position.set(BODY_LEFT, BODY_TOP);

    const wheelTex = gridTexture('rescue:wheel', WHEEL);
    this.wheels = WHEEL_PODS.map((ax) => {
      const s = new Sprite(wheelTex);
      s.roundPixels = true;
      s.scale.set(TEXEL);
      s.position.set(ax - WHEEL_W / 2, 4);
      return s;
    }) as [Sprite, Sprite];

    this.art.addChild(this.gear, this.body, this.wheels[0], this.wheels[1], this.beacon);

    this.tag = makeText('+ RESCUE', { fontSize: 10, fill: RESCUE_WHITE, letterSpacing: 1 });
    this.tag.anchor.set(0.5, 1);
    this.tag.position.set(0, -HH - 11);
    this.root.addChild(this.flames, this.art, this.tag);
  }

  update(c: ServiceCraft, x: number, y: number, time: number): void {
    this.root.position.set(x, y);
    this.art.scale.x = c.facing === -1 ? -1 : 1;

    this.updateGear(c.gear);
    this.drawBeacon(c.status, time);
    this.drawFlames(c.thrust, time);

    const label =
      c.status === 'docked' ? '+ RESCUE · OPEN' : c.status === 'departing' ? '+ RESCUE' : '+ RESCUE · EN ROUTE';
    if (this.tag.text !== label) this.tag.text = label;
  }

  /**
   * Wheel landing gear: retracted, the chunky OG yellow wheels sit tucked in their wheel
   * wells; extending drops them on pistons so the tires rest flush on the pad at y = 24.
   */
  private updateGear(p: number): void {
    const g = this.gear;
    g.clear();
    const clamped = Math.max(0, Math.min(1, p));
    const e = clamped * clamped * (3 - 2 * clamped);
    const locked = clamped >= 1;

    const top = 6; // inside the wheel well
    const bottom = HH + GL; // 24 (exact landing surface)
    const restTopY = 4; // tucked: bottom sits at y = 12 (2u proud of body, classic OG silhouette)
    const downTopY = bottom - WHEEL_H; // extended: tires rest flush on the pad at y = 24
    const wheelTopY = restTopY + (downTopY - restTopY) * e;
    const wheelCenterY = wheelTopY + WHEEL_H / 2;

    for (let i = 0; i < WHEEL_PODS.length; i++) {
      const ax = WHEEL_PODS[i]!;
      this.wheels[i]!.position.set(ax - WHEEL_W / 2, wheelTopY);

      if (e > 0.02) {
        // Piston rod + upper sleeve.
        g.moveTo(ax, top).lineTo(ax, wheelCenterY).stroke({ width: 1.6, color: PISTON_ROD });
        g.moveTo(ax, top).lineTo(ax, top + Math.min(wheelCenterY - top, 6)).stroke({ width: 3, color: PISTON_SLEEVE });
      }
      if (locked) {
        g.rect(ax - 1, wheelTopY - 3, 2, 2).fill(0x6dff8a);
      }
    }
  }

  /** Blocky retro red/white alternating rooftop beacon centered on the stepped ambulance roof. */
  private drawBeacon(status: ServiceCraft['status'], time: number): void {
    const b = this.beacon;
    b.clear();
    // Stepped roof spans cols 3..13 -> x = -18..+4, center at x = -7.
    const cx = -7;
    const baseY = BODY_TOP;

    // Dark mounting base.
    b.rect(cx - 5, baseY - 2, 10, 2).fill(0x1a1e29);

    const docked = status === 'docked';
    const phase = Math.floor(time * (docked ? 3 : 9)) % 2;
    const redLeft = phase === 0;
    const leftColor = redLeft ? RESCUE_RED : RESCUE_WHITE;
    const rightColor = redLeft ? RESCUE_WHITE : RESCUE_RED;
    const dim = docked ? 0.5 : 0.35;
    const glowAlpha = docked ? 0.22 : 0.42;

    // Blocky two-chamber lightbar.
    b.rect(cx - 4, baseY - 5, 4, 3).fill({ color: leftColor, alpha: redLeft ? 1 : dim });
    b.rect(cx, baseY - 5, 4, 3).fill({ color: rightColor, alpha: redLeft ? dim : 1 });

    // Soft retro glow around the active chamber.
    const activeX = redLeft ? cx - 2 : cx + 2;
    b.rect(activeX - 4, baseY - 7, 8, 7).fill({ color: RESCUE_RED, alpha: glowAlpha * (redLeft ? 1 : 0.45) });
    b.rect(activeX - 3, baseY - 6, 6, 5).fill({ color: RESCUE_WHITE, alpha: glowAlpha * (redLeft ? 0.45 : 0.9) });
  }

  /** Warm yellow/white retro thruster flames echoing the OG yellow wheels and crisp white hull. */
  private drawFlames(thrust: number, time: number): void {
    const f = this.flames;
    f.clear();
    if (!thrust) return;
    const flick = (k: number) => 0.78 + 0.22 * Math.sin(time * 52 + k * 1.7);
    const flame = (x: number, y: number, dx: number, dy: number, len: number, w: number) => {
      const px = -dy;
      const py = dx;
      f.poly([x + px * w, y + py * w, x - px * w, y - py * w, x + dx * len, y + dy * len]).fill({
        color: 0xffe478,
        alpha: 0.9,
      });
      f.poly([
        x + px * w * 0.5,
        y + py * w * 0.5,
        x - px * w * 0.5,
        y - py * w * 0.5,
        x + dx * len * 0.55,
        y + dy * len * 0.55,
      ]).fill(0xffffff);
    };
    if (thrust & Input.UP) {
      flame(-5, HH, 0, 1, 14 * flick(0), 3.2);
      flame(5, HH, 0, 1, 14 * flick(1), 3.2);
    }
    if (thrust & Input.DOWN) flame(-7, -HH, 0, -1, 10 * flick(2), 2.5);
    if (thrust & Input.LEFT) flame(HW - 2, 3, 1, 0, 11 * flick(3), 2.8);
    if (thrust & Input.RIGHT) flame(-HW + 2, 1, -1, 0, 11 * flick(4), 2.8);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** Manages all rendered Rescue Service ambulance crafts in world space. */
export class ServiceLayer {
  readonly root = new Container();
  private views = new Map<number, ServiceCraftView>();

  update(
    crafts: readonly ServiceCraft[],
    prev: ReadonlyMap<number, { x: number; y: number }>,
    alpha: number,
    time: number,
    wrap?: { refX: number; refY: number; w: number; h: number } | null,
  ): void {
    const seen = new Set<number>();
    for (const c of crafts) {
      seen.add(c.id);
      let view = this.views.get(c.id);
      if (!view) {
        view = new ServiceCraftView();
        this.views.set(c.id, view);
        this.root.addChild(view.root);
      }
      const p = prev.get(c.id) ?? c;
      let x: number;
      let y: number;
      if (wrap) {
        const ix = wrapCoord(p.x + wrapDelta(p.x, c.x, wrap.w) * alpha, wrap.w);
        const iy = wrapCoord(p.y + wrapDelta(p.y, c.y, wrap.h) * alpha, wrap.h);
        x = wrap.refX + wrapDelta(wrap.refX, ix, wrap.w);
        y = wrap.refY + wrapDelta(wrap.refY, iy, wrap.h);
      } else {
        x = p.x + (c.x - p.x) * alpha;
        y = p.y + (c.y - p.y) * alpha;
      }
      view.update(c, x, y, time);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.destroy();
      this.views.delete(id);
    }
  }

  clear(): void {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
  }
}
