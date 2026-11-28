import { Container, Graphics } from 'pixi.js';
import type { Level } from '@hey-taxi/sim';
import type { ThemePalette } from './world';
import { makeText } from './text';

/**
 * Procedural Santa Monica Beach renderer (homage to Space Taxi's "The Beach").
 * Zero binary assets: California golden-hour coastal sky, puffy clouds, Pacific surf,
 * Santa Monica Pier & Ferris wheel parallax, golden sand, lifeguard tower, giant beach
 * umbrella, lounge chairs, umbrellas, surfboards, and boogie boards.
 */

const SKY_STOPS: readonly [number, number][] = [
  [0.0, 0x0b1730],
  [0.18, 0x13284d],
  [0.36, 0x1e3b66],
  [0.54, 0x3b4870],
  [0.7, 0x7a5368],
  [0.84, 0xc26e58],
  [0.94, 0xe0955c],
  [1.0, 0x995240],
];

/** Coastal twilight sky with low setting California sun and dusk-lit cumulus clouds. */
export function drawBeachSky(viewW: number, viewH: number, rand: () => number): Graphics {
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

  // Low setting California sun near the Pacific horizon (upper/mid-left)
  const sx = viewW * 0.18;
  const sy = viewH * 0.42;
  g.circle(sx, sy, 96).fill({ color: 0xffa65c, alpha: 0.08 });
  g.circle(sx, sy, 62).fill({ color: 0xffb86c, alpha: 0.14 });
  g.circle(sx, sy, 36).fill({ color: 0xffcf82, alpha: 0.24 });
  g.circle(sx, sy, 21).fill(0xffe7ad);

  // Dusk-lit coastal clouds (warm sunset peach & soft rose so taxis pop against the sky)
  const clouds: readonly [number, number, number][] = [
    [viewW * 0.34, viewH * 0.18, 1.05],
    [viewW * 0.64, viewH * 0.2, 1.15],
    [viewW * 0.88, viewH * 0.24, 0.9],
    [viewW * 0.12, viewH * 0.28, 0.78],
    [viewW * 0.52, viewH * 0.3, 0.85],
  ];
  for (const [cx, cy, sc] of clouds) {
    drawPuffyCloud(g, cx, cy, sc);
  }

  // Tiny distant coastal seagulls silhouetted against the twilight sky
  const gulls: readonly [number, number, number][] = [
    [viewW * 0.43, viewH * 0.21, 5],
    [viewW * 0.45, viewH * 0.23, 4],
    [viewW * 0.74, viewH * 0.19, 4.5],
  ];
  for (const [gx, gy, sz] of gulls) {
    g.moveTo(gx - sz, gy + 1)
      .quadraticCurveTo(gx - sz * 0.4, gy - sz * 0.5, gx, gy)
      .quadraticCurveTo(gx + sz * 0.4, gy - sz * 0.5, gx + sz, gy + 1)
      .stroke({ width: 1.4, color: 0x0b1529, alpha: 0.6 });
  }

  void rand;
  return g;
}

