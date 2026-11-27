/**
 * "Pixel Cab": a crisp 48×34 deluxe pixel-art space taxi with a stair-stepped crimson tailfin,
 * hood-mounted T-antenna, indigo canopy with lavender glint, four square side portholes, purple
 * rear thruster housing, and splayed landing struts with copper knee joints and beveled skids.
 *
 * Drawn as nearest-neighbor textures (1 world unit per texel) snapped to screen pixels so edges
 * stay razor-sharp at both 1× gameplay and 3.4× skin-picker scale.
 *
 * Grid: 48 × 34 texels of 1 world unit, top-left at (-24, -10).
 *  - Rows 0–19  (y -10…+10): body, fitting the exact ±24 × ±10 hitbox.
 *  - Rows 20–33 (y +10…+24): landing gear, feet spanning x ±10…±20 (exact ±feetHalfW).
 */
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

const TEXEL = 1;
const COLS = 48;
const LEFT = -24;
const TOP = -10;

/** Default body color: Classic Gold. */
export const PIXEL_CAB_YELLOW = 0xffc83d;

/**
 * Facing right (48 chars per row, 20 rows).
 *  Y body color · H highlight · L pale edge · S shaded body · D deeper belly shadow
 *  R crimson accent · P deep indigo canopy · K dark navy portholes · V violet trim
 *  v dark violet · G lavender glint
 */
const BODY = [
  '...........RRRRHHHHHHLLGV.......................',
  '...........RRRRHHHHHHHHVV.......................',
  '...........RRRRYYYYYYYYVV.......................',
  '........RRRRRYYPPPPVVVVVVH......................',
  '........RRRRRYYPPPPVVGGGGYH......YYYYVVVV.......',
  '.....RRRRRRYYYYPPPPPVGGVVYH......SSSSvvVV.......',
  '.....RRRRRRYYYYPPPPPVGGVVYH.........vV..........',
  '..RRRRYYYYYYYYYPPPPPVVVVVYH.........vV..........',
  '..RRRRYYYYYYYYYPPPPPPPPPPYHH........vV..........',
  'GGGGPPYYYYYYYYYPPPPPPPPPPYHH........vV..........',
  'VVVVPPYYYYYYYYYPPPPPPPPPPYHHHHHLLHHHHHLLLLL.....',
  'VVVVPPYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYHHL.....',
  'VVVVVVVVVKKKKYYKKYYKKYYKKYYKKYYYYKKKKKYYYYHHHLL.',
  'VVVVVVVVVKKKKYYKKYYKKYYKKYYKKYYYYKKKKKYYYYYYHHHL',
  'VVVVVVVVVYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYHHH',
  '..RRRRvvvYYYYYYYYYYYYYYYYYYYYYYYYYYYYSSRRRRSSSSS',
  '..RRRRvvvYYYYRRRRRRRRYYYYYYYYYYYYYYYYSSRRRRSSSSS',
  '..RRRRvvvYYYYRRRRRRRRYYYYYYYYYYYYYYYYSSRRRRSSSSS',
  '......vvv..SSYYYYRRRRRDDDDDDDDDRRRYYYY..........',
  '...........SSYYYYRRRRRDDDDDDDDDRRRYYYY..........',
];

/**
 * Landing gear fully deployed (14 rows, y +10…+24). Retracting slides it smoothly up into the belly.
 *  C copper knee joint · H/Y/S bevel-shaded struts and flat skids (spanning x -20…-10 and +10…+20).
 */
const LEGS = [
  '..........CCCYY...................YYCCC.........',
  '..........CCCYY...................YYCCC.........',
  '..........CCCYY...................YYCCC.........',
  '.........HYYYY.....................YYYYH........',
  '.........HYYYY.....................YYYYH........',
  '.........HYYYS.....................SYYYH........',
  '........HYYYS.......................SYYYH.......',
  '........HYYYS.......................SYYYH.......',
  '.......HYYYS.........................SYYYH......',
  '.......HYYYS.........................SYYYH......',
  '......HYYYSS.........................SSYYYH.....',
  '....HHHHHHHHHH....................HHHHHHHHHH....',
  '....YYYYYYYYYY....................YYYYYYYYYY....',
  '....SSSSSSSSSS....................SSSSSSSSSS....',
];
const LEG_ROWS = LEGS.length;

const INK: Record<string, number> = {
  R: 0xc43e3d,
  P: 0x281367,
  K: 0x141236,
  v: 0x3e288c,
  V: 0x6e4ac5,
  G: 0x9b84e4,
  C: 0xc2662d,
};

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

