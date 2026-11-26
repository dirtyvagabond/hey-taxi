import { Container, Graphics, type Text } from 'pixi.js';
import { PASSENGER, type Passenger } from '@hey-taxi/sim';
import { makeText } from './text';

/** Per-kind look. Placeholder people: simple shapes, original. */
export const PASSENGER_LOOKS = [
  { shirt: 0xff6b9d, skin: 0xf1c27d, hat: 0x2b2f4a },
  { shirt: 0x6dd3ff, skin: 0xc68642, hat: null },
  { shirt: 0xa0ff6d, skin: 0x8d5524, hat: null },
  { shirt: 0xffa94d, skin: 0xffdbac, hat: 0x7a2f2f },
] as const;

export function lookFor(kind: number) {
  return PASSENGER_LOOKS[kind % PASSENGER_LOOKS.length]!;
}

type Anchor = () => { x: number; y: number } | null;

interface Bubble {
  root: Container;
  anchor: Anchor;
  last: { x: number; y: number };
  life: number;
}

interface FloatText {
  text: Text;
  vy: number;
  life: number;
  max: number;
}

interface Sprite {
  gfx: Graphics;
  phase: number;
  nextHail: number;
  hailedInView: boolean;
  firstSightPending: boolean;
}

const BUBBLE_LIFE = 2.4;
const LEAVE_TICKS = 72;

/**
 * Draws passengers, their speech bubbles and floating money text (world space).
 */
export class PassengerLayer {
  readonly root = new Container();
  private people = new Container();
  private overlay = new Container();
  private sprites = new Map<number, Sprite>();
  private bubbles = new Map<string, Bubble>();
  private floats: FloatText[] = [];
  private time = 0;

  constructor(
    private hailLines: (p: Passenger, firstSight: boolean) => string,
    private onHail?: (p: Passenger, line: string, firstSight: boolean) => void,
  ) {
    this.root.addChild(this.people, this.overlay);
  }

  clear(): void {
    for (const s of this.sprites.values()) s.gfx.destroy();
    this.sprites.clear();
    for (const b of this.bubbles.values()) b.root.destroy({ children: true });
    this.bubbles.clear();
    for (const f of this.floats) f.text.destroy();
    this.floats = [];
  }

  /** Speech bubble that follows `anchor` (falls back to its last position once the anchor is gone). */
  say(key: string, text: string, _kind: number, anchor: Anchor, life = BUBBLE_LIFE): void {
    this.bubbles.get(key)?.root.destroy({ children: true });
    const label = makeText(text, { fontSize: 12, fill: 0x14182e });
    const padX = 7;
    const padY = 4;
    const w = Math.ceil(label.width) + padX * 2;
    const h = Math.ceil(label.height) + padY * 2;
    const bg = new Graphics()
      .roundRect(-w / 2, -h - 6, w, h, 6)
      .fill(0xf4f6ff)
      .poly([-5, -7, 5, -7, 0, 0])
      .fill(0xf4f6ff);
    label.anchor.set(0.5, 0.5);
    label.position.set(0, -6 - h / 2);
    const root = new Container();
    root.addChild(bg, label);
    this.overlay.addChild(root);
    const start = anchor() ?? { x: 0, y: 0 };
    this.bubbles.set(key, { root, anchor, last: start, life });
  }

  /** Rising, fading text such as "+$14.20". */
  /** Floating text that drifts up and fades (`size` px, lasting `life` s). */
  float(
    x: number,
    y: number,
    text: string,
    color: number,
    /**
     * size (px) and life (s); anchorX 0 = text starts at x, 0.5 = centered, 1 = ends at x;
     * placed: put it exactly at (x, y) instead of stacking above recent floats nearby (for
     * messages laid out together on purpose, like the drop-off summary and a tip cut).
     */
    opts: { size?: number; life?: number; anchorX?: number; placed?: boolean } = {},
  ): void {
    const size = opts.size ?? 15;
    const life = opts.life ?? 1.4;
    const t = makeText(text, { fontSize: size, fill: color, stroke: { color: 0x05070f, width: 3 } });
    t.anchor.set(opts.anchorX ?? 0.5, 0.5);
    // Stack above any recent float nearby so quick successive messages don't overlap.
    const recent = opts.placed ? [] : this.floats.filter((f) => f.max - f.life < 0.6 && Math.abs(f.text.x - x) < 80);
    const lift = recent.reduce((h, f) => h + f.text.height + 2, 0);
    t.position.set(x, y - lift);
    this.overlay.addChild(t);
    this.floats.push({ text: t, vy: -38, life, max: life });
  }

