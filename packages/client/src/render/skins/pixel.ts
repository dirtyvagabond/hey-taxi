/**
 * "Pixel Homage": an original low-resolution pixel-art cab in the spirit of 8-bit home-computer
 * games (24×17 texels). Swept red tailfin, raised purple-glass canopy with roof beacon, a
 * porthole stripe along the body, stepped nose with headlamp, and outward-splayed stair-stepped
 * landing struts with wide flat skids and lock lights.
 *
 * Drawn as tiny nearest-neighbor textures snapped to screen pixels so it stays razor-sharp
 * at any zoom.
 *
 * Grid: 24 × 17 texels of 2 world units, top-left at (-24, -10).
 *  - Rows 0–9  (y -10…+10): body, fitting the exact ±24 × ±10 hitbox.
 *  - Rows 10–16 (y +10…+24): landing gear, feet spanning x ±10…±20 (exact ±feetHalfW).
 */
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

const TEXEL = 2;
const COLS = 24;
const LEFT = -24;
const TOP = -10;

/**
 * Facing right (24 chars per row).
 *  Y body color · S shaded body · H highlight · P dark purple glass · G glass glint
 *  L lavender trim/nozzle · R brick red tailfin · r dark red · D dark seam/checker · W warm cream lamp
 */
const BODY = [
  '.....RRRHHWWYY..........',
  '...RRRRHGGGGPPY.........',
  '..RRrYYPGPPPPPPY...WW...',
  '.RrrYYYPPPPPPPPY..HYYY..',
  'LLDYYYYPPPPPPPPYDDYYYYW.',
  'LLDYYYYYYYYYYYYYYYYYYYYW',
  '.LDYDYDYDYDYDYDYDYDYYYYY',
  '..DYYYYYYYYYYYYYYYYYYRYY',
  '...SSSSSSSSSSSSSSSSSSSS.',
  '....SDDSSSSSSSSSSSDDS...',
];

/**
 * Landing gear fully deployed (7 rows, y +10…+24). Retracting slides it up into the bays.
 *  M strut · Y skid · K lock-indicator light (green when locked, dim while moving).
 */
const LEGS = [
  '......MM........MM......',
  '.....MM..........MM.....',
  '.....MM..........MM.....',
  '....MM............MM....',
  '....MK............KM....',
  '...MM..............MM...',
  '..YYYYY..........YYYYY..',
];
const LEG_ROWS = LEGS.length;

const INK: Record<string, number> = {
  P: 0x2d1e5c,
  G: 0x7d68c8,
  L: 0x7055b0,
  R: 0xc04b42,
  r: 0x8a302b,
  D: 0x1e1633,
  W: 0xfff6c4,
};

/** Warm retro yellow for the player cab. */
export const PIXEL_YELLOW = 0xf0e26b;

const textures = new Map<string, Texture>();

