import { Container, Graphics } from 'pixi.js';
import type { Level } from '@hey-taxi/sim';
import type { ThemePalette } from './world';
import { makeText } from './text';

/**
 * Procedural Monument Valley Twilight & Sandstone Hoodoo renderer for Overdrive Canyon.
 * Zero binary assets: layered twilight sky, desert moon, multi-layer Mitten Butte parallax,
 * seamless sandstone strata/fluting with eroded hoodoo undersides, and hybrid caprock/outpost pads.
 */

const SKY_STOPS: readonly [number, number][] = [
  [0.0, 0x130c22],
  [0.14, 0x1c1029],
  [0.28, 0x2d1834],
  [0.44, 0x4b223a],
  [0.6, 0x6c2e3e],
  [0.74, 0x943d39],
  [0.86, 0xb84c35],
  [0.95, 0x6e2824],
  [1.0, 0x3a1816],
];

/** Twilight desert sky with smooth gradient bands, desert moon, and warm-lit dusk clouds. */
export function drawCanyonSky(viewW: number, viewH: number, rand: () => number): Graphics {
  const g = new Graphics();
  const x0 = -2000;
  const totalW = viewW + 4000;
  const bands = 32;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const y0 = Math.floor(t0 * viewH);
    const y1 = Math.ceil(t1 * viewH) + 1;
    g.rect(x0, y0, totalW, y1 - y0).fill(sampleGradient(SKY_STOPS, (t0 + t1) * 0.5));
  }

  // Desert twilight moon (upper-right sky)
  const mx = viewW * 0.78;
  const my = viewH * 0.19;
  g.circle(mx, my, 58).fill({ color: 0xffd699, alpha: 0.07 });
  g.circle(mx, my, 36).fill({ color: 0xffdea8, alpha: 0.14 });
  g.circle(mx, my, 20).fill({ color: 0xffe5b8, alpha: 0.24 });
  g.circle(mx, my, 12.5).fill(0xffebc2);

  // Subtle warm-lit twilight cloud wisps
  const clouds: readonly [number, number, number, number][] = [
    [viewW * 0.22, viewH * 0.24, 190, 18],
    [viewW * 0.56, viewH * 0.31, 165, 14],
    [viewW * 0.88, viewH * 0.28, 145, 13],
    [viewW * 0.38, viewH * 0.17, 130, 11],
  ];
  for (const [cx, cy, rw, rh] of clouds) {
    drawCloudBand(g, cx, cy, rw, rh, 0xff925c, 0.12);
    drawCloudBand(g, cx + 10, cy - 3, rw * 0.72, rh * 0.52, 0xffc882, 0.11);
  }

  // Faint twilight horizon glow
  g.rect(x0, viewH * 0.72, totalW, viewH * 0.28).fill({ color: 0xd96134, alpha: 0.08 });
  void rand;
  return g;
}

function drawCloudBand(
  g: Graphics,
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  color: number,
  alpha: number,
): void {
  g.ellipse(cx, cy, rw * 0.5, rh * 0.5).fill({ color, alpha });
  g.ellipse(cx - rw * 0.3, cy + 3, rw * 0.32, rh * 0.38).fill({ color, alpha });
  g.ellipse(cx + rw * 0.3, cy + 2, rw * 0.34, rh * 0.4).fill({ color, alpha });
}

/** Two-layer Monument Valley parallax backdrop: distant flat-topped mesas + closer Mitten Buttes. */
export function drawCanyonSkyline(w: number, h: number, rand: () => number): Graphics {
  const g = new Graphics();

  // Far hazy mesa layer
  const farBase = h * 0.92;
  let fx = -60;
  while (fx < w + 120) {
    const bw = 180 + rand() * 190;
    const bh = 110 + rand() * 140;
    drawParallaxButte(g, fx + bw * 0.5, farBase, bw, bh, 0x431d2c, 0x78343a, rand() < 0.45, rand() < 0.5 ? 1 : -1);
    fx += bw * (0.72 + rand() * 0.35);
  }
  g.rect(-60, farBase - 4, w + 120, h - farBase + 60).fill(0x3a1824);

  // Mid-distance darker Mitten Buttes with warm golden-hour rim light
  const midBase = h * 0.97;
  let mx = -40;
  while (mx < w + 140) {
    const bw = 150 + rand() * 170;
    const bh = 95 + rand() * 125;
    drawParallaxButte(g, mx + bw * 0.5, midBase, bw, bh, 0x2a121b, 0xa8432d, rand() < 0.65, rand() < 0.5 ? 1 : -1);
    mx += bw * (0.85 + rand() * 0.45);
  }
  g.rect(-60, midBase - 4, w + 120, h - midBase + 80).fill(0x261018);

  return g;
}

