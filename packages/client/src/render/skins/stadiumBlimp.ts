/**
 * "STADIUM BLIMP": a classic 1980s overhead stadium dirigible featuring a live scrolling
 * amber LED matrix signboard along its flank that continuously scrolls "HEY, TAXI!".
 * Plump silver-and-paint two-tone envelope, four cruciform tailfins, underslung panoramic
 * passenger gondola with tiny rear pusher prop, and retractable mooring landing struts.
 *
 * The body color paints the lower dirigible belly stripe and tailfin accents (default:
 * stadium Cobalt Blue) while keeping the glossy silver-white upper envelope and warm
 * amber-gold scrolling LED signboard crisp and unbranded.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox;
 * extended mooring skids sit flush on the pad at y = 24, outer edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default livery accent color: classic stadium Cobalt Blue. */
export const BLIMP_BLUE = 0x4ea8ff;

const ENVELOPE_TOP = 0xe4eaf7;
const ENVELOPE_MID = 0xc5cfe3;
const GONDOLA_BODY = 0x262d3f;
const GLASS = 0x13243e;
const GLASS_SHINE = 0x9cd4ff;
const SIGN_BG = 0x0a0d16;
const SIGN_FRAME = 0x3b445c;
const LED_AMBER = 0xffc83d;
const LED_CORE = 0xfff5b8;
const LED_OFF = 0x1a2030;
const STRUT = 0xa8b4cc;
const STRUT_DARK = 0x3c4459;
const WARN = 0xff3b3b;