/** Parallax twilight Pacific Ocean, Malibu headlands, illuminated Santa Monica Pier & animated Ferris wheel. */
export function drawBeachSkyline(
  w: number,
  h: number,
  rand: () => number,
): { container: Container; update: (dt: number) => void } {
  const container = new Container();
  const g = new Graphics();
  const horizonY = Math.round(h * 0.66);

  // Distant Malibu / Santa Monica headland silhouette on the left
  g.poly([
    -60, horizonY,
    80, horizonY - 46,
    240, horizonY - 62,
    430, horizonY - 38,
    610, horizonY - 14,
    720, horizonY,
  ]).fill({ color: 0x1a2847, alpha: 0.62 });

  // Deeper twilight Pacific Ocean band
  g.rect(-60, horizonY, w + 120, h - horizonY + 40).fill(0x0d354f);
  g.rect(-60, horizonY, w + 120, 14).fill({ color: 0xd98055, alpha: 0.24 });

  // Warm sunset reflections & twilight wave shimmer
  for (let i = 0; i < 30; i++) {
    const wy = horizonY + 12 + rand() * (h - horizonY - 46);
    const wx = rand() * w;
    const wl = 28 + rand() * 70;
    const isSunGlint = wx < 420;
    g.rect(wx, wy, wl, 2).fill({
      color: isSunGlint ? 0xffb86b : 0x4ca6c9,
      alpha: isSunGlint ? 0.36 : 0.18,
    });
  }

  // Santa Monica Pier silhouette + glowing Ferris wheel on the right horizon
  const pierX = Math.min(w * 0.42, 760);
  const pierW = 340;
  const pierY = horizonY - 12;
  // Pier pilings
  for (let px = pierX + 12; px < pierX + pierW; px += 22) {
    g.rect(px, pierY + 6, 4, 42).fill({ color: 0x132236, alpha: 0.78 });
  }
  // Pier deck & buildings
  g.rect(pierX, pierY, pierW, 8).fill({ color: 0x182b42, alpha: 0.88 });
  g.rect(pierX + 26, pierY - 22, 46, 22).fill({ color: 0x15263b, alpha: 0.85 });
  g.rect(pierX + 86, pierY - 16, 36, 16).fill({ color: 0x15263b, alpha: 0.85 });
  // Warm twilight string lights along the pier
  for (let lx = pierX + 16; lx < pierX + pierW - 12; lx += 28) {
    g.circle(lx, pierY - 2, 2.2).fill({ color: 0xffd17a, alpha: 0.75 });
  }

  // Pacific Park Ferris Wheel A-frame support legs (static)
  const fx = pierX + 210;
  const fy = pierY - 52;
  const fr = 38;
  g.moveTo(fx - 18, pierY).lineTo(fx, fy).lineTo(fx + 18, pierY).stroke({ width: 3, color: 0x162940, alpha: 0.85 });

  // Rolling dusk surf foam line near bottom
  const surfY = h - 54;
  g.rect(-60, surfY, w + 120, 60).fill(0x16526e);
  for (let x = -40; x < w + 60; x += 48) {
    g.ellipse(x + 24, surfY + 4, 30, 5).fill({ color: 0xd9e8f0, alpha: 0.42 });
    g.ellipse(x + 10, surfY + 14, 24, 3.5).fill({ color: 0xc2dce8, alpha: 0.28 });
  }
  container.addChild(g);

  // Rotating Ferris wheel assembly pivoted at (fx, fy) — zero per-frame redraws
  const wheel = new Container();
  wheel.position.set(fx, fy);
  const frame = new Graphics();
  frame.circle(0, 0, fr).stroke({ width: 2.5, color: 0x264466, alpha: 0.85 });
  frame.circle(0, 0, fr * 0.65).stroke({ width: 1.5, color: 0x264466, alpha: 0.6 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    frame.moveTo(0, 0).lineTo(Math.cos(a) * fr, Math.sin(a) * fr).stroke({ width: 1, color: 0x264466, alpha: 0.6 });
  }
  frame.circle(0, 0, 4.5).fill(0xffe194);

  // Two alternating gondola light rings for a gentle sunset chase pulse while spinning
  const lightsEven = new Graphics();
  const lightsOdd = new Graphics();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const gx = Math.cos(a) * fr;
    const gy = Math.sin(a) * fr;
    const isEven = i % 2 === 0;
    const target = isEven ? lightsEven : lightsOdd;
    const glow = isEven ? 0xffd166 : 0xff6b7a;
    target.circle(gx, gy, 5.5).fill({ color: glow, alpha: 0.28 });
    target.circle(gx, gy, 3).fill({ color: glow, alpha: 0.95 });
  }
  wheel.addChild(frame, lightsEven, lightsOdd);
  container.addChild(wheel);

  // Realistic 42 s pier ride cycle: 12 s boarding pause -> 3 s ramp-up -> 24 s cruise -> 3 s ease-out
  const BOARDING = 12;
  const RAMP = 3;
  const CRUISE = 24;
  const DECEL = 3;
  const CYCLE = BOARDING + RAMP + CRUISE + DECEL;
  const MAX_OMEGA = 0.24; // ~1 full revolution every ~26 s
  let elapsed = BOARDING - 1.5; // starts ramping up shortly after arrival

  const smoothstep = (t: number): number => {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  };

  const update = (dt: number): void => {
    if (dt <= 0) return;
    elapsed += dt;
    const phase = elapsed % CYCLE;
    let speedFactor = 0;
    if (phase >= BOARDING) {
      const rideT = phase - BOARDING;
      if (rideT < RAMP) {
        speedFactor = smoothstep(rideT / RAMP);
      } else if (rideT < RAMP + CRUISE) {
        speedFactor = 1;
      } else {
        speedFactor = 1 - smoothstep((rideT - RAMP - CRUISE) / DECEL);
      }
    }
    wheel.rotation += MAX_OMEGA * speedFactor * dt;

    // Gentle alternating light chase while spinning; soft steady glow while boarding
    if (speedFactor > 0.01) {
      const pulse = Math.sin(elapsed * 4.5);
      lightsEven.alpha = 0.78 + 0.22 * pulse * speedFactor;
      lightsOdd.alpha = 0.78 - 0.22 * pulse * speedFactor;
    } else {
      lightsEven.alpha = 0.78;
      lightsOdd.alpha = 0.78;
    }
  };

  return { container, update };
}

