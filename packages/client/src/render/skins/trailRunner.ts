/**
 * "TRAIL RUNNER": a modern off-road SUV taxi. Crisp Pearl White sculpted body with a hood
 * scoop, black roof rails with dual raised crossbar towers, three side windows separated by
 * a black B-pillar and thick forward-slanted C-pillar (lighter front glass showcasing the
 * passenger, darker privacy-tinted rear & cargo glass), silver-edged black side running board,
 * body-colored side mirror and door handles, squared flared wheel arches, and meaty matte-black
 * beadlock off-road tires dropping directly onto the pad on lift struts.
 *
 * The body color repaints the SUV hull directly (default Pearl White) while keeping the black
 * roof rack, dark B-pillar, tinted windows, silver running board, and matte-black beadlock
 * wheels neutral so custom swatches and AI rival colors read cleanly.
 *
 * Taxi-local units, facing right (+x = nose). The body stays inside the ±24 × ±10 hitbox with
 * flush thruster anchors; extended tires sit flush on the pad at y = 24 inside ±feetHalfW.
 */
import { Container, Graphics } from 'pixi.js';
import { TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { mix, type HullStage, type SkinArt, type SkinDef } from './types';

/** Default body color: Pearl White. */
export const TRAIL_RUNNER_WHITE = 0xf0f4ff;

const GLASS_FRONT = 0x1a2e4a;
const GLASS_REAR = 0x0d1524;
const GLASS_SHINE = 0xa8d4ff;
const TRIM_DARK = 0x181c26;
const TRIM_MID = 0x2c3242;
const SILVER_HI = 0xe4ebf7;
const SILVER_MID = 0xa8b4c9;
const TIRE = 0x13161e;
const TIRE_TREAD = 0x252a38;
const RIM_MATTE = 0x1a1e28;
const RIM_SPOKE = 0x353c4d;
const HEADLIGHT = 0xf5f9ff;
const TAIL_RED = 0xe62e3d;
const WARN = 0xff3b3b;

/** Symmetric off-road wheel axles (outer tire edges at ±17.4, well inside ±feetHalfW = ±20). */
const AXLES: readonly number[] = [-13.4, 13.4];
const WHEEL_R = 4.0;
const ARCH_TOP_Y = 2.0;
const SILL_Y = 7.6;

/**
 * Modern off-road SUV silhouette (nose at +x) with squared-off open wheel-arch cutouts along
 * y = 7.6 so the meaty matte-black off-road tires show cleanly through when retracted.
 */
function silhouette(g: Graphics): Graphics {
  g.moveTo(-19.0, -7.8)
    .lineTo(5.6, -7.8)
    .quadraticCurveTo(7.0, -7.8, 7.9, -6.2)
    .lineTo(10.6, -1.8)
    .lineTo(20.8, -1.0)
    .quadraticCurveTo(22.4, -0.7, 22.6, 1.2)
    .lineTo(22.6, 5.8)
    .quadraticCurveTo(22.5, 7.6, 21.0, SILL_Y)
    // Front squared wheel arch.
    .lineTo(18.6, SILL_Y)
    .lineTo(16.9, ARCH_TOP_Y)
    .lineTo(9.9, ARCH_TOP_Y)
    .lineTo(8.2, SILL_Y)
    // Mid rocker sill between axles.
    .lineTo(-8.2, SILL_Y)
    // Rear squared wheel arch.
    .lineTo(-9.9, ARCH_TOP_Y)
    .lineTo(-16.9, ARCH_TOP_Y)
    .lineTo(-18.6, SILL_Y)
    .lineTo(-21.0, SILL_Y)
    .quadraticCurveTo(-22.5, 7.4, -22.5, 5.8)
    .lineTo(-21.9, -1.6)
    .lineTo(-19.0, -7.8)
    .closePath();
  return g;
}

function drawBody(g: Graphics, color: number): void {
  const shade = mix(color, 0x000000, 0.14);
  const deep = mix(color, 0x000000, 0.34);
  const hi = mix(color, 0xffffff, 0.6);

  // Subtle rear spoiler lip overhanging the angled rear hatch.
  g.poly([-20.6, -7.8, -18.2, -7.8, -19.0, -6.6, -20.3, -6.9]).fill(color);
  g.moveTo(-20.5, -7.7).lineTo(-18.4, -7.7).stroke({ width: 0.5, color: hi, alpha: 0.7 });

  // Black roof rails + dual raised crossbar towers along the roofline (y: -9.8..-7.8).
  g.roundRect(-18.2, -8.7, 21.2, 1.0, 0.45).fill(TRIM_DARK);
  g.moveTo(-17.6, -8.5).lineTo(2.4, -8.5).stroke({ width: 0.35, color: 0x4b5368, alpha: 0.75 });
  for (const rx of [-13.6, -4.4] as const) {
    g.roundRect(rx - 1.5, -9.8, 3.0, 1.3, 0.6).fill(TRIM_DARK);
    g.moveTo(rx - 0.8, -9.5).lineTo(rx + 0.8, -9.5).stroke({ width: 0.35, color: 0x5c667e, alpha: 0.8 });
  }

  // Main sculpted SUV hull.
  silhouette(g).fill(color);

  // Subtle lower-door sculpted shading between the wheel arches.
  g.rect(-8.2, 4.4, 16.4, 3.2).fill({ color: shade, alpha: 0.8 });
  g.rect(-22.1, 4.8, 3.6, 2.7).fill({ color: shade, alpha: 0.75 });
  g.rect(18.6, 4.8, 3.8, 2.7).fill({ color: shade, alpha: 0.75 });

  // Crisp roofline & hood specular highlights.
  g.moveTo(-18.4, -7.3).lineTo(5.4, -7.3).stroke({ width: 0.8, color: hi, alpha: 0.85, cap: 'round' });
  g.moveTo(11.0, -1.4).lineTo(20.6, -0.7).stroke({ width: 0.75, color: hi, alpha: 0.8, cap: 'round' });

  // Signature raised hood scoop right ahead of the windshield.
  g.poly([12.2, -1.6, 13.6, -2.7, 17.8, -2.4, 18.4, -1.2]).fill(color);
  g.moveTo(13.6, -2.6).lineTo(17.7, -2.3).stroke({ width: 0.65, color: hi, alpha: 0.85, cap: 'round' });
  g.rect(17.5, -2.3, 0.8, 1.0).fill(TRIM_DARK);

  // --- Side greenhouse: front cab window, black B-pillar, tinted rear door, slanted C-pillar, tinted cargo ---
  // Front cab window (lighter glass so passenger shows clearly via setRider).
  g.poly([0.8, -6.5, 5.8, -6.5, 9.2, -1.6, 0.8, -1.6]).fill(GLASS_FRONT);
  g.moveTo(2.0, -5.6).lineTo(5.0, -5.6).stroke({ width: 0.75, color: GLASS_SHINE, alpha: 0.55, cap: 'round' });

  // Black B-pillar dividing front and rear doors.
  g.rect(-0.8, -6.6, 1.7, 5.1).fill(TRIM_DARK);

  // Rear passenger door window (dark privacy tint).
  g.poly([-8.9, -6.5, -0.8, -6.5, -0.8, -1.6, -10.5, -1.6]).fill(GLASS_REAR);
  g.moveTo(-7.6, -5.5).lineTo(-3.4, -5.5).stroke({ width: 0.6, color: GLASS_SHINE, alpha: 0.35, cap: 'round' });

  // Rear cargo window behind the iconic thick forward-slanted body-colored C-pillar, angled to match the hatch.
  g.poly([-19.1, -6.4, -13.2, -6.4, -15.2, -1.6, -21.1, -1.6]).fill(GLASS_REAR);
  g.moveTo(-18.2, -5.4).lineTo(-15.0, -5.4).stroke({ width: 0.55, color: GLASS_SHINE, alpha: 0.3, cap: 'round' });

  // Abstract illegible dark trim-badge greeble ticks on the C-pillar above the rear tire.
  g.rect(-13.4, -3.6, 0.7, 0.65).fill(TRIM_DARK);
  g.rect(-12.5, -3.6, 0.75, 0.65).fill(TRIM_DARK);
  g.rect(-11.55, -3.6, 0.65, 0.65).fill(TRIM_DARK);
  g.rect(-12.2, -2.75, 0.7, 0.5).fill(TRIM_DARK);
  g.rect(-11.3, -2.75, 0.85, 0.5).fill(TRIM_DARK);

  // Dark window beltline trim under all three windows.
  g.moveTo(-21.2, -1.55).lineTo(9.3, -1.55).stroke({ width: 0.65, color: TRIM_DARK });

  // Subtle door seams & body-colored door handles (front + rear).
  g.moveTo(0.0, -1.5).lineTo(0.0, 7.2).stroke({ width: 0.45, color: deep, alpha: 0.45 });
  g.moveTo(9.4, -1.5).lineTo(8.5, 3.6).stroke({ width: 0.45, color: deep, alpha: 0.4 });
  g.moveTo(-10.5, -1.5).lineTo(-9.6, 3.2).stroke({ width: 0.45, color: deep, alpha: 0.4 });
  for (const hx of [1.6, -7.2] as const) {
    g.roundRect(hx, 0.1, 2.5, 0.9, 0.4).fill(shade).stroke({ width: 0.35, color: deep, alpha: 0.55 });
  }

  // Body-colored side mirror with dark lower trim.
  g.roundRect(7.4, -3.1, 2.3, 1.8, 0.6).fill(color).stroke({ width: 0.4, color: deep, alpha: 0.5 });
  g.rect(7.6, -1.9, 1.9, 0.6).fill(TRIM_DARK);

  // Subtle squared fender-arch contour creases.
  for (const ax of AXLES) {
    g.moveTo(ax - 5.5, SILL_Y)
      .lineTo(ax - 3.8, ARCH_TOP_Y - 1.0)
      .lineTo(ax + 3.8, ARCH_TOP_Y - 1.0)
      .lineTo(ax + 5.5, SILL_Y)
      .stroke({ width: 0.65, color: deep, alpha: 0.45, join: 'bevel' });
  }

  // Silver-edged black running board slung cleanly between the wheel arches.
  g.roundRect(-8.0, 7.4, 16.0, 1.7, 0.65).fill(TRIM_DARK);
  g.roundRect(-7.2, 8.2, 14.4, 0.85, 0.35).fill(SILVER_HI);
  g.moveTo(-7.0, 8.85).lineTo(7.0, 8.85).stroke({ width: 0.35, color: SILVER_MID });

  // Swept modern headlight (+x) & rear red taillight (-x).
  g.poly([19.8, 0.2, 22.4, 0.6, 22.4, 2.3, 19.6, 1.9]).fill(HEADLIGHT).stroke({ width: 0.4, color: deep, alpha: 0.5 });
  g.roundRect(-22.3, -0.4, 1.6, 2.4, 0.4).fill(TAIL_RED);

  // Subtle dark lower front chin / rear bumper trim.
  g.roundRect(20.6, 5.4, 2.0, 2.0, 0.4).fill(TRIM_MID);
  g.roundRect(-22.6, 5.4, 1.9, 2.0, 0.4).fill(TRIM_MID);

  // Outer subtle rim outline so Pearl White reads crisply against bright skies too.
  silhouette(g).stroke({ width: 0.55, color: deep, alpha: 0.35 });
}

/** Meaty all-terrain tire on a matte-black beadlock-style 5-spoke wheel. */
function drawOffroadWheel(g: Graphics, x: number, y: number, r: number): void {
  const rimR = r * 0.56;
  // Chunky all-terrain tire casing + outer tread lugs.
  g.circle(x, y, r).fill(TIRE);
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    g.circle(x + Math.cos(a) * (r - 0.18), y + Math.sin(a) * (r - 0.18), 0.46).fill(TIRE_TREAD);
  }
  g.circle(x, y, r - 0.7).stroke({ width: 0.45, color: TIRE_TREAD });

  // Matte-black beadlock wheel rim + simulated beadlock ring bolts.
  g.circle(x, y, rimR).fill(RIM_MATTE);
  g.circle(x, y, rimR + 0.15).stroke({ width: 0.5, color: RIM_SPOKE });
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI * 2) / 10;
    g.circle(x + Math.cos(a) * (rimR - 0.25), y + Math.sin(a) * (rimR - 0.25), 0.22).fill(0x555e75);
  }

  // 5 bold matte-gunmetal spokes + center hub.
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
    g.moveTo(x + Math.cos(a) * (rimR * 0.28), y + Math.sin(a) * (rimR * 0.28))
      .lineTo(x + Math.cos(a) * (rimR * 0.8), y + Math.sin(a) * (rimR * 0.8))
      .stroke({ width: 0.75, color: RIM_SPOKE, cap: 'round' });
  }
  g.circle(x, y, rimR * 0.26).fill(TIRE).stroke({ width: 0.35, color: RIM_SPOKE });
}

