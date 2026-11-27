/**
 * "SHUTTLE": a side-profile space shuttle orbiter. Stark white
 * upper fuselage, payload bay doors, OMS pods, and tall swept vertical stabilizer paired
 * with matte-black carbon-carbon nose cap, full-length belly thermal tiles, black-framed
 * flight-deck windows, black wing leading edge, staggered 3-bell SSME cluster + body flap,
 * micro US flag & NASA red accent markings, and asymmetric tricycle landing gear.
 *
 * Default color is pure authentic black-and-white NASA livery. Choosing a custom paint
 * swatch (or rival color) subtly tints the white hull and adds a mission accent band on
 * the tailfin & OMS pod while keeping the black thermal heat shield unmistakable.
 *
 * Taxi-local units, facing right. Sized as large as the game HUD & skin picker cleanly
 * allow (~58u long, belly at y = +10, vertical tailfin peaking at y = -15.2); extended
 * tricycle landing gear sits at y = 24 with outer contact edges at ±feetHalfW (±20).
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default livery color: authentic NASA Space Shuttle white. */
export const SHUTTLE_WHITE = 0xf4f6fa;
const WHITE_SHADE = 0xd2dae8;
const PANEL_LINE = 0xa9b4c9;
const HEAT_SHIELD = 0x151821;
const TILE_SEAM = 0x2d3345;
const NOZZLE = 0x363e52;
const NOZZLE_DARK = 0x10131c;
const GLASS = 0x0f172a;
const GLASS_SHINE = 0x7aa4e6;
const NASA_RED = 0xdc2626;
const FLAG_BLUE = 0x1d4ed8;
const TIRE = 0x161922;
const WARN = 0xff3b3b;

/** Whole shuttle outline (tailfin, OMS pod, fuselage, blunt nose, belly, body flap) for warning glow. */
const SILHOUETTE: readonly number[] = [
  -24.2, -1.0,
  -25.2, -15.2,
  -21.2, -15.2,
  -12.2, -3.8,
  9.5, -3.8,
  14.2, -2.5,
  18.8, 0.2,
  24.2, 2.0,
  28.4, 3.8,
  29.0, 6.4,
  27.4, 9.2,
  24.0, 10.0,
  -29.2, 10.0,
  -29.2, 8.2,
  -24.5, 8.2,
  -24.2, -1.0,
];

/** Where critical sparks fly from (SSME bay, OMS pod, forward hull, nose). */
const SPARKS: readonly (readonly [number, number])[] = [
  [-26.5, 4.5],
  [14.5, 3.2],
  [-19.5, -6.5],
  [24.5, 6.8],
];

