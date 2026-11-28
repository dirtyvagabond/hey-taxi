import { Container, Graphics, Text } from 'pixi.js';
import { wrapDelta, type Level, type MovingPlatform } from '@hey-taxi/sim';
import type { ThemePalette } from './world';
import { makeText } from './text';

/** Deep-space gradient sky with nebula clouds and a ringed gas giant. */
export function drawAsteroidSky(w: number, h: number, rand: () => number): Graphics {
  const g = new Graphics();
  const x0 = -2000;
  const span = w + 4000;
  const bands = 24;
  const stops: [number, [number, number, number]][] = [
    [0, [4, 5, 16]],
    [0.45, [9, 12, 30]],
    [0.8, [16, 15, 38]],
    [1, [20, 16, 36]],
  ];
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const col = lerpStops(stops, t);
    const y0 = (i / bands) * h;
    const bh = h / bands + 1;
    g.rect(x0, y0, span, bh).fill(col);
  }

  // Soft cosmic nebula wisps.
  const nebulae: [number, number, number, number, number, number][] = [
    [w * 0.22, h * 0.28, 340, 120, 0x3b2c7a, 0.14],
    [w * 0.28, h * 0.34, 220, 80, 0x1c6b8c, 0.11],
    [w * 0.68, h * 0.62, 380, 130, 0x4c245e, 0.13],
    [w * 0.52, h * 0.2, 260, 90, 0x1e4d6b, 0.09],
  ];
  for (const [nx, ny, rx, ry, color, alpha] of nebulae) {
    g.ellipse(nx, ny, rx, ry).fill({ color, alpha });
    g.ellipse(nx + 24, ny - 10, rx * 0.6, ry * 0.55).fill({ color, alpha: alpha * 0.85 });
  }

  // Ringed gas giant in the upper-right sky.
  const px = w * 0.78;
  const py = h * 0.26;
  const pr = 72;
  // Outer atmospheric glow
  g.circle(px, py, pr * 1.45).fill({ color: 0x5c7cfa, alpha: 0.05 });
  g.circle(px, py, pr * 1.18).fill({ color: 0x82a0ff, alpha: 0.07 });
  // Back half of planetary rings (drawn before planet)
  g.ellipse(px, py, pr * 2.15, pr * 0.38).stroke({ width: 9, color: 0xa694c9, alpha: 0.24 });
  g.ellipse(px, py, pr * 1.72, pr * 0.3).stroke({ width: 4, color: 0xd4c6eb, alpha: 0.3 });
  // Planet body + subtle cloud bands + shadow crescent
  g.circle(px, py, pr).fill(0x283359);
  g.ellipse(px - 6, py - 18, pr * 0.86, 10).fill({ color: 0x46588c, alpha: 0.45 });
  g.ellipse(px - 4, py + 4, pr * 0.92, 13).fill({ color: 0x3b4a78, alpha: 0.4 });
  g.ellipse(px - 8, py + 26, pr * 0.78, 9).fill({ color: 0x5c4b7a, alpha: 0.35 });
  // Sunlit crescent rim (upper-left) — moveTo first so PixiJS doesn't draw a line from (0,0)
  const rimStart = Math.PI * 0.85;
  const rimEnd = Math.PI * 1.65;
  g.moveTo(px + Math.cos(rimStart) * (pr - 1), py + Math.sin(rimStart) * (pr - 1))
    .arc(px, py, pr - 1, rimStart, rimEnd)
    .stroke({ width: 3, color: 0xb8d0ff, alpha: 0.55 });
  // Shadow hemisphere
  g.circle(px + pr * 0.32, py + pr * 0.16, pr * 0.92).fill({ color: 0x080a1a, alpha: 0.52 });
  // Front ring arc overlay (elliptical polyline so it aligns cleanly with the tilted ring)
  const rxFront = pr * 2.15;
  const ryFront = pr * 0.38;
  g.moveTo(px + Math.cos(0.15) * rxFront, py + Math.sin(0.15) * ryFront);
  for (let s = 1; s <= 24; s++) {
    const a = 0.15 + ((Math.PI - 0.3) * s) / 24;
    g.lineTo(px + Math.cos(a) * rxFront, py + Math.sin(a) * ryFront);
  }
  g.stroke({ width: 6, color: 0xd4c6eb, alpha: 0.38 });

  // Tiny distant background sparkle stars in sky layer.
  for (let i = 0; i < 60; i++) {
    const sx = rand() * w;
    const sy = rand() * h;
    const tint = rand() < 0.3 ? 0x99d6ff : rand() < 0.6 ? 0xffdfb3 : 0xffffff;
    g.circle(sx, sy, 0.8 + rand() * 0.9).fill({ color: tint, alpha: 0.25 + rand() * 0.45 });
  }
  return g;
}

/** Distant parallax asteroid field silhouettes. */
export function drawAsteroidSkyline(w: number, h: number, rand: () => number): Graphics {
  const g = new Graphics();
  const count = Math.round((w * h) / 48000);
  for (let i = 0; i < count; i++) {
    const cx = rand() * w;
    const cy = 40 + rand() * (h - 80);
    const rx = 14 + rand() * 34;
    const ry = rx * (0.62 + rand() * 0.45);
    const pts = rockPolygon(cx, cy, rx, ry, 7 + Math.floor(rand() * 4), rand);
    g.poly(pts).fill({ color: 0x161a2e, alpha: 0.72 });
    // Subtle sunlit rim on top-left edge
    g.moveTo(pts[0]!, pts[1]!)
      .lineTo(pts[2]!, pts[3]!)
      .lineTo(pts[4]!, pts[5]!)
      .stroke({ width: 1.5, color: 0x4b5882, alpha: 0.35 });
  }
  return g;
}