class TrailRunnerArt implements SkinArt {
  readonly gear = new Graphics();
  readonly body = new Container();
  readonly scars = new Graphics();
  readonly rider = new Graphics();
  private paint = new Graphics();
  private warn = new Graphics();
  private stage: HullStage | -1 = -1;
  private riderKind: number | null = null;

  constructor(color: number) {
    drawBody(this.paint, color);
    silhouette(this.warn).stroke({ width: 3.5, color: WARN, alpha: 0.9, join: 'round' });
    this.warn.visible = false;
    this.body.addChild(this.warn, this.paint);
    this.setGear(0);
  }

  /**
   * Meaty matte-black off-road tires tucked into the squared wheel arches in flight (p = 0)
   * and dropping straight onto the pad at y = 24 on lift struts when extended (p = 1).
   */
  setGear(p: number): void {
    const g = this.gear;
    g.clear();
    const e = p * p * (3 - 2 * p);
    const locked = p >= 1;
    const bottom = TAXI.halfH + TAXI.gearLength; // 24
    const restY = TAXI.halfH - WHEEL_R; // 6.0 (bottom at +10, flush with hitbox)
    const downY = bottom - WHEEL_R; // 20.0 (tire bottom rests directly on y = 24)
    const wy = restY + (downY - restY) * e;
    const mountY = ARCH_TOP_Y + 0.6;

    for (const ax of AXLES) {
      if (e > 0.02) {
        // Off-road lift strut + upper shock sleeve + diagonal control arm.
        g.moveTo(ax, mountY).lineTo(ax, wy).stroke({ width: 1.6, color: SILVER_HI });
        g.moveTo(ax, mountY).lineTo(ax, mountY + Math.min(wy - mountY, 5.8)).stroke({ width: 2.9, color: TRIM_DARK });
        const braceX = ax < 0 ? ax + 3.4 : ax - 3.4;
        g.moveTo(braceX, mountY + 0.8).lineTo(ax, wy - 1.5).stroke({ width: 1.05, color: SILVER_MID });
      }
      drawOffroadWheel(g, ax, wy, WHEEL_R);
      if (locked) g.circle(ax, wy - WHEEL_R - 1.7, 1.1).fill(0x6dff8a);
    }
  }

