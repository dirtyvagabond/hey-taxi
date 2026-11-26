import { Graphics } from 'pixi.js';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: number;
  gravity: number;
  drag: number;
}

export type ParticleSpec = Omit<Particle, 'max' | 'gravity' | 'drag'> & { gravity?: number; drag?: number };

const MAX_PARTICLES = 2000;

/** Cosmetic particles (client only; uses Math.random freely). */
export class Particles {
  readonly gfx = new Graphics();
  private ps: Particle[] = [];

  emit(p: ParticleSpec): void {
    if (this.ps.length >= MAX_PARTICLES) return;
    this.ps.push({ gravity: 0, drag: 0, ...p, max: p.life });
  }

  update(dt: number): void {
    const ps = this.ps;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        ps[i] = ps[ps.length - 1]!;
        ps.pop();
        continue;
      }
      p.vy += p.gravity * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const p of this.ps) {
      const k = p.life / p.max;
      g.circle(p.x, p.y, Math.max(0.5, p.size * (0.35 + 0.65 * k))).fill({ color: p.color, alpha: Math.min(1, k * 1.6) });
    }
  }

  clear(): void {
    this.ps.length = 0;
    this.gfx.clear();
  }
}

const FLAME = [0xfff1a8, 0xffd166, 0xff9f1c, 0xff6b35];
const BLAST = [0xffffff, 0xfff1a8, 0xffd166, 0xff9f1c, 0xff4d2e, 0xffc83d];

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

export function exhaust(ps: Particles, x: number, y: number, dirX: number, dirY: number, carryVx: number, carryVy: number) {
  const speed = rnd(140, 240);
  ps.emit({
    x: x + rnd(-2, 2),
    y: y + rnd(-2, 2),
    vx: dirX * speed + rnd(-25, 25) + carryVx * 0.4,
    vy: dirY * speed + rnd(-25, 25) + carryVy * 0.4,
    life: rnd(0.18, 0.4),
    size: rnd(2, 3.5),
    color: pick(FLAME),
    drag: 3,
  });
}

export function explosion(ps: Particles, x: number, y: number, vx: number, vy: number) {
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rnd(40, 340);
    ps.emit({
      x,
      y,
      vx: Math.cos(a) * s + vx * 0.3,
      vy: Math.sin(a) * s + vy * 0.3,
      life: rnd(0.4, 1.3),
      size: rnd(2, 5),
      color: pick(BLAST),
      gravity: 260,
      drag: 1.2,
    });
  }
}

/** Missile exhaust: a spark of flame and a lingering puff of smoke behind it. */
export function missileTrail(ps: Particles, x: number, y: number, vx: number, vy: number) {
  const sp = Math.hypot(vx, vy) || 1;
  const bx = x - (vx / sp) * 9;
  const by = y - (vy / sp) * 9;
  ps.emit({ x: bx, y: by, vx: rnd(-15, 15), vy: rnd(-15, 15), life: rnd(0.5, 0.9), size: rnd(2.5, 4), color: 0x6b7194, drag: 2 });
  ps.emit({ x: bx, y: by, vx: -vx * 0.2, vy: -vy * 0.2, life: rnd(0.08, 0.16), size: rnd(2, 3), color: pick(FLAME) });
}

/**
 * The pop when flares are ejected: a muzzle flash of sparks and a puff of smoke under the cab.
 * (The flares themselves are sim objects drawn by MissileLayer, with flareTrail below.)
 */
export function flareBurst(ps: Particles, x: number, y: number, vx: number, vy: number) {
  for (let i = 0; i < 12; i++) {
    const a = Math.PI / 2 + rnd(-1.4, 1.4);
    const s = rnd(60, 160);
    ps.emit({
      x,
      y: y + 8,
      vx: Math.cos(a) * s + vx * 0.3,
      vy: Math.sin(a) * s + vy * 0.3,
      life: rnd(0.15, 0.35),
      size: rnd(1.5, 2.5),
      color: pick([0xffffff, 0xfff1a8]),
      drag: 3,
    });
  }
  for (let i = 0; i < 12; i++) {
    ps.emit({ x: x + rnd(-12, 12), y: y + rnd(6, 16), vx: rnd(-20, 20), vy: rnd(-10, 20), life: rnd(0.6, 1.1), size: rnd(3, 5), color: 0x8a90b0, drag: 2 });
  }
}

/** Behind a burning flare: sparks and a thick white smoke trail (very visible, like real ones). */
export function flareTrail(ps: Particles, x: number, y: number) {
  ps.emit({ x: x + rnd(-2, 2), y: y + rnd(-2, 2), vx: rnd(-25, 25), vy: rnd(-25, 10), life: rnd(0.15, 0.3), size: rnd(1.5, 2.5), color: pick([0xffffff, 0xffd166]), drag: 2 });
  ps.emit({ x, y, vx: rnd(-8, 8), vy: rnd(-18, -4), life: rnd(0.7, 1.2), size: rnd(3, 5), color: 0xc9cde0, drag: 1.5 });
}