/** Sculpted asteroid rock terrain (including the Giant Cave Asteroid interior & craters). */
export function drawAsteroidTerrain(level: Level, rand: () => number): Graphics {
  const g = new Graphics();
  const ts = level.tileSize;
  const solidAt = (c: number, r: number) =>
    c < 0 || r < 0 || c >= level.cols || r >= level.rows || level.solid[r * level.cols + c] === 1;
  const isInteriorSolid = (c: number, r: number) =>
    (level.wrap || (r > 0 && r < level.rows - 1 && c > 0 && c < level.cols - 1)) && solidAt(c, r);

  // 1. Hollow cavern backdrop: any open cell enclosed by non-border solid rock above, below,
  //    AND a back wall to the right (or left) is inside an asteroid cave — draw recessed cavern rock.
  for (let r = 2; r < level.rows - 2; r++) {
    for (let c = 2; c < level.cols - 2; c++) {
      if (solidAt(c, r)) continue;
      let hasRoof = false;
      let hasFloor = false;
      let hasBackWall = false;
      for (let rr = r - 1; rr >= Math.max(1, r - 9); rr--) {
        if (isInteriorSolid(c, rr)) { hasRoof = true; break; }
      }
      for (let rr = r + 1; rr <= Math.min(level.rows - 2, r + 9); rr++) {
        if (isInteriorSolid(c, rr)) { hasFloor = true; break; }
      }
      for (let cc = c + 1; cc <= Math.min(level.cols - 2, c + 16); cc++) {
        if (isInteriorSolid(cc, r)) { hasBackWall = true; break; }
      }
      if (!hasRoof || !hasFloor || !hasBackWall) continue;
      const x = c * ts;
      const y = r * ts;
      g.rect(x, y, ts + 1, ts + 1).fill({ color: 0x0e111d, alpha: 0.9 });
      // Subtle recessed cavern wall strata and faint warm mining glow
      if ((c + r) % 2 === 0) {
        g.rect(x + 4, y + 8, ts - 8, 4).fill({ color: 0x1a1f33, alpha: 0.65 });
      }
      if (!isInteriorSolid(c - 1, r) && c > 2 && !solidAt(c - 1, r)) {
        // Cave entrance mouth guide ticks
        let roofLeft = false;
        for (let rr = r - 1; rr >= Math.max(1, r - 9); rr--) {
          if (isInteriorSolid(c - 1, rr)) { roofLeft = true; break; }
        }
        if (!roofLeft) {
          g.circle(x + 4, y + ts * 0.5, 3).fill({ color: 0xffb732, alpha: 0.7 });
        }
      }
    }
  }

  // 2. Solid tiles: subtle dark space-frame on outer border, organic faceted asteroid rock inside.
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      const i = r * level.cols + c;
      if (!level.solid[i] || level.padIndex[i]! >= 0) continue;
      const x = c * ts;
      const y = r * ts;
      const isBorder = !level.wrap && (r === 0 || r === level.rows - 1 || c === 0 || c === level.cols - 1);
      if (isBorder) {
        g.rect(x, y, ts, ts).fill(0x111421);
        g.rect(x + 3, y + 3, ts - 6, ts - 6).fill(0x171b2b);
        continue;
      }

      const up = solidAt(c, r - 1);
      const dn = solidAt(c, r + 1);
      const lt = solidAt(c - 1, r);
      const rt = solidAt(c + 1, r);

      // Irregular craggy rock polygon: jitter exposed edges & bevel exposed corners deterministically
      // so the Cave Asteroid and rocky islands read as natural space rocks rather than blocky tiles.
      const j = (s: number) => (rand() - 0.5) * s;
      const tl = !up && !lt ? 10 + rand() * 7 : 0;
      const tr = !up && !rt ? 10 + rand() * 7 : 0;
      const br = !dn && !rt ? 10 + rand() * 7 : 0;
      const bl = !dn && !lt ? 10 + rand() * 7 : 0;
      const topMidY = !up ? y + j(7) : y;
      const botMidY = !dn ? y + ts + j(8) : y + ts;
      const ltMidX = !lt ? x + j(7) : x;
      const rtMidX = !rt ? x + ts + j(8) : x + ts;
      const pts = [
        x + tl, y,
        x + ts * 0.5 + j(4), topMidY,
        x + ts - tr, y,
        x + ts, y + tr,
        rtMidX, y + ts * 0.5 + j(4),
        x + ts, y + ts - br,
        x + ts - br, y + ts,
        x + ts * 0.5 + j(4), botMidY,
        x + bl, y + ts,
        x, y + ts - bl,
        ltMidX, y + ts * 0.5 + j(4),
        x, y + tl,
      ];
      g.poly(pts).fill(0x2b3145);
      // Faceted mid-tone rock interior shifted slightly toward upper-left sunlight
      const inner = insetPoly(pts, x + ts * 0.45, y + ts * 0.45, 0.78);
      g.poly(inner).fill(0x3a4259);
      // Sunlit upper-left rock ridge facet on exposed top/left tiles
      if (!up || !lt) {
        g.poly([
          pts[0]!, pts[1]!,
          pts[2]!, pts[3]!,
          x + ts * 0.48, y + ts * 0.48,
          pts[20]!, pts[21]!,
          pts[22]!, pts[23]!,
        ]).fill({ color: 0x545f80, alpha: 0.5 });
      }

      // Sunlit upper-left rock rims & shadowed bottom-right edges along the jagged outline
      if (!up) {
        g.moveTo(pts[0]!, pts[1]!)
          .lineTo(pts[2]!, pts[3]!)
          .lineTo(pts[4]!, pts[5]!)
          .stroke({ width: 2.5, color: 0x8291b8, alpha: 0.78 });
      }
      if (!lt) {
        g.moveTo(pts[22]!, pts[23]!)
          .lineTo(pts[20]!, pts[21]!)
          .lineTo(pts[18]!, pts[19]!)
          .stroke({ width: 2.2, color: 0x6f7da3, alpha: 0.7 });
      }
      if (!dn) {
        g.moveTo(pts[16]!, pts[17]!)
          .lineTo(pts[14]!, pts[15]!)
          .lineTo(pts[12]!, pts[13]!)
          .stroke({ width: 2.8, color: 0x151824, alpha: 0.9 });
      }
      if (!rt) {
        g.moveTo(pts[6]!, pts[7]!)
          .lineTo(pts[8]!, pts[9]!)
          .lineTo(pts[10]!, pts[11]!)
          .stroke({ width: 2.5, color: 0x151824, alpha: 0.85 });
      }

      // Deterministic rock craters & mineral fractures on solid asteroid tiles
      const roll = rand();
      if (roll < 0.4) {
        const crx = x + 12 + rand() * (ts - 24);
        const cry = y + 12 + rand() * (ts - 24);
        const rr = 3.5 + rand() * 6.5;
        g.ellipse(crx, cry, rr, rr * (0.68 + rand() * 0.25)).fill({ color: 0x1b2030, alpha: 0.74 });
        g.ellipse(crx + 1, cry + 1, rr * 0.82, rr * 0.62).stroke({ width: 1, color: 0x677499, alpha: 0.48 });
      } else if (roll < 0.68) {
        const fx = x + 6 + rand() * 10;
        const fy = y + 8 + rand() * 14;
        g.moveTo(fx, fy)
          .lineTo(fx + 10 + rand() * 8, fy + (rand() - 0.5) * 10)
          .lineTo(fx + 18 + rand() * 8, fy + (rand() - 0.5) * 14)
          .stroke({ width: 1.2, color: 0x181c2b, alpha: 0.58 });
      }
    }
  }
  return g;
}