  /** Show a hail bubble immediately (e.g. on initial spawn callout) and push back next hail. */
  forceHail(p: Passenger, text: string, inView: boolean): void {
    let s = this.sprites.get(p.id);
    if (!s) {
      s = {
        gfx: new Graphics(),
        phase: 0,
        nextHail: this.time + 5.5 + Math.random() * 3,
        hailedInView: inView,
        firstSightPending: false,
      };
      this.sprites.set(p.id, s);
      this.people.addChild(s.gfx);
    } else {
      s.nextHail = this.time + 5.5 + Math.random() * 3;
      if (inView) {
        s.hailedInView = true;
        s.firstSightPending = false;
      }
    }
    this.say(`p${p.id}`, text, p.kind, () => this.headOf(p));
  }

  /** Passenger anchor for bubbles: above their head. */
  headOf(p: Passenger): { x: number; y: number } {
    return { x: p.x, y: p.y - PASSENGER.height - 4 };
  }

  update(passengers: readonly Passenger[], dt: number, canFirstSightHail?: (p: Passenger) => boolean): void {
    this.time += dt;
    const seen = new Set<number>();
    for (const p of passengers) {
      seen.add(p.id);
      let s = this.sprites.get(p.id);
      if (!s) {
        s = { gfx: new Graphics(), phase: 0, nextHail: this.time + 0.3, hailedInView: false, firstSightPending: false };
        this.sprites.set(p.id, s);
        this.people.addChild(s.gfx);
      }
      const visible = p.state !== 'riding';
      s.gfx.visible = visible;
      if (!visible) continue;
      const walking = p.state === 'walking' || p.state === 'leaving';
      if (walking) s.phase += dt * 14;
      if (p.state === 'waiting') {
        if (!s.hailedInView && canFirstSightHail?.(p)) {
          s.hailedInView = true;
          s.firstSightPending = true;
          s.nextHail = Math.min(s.nextHail, this.time + 0.15);
        }
        if (this.time >= s.nextHail) {
          const firstSight = s.firstSightPending;
          s.firstSightPending = false;
          const line = this.hailLines(p, firstSight);
          this.say(`p${p.id}`, line, p.kind, () => this.headOf(p));
          this.onHail?.(p, line, firstSight);
          s.nextHail = this.time + 5 + Math.random() * 3;
        }
      }
      const waving = p.state === 'waiting' && this.bubbles.has(`p${p.id}`);
      drawPerson(s.gfx, p.kind, walking ? s.phase : null, waving ? this.time : null, p.dir);
      s.gfx.position.set(p.x, p.y);
      s.gfx.alpha = p.state === 'leaving' ? Math.min(1, p.leaveTicks / (LEAVE_TICKS * 0.5)) : 1;
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        s.gfx.destroy();
        this.sprites.delete(id);
      }
    }

    for (const [key, b] of this.bubbles) {
      b.life -= dt;
      if (b.life <= 0) {
        b.root.destroy({ children: true });
        this.bubbles.delete(key);
        continue;
      }
      const at = b.anchor();
      if (at) b.last = at;
      b.root.position.set(b.last.x, b.last.y);
      b.root.alpha = Math.min(1, b.life / 0.3);
    }

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]!;
      f.life -= dt;
      if (f.life <= 0) {
        f.text.destroy();
        this.floats.splice(i, 1);
        continue;
      }
      f.text.y += f.vy * dt;
      f.vy *= 1 - dt * 1.5;
      f.text.alpha = Math.min(1, f.life / 0.4);
    }
  }
}

/** A tiny person, feet at (0,0), ~22u tall. */
function drawPerson(g: Graphics, kind: number, walkPhase: number | null, waveTime: number | null, dir: number): void {
  const look = lookFor(kind);
  g.clear();
  const swing = walkPhase === null ? 0 : Math.sin(walkPhase) * 2.5;
  const bob = walkPhase === null ? 0 : Math.abs(Math.sin(walkPhase)) * -0.8;
  g.rect(-3.5 + swing, -7, 2.5, 7).fill(0x2b3050);
  g.rect(1 - swing, -7, 2.5, 7).fill(0x2b3050);
  g.roundRect(-4.5, -16 + bob, 9, 10, 3).fill(look.shirt);
  g.circle(0, -19.5 + bob, 3.6).fill(look.skin);
  if (look.hat !== null) {
    g.rect(-3.5, -25 + bob, 7, 3).fill(look.hat);
    g.rect(-5, -22.5 + bob, 10, 1.3).fill(look.hat);
  }
  if (waveTime !== null) {
    const handY = -24 + Math.sin(waveTime * 12) * 2;
    g.moveTo(dir * 3, -14 + bob).lineTo(dir * 7, handY).stroke({ width: 2, color: look.shirt, cap: 'round' });
  } else {
    g.moveTo(dir * 3.5, -14 + bob).lineTo(dir * 4.5 + swing * 0.4, -8 + bob).stroke({ width: 2, color: look.shirt, cap: 'round' });
  }
}