/** Beach terrain: golden sand shoreline, boardwalk border, lifeguard tower cabin, and beach props. */
export function drawBeachTerrain(level: Level, rand: () => number): Graphics {
  const g = new Graphics();
  const ts = level.tileSize;
  const W = level.width;
  const H = level.height;

  // Identify pads so we can place thematic props around them
  const pad1 = level.pads.find((p) => p.label === '1');
  const pad2 = level.pads.find((p) => p.label === '2');
  const pad3 = level.pads.find((p) => p.label === '3');
  const storePad = level.pads.find((p) => p.kind === 'fuel');
  const telePad = level.pads.find((p) => p.kind === 'teleport');

  // 1. Background decorative props behind/under pads (non-solid visual storytelling)
  const sandSurfaceY = (level.rows - 1) * ts;

  // Giant Beach Umbrella pole descending from Pad 2 to the sand (decorative, fly-through)
  if (pad2) {
    const ux = pad2.x + pad2.w / 2;
    g.rect(ux - 4, pad2.y + ts, 8, sandSurfaceY - (pad2.y + ts)).fill(0xd9e2ec);
    g.rect(ux - 4, pad2.y + ts, 3, sandSurfaceY - (pad2.y + ts)).fill(0xffffff);
    g.rect(ux + 1, pad2.y + ts, 3, sandSurfaceY - (pad2.y + ts)).fill(0x9fb3c8);
    // Umbrella stand buried in sand
    g.ellipse(ux, sandSurfaceY + 1, 18, 5).fill(0xc9a05b);
  }

  // Realistic Santa Monica LA County Lifeguard Tower (drawn as one cohesive structure)
  if (pad3) {
    drawLifeguardTower(g, pad3, ts, sandSurfaceY);
    // Tall classic longboard leaning beside the right edge of the tower base
    drawSurfboard(g, pad3.x + pad3.w - 14, sandSurfaceY, -0.1, 82, 0xff1e6b, 0xb80d49);
  }

  // Beach props along the golden sand floor (lounge chairs, umbrellas, surfboards, boogie boards)
  if (pad1) {
    // Lounge chair + striped beach umbrella + boogie board beside Pad 1
    drawLoungeChair(g, pad1.x + pad1.w + 18, sandSurfaceY, 0x2b95d6);
    drawMiniUmbrella(g, pad1.x + pad1.w + 56, sandSurfaceY, 0xff5a5f, 0xffffff);
    drawBoogieBoard(g, pad1.x + pad1.w + 88, sandSurfaceY, 0.22, 0x00d2a0, 0xffe66d);
  }

  if (storePad) {
    // Second lounge chair + neatly spaced rental longboards & boogie board on the spacious sand left of Perry's
    drawLoungeChair(g, storePad.x - 86, sandSurfaceY, 0xff7b54);
    drawBoogieBoard(g, storePad.x - 54, sandSurfaceY, 0.14, 0xff006e, 0x8338ec);
    drawSurfboard(g, storePad.x - 34, sandSurfaceY, 0.08, 84, 0x00d9d9, 0x009999);
    drawSurfboard(g, storePad.x - 14, sandSurfaceY, 0.04, 86, 0x12b8ff, 0x087ec2);
  }

  // 2. Solid tiles (borders, sand bases, lifeguard cabin)
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      const i = r * level.cols + c;
      if (!level.solid[i] || level.padIndex[i]! >= 0) continue;
      const x = c * ts;
      const y = r * ts;

      // Outer border frame
      if (r === 0 || c === 0 || c === level.cols - 1) {
        // Deep twilight coastal frame
        g.rect(x, y, ts, ts).fill(0x122238);
        g.rect(x + 2, y + 2, ts - 4, ts - 4).fill(0x192e4a);
        if (r === 0) g.rect(x, y + ts - 3, ts, 3).fill(0x31527a);
        continue;
      }

      // Bottom beach sand floor (row 13) — warm dusk sand for crisp HUD/keybind contrast
      if (r === level.rows - 1) {
        g.rect(x, y, ts, ts).fill(0x9c7847);
        g.rect(x, y, ts, 7).fill(0xb8925c); // warm sunset-lit top sand crest
        g.rect(x, y + ts - 6, ts, 6).fill(0x785a31);
        // Subtle sand grain speckles
        for (let k = 0; k < 3; k++) {
          g.circle(x + 5 + rand() * (ts - 10), y + 10 + rand() * (ts - 16), 1.4).fill({
            color: k === 0 ? 0xd9b57e : 0x6e512b,
            alpha: 0.55,
          });
        }
        continue;
      }

      // Lifeguard Tower solid interior cells are rendered by drawLifeguardTower()
      if (pad3 && x >= pad3.x && x < pad3.x + pad3.w && y > pad3.y && r < level.rows - 1) {
        continue;
      }

      // Pier pilings under Teleport T (row 12) are drawn cohesively by drawPierTeleportBase()
      if (telePad && x >= telePad.x && x < telePad.x + telePad.w && r === level.rows - 2) {
        continue;
      }

      // Perry's-style beach café under Store F (rows 11..12) is drawn cohesively by drawBeachCafe()
      if (storePad && x >= storePad.x && x < storePad.x + storePad.w && y > storePad.y && r < level.rows - 1) {
        continue;
      }

      // Warm boardwalk / sand support under Pad 1
      g.rect(x, y, ts, ts).fill(0xc79552);
      g.rect(x + 2, y + 3, ts - 4, ts - 6).fill(0xd9aa64);
      g.rect(x, y, ts, 4).fill(0x9e7139);
    }
  }

  // Cohesive Perry's-style Santa Monica beach café façade under Store F
  if (storePad) {
    drawBeachCafe(g, storePad, ts, sandSurfaceY);
  }

  // Cohesive thematic Santa Monica Pier pilings, cross-bracing & festoon lights under Teleport T
  if (telePad) {
    drawPierTeleportBase(g, telePad, ts, sandSurfaceY);
  }

  // Subtle top boardwalk frame shadow
  g.rect(ts, ts, W - ts * 2, 2).fill({ color: 0x0e2440, alpha: 0.25 });
  void H;
  return g;
}

