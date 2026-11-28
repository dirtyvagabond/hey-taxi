import { Container, Graphics } from 'pixi.js';
import type { Level, LevelTheme } from '@hey-taxi/sim';
import { MAX_CAMERA_ZOOM, VIEW_H, VIEW_W } from '../camera';
import { drawCanyonPads, drawCanyonSky, drawCanyonSkyline, drawCanyonTerrain } from './canyon';
import { makeText } from './text';

export interface ThemePalette {
  sky: number;
  wall: number;
  wallPanel: number;
  wallTop: number;
  wallShadow: number;
  padBody: number;
  pad: number;
  fuel: number;
  teleport: number;
  skyline: number;
  window: number;
  windowLit: number;
}

export const COLORS: ThemePalette = {
  sky: 0x0b0e1f,
  wall: 0x2b3260,
  wallPanel: 0x323a6e,
  wallTop: 0x6170c4,
  wallShadow: 0x1a1f40,
  padBody: 0x1c2244,
  pad: 0x39d0ff,
  fuel: 0xff9f1c,
  teleport: 0xb48cff,
  skyline: 0x141936,
  window: 0x2c3a6e,
  windowLit: 0xffd36b,
};

export const THEME_PALETTES: Record<LevelTheme, ThemePalette> = {
  city: COLORS,
  winter: {
    sky: 0x0d1c30,
    wall: 0x263f5c,
    wallPanel: 0x2f4d6e,
    wallTop: 0xe6f7ff, // snow-capped ledges
    wallShadow: 0x152538,
    padBody: 0x182b42,
    pad: 0x66e3ff,
    fuel: 0xffa630,
    teleport: 0xc299ff,
    skyline: 0x132740,
    window: 0x385e85,
    windowLit: 0xfff0b3,
  },
  singularity: {
    sky: 0x070512,
    wall: 0x251e3d,
    wallPanel: 0x2f264d,
    wallTop: 0x876be6,
    wallShadow: 0x141024,
    padBody: 0x1a152e,
    pad: 0x5ce1ff,
    fuel: 0xff9f1c,
    teleport: 0xd09eff,
    skyline: 0x110c24,
    window: 0x3b2c63,
    windowLit: 0xffcc70,
  },
  polarity: {
    sky: 0x08151d,
    wall: 0x1c3542,
    wallPanel: 0x244252,
    wallTop: 0x4dd0e1,
    wallShadow: 0x102129,
    padBody: 0x132630,
    pad: 0x39e5ff,
    fuel: 0xffa726,
    teleport: 0xc68cff,
    skyline: 0x0f2430,
    window: 0x274f63,
    windowLit: 0xff70d9,
  },
  vault: {
    sky: 0x0f0c14,
    wall: 0x2a2433,
    wallPanel: 0x342d40,
    wallTop: 0xe07a38,
    wallShadow: 0x17141d,
    padBody: 0x1f1a26,
    pad: 0x45d9ff,
    fuel: 0xffa62b,
    teleport: 0xb98aff,
    skyline: 0x191521,
    window: 0x40334d,
    windowLit: 0xff6b4a,
  },
  canyon: {
    sky: 0x1d0e16,
    wall: 0x4d251d,
    wallPanel: 0x5c2e24,
    wallTop: 0xe8854a,
    wallShadow: 0x2b130e,
    padBody: 0x331814,
    pad: 0x4fe3ff,
    fuel: 0xffb732,
    teleport: 0xc896ff,
    skyline: 0x2e1518,
    window: 0x6b3228,
    windowLit: 0xffd166,
  },
};

const STAR_PARALLAX = 0.12;
const SKYLINE_PARALLAX = 0.4;

/** Static drawing of a level: themed sky, parallax backdrop (screen space) and terrain (world space). */
export class WorldView {
  readonly background = new Container();
  readonly terrain = new Container();
  private stars: Graphics;
  private skyline: Graphics;

  constructor(level: Level) {
    const pal = THEME_PALETTES[level.theme] ?? COLORS;
    const rand = seeded(level.name.length * 7919 + level.cols * 31 + level.rows);
    const sky =
      level.theme === 'canyon'
        ? drawCanyonSky(VIEW_W, VIEW_H, rand)
        : new Graphics().rect(-2000, 0, VIEW_W + 4000, VIEW_H).fill(pal.sky);
    this.stars = drawStars(level, rand);
    this.skyline = drawSkyline(level, rand, pal);
    this.background.addChild(sky, this.stars, this.skyline);
    if (level.theme === 'canyon') {
      this.terrain.addChild(drawCanyonTerrain(level, rand));
      drawCanyonPads(level, this.terrain, pal);
    } else {
      this.terrain.addChild(drawTiles(level, pal));
      drawPads(level, this.terrain, pal);
    }
  }

  updateParallax(camX: number, camY: number): void {
    this.stars.position.set(-camX * STAR_PARALLAX, -camY * STAR_PARALLAX);
    this.skyline.position.set(-camX * SKYLINE_PARALLAX, -camY * SKYLINE_PARALLAX);
  }

  destroy(): void {
    this.background.destroy({ children: true });
    this.terrain.destroy({ children: true });
  }
}