function drawParallaxButte(
  g: Graphics,
  cx: number,
  baseY: number,
  w: number,
  h: number,
  bodyColor: number,
  rimColor: number,
  hasThumb: boolean,
  thumbDir: 1 | -1,
): void {
  const topW = w * 0.44;
  const cliffH = h * 0.56;
  const cliffY = baseY - h;
  const skirtY = cliffY + cliffH;

  g.poly([
    cx - w * 0.56, baseY,
    cx - topW * 0.58, skirtY,
    cx - topW * 0.5, cliffY + 7,
    cx - topW * 0.36, cliffY,
    cx + topW * 0.36, cliffY,
    cx + topW * 0.5, cliffY + 8,
    cx + topW * 0.58, skirtY,
    cx + w * 0.56, baseY,
  ]).fill(bodyColor);

  // Sunward left cliff highlight
  g.poly([
    cx - topW * 0.5, cliffY + 7,
    cx - topW * 0.36, cliffY,
    cx - topW * 0.1, cliffY,
    cx - topW * 0.16, skirtY,
    cx - w * 0.2, baseY,
    cx - w * 0.56, baseY,
    cx - topW * 0.58, skirtY,
  ]).fill(rimColor);

  if (hasThumb) {
    const tx = cx + thumbDir * topW * 0.68;
    const tw = Math.max(8, w * 0.065);
    const th = cliffH * 0.78;
    g.poly([
      tx - tw, skirtY + 12,
      tx - tw * 0.55, skirtY - th + 3,
      tx + tw * 0.55, skirtY - th,
      tx + tw, skirtY + 14,
    ]).fill(bodyColor);
    g.poly([
      tx - tw * 0.55, skirtY - th + 3,
      tx, skirtY - th + 1,
      tx - tw * 0.08, skirtY + 12,
      tx - tw, skirtY + 12,
    ]).fill(rimColor);
  }
}

interface TileComp {
  tiles: [number, number][];
  minC: number;
  maxC: number;
  minR: number;
  maxR: number;
  grounded: boolean;
}

/**
 * Procedural sandstone terrain for Overdrive Canyon:
 *  - Recessed non-colliding talus aprons & distant Mitten thumbs behind grounded spires
 *  - Sculpted hoodoo rock formations with tapered eroded undersides, craggy spire crowns,
 *    continuous sedimentary strata, vertical cliff fluting, and directional sunset lighting
 */
export function drawCanyonTerrain(level: Level, rand: () => number): Graphics {
  const g = new Graphics();
  const ts = level.tileSize;
  const gate = new Set(level.exit?.tiles ?? []);
  const solidAt = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= level.cols || r >= level.rows) return true;
    const i = r * level.cols + c;
    return level.solid[i] === 1 && !gate.has(i);
  };
  const isBorder = (c: number, r: number): boolean =>
    c === 0 || r === 0 || c === level.cols - 1 || r === level.rows - 1;

  // 1. Find interior connected formations (including pad tiles so rock & pad fuse seamlessly).
  const visited = new Uint8Array(level.cols * level.rows);
  const comps: TileComp[] = [];
  for (let r = 1; r < level.rows - 1; r++) {
    for (let c = 1; c < level.cols - 1; c++) {
      const idx = r * level.cols + c;
      if (visited[idx] || !solidAt(c, r)) continue;
      const queue: [number, number][] = [[c, r]];
      visited[idx] = 1;
      const tiles: [number, number][] = [];
      let minC = c, maxC = c, minR = r, maxR = r;
      while (queue.length) {
        const [cc, cr] = queue.pop()!;
        tiles.push([cc, cr]);
        if (cc < minC) minC = cc;
        if (cc > maxC) maxC = cc;
        if (cr < minR) minR = cr;
        if (cr > maxR) maxR = cr;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = cc + dc;
          const nr = cr + dr;
          if (isBorder(nc, nr)) continue;
          const ni = nr * level.cols + nc;
          if (!visited[ni] && solidAt(nc, nr)) {
            visited[ni] = 1;
            queue.push([nc, nr]);
          }
        }
      }
      comps.push({
        tiles,
        minC,
        maxC,
        minR,
        maxR,
        grounded: maxR >= level.rows - 2,
      });
    }
  }

  // 2. Recessed background talus aprons behind tall grounded spires (non-colliding depth cue).
  for (const comp of comps) {
    const heightTiles = comp.maxR - comp.minR + 1;
    if (!comp.grounded || heightTiles < 8) continue;
    const cx = ((comp.minC + comp.maxC + 1) * 0.5) * ts;
    const topY = (comp.minR + 2) * ts;
    const baseY = (level.rows - 1) * ts;
    const topW = (comp.maxC - comp.minC + 1) * ts * 0.72;
    const baseW = topW + ts * 4.5;
    const midY = topY + (baseY - topY) * 0.52;

    g.poly([
      cx - topW * 0.5, topY,
      cx + topW * 0.5, topY,
      cx + topW * 0.62, midY,
      cx + baseW * 0.5, baseY,
      cx - baseW * 0.5, baseY,
      cx - topW * 0.62, midY,
    ]).fill({ color: 0x3b1920, alpha: 0.72 });

    // Sunward left talus face
    g.poly([
      cx - topW * 0.5, topY,
      cx - topW * 0.08, topY,
      cx - topW * 0.14, midY,
      cx - baseW * 0.16, baseY,
      cx - baseW * 0.5, baseY,
      cx - topW * 0.62, midY,
    ]).fill({ color: 0x692c26, alpha: 0.62 });
  }

  // 3. Draw outer canyon border (ceiling rock lip, cliff walls, and desert canyon floor).
  drawCanyonBorder(g, level, ts, rand);

  // 4. Draw each interior formation as sculpted Monument Valley sandstone.
  for (let ci = 0; ci < comps.length; ci++) {
    const comp = comps[ci]!;
    drawFormation(g, level, comp, ts, solidAt, ci * 313 + 17);
  }

  return g;
}