/** Beach-themed landing pads with crisp cyan/orange/violet readability. */
export function drawBeachPads(level: Level, into: Container, pal: ThemePalette): void {
  const g = new Graphics();
  into.addChild(g);
  const ts = level.tileSize;

  for (const pad of level.pads) {
    const color = pad.kind === 'fuel' ? pal.fuel : pad.kind === 'teleport' ? pal.teleport : pal.pad;

    if (pad.label === '2') {
      // Giant Beach Umbrella canopy: red-and-white striped underside + dark deck + cyan landing strip
      const stripes = 6;
      const sw = pad.w / stripes;
      for (let i = 0; i < stripes; i++) {
        g.rect(pad.x + i * sw, pad.y + 8, sw + 0.5, ts - 8).fill(i % 2 === 0 ? 0xe63946 : 0xf8f9fa);
      }
      // Scalloped umbrella valance along the bottom edge
      for (let i = 0; i < stripes; i++) {
        g.circle(pad.x + (i + 0.5) * sw, pad.y + ts, sw * 0.48).fill(i % 2 === 0 ? 0xc92a37 : 0xe9ecef);
      }
      // Dark label banner strip so PAD 2 is 100% legible over the stripes
      g.roundRect(pad.x + pad.w * 0.22, pad.y + 13, pad.w * 0.56, 20, 4).fill({ color: 0x102840, alpha: 0.88 });
    } else if (pad.label === '3') {
      // Santa Monica Lifeguard Tower overhanging flat roof deck + left sun visor
      g.rect(pad.x, pad.y, pad.w, ts).fill(0x1b3b52);
      g.rect(pad.x - 10, pad.y + ts - 8, pad.w + 14, 8).fill(0x9ec4d6); // LA County powder-blue fascia
      g.rect(pad.x - 10, pad.y + ts - 9, pad.w + 14, 2).fill(0xeef5f8); // bright sunlit roof edge
      g.rect(pad.x - 14, pad.y + ts, 28, 4).fill(0x7ca6bc); // ocean-side sun-visor awning underneath
    } else if (pad.kind === 'fuel') {
      // Perry's-inspired white-stucco roof cornice under the standard STORE · FUEL deck
      g.rect(pad.x, pad.y, pad.w, ts).fill(0x261c16);
      g.rect(pad.x - 2, pad.y + ts - 6, pad.w + 4, 6).fill(0xe6e1d6);
      g.rect(pad.x - 2, pad.y + ts - 7, pad.w + 4, 1.5).fill(0xf7f4ed);
    } else if (pad.kind === 'teleport') {
      // Santa Monica Pier boardwalk portal deck with weathered wood trim & subtle neon-violet crest
      g.rect(pad.x, pad.y, pad.w, ts).fill(0x1b1530);
      // Boardwalk deck planks & warm timber rim along bottom
      g.rect(pad.x - 4, pad.y + ts - 7, pad.w + 8, 7).fill(0x6b4b32);
      g.rect(pad.x - 4, pad.y + ts - 8, pad.w + 8, 2).fill(0x966e4d);
      // Decorative neon-violet pier wave filigree flanking the TELEPORT label
      for (const side of [-1, 1]) {
        const bx = pad.x + pad.w / 2 + side * 66;
        const by = pad.y + ts / 2 + 4;
        g.moveTo(bx - 16, by + 2)
          .quadraticCurveTo(bx - 8, by - 5, bx, by + 2)
          .quadraticCurveTo(bx + 8, by + 7, bx + 16, by)
          .stroke({ width: 2, color: pal.teleport, alpha: 0.55 });
      }
      // Classic wooden pier rope bollards at left & right corners (below landing strip)
      g.rect(pad.x + 6, pad.y + 14, 6, 18).fill(0x876244);
      g.rect(pad.x + pad.w - 12, pad.y + 14, 6, 18).fill(0x876244);
      g.circle(pad.x + 9, pad.y + 14, 3).fill(0xc896ff);
      g.circle(pad.x + pad.w - 9, pad.y + 14, 3).fill(0xc896ff);
    } else {
      // Pad 1: Beach Lounge Boardwalk Deck
      g.rect(pad.x, pad.y, pad.w, ts).fill(pal.padBody);
      g.rect(pad.x, pad.y + ts - 5, pad.w, 5).fill(0x9e7139);
    }

    // Universal high-contrast landing strip + beacon lights (keeps gameplay readability identical)
    g.rect(pad.x, pad.y, pad.w, 5).fill(color);
    g.rect(pad.x, pad.y + 5, pad.w, 3).fill({ color, alpha: 0.3 });
    for (let lx = pad.x + 8; lx < pad.x + pad.w - 4; lx += 16) {
      g.circle(lx, pad.y + 11, 2).fill({ color, alpha: 0.8 });
    }

    const text = pad.kind === 'fuel' ? 'STORE · FUEL' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`;
    const label = makeText(text, { fontSize: 13, fill: color });
    label.anchor.set(0.5);
    label.position.set(pad.x + pad.w / 2, pad.y + ts / 2 + 4);
    into.addChild(label);
  }
}

/** Perry's-inspired Santa Monica beachfront café façade (full 2-row pavilion under STORE · FUEL). */
function drawBeachCafe(
  g: Graphics,
  storePad: { x: number; y: number; w: number },
  ts: number,
  sandY: number,
): void {
  const x = storePad.x;
  const y = storePad.y + ts; // row 11 top
  const w = storePad.w;
  const h = sandY - y; // 80 px tall (rows 11..12)
  const stucco = 0xe8e3d8;
  const stuccoLight = 0xf5f1e8;
  const stuccoShade = 0xc7bfb2;

  // Full white stucco pavilion wall
  g.rect(x, y, w, h).fill(stucco);
  g.rect(x, y, w, 3).fill(stuccoShade);
  g.rect(x + w - 4, y, 4, h).fill(stuccoShade);
  // Subtle stepped parapet accent on upper façade (signature Perry's silhouette)
  g.rect(x + 22, y + 2, w - 44, 24).fill(stuccoLight);
  g.rect(x + 22, y + 2, w - 44, 2).fill(stuccoShade);

  // Iconic centered red oval sign on the upper parapet with crisp white rim & golden sun accent
  const cx = x + w / 2;
  const signY = y + 14;
  g.ellipse(cx, signY + 1.5, 22, 7.5).fill({ color: 0x000000, alpha: 0.14 });
  g.ellipse(cx, signY, 22, 7.5).fill(0xffffff);
  g.ellipse(cx, signY, 20, 6.2).fill(0xd92626);
  g.circle(cx - 11, signY, 2).fill(0xffd166);
  g.rect(cx - 6, signY - 1, 17, 2).fill({ color: 0xfff5f5, alpha: 0.92 });

  // Open-air walk-up café counter framed by two clean white stucco pillars
  const pillarW = 14;
  const openX = x + pillarW;
  const openW = w - pillarW * 2;
  const counterTop = y + 40;
  g.rect(openX, counterTop, openW, sandY - counterTop).fill(0x1b1614);
  // Cozy warm twilight counter lighting under the awning
  g.rect(openX + 2, counterTop + 2, openW - 4, 16).fill({ color: 0xffcf75, alpha: 0.25 });
  g.rect(openX + 10, counterTop + 3, openW - 20, 2.5).fill({ color: 0xffe6a3, alpha: 0.8 });
  // Tiny menu board silhouette inside the counter
  g.rect(cx - 10, counterTop + 10, 20, 12).fill(0x2a2422);
  g.rect(cx - 7, counterTop + 13, 14, 1.5).fill({ color: 0xe6ddd0, alpha: 0.65 });
  g.rect(cx - 7, counterTop + 17, 10, 1.5).fill({ color: 0xe6ddd0, alpha: 0.5 });
  // Lower timber service counter
  g.rect(openX, sandY - 15, openW, 15).fill(0x5c4637);
  g.rect(openX, sandY - 16, openW, 2.5).fill(0x8c6e58);
  // Subtle stucco pillar inner shadows
  g.rect(openX - 2, counterTop, 2, sandY - counterTop).fill(stuccoShade);
  g.rect(openX + openW, counterTop, 2, sandY - counterTop).fill(stuccoShade);

  // Signature bright red scalloped awning spanning across the café front
  const awX = x - 3;
  const awW = w + 6;
  const awY = y + 29;
  const awH = 10;
  g.poly([awX + 4, awY, awX + awW - 4, awY, awX + awW, awY + awH, awX, awY + awH]).fill(0xe02828);
  g.rect(awX, awY + awH - 2, awW, 2).fill(0xb51b1b);
  const scallops = 14;
  const sw = awW / scallops;
  for (let i = 0; i < scallops; i++) {
    g.circle(awX + (i + 0.5) * sw, awY + awH, sw * 0.48).fill(i % 2 === 0 ? 0xd92626 : 0xb51b1b);
  }
}

/** Thematic Santa Monica Pier open-piling substructure with cross-bracing and twilight festoon lights. */
function drawPierTeleportBase(
  g: Graphics,
  telePad: { x: number; y: number; w: number },
  ts: number,
  sandY: number,
): void {
  const x = telePad.x;
  const y = telePad.y + ts; // row 12 top
  const w = telePad.w;
  const h = sandY - y; // 40 px

  // Shadowed surf/under-pier twilight backdrop (lets the wooden pilings read like a real pier)
  g.rect(x, y, w, h).fill({ color: 0x0c283d, alpha: 0.82 });
  // Subtle violet portal shimmer reflecting on the water beneath the pier
  g.ellipse(x + w / 2, y + h - 8, w * 0.36, 6).fill({ color: 0xb48cff, alpha: 0.16 });
  g.rect(x + 6, y, w - 12, 5).fill(0x3b281b); // heavy timber girder under pier deck

  // Five sturdy weathered timber pilings with X-bracing between bays
  const bays = 4;
  const bayW = (w - 20) / bays;
  for (let b = 0; b < bays; b++) {
    const px0 = x + 10 + b * bayW;
    const px1 = px0 + bayW;
    // Diagonal timber X-bracing
    g.moveTo(px0 + 4, y + 6).lineTo(px1 - 4, sandY - 4).stroke({ width: 3.5, color: 0x4f3624 });
    g.moveTo(px1 - 4, y + 6).lineTo(px0 + 4, sandY - 4).stroke({ width: 3.5, color: 0x63452e });
    // Draped warm twilight festoon string lights under the pier deck
    const midX = (px0 + px1) / 2;
    g.moveTo(px0 + 4, y + 6).quadraticCurveTo(midX, y + 16, px1 - 4, y + 6).stroke({ width: 1, color: 0x2a1d14 });
    for (const f of [0.25, 0.5, 0.75]) {
      const lx = px0 + 4 + (px1 - px0 - 8) * f;
      const ly = y + 6 + Math.sin(f * Math.PI) * 6;
      const bulb = f === 0.5 ? 0xd4adff : 0xffd67a;
      g.circle(lx, ly + 1.5, 4).fill({ color: bulb, alpha: 0.22 });
      g.circle(lx, ly + 1.5, 1.8).fill(bulb);
    }
  }
  // Vertical timber pilings drawn cleanly in front of bracing
  for (let i = 0; i <= bays; i++) {
    const px = x + 10 + i * bayW;
    g.rect(px - 5, y, 10, h).fill(0x6b4b32);
    g.rect(px - 5, y, 3, h).fill(0x876244); // sunlit west edge
    g.rect(px + 2, y, 3, h).fill(0x473120); // shadowed east edge
    // Barnacle/sand collar at the base of each piling
    g.rect(px - 6, sandY - 4, 12, 4).fill(0x3a281a);
  }
}

function drawLifeguardTower(
  g: Graphics,
  pad3: { x: number; y: number; w: number },
  ts: number,
  sandY: number,
): void {
  // Authentic LA County / Santa Monica powder-blue palette
  const blueMain = 0x9bc4d8;
  const blueLight = 0xc5e1ee;
  const blueShadow = 0x6b95ab;
  const blueDeep = 0x4b7287;
  const timberDark = 0x26343d;

  const roofBottom = pad3.y + ts; // y = 400
  const deckTop = roofBottom + 44; // y = 444 (cabin height = 44)
  const deckBottom = deckTop + 34; // y = 478 (slatted railing height = 34)
  const baseH = sandY - deckBottom; // ~42 px short stout timber base

  const deckX0 = pad3.x + 12;
  const deckX1 = pad3.x + pad3.w - 14;
  const deckW = deckX1 - deckX0;

  // 1. Sweeping powder-blue entrance ramp angling gently down-left to the sand
  const rampEndX = deckX0 - 94;
  const rampTopY = deckTop + 4;
  const rampBotY = deckBottom - 4;
  const rampLandTopY = sandY - 26;
  // Ramp underside shadow + main deck beam
  g.poly([
    rampEndX, sandY,
    deckX0, rampBotY + 3,
    deckX0, rampBotY - 3,
    rampEndX, sandY - 6,
  ]).fill(blueDeep);
  g.poly([
    rampEndX, sandY - 5,
    deckX0, rampBotY - 2,
    deckX0, rampBotY - 8,
    rampEndX, sandY - 10,
  ]).fill(blueMain);
  // Three parallel slatted ramp railings
  for (let i = 0; i < 3; i++) {
    const f = i / 2;
    const ly0 = rampLandTopY + f * 15;
    const ly1 = rampTopY + f * 18;
    g.moveTo(rampEndX, ly0).lineTo(deckX0, ly1).stroke({ width: 3.5, color: i === 0 ? blueLight : blueMain });
  }
  // Vertical ramp balustrade posts
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const px = rampEndX + (deckX0 - rampEndX) * t;
    const pyTop = rampLandTopY + (rampTopY - rampLandTopY) * t;
    const pyBot = sandY - 4 + (rampBotY - (sandY - 4)) * t;
    g.moveTo(px, pyTop).lineTo(px, pyBot).stroke({ width: 3, color: blueLight });
  }

  // 2. Short sturdy timber base on sand skids with powder-blue X-bracing
  const legL = deckX0 + 14;
  const legR = deckX1 - 14;
  // Sand shadow & wooden runner skids
  g.rect(legL - 8, sandY - 4, legR - legL + 16, 4).fill(timberDark);
  // Stout vertical support posts
  g.rect(legL - 4, deckBottom, 8, baseH).fill(timberDark);
  g.rect(legR - 4, deckBottom, 8, baseH).fill(timberDark);
  // Heavy floor joists directly beneath deck
  g.rect(deckX0 + 2, deckBottom, deckW - 4, 6).fill(timberDark);
  // Iconic powder-blue X-bracing between the short legs
  g.moveTo(legL + 2, deckBottom + 6).lineTo(legR - 2, sandY - 6).stroke({ width: 6, color: blueShadow });
  g.moveTo(legR - 2, deckBottom + 6).lineTo(legL + 2, sandY - 6).stroke({ width: 6, color: blueMain });
  g.moveTo(legR - 2, deckBottom + 5).lineTo(legL + 2, sandY - 7).stroke({ width: 2, color: blueLight });

  // 3. Outward-canted lookout cabin (wider at top under roof eave, narrower at deck)
  const cabTopX0 = deckX0 + 24;
  const cabTopX1 = deckX1 - 8;
  const cabBotX0 = deckX0 + 34;
  const cabBotX1 = deckX1 - 10;
  g.poly([
    cabTopX0, roofBottom,
    cabTopX1, roofBottom,
    cabBotX1, deckTop,
    cabBotX0, deckTop,
  ]).fill(blueMain);
  // Sunlit edge & shadow under roof overhang
  g.rect(cabTopX0, roofBottom, cabTopX1 - cabTopX0, 4).fill(blueDeep);
  // Large canted dark-tinted panoramic front window (ocean side, left)
  g.poly([
    cabTopX0 + 7, roofBottom + 6,
    cabTopX0 + 50, roofBottom + 6,
    cabTopX0 + 50, deckTop - 4,
    cabBotX0 + 5, deckTop - 4,
  ]).fill(0x132636);
  // Subtle sky reflection across top of tinted glass
  g.poly([
    cabTopX0 + 9, roofBottom + 8,
    cabTopX0 + 48, roofBottom + 8,
    cabTopX0 + 48, roofBottom + 16,
    cabTopX0 + 11, roofBottom + 16,
  ]).fill({ color: 0x7fd4ff, alpha: 0.22 });
  // Cabin door + small vertical window on the right side
  const doorX = cabTopX0 + 58;
  g.rect(doorX, roofBottom + 6, 26, deckTop - roofBottom - 6).fill(blueShadow);
  g.rect(doorX + 5, roofBottom + 10, 15, 22).fill(0x162b3d);
  g.rect(doorX + 5, roofBottom + 10, 15, 22).stroke({ width: 2, color: 0xeef5f8 });

  // 4. Wrap-around horizontal-slat deck railing
  g.rect(deckX0, deckTop, deckW, deckBottom - deckTop).fill({ color: blueShadow, alpha: 0.45 });
  // Top handrail & 3 horizontal slats
  for (let i = 0; i < 4; i++) {
    const sy = deckTop + i * 9;
    g.rect(deckX0 - 2, sy, deckW + 4, i === 0 ? 5 : 4).fill(i === 0 ? blueLight : blueMain);
    g.rect(deckX0 - 2, sy + (i === 0 ? 5 : 4), deckW + 4, 1.5).fill(blueDeep);
  }
  // Vertical railing posts
  for (let i = 0; i <= 4; i++) {
    const px = deckX0 + (deckW / 4) * i;
    g.rect(px - 2, deckTop, 4, deckBottom - deckTop).fill(blueLight);
  }
  // Small dark placard for tower number in the center of the deck railing
  const cx = (deckX0 + deckX1) / 2;
  g.roundRect(cx - 8, deckTop + 10, 16, 15, 2).fill(blueLight);
  // Crisp minimalist "3" drawn as vector strokes (matches Pad 3)
  g.moveTo(cx - 3, deckTop + 13)
    .lineTo(cx + 3, deckTop + 13)
    .lineTo(cx, deckTop + 17)
    .lineTo(cx + 3, deckTop + 18)
    .lineTo(cx + 3, deckTop + 22)
    .lineTo(cx - 3, deckTop + 22)
    .stroke({ width: 2, color: 0x1a2630 });
  // Tiny white/red warning sign under front deck edge
  g.rect(cx - 8, deckBottom, 16, 6).fill(0xf8f9fa);
  g.rect(cx - 6, deckBottom + 2, 12, 2).fill(0xe63946);
  // Classic red rescue buoy hanging on the right side of the deck
  g.roundRect(deckX1 - 12, deckTop + 10, 7, 18, 3).fill(0xe63946);
  g.rect(deckX1 - 12, deckTop + 17, 7, 3).fill(0xffffff);
}

function drawPuffyCloud(g: Graphics, cx: number, cy: number, s: number): void {
  // Warm sunset-coral underside
  g.ellipse(cx, cy + 7 * s, 54 * s, 14 * s).fill({ color: 0xc9736b, alpha: 0.45 });
  // Dusk-lit soft peach/amber puffs (subdued alpha so taxis stay high-contrast)
  g.circle(cx - 28 * s, cy + 2 * s, 18 * s).fill({ color: 0xf0b59c, alpha: 0.48 });
  g.circle(cx - 8 * s, cy - 8 * s, 24 * s).fill({ color: 0xf7cbb2, alpha: 0.52 });
  g.circle(cx + 18 * s, cy - 4 * s, 21 * s).fill({ color: 0xf5c4aa, alpha: 0.5 });
  g.circle(cx + 36 * s, cy + 4 * s, 14 * s).fill({ color: 0xe8ab92, alpha: 0.46 });
  g.rect(cx - 32 * s, cy + 2 * s, 68 * s, 14 * s).fill({ color: 0xe39e88, alpha: 0.46 });
}

function drawLoungeChair(g: Graphics, x: number, groundY: number, fabricColor: number): void {
  // Wooden frame legs
  g.moveTo(x - 16, groundY).lineTo(x - 12, groundY - 8).stroke({ width: 2.5, color: 0xf0e4d4 });
  g.moveTo(x + 14, groundY).lineTo(x + 10, groundY - 8).stroke({ width: 2.5, color: 0xf0e4d4 });
  // Reclining chair bed & backrest
  g.moveTo(x - 18, groundY - 19)
    .lineTo(x - 6, groundY - 8)
    .lineTo(x + 16, groundY - 8)
    .stroke({ width: 5, color: fabricColor });
  // White towel stripe highlight
  g.moveTo(x - 16, groundY - 18)
    .lineTo(x - 5, groundY - 9)
    .lineTo(x + 12, groundY - 9)
    .stroke({ width: 1.8, color: 0xffffff });
}

function drawMiniUmbrella(g: Graphics, x: number, groundY: number, c1: number, c2: number): void {
  // Slightly tilted pole
  g.moveTo(x, groundY).lineTo(x - 5, groundY - 38).stroke({ width: 2.5, color: 0xf4f1de });
  // Canopy dome
  g.poly([x - 28, groundY - 32, x - 5, groundY - 46, x + 18, groundY - 32]).fill(c1);
  g.poly([x - 14, groundY - 32, x - 5, groundY - 46, x + 5, groundY - 32]).fill(c2);
}

/** Classic California longboard: wide rounded nose, long parallel rails, gentle squash tail, stringer & fin box. */
function drawSurfboard(
  g: Graphics,
  x: number,
  groundY: number,
  tilt: number,
  len: number,
  bodyColor: number,
  railColor: number,
): void {
  const sin = Math.sin(tilt);
  const cos = Math.cos(tilt);
  const halfW = len * 0.115; // ~9.5 px half-width (~19 px wide for an 84 px longboard)
  // Helper to transform board-local (u = across width, v = 0 at tail .. 1 at nose) into world coords
  const pt = (u: number, v: number): [number, number] => [
    x + sin * (v * len) + cos * (u * halfW),
    groundY - cos * (v * len) + sin * (u * halfW),
  ];

  // Classic longboard outline: square tail -> tapering lower rails -> parallel mid-body -> full rounded nose
  const profile: readonly [number, number][] = [
    [-0.45, 0.0],
    [-0.78, 0.14],
    [-0.96, 0.34],
    [-1.0, 0.58],
    [-0.96, 0.8],
    [-0.76, 0.93],
    [-0.4, 0.99],
    [0.0, 1.0],
    [0.4, 0.99],
    [0.76, 0.93],
    [0.96, 0.8],
    [1.0, 0.58],
    [0.96, 0.34],
    [0.78, 0.14],
    [0.45, 0.0],
  ];

  const outer: number[] = [];
  const inner: number[] = [];
  for (const [u, v] of profile) {
    const [ox, oy] = pt(u, v);
    outer.push(ox, oy);
    const [ix, iy] = pt(u * 0.84, 0.02 + v * 0.96);
    inner.push(ix, iy);
  }
  // Shaded fiberglass rail border + bright glossy deck fill
  g.poly(outer).fill(railColor);
  g.poly(inner).fill(bodyColor);

  // Subtle center stringer line nose-to-tail
  const [tx, ty] = pt(0, 0.03);
  const [nx, ny] = pt(0, 0.97);
  g.moveTo(tx, ty).lineTo(nx, ny).stroke({ width: 1.2, color: railColor, alpha: 0.5 });

  // Glossy left-rail specular highlight
  const [h0x, h0y] = pt(-0.58, 0.28);
  const [h1x, h1y] = pt(-0.56, 0.84);
  g.moveTo(h0x, h0y).lineTo(h1x, h1y).stroke({ width: 2, color: 0xffffff, alpha: 0.28 });

  // Single-fin box slot near the tail
  const [f0x, f0y] = pt(0, 0.07);
  const [f1x, f1y] = pt(0, 0.18);
  g.moveTo(f0x, f0y).lineTo(f1x, f1y).stroke({ width: 2.2, color: 0x16222e });
}

function drawBoogieBoard(
  g: Graphics,
  x: number,
  groundY: number,
  tilt: number,
  bodyColor: number,
  accentColor: number,
): void {
  const len = 26;
  const dx = Math.sin(tilt) * len;
  const dy = -Math.cos(tilt) * len;
  const nx = Math.cos(tilt) * 6.5;
  const ny = Math.sin(tilt) * 6.5;
  // Compact stubby-nose boogie board
  g.poly([
    x - nx * 0.85, groundY - ny * 0.85,
    x + dx * 0.85 - nx, groundY + dy * 0.85 - ny,
    x + dx - nx * 0.45, groundY + dy - ny * 0.45,
    x + dx + nx * 0.45, groundY + dy + ny * 0.45,
    x + dx * 0.85 + nx, groundY + dy * 0.85 + ny,
    x + nx * 0.85, groundY + ny * 0.85,
  ]).fill(bodyColor);
  g.moveTo(x + dx * 0.25, groundY + dy * 0.25)
    .lineTo(x + dx * 0.78, groundY + dy * 0.78)
    .stroke({ width: 3.5, color: accentColor });
}

function sampleGradient(stops: readonly [number, number][], t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (clamped <= t1) {
      const f = t1 > t0 ? (clamped - t0) / (t1 - t0) : 0;
      const r0 = (c0 >> 16) & 0xff;
      const g0 = (c0 >> 8) & 0xff;
      const b0 = c0 & 0xff;
      const r1 = (c1 >> 16) & 0xff;
      const g1 = (c1 >> 8) & 0xff;
      const b1 = c1 & 0xff;
      const r = Math.round(r0 + (r1 - r0) * f);
      const g = Math.round(g0 + (g1 - g0) * f);
      const b = Math.round(b0 + (b1 - b0) * f);
      return (r << 16) | (g << 8) | b;
    }
  }
  return stops[stops.length - 1]![1];
}
