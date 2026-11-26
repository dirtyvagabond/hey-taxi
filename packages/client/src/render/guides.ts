import { Container, Graphics, type Text } from 'pixi.js';
import { VIEW_H, VIEW_W } from '../camera';
import { makeText } from './text';

export const GUIDE_COLORS = { pickup: 0x6dff8a, dropoff: 0xffe066 };

/** Something to fly to: a pad surface span. */
export interface GuideTarget {
  x: number;
  y: number;
  w: number;
  label: string;
  color: number;
}

const EDGE_MARGIN = 34;

/** Highlights where to fly next, and points at it when it's off-screen. */
export class Guides {
  /** World-space: glow and bobbing chevron. */
  readonly world = new Graphics();
  /** Screen-space: edge arrow for off-screen targets. */
  readonly screen = new Container();
  private arrow = new Graphics();
  private label: Text;

  constructor() {
    // Additive so the glow brightens the scene instead of tinting it gray.
    this.world.blendMode = 'add';
    this.label = makeText('', { fontSize: 12, fill: 0xffffff });
    this.label.anchor.set(0.5);
    this.screen.addChild(this.arrow, this.label);
  }

  update(target: GuideTarget | null, camX: number, camY: number, time: number): void {
    const g = this.world;
    g.clear();
    this.arrow.clear();
    this.label.visible = false;
    if (!target) return;
    const { x, y, w, color } = target;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);

    for (let i = 0; i < 6; i++) {
      // Glow fading upward away from the pad surface.
      g.rect(x, y - 5 * (i + 1), w, 5).fill({ color, alpha: (0.1 + 0.08 * pulse) * (1 - i / 6) });
    }
    g.rect(x, y - 2, w, 2).fill({ color, alpha: 0.6 + 0.4 * pulse });
    const cx = x + w / 2;
    const cy = y - 44 + Math.sin(time * 4) * 4;
    g.poly([cx - 7, cy, cx + 7, cy, cx, cy + 8]).fill({ color, alpha: 0.9 });

    // Off-screen arrow, in view coordinates.
    const sx = cx - camX;
    const sy = y - 20 - camY;
    if (sx >= 0 && sx <= VIEW_W && sy >= 0 && sy <= VIEW_H) return;
    const ex = Math.min(Math.max(sx, EDGE_MARGIN), VIEW_W - EDGE_MARGIN);
    const ey = Math.min(Math.max(sy, EDGE_MARGIN + 70), VIEW_H - EDGE_MARGIN - 20);
    const a = Math.atan2(sy - ey, sx - ex);
    const tip = { x: ex + Math.cos(a) * 14, y: ey + Math.sin(a) * 14 };
    const l = { x: ex + Math.cos(a + 2.5) * 10, y: ey + Math.sin(a + 2.5) * 10 };
    const r = { x: ex + Math.cos(a - 2.5) * 10, y: ey + Math.sin(a - 2.5) * 10 };
    this.arrow.circle(ex, ey, 17).fill({ color: 0x05070f, alpha: 0.6 });
    this.arrow.poly([tip.x, tip.y, l.x, l.y, r.x, r.y]).fill(color);
    this.label.text = target.label;
    this.label.style.fill = color;
    this.label.position.set(ex - Math.cos(a) * 30, ey - Math.sin(a) * 30);
    this.label.visible = true;
  }
}