/** Static rim pads (moving pads are rendered dynamically with their asteroids). */
export function drawAsteroidPads(level: Level, into: Container, pal: ThemePalette): void {
  const g = new Graphics();
  into.addChild(g);
  const ts = level.tileSize;
  for (const pad of level.pads) {
    if (pad.platformIndex >= 0) continue;
    const color = pad.kind === 'fuel' ? pal.fuel : pad.kind === 'teleport' ? pal.teleport : pal.pad;
    g.rect(pad.x, pad.y, pad.w, ts).fill(pal.padBody);
    g.rect(pad.x, pad.y, pad.w, 5).fill(color);
    g.rect(pad.x, pad.y + 5, pad.w, 3).fill({ color, alpha: 0.28 });
    // Industrial docking clamps on left and right ends
    g.rect(pad.x - 3, pad.y - 6, 4, 10).fill(0x525d7d);
    g.rect(pad.x + pad.w - 1, pad.y - 6, 4, 10).fill(0x525d7d);
    g.circle(pad.x - 1, pad.y - 7, 2.2).fill(color);
    g.circle(pad.x + pad.w + 1, pad.y - 7, 2.2).fill(color);
    for (let lx = pad.x + 10; lx < pad.x + pad.w - 6; lx += 16) {
      g.circle(lx, pad.y + 12, 2).fill({ color, alpha: 0.75 });
    }
    const text = pad.kind === 'fuel' ? 'STORE · FUEL' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`;
    const label = makeText(text, { fontSize: 13, fill: color });
    label.anchor.set(0.5);
    label.position.set(pad.x + pad.w / 2, pad.y + ts / 2 + 6);
    into.addChild(label);
  }
}

/**
 * Pre-build a single cached Pixi Container for a moving asteroid (rock polygon, facets,
 * craters, bolted landing deck, and pad label) at local origin (0, 0). Updating each frame
 * only moves `node.position`, avoiding per-frame Pixi earcut polygon re-triangulation.
 */
export function buildMovingAsteroidNode(
  p: MovingPlatform,
  pad: Level['pads'][number] | null,
  pal: ThemePalette,
  idx: number,
): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const accent = pad
    ? pad.kind === 'fuel'
      ? pal.fuel
      : pad.kind === 'teleport'
        ? pal.teleport
        : pal.pad
    : 0x8b95b3;
  const w = p.w;
  const h = p.h;
  const rand = seeded(idx * 9973 + Math.round(p.cx) * 31 + Math.round(p.cy));

  if (p.cave && pad) {
    drawOrganicCaveAsteroid(g, 0, 0, w, h, p.cave, accent, pal.padBody, 0.9, rand);
    const text = pad.kind === 'fuel' ? 'STORE · FUEL' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`;
    const lbl = makeText(text, { fontSize: 13, fill: accent });
    lbl.anchor.set(0.5);
    lbl.position.set(p.cave.padOffsetX + p.cave.padW / 2, h - p.cave.floorH + 18);
    root.addChild(lbl);
  } else if (pad) {
    const pts = paddedAsteroidPoly(p.shape, 0, 0, w, h, rand);
    g.poly(pts).fill(0x252a3b);
    const innerPts = insetPoly(pts, w * 0.46, h * 0.44, 0.8);
    g.poly(innerPts).fill(0x3c435c);
    const leftHalf: number[] = [w * 0.48, h * 0.46];
    for (let k = Math.floor(pts.length / 2); k < pts.length; k += 2) {
      leftHalf.push(pts[k]!, pts[k + 1]!);
    }
    leftHalf.push(pts[0]!, pts[1]!);
    g.poly(leftHalf).fill({ color: 0x525c7d, alpha: 0.42 });
    g.moveTo(pts[0]!, pts[1]!)
      .lineTo(pts[pts.length - 2]!, pts[pts.length - 1]!)
      .lineTo(pts[pts.length - 4]!, pts[pts.length - 3]!)
      .lineTo(pts[pts.length - 6]!, pts[pts.length - 5]!)
      .stroke({ width: 2.2, color: 0x8291b8, alpha: 0.72 });
    g.poly(pts).stroke({ width: 1.5, color: 0x131621, alpha: 0.88 });

    for (let f = 0; f < 2; f++) {
      const fx = 16 + rand() * Math.max(12, w - 32);
      const fy = 34 + rand() * Math.max(10, h - 44);
      g.moveTo(fx, fy)
        .lineTo(fx + (rand() - 0.5) * 24, fy + 6 + rand() * 12)
        .lineTo(fx + (rand() - 0.5) * 32, fy + 14 + rand() * 14)
        .stroke({ width: 1.2, color: 0x181c29, alpha: 0.6 });
    }
    const craters = Math.max(3, Math.min(6, Math.round(w / 42)));
    for (let c = 0; c < craters; c++) {
      const crx = 18 + ((w - 36) * (c + 0.5)) / craters + (rand() - 0.5) * 16;
      const cry = 35 + rand() * Math.max(12, h - 44);
      const rr = 3.5 + rand() * Math.min(9, h * 0.09);
      g.ellipse(crx, cry, rr, rr * (0.65 + rand() * 0.25)).fill({ color: 0x1b1f2e, alpha: 0.76 });
      g.ellipse(crx + 1, cry + 1, rr * 0.84, rr * 0.6).stroke({ width: 1, color: 0x687599, alpha: 0.5 });
    }

    g.rect(0, 0, w, 30).fill(pal.padBody);
    g.rect(0, 0, w, 5).fill(accent);
    g.rect(0, 5, w, 3).fill({ color: accent, alpha: 0.3 });
    g.rect(10, 30, 5, 10).fill(0x56607d);
    g.rect(w - 15, 30, 5, 10).fill(0x56607d);
    g.rect(-2, -6, 4, 8).fill(0x525d7d);
    g.rect(w - 2, -6, 4, 8).fill(0x525d7d);
    g.circle(0, -7, 2.5).fill({ color: accent, alpha: 0.9 });
    g.circle(w, -7, 2.5).fill({ color: accent, alpha: 0.9 });

    if (pad.kind === 'fuel') {
      g.roundRect(16, 32, 22, 11, 4).fill(0xc46b10).stroke({ width: 1, color: 0xffc15e, alpha: 0.7 });
      g.roundRect(w - 38, 32, 22, 11, 4).fill(0xc46b10).stroke({ width: 1, color: 0xffc15e, alpha: 0.7 });
    }

    const text = pad.kind === 'fuel' ? 'STORE · FUEL' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`;
    const lbl = makeText(text, { fontSize: 13, fill: accent });
    lbl.anchor.set(0.5);
    lbl.position.set(w / 2, 18);
    root.addChild(lbl);
  } else {
    const cx = w / 2;
    const cy = h / 2;
    const pts = boulderPoly(p.shape, 0, 0, w, h, rand);
    g.poly(pts).fill(0x292f40);
    const inner = insetPoly(pts, cx - 3, cy - 3, 0.74);
    g.poly(inner).fill(0x414a63);
    g.poly([cx, cy, pts[0]!, pts[1]!, pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[pts.length - 2]!, pts[pts.length - 1]!])
      .fill({ color: 0x5c688a, alpha: 0.45 });
    g.poly(pts).stroke({ width: 2, color: 0x141722, alpha: 0.92 });
    g.moveTo(pts[pts.length - 2]!, pts[pts.length - 1]!)
      .lineTo(pts[0]!, pts[1]!)
      .lineTo(pts[2]!, pts[3]!)
      .lineTo(pts[4]!, pts[5]!)
      .stroke({ width: 2.3, color: 0x8b9ac2, alpha: 0.7 });
    for (let c = 0; c < 4; c++) {
      const crx = cx + (rand() - 0.5) * w * 0.46;
      const cry = cy + (rand() - 0.5) * h * 0.46;
      const rr = 4 + rand() * 7.5;
      g.ellipse(crx, cry, rr, rr * (0.68 + rand() * 0.28)).fill({ color: 0x1b1f2e, alpha: 0.78 });
      g.ellipse(crx + 1.2, cry + 1.2, rr * 0.84, rr * 0.62).stroke({ width: 1, color: 0x6b789c, alpha: 0.48 });
    }
  }
  return root;
}

/** Update cached asteroid node positions (O(N) transform updates, zero per-frame triangulation). */
export function updateMovingAsteroidNodes(
  underlayGfx: Graphics,
  nodes: readonly Container[],
  level: Level,
  pal: ThemePalette,
  wrapRef?: { x: number; y: number } | null,
): void {
  for (let i = 0; i < level.movingPlatforms.length; i++) {
    const p = level.movingPlatforms[i]!;
    const pose = level.platformPoses[i];
    const node = nodes[i];
    if (!pose || !node) continue;
    if (!p.freeDrift) {
      const pad = p.padIndex >= 0 ? level.pads[p.padIndex]! : null;
      const accent = pad ? (pad.kind === 'fuel' ? pal.fuel : pad.kind === 'teleport' ? pal.teleport : pal.pad) : 0x8b95b3;
      const ox = wrapRef && level.wrap ? wrapRef.x + wrapDelta(wrapRef.x, p.cx + p.w * 0.5, level.width) - (p.cx + p.w * 0.5) : 0;
      const oy = wrapRef && level.wrap ? wrapRef.y + wrapDelta(wrapRef.y, p.cy + p.h * 0.5, level.height) - (p.cy + p.h * 0.5) : 0;
      drawOrbitTrack(underlayGfx, p, accent, pad !== null, ox, oy);
    }
    const x = wrapRef && level.wrap ? wrapRef.x + wrapDelta(wrapRef.x, pose.x + p.w * 0.5, level.width) - p.w * 0.5 : pose.x;
    const y = wrapRef && level.wrap ? wrapRef.y + wrapDelta(wrapRef.y, pose.y + p.h * 0.5, level.height) - p.h * 0.5 : pose.y;
    node.position.set(x, y);
  }
}

/**
 * Draw all drifting asteroids, their faint orbital-track telegraphs, bolted-on landing pads,
 * and reposition their live Pixi labels.
 */
export function drawMovingAsteroids(
  underlayGfx: Graphics,
  overlayGfx: Graphics,
  labels: (Text | null)[],
  level: Level,
  pal: ThemePalette,
  time: number,
  wrapRef?: { x: number; y: number } | null,
): void {
  const pulse = 0.6 + 0.4 * Math.sin(time * 5);

  for (let i = 0; i < level.movingPlatforms.length; i++) {
    const p = level.movingPlatforms[i]!;
    const pose = level.platformPoses[i];
    if (!pose) continue;
    const pad = p.padIndex >= 0 ? level.pads[p.padIndex]! : null;
    const accent = pad
      ? pad.kind === 'fuel'
        ? pal.fuel
        : pad.kind === 'teleport'
          ? pal.teleport
          : pal.pad
      : 0x8b95b3;

    // 1. Faint orbital drift track telegraph in underlay (only for fixed-orbit platforms, not free-drifting Asteroids).
    if (!p.freeDrift) {
      const ox = wrapRef && level.wrap ? wrapRef.x + wrapDelta(wrapRef.x, p.cx + p.w * 0.5, level.width) - (p.cx + p.w * 0.5) : 0;
      const oy = wrapRef && level.wrap ? wrapRef.y + wrapDelta(wrapRef.y, p.cy + p.h * 0.5, level.height) - (p.cy + p.h * 0.5) : 0;
      drawOrbitTrack(underlayGfx, p, accent, pad !== null, ox, oy);
    }

    // 2. Sculpted asteroid rock body in overlay.
    const x = wrapRef && level.wrap ? wrapRef.x + wrapDelta(wrapRef.x, pose.x + p.w * 0.5, level.width) - p.w * 0.5 : pose.x;
    const y = wrapRef && level.wrap ? wrapRef.y + wrapDelta(wrapRef.y, pose.y + p.h * 0.5, level.height) - p.h * 0.5 : pose.y;
    const w = p.w;
    const h = p.h;
    const rand = seeded(i * 9973 + Math.round(p.cx) * 31 + Math.round(p.cy));

    if (p.cave && pad) {
      // Organic hollowed-out Cave Asteroid — ONE continuous sculpted rock polygon with a carved cavern mouth (no blocks!).
      drawOrganicCaveAsteroid(overlayGfx, x, y, w, h, p.cave, accent, pal.padBody, pulse, rand);
      const lbl = labels[i];
      if (lbl) lbl.position.set(x + p.cave.padOffsetX + p.cave.padW / 2, y + h - p.cave.floorH + 18);
    } else if (pad) {
      // Highly irregular sculpted asteroid rock body tailored to `p.shape` (flat-topped for deck).
      const pts = paddedAsteroidPoly(p.shape, x, y, w, h, rand);
      // Deep shadow base
      overlayGfx.poly(pts).fill(0x252a3b);
      // Mid-tone inner basalt plane
      const innerPts = insetPoly(pts, x + w * 0.46, y + h * 0.44, 0.8);
      overlayGfx.poly(innerPts).fill(0x3c435c);
      // Sunlit upper-left ridge facet (chiseled 3D look)
      const leftHalf: number[] = [x + w * 0.48, y + h * 0.46];
      for (let k = Math.floor(pts.length / 2); k < pts.length; k += 2) {
        leftHalf.push(pts[k]!, pts[k + 1]!);
      }
      leftHalf.push(pts[0]!, pts[1]!);
      overlayGfx.poly(leftHalf).fill({ color: 0x525c7d, alpha: 0.42 });
      // Sunlit upper-left craggy rim highlight
      overlayGfx
        .moveTo(pts[0]!, pts[1]!)
        .lineTo(pts[pts.length - 2]!, pts[pts.length - 1]!)
        .lineTo(pts[pts.length - 4]!, pts[pts.length - 3]!)
        .lineTo(pts[pts.length - 6]!, pts[pts.length - 5]!)
        .stroke({ width: 2.2, color: 0x8291b8, alpha: 0.72 });
      // Outline
      overlayGfx.poly(pts).stroke({ width: 1.5, color: 0x131621, alpha: 0.88 });

      // Jagged rock fracture lines + varied impact craters across the asteroid belly
      for (let f = 0; f < 2; f++) {
        const fx = x + 16 + rand() * Math.max(12, w - 32);
        const fy = y + 34 + rand() * Math.max(10, h - 44);
        overlayGfx
          .moveTo(fx, fy)
          .lineTo(fx + (rand() - 0.5) * 24, fy + 6 + rand() * 12)
          .lineTo(fx + (rand() - 0.5) * 32, fy + 14 + rand() * 14)
          .stroke({ width: 1.2, color: 0x181c29, alpha: 0.6 });
      }
      const craters = Math.max(3, Math.min(6, Math.round(w / 42)));
      for (let c = 0; c < craters; c++) {
        const crx = x + 18 + ((w - 36) * (c + 0.5)) / craters + (rand() - 0.5) * 16;
        const cry = y + 35 + rand() * Math.max(12, h - 44);
        const rr = 3.5 + rand() * Math.min(9, h * 0.09);
        overlayGfx.ellipse(crx, cry, rr, rr * (0.65 + rand() * 0.25)).fill({ color: 0x1b1f2e, alpha: 0.76 });
        overlayGfx.ellipse(crx + 1, cry + 1, rr * 0.84, rr * 0.6).stroke({ width: 1, color: 0x687599, alpha: 0.5 });
      }

      // Bolted-on industrial landing deck on the flat top surface
      overlayGfx.rect(x, y, w, 30).fill(pal.padBody);
      overlayGfx.rect(x, y, w, 5).fill(accent);
      overlayGfx.rect(x, y + 5, w, 3).fill({ color: accent, alpha: 0.3 });
      // Steel anchor struts bolting deck to rock
      overlayGfx.rect(x + 10, y + 30, 5, 10).fill(0x56607d);
      overlayGfx.rect(x + w - 15, y + 30, 5, 10).fill(0x56607d);
      // Corner beacon lights
      overlayGfx.rect(x - 2, y - 6, 4, 8).fill(0x525d7d);
      overlayGfx.rect(x + w - 2, y - 6, 4, 8).fill(0x525d7d);
      overlayGfx.circle(x, y - 7, 2.5).fill({ color: accent, alpha: pulse });
      overlayGfx.circle(x + w, y - 7, 2.5).fill({ color: accent, alpha: pulse });

      // Extra fuel-tank canisters under drifting fuel barges so stores pop visually
      if (pad.kind === 'fuel') {
        overlayGfx.roundRect(x + 16, y + 32, 22, 11, 4).fill(0xc46b10).stroke({ width: 1, color: 0xffc15e, alpha: 0.7 });
        overlayGfx.roundRect(x + w - 38, y + 32, 22, 11, 4).fill(0xc46b10).stroke({ width: 1, color: 0xffc15e, alpha: 0.7 });
      }

      const lbl = labels[i];
      if (lbl) lbl.position.set(x + w / 2, y + 18);
    } else {
      // Unpadded irregular tumbling hazard boulder tailored to `p.shape`.
      const cx = x + w / 2;
      const cy = y + h / 2;
      const pts = boulderPoly(p.shape, x, y, w, h, rand);
      overlayGfx.poly(pts).fill(0x292f40);
      const inner = insetPoly(pts, cx - 3, cy - 3, 0.74);
      overlayGfx.poly(inner).fill(0x414a63);
      // Sunlit upper-left facet plane
      overlayGfx
        .poly([cx, cy, pts[0]!, pts[1]!, pts[2]!, pts[3]!, pts[4]!, pts[5]!, pts[pts.length - 2]!, pts[pts.length - 1]!])
        .fill({ color: 0x5c688a, alpha: 0.45 });
      overlayGfx.poly(pts).stroke({ width: 2, color: 0x141722, alpha: 0.92 });
      // Sunlit upper-left craggy edge highlight
      overlayGfx
        .moveTo(pts[pts.length - 2]!, pts[pts.length - 1]!)
        .lineTo(pts[0]!, pts[1]!)
        .lineTo(pts[2]!, pts[3]!)
        .lineTo(pts[4]!, pts[5]!)
        .stroke({ width: 2.3, color: 0x8b9ac2, alpha: 0.7 });
      // Fracture + craters
      overlayGfx
        .moveTo(cx - w * 0.25, cy - h * 0.1)
        .lineTo(cx + (rand() - 0.5) * 14, cy + 4)
        .lineTo(cx + w * 0.22, cy + h * 0.16)
        .stroke({ width: 1.3, color: 0x161a26, alpha: 0.65 });
      for (let c = 0; c < 4; c++) {
        const crx = cx + (rand() - 0.5) * w * 0.46;
        const cry = cy + (rand() - 0.5) * h * 0.46;
        const rr = 4 + rand() * 7.5;
        overlayGfx.ellipse(crx, cry, rr, rr * (0.68 + rand() * 0.28)).fill({ color: 0x1b1f2e, alpha: 0.78 });
        overlayGfx.ellipse(crx + 1.2, cry + 1.2, rr * 0.84, rr * 0.62).stroke({ width: 1, color: 0x6b789c, alpha: 0.48 });
      }
      // Subtle amber mineral glint on hazard boulder
      overlayGfx.circle(cx, cy, 2.5).fill({ color: 0xff8c42, alpha: 0.45 * pulse });
    }
  }
}

function drawOrbitTrack(g: Graphics, p: MovingPlatform, color: number, isPad: boolean, ox = 0, oy = 0): void {
  const cx = p.cx + p.w / 2 + ox;
  const cy = p.cy + p.h / 2 + oy;
  const alpha = isPad ? 0.22 : 0.16;
  if (p.ampX > 0 && p.ampY > 0 && Math.abs(Math.sin(p.yPhaseRad)) > 0.2) {
    // Oval orbit: dashed ellipse via short arc dots
    const steps = 36;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const px = cx + p.ampX * Math.sin(a);
      const py = cy + p.ampY * Math.sin(a + p.yPhaseRad);
      g.circle(px, py, 1.8).fill({ color, alpha });
    }
  } else {
    // Linear horizontal or vertical track with turnaround tick marks
    const x0 = cx - p.ampX;
    const y0 = cy - p.ampY;
    const x1 = cx + p.ampX;
    const y1 = cy + p.ampY;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(4, Math.floor(dist / 16));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      g.circle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, k === 0 || k === steps ? 3 : 1.5).fill({
        color,
        alpha: k === 0 || k === steps ? alpha * 1.8 : alpha,
      });
    }
  }
}

function drawOrganicCaveAsteroid(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  cave: NonNullable<MovingPlatform['cave']>,
  accent: number,
  padBody: number,
  pulse: number,
  rand: () => number,
): void {
  const { roofH, backW, floorH, padOffsetX, padW } = cave;
  const mouthTop = y + roofH;
  const mouthBot = y + h - floorH;
  const backX = x + w - backW;
  const j = (n: number) => (rand() - 0.5) * n;

  // 1. Dark recessed cavern interior rock backdrop (organic curved back wall)
  g.poly([
    x + 6, mouthTop - 4,
    backX + 10, mouthTop - 6,
    backX + 16, (mouthTop + mouthBot) * 0.5,
    backX + 10, mouthBot + 6,
    x + 6, mouthBot + 4,
  ]).fill({ color: 0x0e111d, alpha: 0.92 });
  // Subtle recessed cavern strata lines
  for (let s = 0; s < 3; s++) {
    const sy = mouthTop + 24 + s * ((mouthBot - mouthTop - 48) / 2);
    g.moveTo(x + 24, sy).lineTo(backX - 10, sy + j(8)).stroke({ width: 2, color: 0x1b2136, alpha: 0.65 });
  }

  // 2. Single continuous organic C-shaped craggy asteroid shell (no rectangular blocks!)
  const shell: number[] = [
    // Upper mouth lip -> outer craggy roof -> bulging east back rock -> jagged belly -> lower mouth lip
    x - 4, mouthTop - 4,
    x - 10 + j(6), y + roofH * 0.45,
    x + w * 0.14, y - 6 + j(8),
    x + w * 0.36, y - 14 + j(8),
    x + w * 0.62, y - 10 + j(8),
    x + w * 0.86, y + 2 + j(8),
    x + w + 14 + j(8), y + h * 0.24,
    x + w + 18 + j(8), y + h * 0.52,
    x + w + 10 + j(8), y + h * 0.78,
    x + w * 0.84, y + h + 8 + j(8),
    x + w * 0.58, y + h + 16 + j(8),
    x + w * 0.32, y + h + 10 + j(8),
    x + w * 0.1, y + h + 4 + j(6),
    x - 10 + j(6), y + h - floorH * 0.45,
    x - 4, mouthBot + 4,
    // Inner cavern floor (flat under Pad 5) -> curved inner back wall -> craggy inner ceiling
    x + padOffsetX - 6, mouthBot,
    x + padOffsetX + padW + 6, mouthBot,
    backX - 4, mouthBot - 10,
    backX + 2, (mouthTop + mouthBot) * 0.5 + j(10),
    backX - 6, mouthTop + 12,
    x + w * 0.55, mouthTop + 4 + j(6),
    x + w * 0.25, mouthTop - 2 + j(6),
  ];
  g.poly(shell).fill(0x282e40);
  // Mid-tone basalt layer along the upper-left & back rock mass
  g.poly([
    x - 4, y + roofH * 0.45,
    x + w * 0.16, y - 2,
    x + w * 0.6, y - 6,
    x + w + 8, y + h * 0.28,
    x + w + 10, y + h * 0.68,
    x + w * 0.65, y + h + 6,
    x + w * 0.15, y + h - 2,
    x + padOffsetX + padW + 10, mouthBot + 10,
    backX + 8, (mouthTop + mouthBot) * 0.5,
    backX + 2, mouthTop - 8,
    x + w * 0.3, mouthTop - 10,
  ]).fill({ color: 0x3f4761, alpha: 0.75 });
  // Sunlit upper-left ridge rim
  g.moveTo(shell[0]!, shell[1]!)
    .lineTo(shell[2]!, shell[3]!)
    .lineTo(shell[4]!, shell[5]!)
    .lineTo(shell[6]!, shell[7]!)
    .lineTo(shell[8]!, shell[9]!)
    .stroke({ width: 2.5, color: 0x8594bd, alpha: 0.78 });
  g.poly(shell).stroke({ width: 1.8, color: 0x131621, alpha: 0.9 });

  // Craters & fractures on roof, back rock, and belly
  const craterSpots: [number, number, number][] = [
    [x + w * 0.34, y + roofH * 0.42, 7],
    [x + w * 0.66, y + roofH * 0.48, 6],
    [backX + backW * 0.52, y + h * 0.42, 9],
    [backX + backW * 0.46, y + h * 0.66, 6.5],
    [x + w * 0.45, mouthBot + floorH * 0.62, 7.5],
    [x + w * 0.74, mouthBot + floorH * 0.55, 5.5],
  ];
  for (const [crx, cry, rr] of craterSpots) {
    g.ellipse(crx, cry, rr, rr * 0.72).fill({ color: 0x1a1e2e, alpha: 0.76 });
    g.ellipse(crx + 1.2, cry + 1.2, rr * 0.84, rr * 0.6).stroke({ width: 1, color: 0x6b789c, alpha: 0.5 });
  }

  // Warm amber cavern mouth beacon lights guiding pilots inside
  g.circle(x + 2, mouthTop + 10, 3.2).fill({ color: 0xffb732, alpha: 0.6 + 0.4 * pulse });
  g.circle(x + 2, mouthBot - 10, 3.2).fill({ color: 0xffb732, alpha: 0.6 + 0.4 * pulse });

  // Bolted-on interior landing pad deck on the cavern floor
  const px = x + padOffsetX;
  const py = mouthBot;
  g.rect(px, py, padW, 28).fill(padBody);
  g.rect(px, py, padW, 5).fill(accent);
  g.rect(px, py + 5, padW, 3).fill({ color: accent, alpha: 0.32 });
  g.circle(px + 2, py - 5, 2.4).fill({ color: accent, alpha: pulse });
  g.circle(px + padW - 2, py - 5, 2.4).fill({ color: accent, alpha: pulse });
}

function paddedAsteroidPoly(
  shape: MovingPlatform['shape'],
  x: number,
  y: number,
  w: number,
  h: number,
  rand: () => number,
): number[] {
  const j = (n: number) => (rand() - 0.5) * n;
  // Asymmetric, jagged multi-vertex asteroid silhouettes (top edge stays flat under the bolted deck).
  switch (shape) {
    case 'slab': // Fractured, lopsided tabular rock shelf with stepped notches
      return [
        x - 6, y + 6, x + 2, y, x + w - 2, y, x + w + 7, y + 6,
        x + w + 16 + j(8), y + h * 0.34, x + w + 5 + j(6), y + h * 0.62,
        x + w - 8 + j(8), y + h + 4, x + w * 0.74, y + h - 5,
        x + w * 0.52 + j(10), y + h + 9, x + w * 0.28, y + h - 2,
        x + 8 + j(6), y + h + 5, x - 14 + j(8), y + h * 0.7,
        x - 6 + j(6), y + h * 0.4,
      ];
    case 'spire': // Off-center craggy stalactite keel with chipped side ledges
      return [
        x - 5, y + 7, x + 2, y, x + w - 2, y, x + w + 6, y + 6,
        x + w + 10 + j(6), y + h * 0.26, x + w - 2 + j(8), y + h * 0.5,
        x + w * 0.74 + j(8), y + h * 0.76, x + w * 0.62 + j(8), y + h + 4,
        x + w * 0.42 + j(12), y + h + 18, x + w * 0.26 + j(6), y + h * 0.84,
        x + 4 + j(8), y + h * 0.62, x - 10 + j(6), y + h * 0.34,
      ];
    case 'twin': // Lopsided binary/peanut rock with deep asymmetric waist notch
      return [
        x - 6, y + 6, x + 2, y, x + w - 2, y, x + w + 6, y + 7,
        x + w + 13 + j(8), y + h * 0.46, x + w + 4 + j(6), y + h * 0.82,
        x + w * 0.78 + j(8), y + h + 13, x + w * 0.6, y + h + 2,
        x + w * 0.48 + j(6), y + h * 0.62, x + w * 0.34, y + h + 8,
        x + w * 0.14 + j(8), y + h + 14, x - 11 + j(6), y + h * 0.74,
        x - 14 + j(8), y + h * 0.4,
      ];
    case 'monolith': // Massive craggy, notched angular basalt asteroid
      return [
        x - 5, y + 6, x + 2, y, x + w - 2, y, x + w + 6, y + 7,
        x + w + 15 + j(8), y + h * 0.28, x + w + 6 + j(8), y + h * 0.55,
        x + w + 12 + j(8), y + h * 0.82, x + w * 0.82 + j(8), y + h + 11,
        x + w * 0.62, y + h + 2, x + w * 0.42 + j(10), y + h + 15,
        x + w * 0.2, y + h + 6, x - 6 + j(8), y + h + 10,
        x - 14 + j(8), y + h * 0.66, x - 7 + j(6), y + h * 0.34,
      ];
    case 'wedge': // Wild comet-wedge: heavy knobby nose on left, jagged tapering spur on right
      return [
        x - 7, y + 7, x + 2, y, x + w - 2, y, x + w + 11, y + 6,
        x + w + 20 + j(8), y + h * 0.34, x + w + 4 + j(8), y + h * 0.58,
        x + w * 0.74, y + h * 0.72, x + w * 0.54 + j(8), y + h + 4,
        x + w * 0.32, y + h + 12, x + 6 + j(6), y + h + 15,
        x - 12 + j(8), y + h * 0.82, x - 16 + j(8), y + h * 0.46,
      ];
    case 'crescent': // Craggy concave-scooped asteroid with unequal horns
      return [
        x - 6, y + 6, x + 2, y, x + w - 2, y, x + w + 6, y + 6,
        x + w + 12 + j(8), y + h * 0.44, x + w + 6 + j(6), y + h * 0.84,
        x + w - 6 + j(6), y + h + 14, x + w * 0.74, y + h * 0.76,
        x + w * 0.54 + j(8), y + h * 0.58, x + w * 0.32, y + h * 0.74,
        x + 10 + j(6), y + h + 10, x - 8 + j(8), y + h * 0.72,
        x - 12 + j(6), y + h * 0.38,
      ];
    default: // 'chunky' / 'jagged' — lumpy, heavily irregular potato rock
      return [
        x - 5, y + 6, x + 2, y, x + w - 2, y, x + w + 5, y + 6,
        x + w + 12 + j(10), y + h * 0.36, x + w + 4 + j(8), y + h * 0.68,
        x + w - 6 + j(8), y + h + 8 + j(8), x + w * 0.64 + j(8), y + h + 2 + j(6),
        x + w * 0.42 + j(10), y + h + 13 + j(8), x + w * 0.18 + j(8), y + h + 5 + j(6),
        x - 6 + j(8), y + h * 0.76, x - 13 + j(10), y + h * 0.42,
      ];
  }
}

function boulderPoly(
  shape: MovingPlatform['shape'],
  x: number,
  y: number,
  w: number,
  h: number,
  rand: () => number,
): number[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const sides = shape === 'jagged' ? 14 : 12;
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI * 0.75;
    // Asymmetric multi-frequency radius modulation so every boulder looks truly irregular
    const lobe = 0.85 + 0.18 * Math.sin(a * 2 + 0.7) + 0.12 * Math.cos(a * 3 - 0.4);
    const spike = shape === 'jagged' ? (i % 2 === 0 ? 1.18 : 0.72) : 0.84 + rand() * 0.34;
    const rx = w * 0.52 * lobe * spike;
    const ry = h * 0.52 * lobe * spike;
    pts.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return pts;
}

function insetPoly(pts: number[], cx: number, cy: number, scale: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    out.push(cx + (pts[i]! - cx) * scale, cy + (pts[i + 1]! - cy) * scale);
  }
  return out;
}

function rockPolygon(cx: number, cy: number, rx: number, ry: number, sides: number, rand: () => number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI * 0.75;
    const jitter = 0.82 + rand() * 0.28;
    pts.push(cx + Math.cos(a) * rx * jitter, cy + Math.sin(a) * ry * jitter);
  }
  return pts;
}

function lerpStops(stops: [number, [number, number, number]][], t: number): number {
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / Math.max(1e-6, t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return (r << 16) | (g << 8) | b;
    }
  }
  const last = stops[stops.length - 1]![1];
  return (last[0] << 16) | (last[1] << 8) | last[2];
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
