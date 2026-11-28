/**
 * "BOOMBOX": a 1980s chrome-and-black street ghetto blaster. Chunky brushed-metallic
 * chassis with a top carry handle, angled telescoping radio antenna, twin giant circular
 * speaker woofers, animated multi-color LED equalizer bars bouncing in real time, a central
 * recessed cassette tape deck window (where the passenger sits!), and drop-down rubber
 * stereo feet on chrome struts for landing gear.
 *
 * The body color tints the boombox trim & speaker-ring accents (default: classic 80s
 * Tangerine/Chrome) while keeping the metallic face, dual woofers, and bouncing EQ bars
 * unmistakable.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended stereo feet sit flush on the pad at y = 24, outer edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default accent color: 1980s Boombox Chrome-Silver / Cobalt. */
export const BOOMBOX_SILVER = 0x4ef2f2;

const CASE_DARK = 0x1c202c;
const CASE_MID = 0x2f364a;
const CHROME_HI = 0xe8effc;
const CHROME_MID = 0x9aa6bd;
const CHROME_DARK = 0x4b546b;
const WOOFER_BG = 0x10131c;
const DECK_BG = 0x0d1424;
const WARN = 0xff3b3b;

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.roundRect(-14.5, -9.6, 29.0, 3.2, 1.2);
  g.roundRect(-23.2, -6.2, 46.4, 15.6, 2.2);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const accentHi = mix(color, 0xffffff, 0.4);

  // Angled telescoping chrome radio antenna sticking up from the rear corner.
  g.moveTo(-18.5, -6.2).lineTo(-22.5, -9.8).stroke({ width: 0.75, color: CHROME_HI, cap: 'round' });
  g.circle(-22.5, -9.8, 0.55).fill(CHROME_HI);

  // Chunky top chrome carry handle (x: -14.2..+14.2, y: -9.6..-6.2).
  g.moveTo(-13.6, -6.2).lineTo(-13.6, -9.0).lineTo(13.6, -9.0).lineTo(13.6, -6.2)
    .stroke({ width: 1.7, color: CHROME_MID, join: 'round' });
  g.moveTo(-13.0, -9.2).lineTo(13.0, -9.2).stroke({ width: 0.65, color: CHROME_HI });

  // Main boxy 1980s ghetto-blaster chassis (x: -23.2..+23.2, y: -6.2..+9.4).
  g.roundRect(-23.2, -6.2, 46.4, 15.6, 2.0).fill(CASE_DARK);
  g.roundRect(-22.4, -5.4, 44.8, 14.0, 1.5).fill(CASE_MID);
  // Top metallic control bar & rotary tuning knobs.
  g.rect(-22.4, -5.4, 44.8, 2.8).fill(CHROME_MID);
  g.moveTo(-22.0, -5.0).lineTo(22.0, -5.0).stroke({ width: 0.65, color: CHROME_HI });
  // Colored paint-accent radio dial band across the top bar.
  g.roundRect(-10.5, -4.8, 21.0, 1.6, 0.4).fill(CASE_DARK);
  g.moveTo(-9.5, -4.0).lineTo(9.5, -4.0).stroke({ width: 0.65, color, alpha: 0.9 });
  g.rect(1.5, -4.7, 0.7, 1.4).fill(0xff4d6d); // red tuner needle
  // Control buttons & knobs on left/right of top bar.
  for (const bx of [-19.5, -16.8, -14.1, 14.1, 16.8, 19.5] as const) {
    g.circle(bx, -4.0, 0.85).fill(CASE_DARK).stroke({ width: 0.35, color: CHROME_HI });
  }

  // Twin giant circular speaker woofers (left x = -14.8, right x = +14.8, y = +2.6).
  for (const wx of [-14.8, 14.8] as const) {
    g.circle(wx, 2.6, 6.2).fill(CHROME_DARK);
    g.circle(wx, 2.6, 5.8).stroke({ width: 0.9, color });
    g.circle(wx, 2.6, 5.2).fill(WOOFER_BG);
    g.circle(wx, 2.6, 3.6).stroke({ width: 0.55, color: CHROME_DARK });
    g.circle(wx, 2.6, 1.9).fill(CHROME_MID);
    g.circle(wx, 2.6, 0.9).fill(accentHi);
  }

  // Central recessed cassette tape deck window (passenger sits inside via setRider!).
  g.roundRect(-6.8, -1.8, 13.6, 6.8, 1.0).fill(DECK_BG).stroke({ width: 0.7, color: CHROME_MID });
  // Tiny cassette reels behind the passenger.
  g.circle(-3.4, 2.6, 1.2).stroke({ width: 0.55, color: CHROME_DARK });
  g.circle(3.4, 2.6, 1.2).stroke({ width: 0.55, color: CHROME_DARK });
  // Piano-key tape transport buttons below the deck.
  for (let i = 0; i < 5; i++) {
    g.rect(-5.8 + i * 2.4, 5.6, 1.9, 1.2).fill(i === 2 ? color : CHROME_MID);
  }
  // Recessed dark EQ meter bar window along the bottom center.
  g.rect(-6.4, 7.2, 12.8, 1.6).fill(WOOFER_BG);

  // Subtle chrome outer bezel outline.
  g.roundRect(-23.2, -6.2, 46.4, 15.6, 2.0).stroke({ width: 0.6, color: CHROME_MID, alpha: 0.75 });
}

class BoomboxArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  /** Animated bouncing multi-color LED EQ bars. */
  private eq = new Graphics();
  private warn = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.5, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.eq);
  }

  /** Chunky rubber stereo feet dropping straight down on chrome telescopic struts to y = 24. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const top = 8.8;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const fy = top + (bottom - 2.4 - top) * e;

    for (const s of [-1, 1]) {
      const fx = s * (TAXI.feetHalfW - 5.5); // ±14.5 → pad outer edge ±20
      g.moveTo(fx, top).lineTo(fx, fy).stroke({ width: 2.2, color: CHROME_HI, cap: 'round' });
      g.moveTo(fx, top).lineTo(fx, top + Math.min(fy - top, 5.5)).stroke({ width: 3.2, color: CASE_DARK });
      g.roundRect(fx - 5.5, fy, 11.0, 2.4, 0.9).fill(CASE_DARK);
      g.roundRect(fx - 5.5, fy, 11.0, 0.7, 0.35).fill(CHROME_MID);
      if (locked) g.circle(fx, fy - 2.0, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.scars;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-18, -2.5).lineTo(-12, -1.5).stroke({ width: 0.6, color: 0x0a0d14, alpha: 0.75 });
      }
      if (stage >= 2) {
        g.moveTo(-4.0, -1.2).lineTo(0.2, 2.6).lineTo(-1.4, 4.4).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.circle(15, 2.6, 2.8).fill({ color: 0x100b06, alpha: 0.55 });
      }
      if (stage >= 3) {
        g.circle(-15, 3.0, 3.0).fill({ color: 0x0d0905, alpha: 0.6 });
        g.circle(6, -3.5, 2.2).fill({ color: 0x0d0905, alpha: 0.55 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.warn.visible = stage === 4;
    }

    // Bouncing 8-band 1980s LED equalizer bars!
    const eq = this.eq;
    eq.clear();
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const level = 0.25 + 0.75 * Math.abs(Math.sin(time * (4.5 + i * 1.1) + i * 1.3));
      const h = Math.max(0.6, level * 3.8);
      const bx = -5.8 + i * 1.55;
      const col = stage === 4 ? WARN : level > 0.78 ? 0xff4d6d : level > 0.5 ? 0xffc83d : 0x4ee68c;
      eq.rect(bx, 8.6 - h, 1.15, h).fill(col);
    }

    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger chilling inside the recessed cassette tape deck window! */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-2.6, 2.6, 5.2, 2.0, 0.7).fill(look.shirt);
    g.circle(0, 0.9, 1.8).fill(look.skin);
    if (look.hat !== null) g.rect(-1.9, -1.4, 3.8, 1.1).fill(look.hat);
  }
}

export const BOOMBOX: SkinDef = {
  id: 'boombox',
  name: 'BOOMBOX',
  playerColor: BOOMBOX_SILVER,
  thrusters: {
    tail: { x: -23.4, y: 2.0 },
    nose: { x: 23.4, y: 2.0 },
    top: { x: 0, y: -9.4, scale: 0.85 },
    bottom: [
      { x: -8.0, y: 9.4 },
      { x: 8.0, y: 9.4 },
    ],
  },
  create: (color) => new BoomboxArt(color),
};
