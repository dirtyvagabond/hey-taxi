import { Container, Graphics, type Text } from 'pixi.js';
import { Input, TAXI, type ServiceCraft } from '@hey-taxi/sim';
import { makeText } from './text';

const { halfW: HW, halfH: HH, gearLength: GL, feetHalfW: FW } = TAXI;
export const SERVICE_COLOR = 0x3ee6d8;

class ServiceCraftView {
  readonly root = new Container();
  private art = new Container();
  private flames = new Graphics();
  private gear = new Graphics();
  private body = new Graphics();
  private beacon = new Graphics();
  private tag: Text;

  constructor() {
    this.drawBody();
    this.art.addChild(this.gear, this.body, this.beacon);
    this.tag = makeText('SERVICE', { fontSize: 10, fill: SERVICE_COLOR, letterSpacing: 1 });
    this.tag.anchor.set(0.5, 1);
    this.tag.position.set(0, -HH - 10);
    this.root.addChild(this.flames, this.art, this.tag);
  }

  private drawBody(): void {
    const g = this.body;
    // Utility shuttle / fuel van hull (within TAXI.halfW × TAXI.halfH).
    g.roundRect(-HW, -HH, HW * 2, HH * 2, 5).fill(0xe8f3ff).stroke({ width: 1.5, color: 0x1a2c47 });
    // Teal service stripe along lower hull.
    g.rect(-HW + 1, 2, HW * 2 - 2, HH - 3).fill(SERVICE_COLOR);
    // Amber fuel canister accent on the rear half.
    g.roundRect(-HW + 4, -HH + 3, 16, 8, 2).fill(0xff9f1c).stroke({ width: 1, color: 0x7a4200 });
    // Cockpit windshield on the front (right when facing +1).
    g.poly([4, -HH + 3, HW - 3, -HH + 3, HW - 2, 1, 4, 1]).fill(0x16243b);
    g.poly([6, -HH + 4, HW - 6, -HH + 4, HW - 6, -2, 6, -2]).fill({ color: 0x7ef7ff, alpha: 0.35 });
    // Rooftop beacon base.
    g.roundRect(-4, -HH - 4, 8, 4, 1).fill(0x1a2c47);
  }

  update(c: ServiceCraft, x: number, y: number, time: number): void {
    this.root.position.set(x, y);
    this.art.scale.x = c.facing === -1 ? -1 : 1;

    // Landing skids.
    this.gear.clear();
    if (c.gear > 0.02) {
      const ext = GL * c.gear;
      const footY = HH + ext;
      this.gear.moveTo(-12, HH).lineTo(-15, footY).moveTo(12, HH).lineTo(15, footY).stroke({ width: 2.5, color: 0x9bb2d4 });
      this.gear.roundRect(-FW, footY - 3, FW * 2, 3, 1.5).fill(0xcfe0f5);
    }

    // Pulsing amber rooftop beacon.
    this.beacon.clear();
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(time * (c.status === 'docked' ? 3 : 7)));
    this.beacon.circle(0, -HH - 5, 3).fill({ color: 0xffb732, alpha: pulse });
    this.beacon.circle(0, -HH - 5, 6).fill({ color: 0xffb732, alpha: pulse * 0.28 });

    // Thruster flames.
    this.drawFlames(c.thrust, time);

    const label = c.status === 'docked' ? 'SERVICE · OPEN' : c.status === 'departing' ? 'SERVICE' : 'SERVICE · EN ROUTE';
    if (this.tag.text !== label) this.tag.text = label;
  }

  private drawFlames(thrust: number, time: number): void {
    const f = this.flames;
    f.clear();
    if (!thrust) return;
    const flick = (k: number) => 0.78 + 0.22 * Math.sin(time * 52 + k * 1.7);
    const flame = (x: number, y: number, dx: number, dy: number, len: number, w: number) => {
      const px = -dy;
      const py = dx;
      f.poly([x + px * w, y + py * w, x - px * w, y - py * w, x + dx * len, y + dy * len]).fill({
        color: SERVICE_COLOR,
        alpha: 0.85,
      });
      f.poly([
        x + px * w * 0.5,
        y + py * w * 0.5,
        x - px * w * 0.5,
        y - py * w * 0.5,
        x + dx * len * 0.55,
        y + dy * len * 0.55,
      ]).fill(0xe8ffff);
    };
    if (thrust & Input.UP) {
      flame(-7, HH, 0, 1, 15 * flick(0), 3.5);
      flame(7, HH, 0, 1, 15 * flick(1), 3.5);
    }
    if (thrust & Input.DOWN) flame(0, -HH, 0, -1, 10 * flick(2), 2.5);
    if (thrust & Input.LEFT) flame(HW, 0, 1, 0, 11 * flick(3), 3);
    if (thrust & Input.RIGHT) flame(-HW, 0, -1, 0, 11 * flick(4), 3);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** Manages all rendered flying convenience service crafts in world space. */
export class ServiceLayer {
  readonly root = new Container();
  private views = new Map<number, ServiceCraftView>();

  update(
    crafts: readonly ServiceCraft[],
    prev: ReadonlyMap<number, { x: number; y: number }>,
    alpha: number,
    time: number,
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
      const x = p.x + (c.x - p.x) * alpha;
      const y = p.y + (c.y - p.y) * alpha;
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