/** A texture from a character map (cached by `key`); `paint` gives each cell's [color, alpha] or null. */
function texture(key: string, w: number, h: number, paint: (c: number, r: number) => [number, number] | null): Texture {
  let t = textures.get(key);
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const px = paint(c, r);
      if (!px) continue;
      const [color, alpha] = px;
      ctx.fillStyle = `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
      ctx.fillRect(c, r, 1, 1);
    }
  }
  t = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }) });
  textures.set(key, t);
  return t;
}

const cell = (rows: string[], c: number, r: number) => rows[r]?.[c] ?? '.';
const solid = (c: number, r: number) => cell(BODY, c, r) !== '.';

/** A crisp sprite of `tex`, placed at grid cell (c, r). */
function sprite(tex: Texture, c: number, r: number): Sprite {
  const s = new Sprite(tex);
  s.roundPixels = true;
  s.scale.set(TEXEL);
  s.position.set(LEFT + c * TEXEL, TOP + r * TEXEL);
  return s;
}

class PixelArt implements SkinArt {
  readonly gear = new Container();
  readonly body = new Container();
  readonly scars = new Container();
  readonly rider = new Container();
  private legs: Sprite;
  private legFrames: Texture[];
  private lockedLegs: Texture;
  private soot: Sprite;
  private blots2: Sprite;
  private blots3: Sprite;
  private glow: Sprite;
  private riderSprite: Sprite | null = null;
  private riderKind: number | null = null;

  constructor(color: number) {
    const shade = mix(color, 0x000000, 0.24);
    const hi = mix(color, 0xffffff, 0.45);
    const strut = mix(color, 0x000000, 0.1);
    const ink = (ch: string) => (ch === 'Y' ? color : ch === 'S' ? shade : ch === 'H' ? hi : INK[ch]!);

    this.body.addChild(
      sprite(texture(`px2:body:${color}`, COLS, BODY.length, (c, r) => (solid(c, r) ? [ink(cell(BODY, c, r)), 1] : null)), 0, 0),
    );

    const paintLeg = (h: number, locked: boolean) => (c: number, r: number): [number, number] | null => {
      const ch = cell(LEGS, c, r + h);
      if (ch === '.') return null;
      if (ch === 'Y') return [color, 1];
      if (ch === 'M') return [strut, 1];
      return [locked ? 0x6dff8a : 0x5d668c, 1];
    };

    // One texture per retraction step (h = 0 fully down … LEG_ROWS fully retracted).
    this.legFrames = Array.from({ length: LEG_ROWS + 1 }, (_, h) =>
      texture(`px2:legs:${color}:${h}`, COLS, LEGS.length, paintLeg(h, false)),
    );
    this.lockedLegs = texture(`px2:legs:${color}:locked`, COLS, LEGS.length, paintLeg(0, true));
    this.legs = sprite(this.legFrames[LEG_ROWS]!, 0, BODY.length);
    this.gear.addChild(this.legs);

    // Damage: soot over the body, scorch marks at stages 2/3, and a 1-texel red outline at stage 4.
    this.soot = sprite(texture('px2:soot', COLS, BODY.length, (c, r) => (solid(c, r) ? [0x000000, 1] : null)), 0, 0);
    const blots = (cells: [number, number][]) => (c: number, r: number) => {
      const i = cells.findIndex(([bc, br]) => bc === c && br === r);
      return i < 0 ? null : ([i % 2 ? 0x000000 : 0x1a1208, 0.65] as [number, number]);
    };
    this.blots2 = sprite(
      texture('px2:blots2', COLS, BODY.length, blots([[4, 5], [5, 6], [6, 5], [7, 7], [3, 6], [8, 7]])),
      0,
      0,
    );
    this.blots3 = sprite(
      texture(
        'px2:blots3',
        COLS,
        BODY.length,
        blots([[18, 5], [19, 6], [20, 5], [17, 7], [21, 7], [11, 2], [12, 3], [14, 1], [15, 4]]),
      ),
      0,
      0,
    );
    const outline = (c: number, r: number) =>
      !solid(c - 1, r - 1) && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dc, dr]) => solid(c - 1 + dc!, r - 1 + dr!));
    this.glow = sprite(texture('px2:glow', COLS + 2, BODY.length + 2, (c, r) => (outline(c, r) ? [0xff3b3b, 1] : null)), -1, -1);
    this.scars.addChild(this.soot, this.blots2, this.blots3, this.glow);
    this.setDamage(0, 0);
    this.setGear(0);
  }

  /** Legs slide smoothly out of the underbelly a pixel row at a time; lock lights glow green at p = 1. */
  setGear(p: number): void {
    if (p >= 1) {
      this.legs.texture = this.lockedLegs;
      return;
    }
    const e = p * p * (3 - 2 * p);
    this.legs.texture = this.legFrames[Math.round((1 - e) * LEG_ROWS)]!;
  }

  setDamage(stage: HullStage, time: number): void {
    this.soot.visible = stage >= 2;
    this.soot.alpha = stage === 2 ? 0.1 : 0.18;
    this.blots2.visible = stage >= 2;
    this.blots3.visible = stage >= 3;
    this.glow.visible = stage === 4;
    if (stage === 4) this.glow.alpha = 0.75 + 0.25 * Math.abs(Math.sin(time * 5));
  }

  /** Passenger visible inside the purple canopy: hat (if any), head, and shoulders. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    this.riderSprite?.destroy();
    this.riderSprite = null;
    if (kind === null) return;
    const look = lookFor(kind);
    const tex = texture(`px2:rider:${kind}`, 3, 4, (c, r) => {
      if (r === 0) return look.hat !== null ? [look.hat, 1] : null;
      if (r === 1 || r === 2) return c === 1 || (r === 1 && c === 2) ? [look.skin, 1] : null;
      return [look.shirt, 1];
    });
    this.riderSprite = sprite(tex, 11, 1);
    this.rider.addChild(this.riderSprite);
  }
}

export const PIXEL_HOMAGE: SkinDef = {
  id: 'pixelHomage',
  name: 'Pixel Homage',
  playerColor: PIXEL_YELLOW,
  create: (color) => new PixelArt(color),
};