function drawCanyonBorder(g: Graphics, level: Level, ts: number, rand: () => number): void {
  const W = level.width;
  const H = level.height;

  // Solid base border frames
  g.rect(0, 0, W, ts).fill(0x3a1719);
  g.rect(0, H - ts, W, ts).fill(0x4f211c);
  g.rect(0, 0, ts, H).fill(0x4a1f1c);
  g.rect(W - ts, 0, ts, H).fill(0x351418);

  // Horizontal desert floor strata & sunlit caprock crust
  g.rect(0, H - ts, W, 6).fill(0xc4562c);
  g.rect(0, H - ts + 6, W, 8).fill(0x7c2f22);
  g.rect(0, H - ts + 18, W, 9).fill(0x361416);

  // Ceiling rocky underside edge
  g.rect(0, ts - 5, W, 5).fill(0x220c10);

  // Left & right canyon wall highlights/shadows
  g.rect(ts - 5, ts, 5, H - ts * 2).fill(0x7a3224);
  g.rect(W - ts, ts, 5, H - ts * 2).fill(0xc95a2e);

  // Craggy rock teeth along the desert floor & occasional tiny saguaro silhouettes on open floor
  const floorY = H - ts;
  for (let c = 1; c < level.cols - 1; c++) {
    const aboveEmpty = level.solid[(level.rows - 2) * level.cols + c] === 0;
    if (!aboveEmpty) continue;
    const x = c * ts;
    // Subtle sandstone pebble/mound
    if (rand() < 0.45) {
      const mw = 14 + rand() * 18;
      const mh = 3 + rand() * 4;
      g.poly([x + 4, floorY, x + 4 + mw * 0.4, floorY - mh, x + 4 + mw, floorY]).fill(0x8c3724);
    }
    // Occasional tiny distant saguaro silhouette on clear desert floor
    if (rand() < 0.09) {
      const sx = x + 12 + rand() * 16;
      const sh = 14 + rand() * 10;
      g.rect(sx - 2, floorY - sh, 4, sh).fill(0x281016);
      g.rect(sx - 7, floorY - sh * 0.65, 5, 2.5).fill(0x281016);
      g.rect(sx - 7, floorY - sh * 0.85, 2.5, sh * 0.24).fill(0x281016);
      g.rect(sx + 2, floorY - sh * 0.52, 5, 2.5).fill(0x281016);
      g.rect(sx + 4.5, floorY - sh * 0.74, 2.5, sh * 0.25).fill(0x281016);
    }
  }
}

