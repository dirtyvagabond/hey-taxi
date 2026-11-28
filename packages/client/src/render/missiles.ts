import { Graphics } from 'pixi.js';
import { DT, TAXI, targetable, wrapDelta, type Decoy, type Missile, type SimState, type Taxi } from '@hey-taxi/sim';

/** Draws missiles in flight and a lock-on reticle around the current target (world space). */
export class MissileLayer {
  readonly gfx = new Graphics();

  /**
   * `alpha` is the interpolation factor between sim ticks; missiles are drawn slightly
   * behind their tick position so fast movement looks smooth.
   */
  update(
    missiles: readonly Missile[],
    decoys: readonly Decoy[],
    lockOn: { x: number; y: number } | null,
    alpha: number,
    time: number,
    wrap?: { refX: number; refY: number; w: number; h: number } | null,
  ): void {
    const g = this.gfx;
    g.clear();
    const wx = (v: number) => (wrap ? wrap.refX + wrapDelta(wrap.refX, v, wrap.w) : v);
    const wy = (v: number) => (wrap ? wrap.refY + wrapDelta(wrap.refY, v, wrap.h) : v);

    // Burning flares: a flickering glow, a hot yellow body and a white-hot core.
    for (const d of decoys) {
      const back = (1 - alpha) * DT;
      const x = wx(d.x - d.vx * back);
      const y = wy(d.y - d.vy * back);
      const flicker = 0.8 + 0.2 * Math.sin(time * 40 + d.id * 1.7);
      g.circle(x, y, 14 * flicker).fill({ color: 0xffd166, alpha: 0.18 });
      g.circle(x, y, 8 * flicker).fill({ color: 0xffe9a8, alpha: 0.45 });
      g.circle(x, y, 4).fill(0xfff6d8);
      g.circle(x, y, 2).fill(0xffffff);
    }

    if (lockOn) {
      const pulse = 1 + 0.12 * Math.sin(time * 10);
      const w = (TAXI.halfW + 10) * pulse;
      const h = (TAXI.halfH + TAXI.gearLength / 2 + 10) * pulse;
      const { x, y } = lockOn;
      const cy = y + TAXI.gearLength / 2;
      const len = 8;
      const color = 0xff5c5c;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const cx0 = x + sx * w;
        const cy0 = cy + sy * h;
        g.moveTo(cx0, cy0 - sy * len).lineTo(cx0, cy0).lineTo(cx0 - sx * len, cy0);
      }
      g.stroke({ width: 2, color, alpha: 0.85 });
    }

    for (const m of missiles) {
      const back = (1 - alpha) * DT;
      const x = wx(m.x - m.vx * back);
      const y = wy(m.y - m.vy * back);
      const a = Math.atan2(m.vy, m.vx);
      const c = Math.cos(a);
      const s = Math.sin(a);
      // Body: a short capsule pointing along the velocity.
      const p = (fx: number, fy: number) => [x + c * fx - s * fy, y + s * fx + c * fy];
      g.poly([...p(9, 0), ...p(4, -3), ...p(-7, -3), ...p(-7, 3), ...p(4, 3)]).fill(0xe8ecff);
      g.poly([...p(9, 0), ...p(5, -3), ...p(5, 3)]).fill(0xff5c5c);
      g.poly([...p(-7, -3), ...p(-10, -6), ...p(-5, -3)]).fill(0x8a93b8);
      g.poly([...p(-7, 3), ...p(-10, 6), ...p(-5, 3)]).fill(0x8a93b8);
      const flick = 6 + Math.random() * 5;
      g.poly([...p(-7, -2), ...p(-7 - flick, 0), ...p(-7, 2)]).fill(0xffd166);
    }
  }
}

/**
 * The taxi a missile fired now would chase: the nearest other taxi missiles can see (not
 * crashed, not parked safe at a store).
 */
export function lockTarget(sim: SimState, shooter: Taxi): Taxi | undefined {
  let best: Taxi | undefined;
  let bestD = Infinity;
  for (const t of sim.taxis) {
    if (t === shooter || !targetable(sim, t)) continue;
    const dx = sim.level.wrap ? wrapDelta(shooter.x, t.x, sim.level.width) : t.x - shooter.x;
    const dy = sim.level.wrap ? wrapDelta(shooter.y, t.y, sim.level.height) : t.y - shooter.y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}
