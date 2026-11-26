/** "CLAUDE'S BUS": the first taxi art, unchanged (a rounded yellow cab with a checker band). */
import { Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import type { HullStage, SkinArt, SkinDef } from './types';

const { halfW: HW, halfH: HH } = TAXI;

class OriginalArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Graphics();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private scarStage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.body, color);
  }

  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.rect(1, -4, 7, 2).fill(look.shirt);
    g.circle(4.5, -5.5, 2.4).fill(look.skin);
    if (look.hat !== null) g.rect(2.2, -8, 4.6, 1.6).fill(look.hat);
  }

  /**
   * Soot and scorch on the body: a light soot from 3 points down, scorch marks spreading
   * at 2 left, and a pulsing red edge at the last point.
   */
  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.scarStage) {
      this.scarStage = stage;
      g.clear();
      g.alpha = 1;
      if (stage >= 2) {
        g.roundRect(-HW, -HH, HW * 2, HH * 2, 6).fill({ color: 0x000000, alpha: stage === 2 ? 0.1 : 0.18 });
        // Scorch on the left flank (and the right once it's critical).
        const blot = (x: number, y: number, r: number) => {
          g.circle(x, y, r).fill({ color: 0x1a1208, alpha: 0.55 });
          g.circle(x + r * 0.5, y - r * 0.3, r * 0.55).fill({ color: 0x000000, alpha: 0.45 });
        };
        blot(-HW + 6, 4, 4);
        blot(-HW + 11, 7, 2.5);
        if (stage >= 3) {
          blot(HW - 7, 5, 4.5);
          blot(HW - 13, 2, 2.5);
          blot(-HW + 4, -5, 2.5);
          g.moveTo(-3, -HH + 3).lineTo(1, -HH + 7).lineTo(-1, -HH + 10).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
        }
      }
      if (stage === 4) g.roundRect(-HW - 1, -HH - 1, HW * 2 + 2, HH * 2 + 2, 7).stroke({ width: 2, color: 0xff3b3b, alpha: 1 });
    }
    // The glow pulses (soot stays put): only the last stage animates.
    if (stage === 4) g.alpha = 0.75 + 0.25 * Math.abs(Math.sin(time * 5));
  }

  /**
   * Two struts hinged inside the body. Retracted, they lie folded inward, hidden behind
   * the body; extending swings each one down and outward until its foot sits exactly at
   * the bottom of the feet hitbox.
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p); // smoothstep
    const locked = p >= 1;
    for (const s of [-1, 1]) {
      const hx = s * 10;
      const hy = HH - 3;
      const from = Math.atan2(1, -s * 17); // folded inward
      // Extended foot center: 4u inside the skid edge, at the bottom of the gear.
      const reachX = TAXI.feetHalfW - 4 - Math.abs(hx);
      const reachY = TAXI.gearLength + (HH - hy);
      const to = Math.atan2(reachY, s * reachX); // down and out
      const a = from + (to - from) * e;
      const len = Math.hypot(reachX, reachY);
      const fx = hx + Math.cos(a) * len;
      const fy = hy + Math.sin(a) * len;
      g.moveTo(hx, hy).lineTo(fx, fy).stroke({ width: 3, color: 0x9aa3c7, cap: 'round' });
      g.circle(hx, hy, 2.5).fill(0x5d668c);
      g.roundRect(fx - 4, fy - 3, 8, 3, 1.5).fill(locked ? 0xd6ddff : 0x8a93b8); // outer edge = feetHalfW
      if (locked) g.circle(fx, fy - 5, 1.3).fill(0x6dff8a);
    }
  }
}

function drawBody(g: Graphics, color: number): void {
  g.roundRect(-HW, -HH, HW * 2, HH * 2, 6).fill(color);
  // lower shade
  g.roundRect(-HW + 1, 3, HW * 2 - 2, HH - 4, 3).fill({ color: 0x000000, alpha: 0.14 });
  // checker band
  for (let i = 0; i < 12; i++) {
    g.rect(-HW + 2 + i * 3.67, -1 + (i % 2) * 2, 3.67, 2).fill(0x111111);
  }
  // cabin window
  g.roundRect(-13, -8, 26, 6, 2).fill(0x1b2a4a);
  g.rect(-11, -7, 8, 1.5).fill({ color: 0xffffff, alpha: 0.5 });
  // roof light
  g.roundRect(-5, -HH, 10, 2.5, 1).fill(0xfff3b0);
  // nav lights
  g.rect(-HW, -3, 2, 4).fill(0xff4d6d);
  g.rect(HW - 2, -3, 2, 4).fill(0x6dffb0);
}

export const ORIGINAL: SkinDef = {
  id: 'original',
  name: "CLAUDE'S BUS",
  playerColor: 0xffc83d,
  create: (color) => new OriginalArt(color),
};