function drawFormation(
  g: Graphics,
  level: Level,
  comp: TileComp,
  ts: number,
  solidAt: (c: number, r: number) => boolean,
  seed: number,
): void {
  const r = seeded(seed);
  const spanC = Math.max(1, comp.maxC - comp.minC + 1);
  const compSet = new Set(comp.tiles.map(([c, row]) => row * level.cols + c));
  const inComp = (c: number, row: number) => compSet.has(row * level.cols + c);

  // Pass A: Sculpted sandstone body per tile with directional sunset shading,
  // tapered hoodoo undersides, and beveled spire crowns.
  for (const [c, row] of comp.tiles) {
    const x = c * ts;
    const y = row * ts;
    const isPad = level.padIndex[row * level.cols + c]! >= 0;
    const up = solidAt(c, row - 1);
    const down = solidAt(c, row + 1);
    const left = solidAt(c - 1, row);
    const right = solidAt(c + 1, row);

    // Directional lighting factor across the formation (0 = sunward left, 1 = shaded right)
    const frac = spanC === 1 ? 0.25 : (c - comp.minC) / (spanC - 1);
    const bodyColor = sampleGradient(
      [
        [0.0, 0xd8602c],
        [0.28, 0xa83f25],
        [0.65, 0x68251f],
        [1.0, 0x3f161a],
      ],
      frac,
    );

    // Taper corners on exposed hoodoo undersides & protruding spire crowns
    const topLeftInset = !up && !left && !isPad ? 6 + r() * 5 : 0;
    const topRightInset = !up && !right && !isPad ? 6 + r() * 5 : 0;
    const botLeftInset = !down && !left && !comp.grounded ? 9 + r() * 6 : !down && !left ? 3 : 0;
    const botRightInset = !down && !right && !comp.grounded ? 9 + r() * 6 : !down && !right ? 3 : 0;

    // Slight organic overhang on floating hoodoo bellies (purely within ~4-7u)
    const bellyDrop = !down && !comp.grounded ? 3 + r() * 5 : 0;
    const leftBulge = !left && !isPad ? (r() - 0.5) * 4 : 0;
    const rightBulge = !right && !isPad ? (r() - 0.5) * 4 : 0;

    const pts = [
      x + topLeftInset, y,
      x + ts - topRightInset, y,
      x + ts + rightBulge, y + ts * 0.45,
      x + ts - botRightInset, y + ts,
      x + ts * 0.5, y + ts + bellyDrop,
      x + botLeftInset, y + ts,
      x + leftBulge, y + ts * 0.48,
    ];
    g.poly(pts).fill(bodyColor);

    // Horizontal sedimentary strata stripes clipped naturally inside the tile width
    const strataY1 = y + 8 + (row % 3) * 3;
    const strataY2 = y + 23 + ((row + 1) % 3) * 3;
    const sLeft = x + Math.max(topLeftInset, botLeftInset) * 0.45 + 1;
    const sRight = x + ts - Math.max(topRightInset, botRightInset) * 0.45 - 1;
    const sw = Math.max(4, sRight - sLeft);
    g.rect(sLeft, strataY1, sw, 5).fill({ color: frac < 0.45 ? 0xffa856 : 0x240a0e, alpha: 0.18 });
    g.rect(sLeft, strataY2, sw, 6).fill({ color: 0x1e080c, alpha: 0.22 });

    // Vertical Monument Valley cliff fluting lines (strongest on taller cliffs/spires)
    const fluteCount = 2;
    for (let f = 0; f < fluteCount; f++) {
      const fx = x + 9 + f * 15 + (r() - 0.5) * 4;
      const fy0 = y + (up ? 0 : 4);
      const fy1 = y + ts - (down ? 0 : 5);
      if (fy1 > fy0 + 4) {
        const isLit = frac < 0.42;
        g.rect(fx, fy0, 3 + r() * 2.5, fy1 - fy0).fill({
          color: isLit ? 0xffba62 : 0x1b070b,
          alpha: isLit ? 0.16 : 0.24,
        });
      }
    }

    // Exposed edge lighting: golden-hour sunward left cliff, ochre caprock rim, dark overhang shadow
    if (!up && !isPad) {
      g.poly([
        x + topLeftInset, y,
        x + ts - topRightInset, y,
        x + ts - topRightInset * 0.7, y + 5,
        x + topLeftInset * 0.7, y + 5,
      ]).fill(frac < 0.55 ? 0xf29a52 : 0xc46038);
    }
    if (!left) {
      g.poly([
        x + topLeftInset, y,
        x + topLeftInset + 5, y,
        x + botLeftInset + 4, y + ts,
        x + botLeftInset, y + ts,
        x + leftBulge, y + ts * 0.48,
      ]).fill({ color: 0xffb866, alpha: isPad ? 0.28 : 0.42 });
    }
    if (!right) {
      g.poly([
        x + ts - topRightInset - 4, y,
        x + ts - topRightInset, y,
        x + ts + rightBulge, y + ts * 0.45,
        x + ts - botRightInset, y + ts,
        x + ts - botRightInset - 4, y + ts,
      ]).fill({ color: 0x1c070b, alpha: 0.45 });
    }
    if (!down) {
      g.poly([
        x + botLeftInset, y + ts - 4,
        x + ts - botRightInset, y + ts - 4,
        x + ts - botRightInset, y + ts,
        x + ts * 0.5, y + ts + bellyDrop,
        x + botLeftInset, y + ts,
      ]).fill({ color: 0x1a070b, alpha: 0.55 });
    }

    // Smooth inner-corner rock fillet where a vertical spire meets a horizontal hoodoo shelf
    if (!up && right && inComp(c + 1, row - 1) && !isPad) {
      g.poly([x + ts - 10, y, x + ts, y, x + ts, y - 10]).fill(bodyColor);
    }
    if (!up && left && inComp(c - 1, row - 1) && !isPad) {
      g.poly([x, y, x + 10, y, x, y - 10]).fill(bodyColor);
    }
  }
}