function layerSize(level: Level, factor: number): [number, number] {
  const baseW = Math.max(VIEW_W, 2400);
  const minViewW = VIEW_W / MAX_CAMERA_ZOOM;
  const minViewH = VIEW_H / MAX_CAMERA_ZOOM;
  return [
    baseW + Math.max(0, level.width - minViewW) * factor,
    VIEW_H + Math.max(0, level.height - minViewH) * factor,
  ];
}

function drawStars(level: Level, rand: () => number): Graphics {
  const g = new Graphics();
  const [w, h] = layerSize(level, STAR_PARALLAX);
  const density = level.theme === 'singularity' ? 2200 : 3500;
  const count = Math.round((w * h) / density);
  for (let i = 0; i < count; i++) {
    const r = rand() < 0.12 ? 1.7 : 0.9;
    g.circle(rand() * w, rand() * h, r).fill({ color: 0xffffff, alpha: 0.25 + rand() * 0.55 });
  }
  return g;
}

function drawSkyline(level: Level, rand: () => number, pal: ThemePalette): Graphics {
  const [w, h] = layerSize(level, SKYLINE_PARALLAX);
  if (level.theme === 'canyon') {
    return drawCanyonSkyline(w, h, rand);
  }
  const g = new Graphics();
  if (level.theme === 'winter') {
    // Jagged mountain peaks silhouette.
    let x = -40;
    while (x < w + 60) {
      const pw = 90 + rand() * 140;
      const ph = 110 + rand() * 220;
      g.poly([x, h, x + pw * 0.5, h - ph, x + pw, h]).fill(pal.skyline);
      g.poly([x + pw * 0.36, h - ph * 0.72, x + pw * 0.5, h - ph, x + pw * 0.64, h - ph * 0.72]).fill({
        color: 0xdff4ff,
        alpha: 0.22,
      });
      x += pw * 0.62;
    }
    return g;
  }
  if (level.theme === 'singularity') {
    // Subtle orbital station rings in the deep background.
    g.circle(w * 0.5, h * 0.5, Math.min(w, h) * 0.42).stroke({ width: 2, color: pal.skyline, alpha: 0.8 });
    g.circle(w * 0.5, h * 0.5, Math.min(w, h) * 0.28).stroke({ width: 1, color: pal.window, alpha: 0.4 });
    return g;
  }
  let x = -20;
  while (x < w) {
    const bw = 40 + rand() * 90;
    const bh = 90 + rand() * 230;
    g.rect(x, h - bh, bw, bh).fill(pal.skyline);
    for (let wy = h - bh + 12; wy < h - 10; wy += 16) {
      for (let wx = x + 8; wx < x + bw - 10; wx += 14) {
        const roll = rand();
        if (roll < 0.55) g.rect(wx, wy, 5, 7).fill(roll < 0.07 ? pal.windowLit : pal.window);
      }
    }
    x += bw + 4 + rand() * 18;
  }
  return g;
}

function drawTiles(level: Level, pal: ThemePalette): Graphics {
  const g = new Graphics();
  const ts = level.tileSize;
  const gate = new Set(level.exit?.tiles ?? []); // drawn separately (it opens)
  const solidAt = (c: number, r: number) =>
    c < 0 || r < 0 || c >= level.cols || r >= level.rows || level.solid[r * level.cols + c] === 1;
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      const i = r * level.cols + c;
      if (!level.solid[i] || level.padIndex[i]! >= 0 || gate.has(i)) continue;
      const x = c * ts;
      const y = r * ts;
      g.rect(x, y, ts, ts).fill(pal.wall);
      g.rect(x + 3, y + 3, ts - 6, ts - 6).fill(pal.wallPanel);
      if (!solidAt(c, r - 1)) {
        g.rect(x, y, ts, level.theme === 'winter' ? 5 : 3).fill(pal.wallTop);
      }
      if (!solidAt(c, r + 1)) g.rect(x, y + ts - 3, ts, 3).fill(pal.wallShadow);
      if (!solidAt(c - 1, r)) g.rect(x, y, 2, ts).fill({ color: pal.wallTop, alpha: 0.5 });
      if (!solidAt(c + 1, r)) g.rect(x + ts - 2, y, 2, ts).fill(pal.wallShadow);
    }
  }
  return g;
}

function drawPads(level: Level, into: Container, pal: ThemePalette): void {
  const g = new Graphics();
  into.addChild(g);
  const ts = level.tileSize;
  for (const pad of level.pads) {
    const color = pad.kind === 'fuel' ? pal.fuel : pad.kind === 'teleport' ? pal.teleport : pal.pad;
    g.rect(pad.x, pad.y, pad.w, ts).fill(pal.padBody);
    g.rect(pad.x, pad.y, pad.w, 5).fill(color);
    g.rect(pad.x, pad.y + 5, pad.w, 3).fill({ color, alpha: 0.25 });
    for (let lx = pad.x + 8; lx < pad.x + pad.w - 4; lx += 16) {
      g.circle(lx, pad.y + 12, 2).fill({ color, alpha: 0.7 });
    }
    const text = pad.kind === 'fuel' ? 'STORE · FUEL' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`;
    const label = makeText(text, { fontSize: 13, fill: color });
    label.anchor.set(0.5);
    label.position.set(pad.x + pad.w / 2, pad.y + ts / 2 + 6);
    into.addChild(label);
  }
}

/** Small deterministic PRNG so backdrops look the same on every load. */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