function drawBody(g: Graphics, color: number): void {
  const isDefault = color === SHUTTLE_WHITE;
  const hull = isDefault ? SHUTTLE_WHITE : mix(SHUTTLE_WHITE, color, 0.22);
  const hullShade = isDefault ? WHITE_SHADE : mix(WHITE_SHADE, color, 0.26);
  const hullHi = mix(hull, 0xffffff, 0.65);

  // --- 1. Protruding black thermal body flap under the main engines ---
  g.poly([-29.2, 8.4, -23.8, 8.1, -23.8, 10.0, -29.2, 10.0]).fill(HEAT_SHIELD);
  g.moveTo(-29.0, 8.5).lineTo(-24.0, 8.2).stroke({ width: 0.45, color: TILE_SEAM, alpha: 0.85 });

  // --- 2. Three staggered Space Shuttle Main Engine (SSME) bells ---
  // Far lower bell (recessed slightly behind).
  g.poly([-27.8, 3.1, -23.6, 3.8, -23.6, 5.5, -27.8, 6.2]).fill(mix(NOZZLE, 0x000000, 0.28));
  // Upper-center SSME bell.
  g.poly([-28.6, 0.1, -23.8, 0.9, -23.8, 2.5, -28.6, 3.3]).fill(NOZZLE);
  g.moveTo(-28.4, 0.3).lineTo(-28.4, 3.1).stroke({ width: 0.7, color: NOZZLE_DARK });
  g.moveTo(-26.3, 0.6).lineTo(-26.3, 2.8).stroke({ width: 0.45, color: 0x525d78, alpha: 0.75 });
  // Near lower SSME bell (prominent).
  g.poly([-29.0, 4.4, -24.0, 5.2, -24.0, 7.0, -29.0, 7.8]).fill(NOZZLE);
  g.moveTo(-28.8, 4.6).lineTo(-28.8, 7.6).stroke({ width: 0.7, color: NOZZLE_DARK });
  g.moveTo(-26.6, 4.9).lineTo(-26.6, 7.3).stroke({ width: 0.45, color: 0x525d78, alpha: 0.75 });

  // --- 3. Tall, sharply swept vertical stabilizer (tailfin) ---
  g.poly([-24.2, -0.8, -25.2, -15.2, -21.2, -15.2, -12.2, -3.5]).fill(hull);
  // Subtle aft rudder / speedbrake shade.
  g.poly([-25.2, -15.2, -23.3, -15.2, -22.2, -2.0, -24.2, -1.0]).fill(hullShade);
  // Split rudder vertical seam.
  g.moveTo(-23.2, -14.8).lineTo(-22.2, -2.5).stroke({ width: 0.45, color: PANEL_LINE, alpha: 0.85 });
  // Authentic black TPS trim along the tailfin tip and leading edge.
  g.poly([-25.2, -15.2, -21.2, -15.2, -20.5, -14.2, -25.1, -14.2]).fill(HEAT_SHIELD);
  g.moveTo(-21.2, -15.1).lineTo(-12.2, -3.6).stroke({ width: 0.65, color: HEAT_SHIELD, alpha: 0.75 });
  // Subtle mission accent stripe only when a non-default paint swatch is chosen.
  if (!isDefault) {
    g.poly([-24.8, -11.2, -18.2, -11.2, -16.8, -9.2, -24.6, -9.2]).fill(color);
  }

  // --- 4. Main fuselage (stepped crew cabin + flat payload bay + blunt nose) ---
  g.moveTo(-24.5, -1.2)
    .lineTo(-16.5, -3.8)
    .lineTo(9.5, -3.8)
    .lineTo(14.2, -2.5)
    .lineTo(18.8, 0.2)
    .lineTo(24.2, 2.0)
    .quadraticCurveTo(29.4, 3.6, 29.0, 6.4)
    .quadraticCurveTo(28.5, 9.6, 24.0, 10.0)
    .lineTo(-24.5, 10.0)
    .closePath()
    .fill(hull);

  // Upper payload-bay specular highlight.
  g.moveTo(-15.5, -3.3)
    .lineTo(9.2, -3.3)
    .lineTo(13.8, -2.1)
    .stroke({ width: 0.75, color: hullHi, alpha: 0.9 });

  // Payload bay door longitudinal hinge + vertical bay panel seams.
  g.moveTo(-14.5, -2.2).lineTo(8.5, -2.2).stroke({ width: 0.4, color: PANEL_LINE, alpha: 0.75 });
  for (const sx of [-9.5, -3.5, 2.5, 8.2]) {
    g.moveTo(sx, -3.6).lineTo(sx, 2.4).stroke({ width: 0.35, color: PANEL_LINE, alpha: 0.5 });
  }

  // --- 5. Bulging aft OMS (Orbital Maneuvering System) pod ---
  // Small OMS engine nozzle peeking out the rear of the pod.
  g.poly([-26.6, -2.0, -24.4, -1.6, -24.4, -0.3, -26.6, 0.1]).fill(NOZZLE);
  g.moveTo(-26.4, -1.8).lineTo(-26.4, -0.1).stroke({ width: 0.55, color: NOZZLE_DARK });
  // Pod fairing body.
  g.moveTo(-24.8, -2.6)
    .quadraticCurveTo(-19.5, -4.4, -14.8, -2.2)
    .lineTo(-15.2, 1.4)
    .lineTo(-24.8, 1.4)
    .closePath()
    .fill(hull);
  g.moveTo(-24.6, 0.2).lineTo(-15.4, 0.2).lineTo(-15.2, 1.4).lineTo(-24.8, 1.4).closePath().fill(hullShade);
  // Black TPS rear cap & nose collar on the OMS pod.
  g.poly([-24.8, -2.6, -22.6, -3.2, -22.6, 1.4, -24.8, 1.4]).fill(HEAT_SHIELD);
  g.moveTo(-14.8, -2.2).lineTo(-15.2, 1.4).stroke({ width: 0.65, color: HEAT_SHIELD, alpha: 0.6 });
  if (!isDefault) {
    g.rect(-22.2, -1.8, 6.2, 1.2).fill(color);
  }
  // Aft RCS thruster port dots on the OMS pod.
  for (const [rx, ry] of [[-23.7, -1.7], [-23.7, -0.3], [-21.2, -2.6]] as const) {
    g.circle(rx, ry, 0.42).fill(0x0b0e16);
  }

  // --- 6. NASA markings on the white payload bay ---
  // Crisp micro American flag (blue canton + red/white stripes).
  const fx = -11.4;
  const fy = -1.2;
  g.rect(fx, fy, 4.8, 2.7).fill(0xffffff);
  for (let i = 0; i < 4; i++) {
    g.rect(fx, fy + i * 0.72, 4.8, 0.36).fill(NASA_RED);
  }
  g.rect(fx, fy, 2.1, 1.45).fill(FLAG_BLUE);
  g.rect(fx, fy, 4.8, 2.7).stroke({ width: 0.25, color: PANEL_LINE, alpha: 0.6 });

  // NASA red "worm" emblem bar & micro-marking on forward payload bay.
  g.roundRect(1.8, -1.0, 4.8, 0.9, 0.3).fill(NASA_RED);
  g.rect(2.2, 0.45, 4.0, 0.55).fill(HEAT_SHIELD);

  // Crew access hatch outline below/aft of flight deck.
  g.roundRect(9.2, 1.2, 2.4, 3.0, 0.6).stroke({ width: 0.45, color: PANEL_LINE, alpha: 0.85 });
  g.circle(10.4, 2.1, 0.42).fill(GLASS);

  // --- 7. Swept double-delta wing on the lower flank ---
  // White upper wing surface + soft underside shading.
  g.poly([-24.2, 4.2, -4.5, 4.8, 12.0, 7.6, -24.2, 9.0]).fill(hullShade);
  g.poly([-23.5, 4.6, -5.0, 5.1, 8.8, 7.3, -23.5, 7.1]).fill(hull);
  // Bold black RCC wing leading edge sweeping down into the belly.
  g.poly([-24.2, 3.9, -4.5, 4.5, 13.5, 7.6, 10.5, 8.1, -4.8, 5.6, -24.2, 5.1]).fill(HEAT_SHIELD);
  // Dark aft elevon trailing edge.
  g.rect(-24.2, 5.2, 5.2, 2.6).fill(mix(HEAT_SHIELD, NOZZLE, 0.35));

  // --- 8. Signature black RCC blunt nose cap & full-length belly heat shield ---
  // Blunt carbon-carbon nose cap.
  g.moveTo(23.6, 1.8)
    .lineTo(24.2, 2.0)
    .quadraticCurveTo(29.4, 3.6, 29.0, 6.4)
    .quadraticCurveTo(28.5, 9.6, 24.0, 10.0)
    .lineTo(21.4, 10.0)
    .quadraticCurveTo(23.2, 6.2, 23.6, 1.8)
    .closePath()
    .fill(HEAT_SHIELD);

  // Full-length black belly thermal tile shield (curves slightly higher under the chin).
  g.poly([
    -24.5, 7.4,
    13.5, 7.4,
    22.8, 6.5,
    24.0, 10.0,
    -24.5, 10.0,
  ]).fill(HEAT_SHIELD);

  // Subtle ceramic tile seam ticks along the black belly.
  for (let x = -22; x <= 21; x += 3.6) {
    g.moveTo(x, 7.5).lineTo(x, 9.9).stroke({ width: 0.35, color: TILE_SEAM, alpha: 0.65 });
  }
  g.moveTo(-24, 8.7).lineTo(22.5, 8.7).stroke({ width: 0.3, color: TILE_SEAM, alpha: 0.55 });

  // Forward RCS thruster cluster ports just behind the black nose cap.
  for (const [rx, ry] of [[21.4, 2.8], [22.4, 3.6], [21.5, 4.6]] as const) {
    g.circle(rx, ry, 0.45).fill(HEAT_SHIELD);
  }

  // --- 9. Iconic black-framed flight-deck windows ("sunglasses" profile) ---
  // Black thermal-tile windshield surround.
  g.poly([11.8, -1.6, 15.0, -1.4, 20.6, 1.6, 19.6, 3.4, 11.8, 3.0]).fill(HEAT_SHIELD);
  // Three distinct narrow dark glass panes.
  g.poly([12.5, -0.7, 14.9, -0.6, 15.1, 2.1, 12.5, 2.1]).fill(GLASS);
  g.poly([15.6, -0.5, 17.6, 0.4, 17.5, 2.3, 15.7, 2.2]).fill(GLASS);
  g.poly([18.1, 0.7, 19.9, 1.7, 19.3, 2.8, 18.0, 2.4]).fill(GLASS);
  // Crisp glass specular reflections.
  g.moveTo(13.1, -0.2).lineTo(14.5, 0.3).stroke({ width: 0.5, color: GLASS_SHINE, alpha: 0.85, cap: 'round' });
  g.moveTo(16.1, 0.1).lineTo(17.2, 0.9).stroke({ width: 0.5, color: GLASS_SHINE, alpha: 0.9, cap: 'round' });
  g.moveTo(18.4, 1.2).lineTo(19.3, 1.9).stroke({ width: 0.45, color: GLASS_SHINE, alpha: 0.9, cap: 'round' });
}

class ShuttleArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  private paint = new Graphics();
  private warn = new Graphics();
  readonly scars = new Container();
  private marks = new Graphics();
  private sparks = new Graphics();
  readonly rider = new Graphics();
  private accent: number;
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    this.accent = color === SHUTTLE_WHITE ? NASA_RED : color;
    drawBody(this.paint, color);
    this.warn.poly([...SILHOUETTE]).stroke({ width: 4, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint);
    this.scars.addChild(this.marks, this.sparks);
    // Normalize the shuttle silhouette closer to ±24 × ±10 (~50u long, tailfin at y = -11.4,
    // belly pinned cleanly at y = +10) so it matches the hitbox and clears overhead pips/bars.
    for (const layer of [this.body, this.scars, this.rider]) {
      layer.scale.set(0.86, 0.85);
      layer.position.set(0, 1.5);
    }
  }

  /**
   * Asymmetric tricycle landing gear dropping from open belly doors: heavier aft main gear
   * under the wings and a slimmer forward nose gear behind the RCC nose cap. Contact pads
   * sit at y = 24 with outer edges aligned to ±feetHalfW (±20).
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    if (p <= 0) return;
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const top = 9.4;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24

    // [strutX, wheelRadius, padHalfMax, isMainGear]
    const legs: readonly (readonly [number, number, number, boolean])[] = [
      [-14.5, 3.4, 5.5, true],
      [15.0, 2.5, 5.0, false],
    ];

    for (const [ax, wheelR, padMax, isMain] of legs) {
      const wheelY = top + (bottom - wheelR - top) * e;
      // Open black belly gear bay door.
      const doorDir = isMain ? -1 : 1;
      g.poly([
        ax - 2.4, top,
        ax + 2.4, top,
        ax + doorDir * 3.8, top + 2.2 * e,
        ax - doorDir * 1.4, top + 1.6 * e,
      ]).fill(HEAT_SHIELD);
      // Hydraulic oleo strut + diagonal drag brace.
      g.moveTo(ax, top)
        .lineTo(ax, wheelY)
        .stroke({ width: isMain ? 2.4 : 1.8, color: 0xc2cbe0, cap: 'round' });
      g.moveTo(ax - Math.sign(ax) * (isMain ? 4.2 : 3.2), top + 0.4)
        .lineTo(ax, top + (wheelY - top) * 0.62)
        .stroke({ width: 1.2, color: 0x737e99 });
      // Subtle ground-contact skid pad aligned to ±feetHalfW (±20).
      const padHalf = padMax * (0.35 + 0.65 * e);
      g.roundRect(ax - padHalf, wheelY + wheelR - 1.2, padHalf * 2, 1.2, 0.6).fill(locked ? 0xd6ddff : 0x6b748f);
      // Rubber tire (dual-wheel depth hint on main gear) + metallic hub.
      if (isMain) {
        g.circle(ax - 0.9, wheelY - 0.3, wheelR * 0.92).fill(0x0c0e14);
      }
      g.circle(ax, wheelY, wheelR).fill(TIRE);
      g.circle(ax, wheelY, wheelR * 0.48).fill(0xc4cde0);
      g.circle(ax, wheelY, wheelR * 0.18).fill(this.accent);
      if (locked) g.circle(ax, wheelY - wheelR - 1.9, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    if (stage !== this.stage) {
      this.stage = stage;
      const g = this.marks;
      g.clear();
      // Stage 1: chipped/missing thermal tiles along the belly & nose cap.
      if (stage >= 1) {
        for (const [tx, ty] of [[-14, 7.8], [1, 7.8], [15, 7.6], [24.8, 5.4]] as const) {
          g.rect(tx, ty, 2.3, 1.5).fill(0x07090e);
        }
      }
      // Stage 2: atmospheric reentry plasma scorch streaks across nose, flank, and tailfin.
      if (stage >= 2) {
        g.ellipse(19, 5.4, 6.2, 1.7).fill({ color: 0x1a1208, alpha: 0.45 });
        g.ellipse(-8, 3.6, 5.2, 1.9).fill({ color: 0x1a1208, alpha: 0.4 });
        g.circle(-21.5, -9.5, 2.3).fill({ color: 0x1a1208, alpha: 0.48 });
      }
      // Stage 3: cracked flight-deck glass + heavy scorch patches.
      if (stage >= 3) {
        g.moveTo(15.8, -0.3).lineTo(17.5, 1.2).lineTo(16.4, 2.3).stroke({ width: 0.5, color: 0xffffff, alpha: 0.85 });
        g.circle(7, 5.2, 3.4).fill({ color: 0x0d0a06, alpha: 0.55 });
        g.circle(-21, 5.0, 3.1).fill({ color: 0x0d0a06, alpha: 0.5 });
      }
      this.paint.tint = stage >= 3 ? 0xf0c4bc : stage === 2 ? 0xe6e6e6 : 0xffffff;
      this.warn.visible = stage === 4;
      if (stage < 3) this.sparks.clear();
    }
    if (stage === 4) {
      this.warn.alpha = 0.6 + 0.4 * Math.abs(Math.sin(time * 5));
    }
    if (stage >= 3) {
      const g = this.sparks;
      g.clear();
      for (let i = 0; i < (stage === 4 ? 4 : 2); i++) {
        const phase = (time * 1.8 + i * 0.39) % 1;
        const [sx, sy] = SPARKS[i]!;
        g.circle(sx + Math.sin(i * 6.7 + time * 3) * 2, sy + phase * 4.5, 0.7 * (1 - phase) + 0.3).fill({
          color: 0xfff1a8,
          alpha: 1 - phase,
        });
      }
    }
  }

  /** A passenger visible in the forward flight-deck window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(12.6, 1.0, 3.8, 1.2, 0.5).fill(look.shirt);
    g.circle(14.5, 0.0, 1.25).fill(look.skin);
    if (look.hat !== null) g.rect(13.0, -1.5, 3.0, 0.95).fill(look.hat);
  }
}

export const SHUTTLE: SkinDef = {
  id: 'shuttle',
  name: 'SHUTTLE',
  playerColor: SHUTTLE_WHITE,
  thrusters: { leftX: -25, rightX: 25, topY: -2, bottomY: 10 },
  create: (color) => new ShuttleArt(color),
};