/** Compact 3×5 pixel-matrix glyphs for the scrolling "HEY, TAXI!" stadium LED signboard. */
const GLYPHS: Record<string, readonly string[]> = {
  H: ['101', '101', '111', '101', '101'],
  E: ['111', '100', '110', '100', '111'],
  Y: ['101', '101', '010', '010', '010'],
  T: ['111', '010', '010', '010', '010'],
  A: ['010', '101', '111', '101', '101'],
  X: ['101', '101', '010', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  ',': ['00', '00', '00', '01', '10'],
  '!': ['1', '1', '1', '0', '1'],
  ' ': ['00', '00', '00', '00', '00'],
};

/** Pre-baked 5-row scrolling LED bitmap for "HEY, TAXI!   " (each column is a 5-bit mask). */
const LED_COLS: readonly number[] = (() => {
  const msg = 'HEY, TAXI!   ';
  const cols: number[] = [];
  for (const ch of msg) {
    const g = GLYPHS[ch] ?? GLYPHS[' ']!;
    const w = g[0]!.length;
    for (let c = 0; c < w; c++) {
      let mask = 0;
      for (let r = 0; r < 5; r++) {
        if (g[r]![c] === '1') mask |= 1 << r;
      }
      cols.push(mask);
    }
    cols.push(0); // 1-column letter spacing
  }
  return cols;
})();

const LED_WINDOW_COLS = 26;
const LED_PITCH = 0.92;
const LED_X0 = -((LED_WINDOW_COLS - 1) * LED_PITCH) / 2;
const LED_Y0 = -3.6;

/** Outer silhouette for the stage-4 red warning outline. */
function silhouette(g: Graphics): Graphics {
  g.ellipse(0.5, -1.8, 22.8, 7.8);
  g.roundRect(-4.8, 5.4, 12.0, 4.2, 1.4);
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.24);
  const deep = mix(color, 0x000000, 0.45);

  // Rear cruciform tailfins (top & bottom dorsal/ventral fins behind envelope).
  g.poly([-22.8, -4.4, -20.2, -9.6, -13.6, -7.8, -14.8, -3.2]).fill(color);
  g.poly([-22.8, 1.2, -20.2, 6.2, -13.6, 4.6, -14.8, 0.2]).fill(shade);
  g.moveTo(-20.2, -9.4).lineTo(-13.8, -7.7).stroke({ width: 0.6, color: mix(color, 0xffffff, 0.45) });

  // Underslung panoramic passenger gondola (x: -4.8..+7.2, y: +5.2..+9.6).
  g.roundRect(-4.8, 5.2, 12.0, 4.4, 1.6).fill(GONDOLA_BODY);
  g.roundRect(-3.8, 6.0, 9.8, 2.5, 0.8).fill(GLASS);
  g.moveTo(-2.6, 6.5).lineTo(3.8, 6.5).stroke({ width: 0.55, color: GLASS_SHINE, alpha: 0.65, cap: 'round' });
  // Tiny gondola rear pusher-prop housing.
  g.rect(-6.0, 6.8, 1.4, 1.4).fill(STRUT_DARK);

  // Plump glossy dirigible envelope (x: -22.3..+23.3, y: -9.6..+6.0).
  g.ellipse(0.5, -1.8, 22.8, 7.8).fill(ENVELOPE_TOP);
  // Lower envelope paint-colored belly band.
  g.moveTo(-20.6, 1.2)
    .quadraticCurveTo(0.5, 3.0, 21.6, 1.2)
    .quadraticCurveTo(14.0, 6.0, 0.5, 6.0)
    .quadraticCurveTo(-13.0, 6.0, -20.6, 1.2)
    .closePath()
    .fill(color);
  // Subtle underside shading on the belly band.
  g.moveTo(-16.0, 3.6)
    .quadraticCurveTo(0.5, 5.4, 17.0, 3.6)
    .quadraticCurveTo(10.0, 6.0, 0.5, 6.0)
    .quadraticCurveTo(-9.0, 6.0, -16.0, 3.6)
    .closePath()
    .fill({ color: shade, alpha: 0.7 });
  // Glossy upper-crown specular highlight & subtle envelope rib seams.
  g.moveTo(-14.5, -6.8).quadraticCurveTo(0.5, -9.2, 15.5, -6.8).stroke({ width: 1.2, color: 0xffffff, alpha: 0.8, cap: 'round' });
  g.moveTo(-19.5, -1.8).quadraticCurveTo(0.5, -3.2, 20.5, -1.8).stroke({ width: 0.45, color: ENVELOPE_MID, alpha: 0.6 });

  // Horizontal side stabilizer fin at the rear.
  g.poly([-23.4, -2.4, -15.6, -2.8, -15.6, -0.8, -23.4, -1.2]).fill(color).stroke({ width: 0.4, color: deep, alpha: 0.6 });

  // Nose mooring cone cap (+x).
  g.poly([22.2, -3.2, 24.0, -1.8, 22.2, -0.4]).fill(STRUT);

  // Recessed dark LED matrix signboard housing on the blimp's flank!
  g.roundRect(LED_X0 - 1.3, LED_Y0 - 1.0, (LED_WINDOW_COLS - 1) * LED_PITCH + 2.6, 5.6, 0.9)
    .fill(SIGN_BG)
    .stroke({ width: 0.6, color: SIGN_FRAME });
}

class StadiumBlimpArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  /** Live scrolling amber LED matrix displaying "HEY, TAXI!". */
  private led = new Graphics();
  private warn = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;
  private lastScrollCol = -1;
  private lastLedCrit = false;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.6, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint, this.led);
    this.drawLedSign(0, false);
  }

  private drawLedSign(scrollCol: number, crit: boolean): void {
    const g = this.led;
    g.clear();
    const total = LED_COLS.length;
    const colOn = crit ? WARN : LED_AMBER;
    const colCore = crit ? 0xffb8b8 : LED_CORE;
    for (let i = 0; i < LED_WINDOW_COLS; i++) {
      const mask = LED_COLS[(scrollCol + i) % total]!;
      const x = LED_X0 + i * LED_PITCH;
      for (let r = 0; r < 5; r++) {
        const y = LED_Y0 + r * 0.9;
        if (mask & (1 << r)) {
          g.circle(x, y, 0.52).fill({ color: colOn, alpha: 0.45 });
          g.circle(x, y, 0.34).fill(colCore);
        } else {
          g.circle(x, y, 0.22).fill({ color: LED_OFF, alpha: 0.7 });
        }
      }
    }
  }

  /** Retractable mooring landing struts extending from the gondola down to wide pads at y = 24. */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const hy = 8.4;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    for (const s of [-1, 1]) {
      const hx = s * 4.5 + 1.0;
      const fx = s * (TAXI.feetHalfW - 5.5); // ±14.5; pad half-width 5.5 → ±20
      const curX = hx + (fx - hx) * e;
      const fy = hy + (bottom - 2.2 - hy) * e;
      g.moveTo(hx, hy).lineTo(curX, fy).stroke({ width: 2.0, color: STRUT, cap: 'round' });
      g.moveTo(hx, hy)
        .lineTo(hx + (curX - hx) * 0.45, hy + (fy - hy) * 0.45)
        .stroke({ width: 2.8, color: STRUT_DARK, cap: 'round' });
      g.roundRect(curX - 5.5, fy, 11.0, 2.2, 1.0).fill(STRUT);
      g.roundRect(curX - 5.5, fy + 1.2, 11.0, 1.0, 0.5).fill(STRUT_DARK);
      if (locked) g.circle(curX, fy - 2.0, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.scars;
      g.clear();
      if (stage >= 1) {
        g.moveTo(-12, -5.5).lineTo(-6, -4.8).stroke({ width: 0.6, color: 0x3b445c, alpha: 0.65 });
      }
      if (stage >= 2) {
        // Canvas patch & scorch on the envelope.
        g.roundRect(10.5, -5.8, 4.2, 2.4, 0.4).fill(0xd9cdb4).stroke({ width: 0.35, color: 0x6b6048 });
        g.circle(-16.5, -2.2, 2.6).fill({ color: 0x161008, alpha: 0.48 });
      }
      if (stage >= 3) {
        g.circle(15.0, 0.8, 3.0).fill({ color: 0x100b06, alpha: 0.55 });
        g.circle(-14.0, 3.0, 2.6).fill({ color: 0x100b06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xe8e8e8 : 0xffffff;
      this.warn.visible = stage === 4;
    }

    // Counter-mirror the LED signboard whenever TaxiView flips art.scale.x = -1,
    // so "HEY, TAXI!" always reads left-to-right in both flight directions!
    this.led.scale.x = (this.body.parent?.scale.x ?? 1) < 0 ? -1 : 1;

    // Scroll "HEY, TAXI!" smoothly across the stadium LED signboard (~7 cols/sec).
    const scrollCol = Math.floor(time * 7) % LED_COLS.length;
    const crit = stage === 4;
    if (scrollCol !== this.lastScrollCol || crit !== this.lastLedCrit) {
      this.lastScrollCol = scrollCol;
      this.lastLedCrit = crit;
      this.drawLedSign(scrollCol, crit);
    }
    if (stage >= 3) {
      const flick = Math.sin(time * 39.1) * Math.sin(time * 12.7) > 0.55;
      this.led.alpha = flick ? 0.25 : 1;
    } else {
      this.led.alpha = 1;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger riding inside the panoramic underslung blimp gondola. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(-0.8, 7.2, 3.6, 1.2, 0.4).fill(look.shirt);
    g.circle(1.0, 6.2, 1.25).fill(look.skin);
    if (look.hat !== null) g.rect(-0.3, 4.7, 2.6, 0.8).fill(look.hat);
  }
}

export const STADIUM_BLIMP: SkinDef = {
  id: 'stadiumBlimp',
  name: 'STADIUM BLIMP',
  playerColor: BLIMP_BLUE,
  thrusters: {
    tail: { x: -23.4, y: -1.8, scale: 0.9 },
    nose: { x: 24.0, y: -1.8, scale: 0.75 },
    top: { x: 0.5, y: -9.6, scale: 0.8 },
    bottom: [
      { x: -3.0, y: 9.6 },
      { x: 5.0, y: 9.6 },
    ],
  },
  create: (color) => new StadiumBlimpArt(color),
};