/** A damaged taxi trails smoke; at its last hull point it's on fire too. Call once per tick. */
/**
 * Smoke from a damaged taxi, by hull stage (see hullStage): none when clean, an occasional
 * light wisp, a steady light trail, thick dark smoke with sparks, then black smoke and
 * flames. It leaves from the flank away from the direction of travel and drifts outward, so
 * the hull pips above the cab stay clear.
 */
export function damageSmoke(ps: Particles, t: { x: number; y: number; vx: number; vy: number }, stage: number) {
  if (stage <= 0) return;
  const side = t.vx > 25 ? -1 : t.vx < -25 ? 1 : Math.random() < 0.5 ? -1 : 1;
  const from = () => ({ x: t.x + side * rnd(9, 17), y: t.y + rnd(-3, 5) });
  const drift = () => side * rnd(12, 30) - t.vx * 0.15;
  const SMOKE = [
    null,
    { chance: 0.06, color: 0x8a90ad, size: [2.5, 4], life: [0.5, 0.8] },
    { chance: 0.35, color: 0x6b7194, size: [3, 5], life: [0.6, 1.0] },
    { chance: 0.7, color: 0x3a3d52, size: [3.5, 6], life: [0.7, 1.2] },
    { chance: 0.95, color: 0x1c1d28, size: [4, 7], life: [0.8, 1.4] },
  ][Math.min(stage, 4)]!;
  if (Math.random() < SMOKE.chance) {
    const at = from();
    ps.emit({ ...at, vx: drift(), vy: rnd(-40, -18), life: rnd(SMOKE.life[0]!, SMOKE.life[1]!), size: rnd(SMOKE.size[0]!, SMOKE.size[1]!), color: SMOKE.color, drag: 1 });
  }
  // Sparks from 2 points left.
  if (stage >= 3 && Math.random() < (stage === 4 ? 0.08 : 0.04)) {
    const at = from();
    ps.emit({ ...at, vx: side * rnd(40, 110), vy: rnd(-80, -20), life: rnd(0.2, 0.4), size: rnd(1.2, 2), color: 0xffe9a8, gravity: 300, drag: 0.5 });
  }
  // Flames on the last point.
  if (stage >= 4 && Math.random() < 0.6) {
    const at = from();
    ps.emit({ ...at, vx: drift() * 0.6, vy: rnd(-70, -30), life: rnd(0.15, 0.35), size: rnd(2, 3.5), color: pick(FLAME), drag: 2 });
  }
}

/** A missile detonating on a flare: a bright white flash with sparks. */
export function decoyBlast(ps: Particles, x: number, y: number) {
  for (let i = 0; i < 36; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rnd(40, 220);
    ps.emit({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), size: rnd(1.5, 3.5), color: pick([0xffffff, 0xfff1a8, 0xffd166, 0xff9f1c]), gravity: 120, drag: 2 });
  }
}

/** Small blast when a missile hits a wall or burns out. */
export function missileBlast(ps: Particles, x: number, y: number) {
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rnd(30, 180);
    ps.emit({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.25, 0.6), size: rnd(1.5, 3.5), color: pick(BLAST), gravity: 120, drag: 2 });
  }
}

/** A ring of glowing motes: something has just arrived. */
export function arrival(ps: Particles, x: number, y: number, color: number) {
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const s = rnd(60, 140);
    ps.emit({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.4, 0.8), size: rnd(1.5, 3), color, drag: 3 });
  }
}

/** Metal-on-metal sparks when taxis bump; `strength` 0–1. */
export function sparks(ps: Particles, x: number, y: number, strength: number) {
  const n = Math.round(6 + strength * 18);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rnd(60, 220) * (0.5 + strength);
    ps.emit({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rnd(0.15, 0.35),
      size: rnd(1, 2),
      color: pick([0xffffff, 0xfff1a8, 0xffd166]),
      gravity: 400,
    });
  }
}

export function dust(ps: Particles, x: number, y: number, strength: number) {
  const n = Math.round(6 + strength * 14);
  for (let i = 0; i < n; i++) {
    const dir = i % 2 ? 1 : -1;
    ps.emit({
      x: x + rnd(-14, 14),
      y: y - 1,
      vx: dir * rnd(30, 90) * (0.5 + strength),
      vy: rnd(-30, -5),
      life: rnd(0.3, 0.7),
      size: rnd(1.5, 3),
      color: 0x9aa3c7,
      drag: 3,
    });
  }
}
