import { Container, Graphics } from 'pixi.js';
import { globalWind, laserState, type Level, type SimState } from '@hey-taxi/sim';
import { VIEW_H, VIEW_W } from '../camera';
import { makeText } from './text';

interface Flake {
  x: number;
  y: number;
  r: number;
  speed: number;
}

/**
 * Dynamic environmental visuals for experimental locales:
 *  - Gravity zones (Polarity Yard): tinted bays, animated field sparks, labels
 *  - Radial gravity wells (Singularity Station): swirling accretion disk & field rings
 *  - Laser & Electroid gates (Gridlock Vault): pylons, charging flicker, active beams
 *  - Meteors (Overdrive Canyon): telegraph streaks and blazing fireballs
 *  - Snow & wind streaks (Frostbite Pass): screen-space snowfall that whips during gusts
 */
export class EnvironmentView {
  /** World-space layer behind taxis & terrain accents (gravity bays, black hole rings). */
  readonly underlay = new Container();
  /** World-space layer above terrain (laser gates, meteors). */
  readonly overlay = new Container();
  /** Screen-space weather layer (blizzard snow & wind streaks). */
  readonly weather = new Container();

  private underlayGfx = new Graphics();
  private overlayGfx = new Graphics();
  private weatherGfx = new Graphics();
  private labels = new Container();
  private flakes: Flake[] = [];
  private level: Level | null = null;

  constructor() {
    this.underlay.addChild(this.underlayGfx, this.labels);
    this.overlay.addChild(this.overlayGfx);
    this.weather.addChild(this.weatherGfx);
  }

  setLevel(level: Level): void {
    this.level = level;
    this.labels.removeChildren().forEach((c) => c.destroy());
    this.flakes = [];

    for (const z of level.gravityZones) {
      if (!z.label) continue;
      const inverted = z.gyScale < 0;
      const color = inverted ? 0xff66d9 : 0x5ce1ff;
      const txt = makeText(inverted ? `▲ ${z.label} ▲` : `▼ ${z.label} ▼`, {
        fontSize: 13,
        fill: color,
        letterSpacing: 2,
      });
      txt.alpha = 0.65;
      txt.anchor.set(0.5, 0);
      txt.position.set((z.x0 + z.x1) / 2, z.y0 + 10);
      this.labels.addChild(txt);
    }

    if (level.theme === 'winter' || level.wind) {
      for (let i = 0; i < 150; i++) {
        this.flakes.push({
          x: Math.random() * 2400,
          y: Math.random() * VIEW_H,
          r: 1.1 + Math.random() * 1.8,
          speed: 35 + Math.random() * 55,
        });
      }
    }
  }