class PixelCabArt implements SkinArt {
  readonly gear = new Container();
  readonly body = new Container();
  readonly scars = new Container();
  readonly rider = new Container();
  private legs: Sprite;
  private legFrames: Texture[];
  private soot: Sprite;
  private blots2: Sprite;
  private blots3: Sprite;
  private glow: Sprite;
  private riderSprite: Sprite | null = null;
  private riderKind: number | null = null;

  constructor(color: number) {
    const hi = mix(color, 0xffffff, 0.32);
    const light = mix(color, 0xffffff, 0.62);
    const shade = mix(color, 0x000000, 0.14);
    const deep = mix(color, 0x000000, 0.28);

    const ink = (ch: string): number => {
      if (ch === 'Y') return color;
      if (ch === 'H') return hi;
      if (ch === 'L') return light;
      if (ch === 'S') return shade;
      if (ch === 'D') return deep;
      return INK[ch]!;
    };

    this.body.addChild(
      sprite(
        texture(`pxcab:body:${color}`, COLS, BODY.length, (c, r) => (solid(c, r) ? [ink(cell(BODY, c, r)), 1] : null)),
        0,
        0,
      ),
    );

    // One texture per retraction row (h = 0 fully down … LEG_ROWS fully retracted).
    this.legFrames = Array.from({ length: LEG_ROWS + 1 }, (_, h) =>
      texture(`pxcab:legs:${color}:${h}`, COLS, LEG_ROWS, (c, r) => {
        const ch = cell(LEGS, c, r + h);
        return ch === '.' ? null : [ink(ch), 1];
      }),
    );
    this.legs = sprite(this.legFrames[LEG_ROWS]!, 0, BODY.length);
    this.gear.addChild(this.legs);

    // Damage: dark soot wash, scorch clusters at stages 2/3, and a pulsing 1-texel red outline at stage 4.
    this.soot = sprite(texture('pxcab:soot', COLS, BODY.length, (c, r) => (solid(c, r) ? [0x000000, 1] : null)), 0, 0);
    const blots = (cells: [number, number][]) => (c: number, r: number) => {
      const i = cells.findIndex(([bc, br]) => bc === c && br === r);
      return i < 0 ? null : ([i % 2 ? 0x000000 : 0x1a1208, 0.65] as [number, number]);
    };
    this.blots2 = sprite(
      texture(
        'pxcab:blots2',
        COLS,
        BODY.length,
        blots([
          [8, 10],
          [9, 10],
          [9, 11],
          [10, 11],
          [11, 14],
          [12, 14],
          [12, 15],
          [13, 15],
          [14, 15],
        ]),
      ),
      0,
      0,
    );
    this.blots3 = sprite(
      texture(
        'pxcab:blots3',
        COLS,
        BODY.length,
        blots([
          [32, 11],
          [33, 11],
          [33, 12],
          [38, 13],
          [39, 14],
          [40, 14],
          [20, 2],
          [21, 3],
          [25, 8],
          [26, 9],
          [27, 15],
          [28, 16],
        ]),
      ),
      0,
      0,
    );
    const outline = (c: number, r: number) =>
      !solid(c - 1, r - 1) && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dc, dr]) => solid(c - 1 + dc!, r - 1 + dr!));
    this.glow = sprite(
      texture('pxcab:glow', COLS + 2, BODY.length + 2, (c, r) => (outline(c, r) ? [0xff3b3b, 1] : null)),
      -1,
      -1,
    );
    this.scars.addChild(this.soot, this.blots2, this.blots3, this.glow);
    this.setDamage(0, 0);
    this.setGear(0);
  }

  /** Legs slide smoothly out of the underbelly bays one texel row at a time. */
  setGear(p: number): void {
    const clamped = Math.max(0, Math.min(1, p));
    const e = clamped * clamped * (3 - 2 * clamped);
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

  /** Passenger visible inside the indigo canopy: hat (if any), head, and shoulders. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    this.riderSprite?.destroy();
    this.riderSprite = null;
    if (kind === null) return;
    const look = lookFor(kind);
    const tex = texture(`pxcab:rider:${kind}`, 5, 6, (c, r) => {
      if (r === 0) return look.hat !== null && c >= 1 && c <= 3 ? [look.hat, 1] : null;
      if (r === 1 || r === 2) return c >= 1 && c <= 3 ? [look.skin, 1] : null;
      if (r === 3) return c === 2 ? [look.skin, 1] : null;
      return [look.shirt, 1];
    });
    this.riderSprite = sprite(tex, 17, 5);
    this.rider.addChild(this.riderSprite);
  }
}

export const PIXEL_CAB: SkinDef = {
  id: 'pixelCab',
  name: 'Pixel Cab',
  playerColor: PIXEL_CAB_YELLOW,
  create: (color) => new PixelCabArt(color),
};