/**
 * Hybrid Canyon Pads:
 *  - Numbered pads (1–9): Carved Caprock Rim (integrated directly into flat sandstone top)
 *  - Stores & Teleports: Retro-Futuristic Desert Outpost Deck (bolted steel deck, struts, corner beacons)
 */
export function drawCanyonPads(level: Level, into: Container, pal: ThemePalette): void {
  const g = new Graphics();
  into.addChild(g);
  const ts = level.tileSize;

  for (const pad of level.pads) {
    const color = pad.kind === 'fuel' ? pal.fuel : pad.kind === 'teleport' ? pal.teleport : pal.pad;
    const text = pad.kind === 'fuel' ? 'STORE · FUEL' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`;

    if (pad.kind === 'pad') {
      // Carved Caprock Rim
      g.rect(pad.x + 3, pad.y + 4, pad.w - 6, ts - 12).fill({ color: 0x1c0a0d, alpha: 0.62 });
      g.rect(pad.x + 2, pad.y, pad.w - 4, 5).fill(color);
      g.rect(pad.x + 2, pad.y + 5, pad.w - 4, 4).fill({ color, alpha: 0.25 });
      for (let lx = pad.x + 12; lx < pad.x + pad.w - 8; lx += 18) {
        g.circle(lx, pad.y + 12, 2).fill({ color, alpha: 0.78 });
      }
      const label = makeText(text, { fontSize: 13, fill: color });
      label.anchor.set(0.5);
      label.position.set(pad.x + pad.w / 2, pad.y + ts / 2 + 5);
      into.addChild(label);
    } else {
      // Retro-Futuristic Desert Outpost Deck (for STORE · FUEL and TELEPORT)
      // Angled support struts bolted into rock below
      g.moveTo(pad.x + 12, pad.y + 22)
        .lineTo(pad.x + 24, pad.y + ts + 6)
        .stroke({ width: 3, color: 0x6e5960 });
      g.moveTo(pad.x + pad.w - 12, pad.y + 22)
        .lineTo(pad.x + pad.w - 24, pad.y + ts + 6)
        .stroke({ width: 3, color: 0x6e5960 });

      // Cantilevered weathered steel deck
      g.rect(pad.x - 4, pad.y, pad.w + 8, 25).fill(0x261c24);
      g.rect(pad.x - 4, pad.y, pad.w + 8, 25).stroke({ width: 1.5, color: 0x735b65 });
      g.rect(pad.x - 4, pad.y, pad.w + 8, 5).fill(color);
      g.rect(pad.x - 4, pad.y + 5, pad.w + 8, 3).fill({ color, alpha: 0.28 });

      // Twin corner beacon posts
      g.rect(pad.x - 6, pad.y - 10, 4, 12).fill(0xd98a4a);
      g.rect(pad.x + pad.w + 2, pad.y - 10, 4, 12).fill(0xd98a4a);
      g.circle(pad.x - 4, pad.y - 11, 3.2).fill(color);
      g.circle(pad.x + pad.w + 4, pad.y - 11, 3.2).fill(color);

      const label = makeText(text, { fontSize: 13, fill: color });
      label.anchor.set(0.5);
      label.position.set(pad.x + pad.w / 2, pad.y + 16);
      into.addChild(label);
    }
  }
}

function sampleGradient(stops: readonly [number, number][], t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (clamped >= t0 && clamped <= t1) {
      const f = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0);
      return lerpColor(c0, c1, f);
    }
  }
  return stops[stops.length - 1]![1];
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