  update(sim: SimState, time: number, dt: number, vpW = VIEW_W): void {
    const level = this.level;
    this.underlayGfx.clear();
    this.overlayGfx.clear();
    this.weatherGfx.clear();
    if (!level) return;

    // 1. Gravity zones (Polarity Yard)
    for (const z of level.gravityZones) {
      const inverted = z.gyScale < 0;
      const color = inverted ? 0xff4fd8 : 0x39d0ff;
      const w = z.x1 - z.x0;
      const h = z.y1 - z.y0;
      this.underlayGfx.rect(z.x0, z.y0, w, h).fill({ color, alpha: inverted ? 0.08 : 0.05 });
      this.underlayGfx.rect(z.x0, z.y0, w, 4).fill({ color, alpha: 0.45 });
      // Animated rising (inverted) or gentle-floating (low-G) field sparks.
      const cols = Math.max(3, Math.floor(w / 110));
      for (let i = 0; i < cols; i++) {
        const sx = z.x0 + ((i + 0.5) / cols) * w;
        const speed = inverted ? -55 : 22;
        for (let k = 0; k < 5; k++) {
          const raw = (k * (h / 5) + time * speed + i * 73) % h;
          const sy = z.y0 + (raw < 0 ? raw + h : raw);
          this.underlayGfx.circle(sx, sy, 2).fill({ color, alpha: 0.35 });
          this.underlayGfx
            .moveTo(sx, sy)
            .lineTo(sx, sy + (inverted ? 10 : -7))
            .stroke({ width: 1.5, color, alpha: 0.22 });
        }
      }
    }

    // 2. Radial gravity wells (Singularity Station)
    for (const w of level.gravityWells) {
      // Concentric field rings pulling inward
      for (let i = 0; i < 4; i++) {
        const phase = ((i / 4) - (time * 0.22) % 1 + 1) % 1;
        const r = w.coreRadius + phase * (w.radius - w.coreRadius);
        const alpha = Math.sin(phase * Math.PI) * 0.2;
        this.underlayGfx.circle(w.x, w.y, r).stroke({ width: 1.5, color: 0xa678ff, alpha });
      }
      // Swirling accretion disk + event horizon
      const pulse = 1 + Math.sin(time * 4) * 0.05;
      this.underlayGfx.circle(w.x, w.y, w.coreRadius * 1.75 * pulse).fill({ color: 0x7c4dff, alpha: 0.16 });
      this.underlayGfx.circle(w.x, w.y, w.coreRadius * 1.28 * pulse).stroke({ width: 4, color: 0xff9d47, alpha: 0.75 });
      this.underlayGfx.circle(w.x, w.y, w.coreRadius * 1.1).stroke({ width: 2, color: 0xffdf99, alpha: 0.9 });
      this.underlayGfx.circle(w.x, w.y, w.coreRadius).fill({ color: 0x05030a, alpha: 0.98 });
      // Orbiting sparks on the accretion ring
      for (let i = 0; i < 6; i++) {
        const a = time * 1.8 + (i * Math.PI * 2) / 6;
        const r = w.coreRadius * 1.35;
        this.underlayGfx.circle(w.x + Math.cos(a) * r, w.y + Math.sin(a) * r, 2.5).fill({ color: 0xffd180, alpha: 0.85 });
      }
    }

    // 3. Laser & Electroid gates (Gridlock Vault)
    for (const g of level.laserGates) {
      const ev = laserState(g, sim.tick);
      const isElectroid = g.gapWidth > 0;
      const beamColor = isElectroid ? 0x39f0ff : 0xff3b5c;
      // Emitter pylons at both ends
      this.overlayGfx.circle(g.x0, g.y0, 6).fill(0x524b63).stroke({ width: 1.5, color: beamColor, alpha: 0.8 });
      this.overlayGfx.circle(g.x1, g.y1, 6).fill(0x524b63).stroke({ width: 1.5, color: beamColor, alpha: 0.8 });

      if (ev.state === 'warn') {
        const flicker = Math.sin(time * 36) > 0 ? 0.65 : 0.2;
        for (const [x0, y0, x1, y1] of ev.segments) {
          this.overlayGfx.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: 0xffc845, alpha: flicker });
        }
      } else if (ev.state === 'active') {
        for (const [x0, y0, x1, y1] of ev.segments) {
          this.overlayGfx.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 10, color: beamColor, alpha: 0.22 });
          this.overlayGfx.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 4, color: beamColor, alpha: 0.9 });
          this.overlayGfx.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.5, color: 0xffffff, alpha: 0.95 });
        }
      }
    }

    // 4. Meteors (Overdrive Canyon)
    for (const m of sim.meteors ?? []) {
      const sp = Math.hypot(m.vx, m.vy) || 1;
      const dx = m.vx / sp;
      const dy = m.vy / sp;
      if (m.warnTicks > 0) {
        // Dashed telegraph streak from spawn point along trajectory
        const alpha = 0.25 + 0.35 * Math.abs(Math.sin(time * 24));
        this.overlayGfx
          .moveTo(m.x, m.y)
          .lineTo(m.x + dx * 280, m.y + dy * 280)
          .stroke({ width: 2, color: 0xff9944, alpha });
        this.overlayGfx.circle(m.x, m.y, 7).stroke({ width: 2, color: 0xffcc66, alpha: alpha + 0.2 });
      } else {
        // Blazing meteor + fiery tail
        this.overlayGfx
          .moveTo(m.x, m.y)
          .lineTo(m.x - dx * 48, m.y - dy * 48)
          .stroke({ width: m.radius * 1.4, color: 0xff5a1f, alpha: 0.35 });
        this.overlayGfx
          .moveTo(m.x, m.y)
          .lineTo(m.x - dx * 26, m.y - dy * 26)
          .stroke({ width: m.radius * 0.9, color: 0xffc145, alpha: 0.8 });
        this.overlayGfx.circle(m.x, m.y, m.radius).fill(0xff7733);
        this.overlayGfx.circle(m.x, m.y, m.radius * 0.55).fill(0xfff1c9);
      }
    }

    // 5. Winter snowfall & wind streaks (Frostbite Pass)
    if (this.flakes.length) {
      const w = globalWind(level, sim.tick);
      const vx = w.ax * 2.6 + (w.warning ? Math.sign(w.ax || 1) * 80 : 0);
      for (const f of this.flakes) {
        f.x = (f.x + vx * dt + vpW) % vpW;
        f.y = (f.y + f.speed * dt) % VIEW_H;
        if (Math.abs(vx) > 90) {
          this.weatherGfx
            .moveTo(f.x, f.y)
            .lineTo(f.x - vx * 0.055, f.y - f.speed * 0.03)
            .stroke({ width: f.r * 0.9, color: 0xe6f7ff, alpha: w.gusting ? 0.65 : 0.4 });
        } else {
          this.weatherGfx.circle(f.x, f.y, f.r).fill({ color: 0xe6f7ff, alpha: 0.55 });
        }
      }
    }
  }
}