  setDamage(stage: HullStage, time: number): void {
    const g = this.scars;
    if (stage !== this.stage) {
      this.stage = stage;
      g.clear();
      // Stage 1: desert trail pinstripes & mud scuff on the lower door.
      if (stage >= 1) {
        g.moveTo(-9.5, 2.2).lineTo(-3.2, 2.8).stroke({ width: 0.6, color: 0x5c4b3b, alpha: 0.65, cap: 'round' });
        g.moveTo(2.4, 3.4).lineTo(6.8, 3.0).stroke({ width: 0.55, color: 0x5c4b3b, alpha: 0.6, cap: 'round' });
      }
      // Stage 2: cracked front cab window + hood scorch.
      if (stage >= 2) {
        g.moveTo(3.4, -5.8).lineTo(5.6, -3.6).lineTo(7.4, -2.0).stroke({ width: 0.55, color: 0xe6f2ff, alpha: 0.85 });
        g.moveTo(5.6, -3.6).lineTo(3.8, -2.4).stroke({ width: 0.45, color: 0xe6f2ff, alpha: 0.7 });
        g.circle(16.2, -0.4, 2.5).fill({ color: 0x1a120a, alpha: 0.5 });
      }
      // Stage 3: heavy hood & rear soot + bent running board + cracked rear window.
      if (stage >= 3) {
        g.circle(16.8, 0.2, 3.4).fill({ color: 0x120c06, alpha: 0.55 });
        g.circle(-16.2, 2.6, 3.0).fill({ color: 0x120c06, alpha: 0.5 });
        g.moveTo(-6.8, -5.4).lineTo(-4.2, -2.8).stroke({ width: 0.5, color: 0xe6f2ff, alpha: 0.75 });
        g.moveTo(-7.4, 8.2).lineTo(-0.5, 9.2).lineTo(7.2, 8.0).stroke({ width: 1.1, color: SILVER_MID, cap: 'round' });
      }
      this.paint.tint = stage >= 3 ? 0xeec4bc : stage === 2 ? 0xeaeaea : 0xffffff;
      this.gear.tint = stage >= 3 ? 0xf0cac2 : 0xffffff;
      this.warn.visible = stage === 4;
    }
    if (stage === 4) {
      this.warn.alpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 5));
    }
  }

  /** Passenger clearly visible in the lighter-tinted front cab window. */
  setRider(kind: number | null): void {
    if (kind === this.riderKind) return;
    this.riderKind = kind;
    const g = this.rider;
    g.clear();
    if (kind === null) return;
    const look = lookFor(kind);
    g.roundRect(2.1, -3.0, 4.4, 1.5, 0.5).fill(look.shirt);
    g.circle(4.3, -4.4, 1.6).fill(look.skin);
    if (look.hat !== null) g.rect(2.7, -6.3, 3.2, 1.05).fill(look.hat);
  }
}

export const TRAIL_RUNNER: SkinDef = {
  id: 'trailRunner',
  name: 'TRAIL RUNNER',
  playerColor: TRAIL_RUNNER_WHITE,
  thrusters: {
    tail: { x: -22.6, y: 4.8 },
    nose: { x: 22.8, y: 4.6 },
    top: { x: -7.5, y: -8.7 },
    bottom: [
      { x: -5.5, y: 9.1 },
      { x: 5.5, y: 9.1 },
    ],
  },
  create: (color) => new TrailRunnerArt(color),
};
