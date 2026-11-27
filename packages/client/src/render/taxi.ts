import { Container, Graphics, type Text } from 'pixi.js';
import { archetypeColor, Input, personalityArchetype, shortTaxiName, TAXI, type Taxi } from '@hey-taxi/sim';
import { skinDef, type HullStage, type NozzleSpec, type SkinArt, type SkinId, type SkinThrusters, type ThrusterNozzle } from './skins';
import { makeText } from './text';

const { halfW: HW, halfH: HH } = TAXI;

export type { HullStage } from './skins';

/** How damaged a taxi looks, from its hull points (see HullStage). */
export function hullStage(hp: number, maxHp: number): HullStage {
  if (hp <= 0 || hp >= maxHp - 1) return 0;
  if (hp <= 1) return 4;
  if (hp <= 2) return 3;
  return hp >= maxHp - 2 ? 1 : 2;
}

/** Hull pips: one per point, rounded, on a dark plate so they read over smoke and sky. */
export const PIP = { w: 5, h: 4, gap: 2 };
const PIP_EMPTY = 0x5d668c;

const DEFAULT_TAIL: readonly ThrusterNozzle[] = [{ x: -HW, y: 0 }];
const DEFAULT_NOSE: readonly ThrusterNozzle[] = [{ x: HW, y: 0 }];
const DEFAULT_TOP: readonly ThrusterNozzle[] = [{ x: 0, y: -HH }];
const DEFAULT_BOTTOM: readonly ThrusterNozzle[] = [
  { x: -6, y: HH },
  { x: 6, y: HH },
];

export interface ResolvedThrusters {
  tail: readonly ThrusterNozzle[];
  nose: readonly ThrusterNozzle[];
  top: readonly ThrusterNozzle[];
  bottom: readonly ThrusterNozzle[];
}

function nozzles(spec: NozzleSpec | undefined, fallback: readonly ThrusterNozzle[]): readonly ThrusterNozzle[] {
  if (!spec) return fallback;
  return 'x' in spec ? [spec] : spec;
}

export function resolveThrusters(t?: SkinThrusters): ResolvedThrusters {
  return {
    tail: nozzles(t?.tail, DEFAULT_TAIL),
    nose: nozzles(t?.nose, DEFAULT_NOSE),
    top: nozzles(t?.top, DEFAULT_TOP),
    bottom: nozzles(t?.bottom, DEFAULT_BOTTOM),
  };
}

const DEV_THRUSTER_OVERRIDES_KEY = 'hey-taxi.devThrusters';

/** Dev helper: load thruster overrides saved by the `?skins` editor. */
export function loadThrusterOverrides(): Partial<Record<SkinId, SkinThrusters>> {
  if (!import.meta.env.DEV) return {};
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DEV_THRUSTER_OVERRIDES_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<SkinId, SkinThrusters>>) : {};
  } catch {
    return {};
  }
}

/** Dev helper: save (or clear with `null`) thruster overrides for a skin. */
export function saveThrusterOverride(skinId: SkinId, thrusters: SkinThrusters | null): void {
  if (!import.meta.env.DEV) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const map = loadThrusterOverrides();
    if (thrusters) map[skinId] = thrusters;
    else delete map[skinId];
    if (Object.keys(map).length === 0) localStorage.removeItem(DEV_THRUSTER_OVERRIDES_KEY);
    else localStorage.setItem(DEV_THRUSTER_OVERRIDES_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable; ignore
  }
}

/**
 * A taxi on screen: its skin's artwork (gear, body, damage, passenger), thruster flames, and
 * the readouts above it. Skins draw inside the physics geometry so crashes look fair.
 */
export class TaxiView {
  readonly root = new Container();
  /** The skin's layers, mirrored when the taxi faces left. */
  private art = new Container();
  private skinId: SkinId;
  private skin: SkinArt;
  private thrusters: ResolvedThrusters;
  private onStorage: ((e: StorageEvent) => void) | null = null;
  private youPing: Text | null = null;
  private flames = new Graphics();
  private hull = new Graphics();
  private fuel = new Graphics();
  private money: Text | null = null;
  private nameText: Text;
  private badge: Text | null = null;
  private statusTag: Text | null = null;
  private tagged: boolean;

  /** `npc`: a computer-driven taxi, which always shows its cash, hull, fuel, name, and archetype above the cab. */
  constructor(color = 0xffc83d, npc = false, skin: SkinId | string = 'shortBus') {
    const def = skinDef(skin);
    this.skinId = def.id;
    this.skin = def.create(color);
    this.thrusters = resolveThrusters(
      import.meta.env.DEV ? (loadThrusterOverrides()[def.id] ?? def.thrusters) : def.thrusters,
    );
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      this.onStorage = (e: StorageEvent) => {
        if (e.key === DEV_THRUSTER_OVERRIDES_KEY) {
          this.thrusters = resolveThrusters(loadThrusterOverrides()[this.skinId] ?? def.thrusters);
        }
      };
      window.addEventListener('storage', this.onStorage);
    }
    this.tagged = npc;
    this.art.addChild(this.skin.gear, this.skin.body, this.skin.scars, this.skin.rider);
    this.root.addChild(this.flames, this.art, this.hull, this.fuel);
    if (npc) {
      const labelStroke = { color: 0x05070f, width: 2 };
      // Compact single-row nameplate above hull pips: "Alva T. [hothead] · $142".
      this.nameText = makeText('', { fontSize: 10, fill: 0xe6ebff, fontWeight: 'bold', stroke: labelStroke });
      this.nameText.anchor.set(0, 1);
      this.nameText.position.set(0, -HH - 17);
      this.nameText.alpha = 0.94;
      this.badge = makeText('', { fontSize: 10, fill: 0xb0badb, fontWeight: 'bold', stroke: labelStroke });
      this.badge.anchor.set(0, 1);
      this.badge.position.set(0, -HH - 17);
      this.badge.alpha = 0.94;
      this.money = makeText('', { fontSize: 10, fill: 0xb8e994, fontWeight: 'bold', stroke: labelStroke });
      this.money.anchor.set(0, 1);
      this.money.position.set(0, -HH - 17);
      this.money.alpha = 0.92;
      // Dynamic status tag (Vendetta / Fleeing) above the nameplate.
      this.statusTag = makeText('', { fontSize: 10, fill: 0xff5c5c, fontWeight: 'bold', stroke: labelStroke });
      this.statusTag.anchor.set(0.5, 1);
      this.statusTag.position.set(0, -HH - 30);
      this.statusTag.visible = false;
      this.root.addChild(this.nameText, this.badge, this.money, this.statusTag);
    } else {
      // Player nameplate: shown on other human players and while watching/spectating.
      const labelStroke = { color: 0x05070f, width: 2 };
      this.nameText = makeText('', {
        fontSize: 10,
        fill: 0xe6ebff,
        fontWeight: 'bold',
        stroke: labelStroke,
      });
      this.nameText.anchor.set(0.5, 1);
      this.nameText.position.set(0, -HH - 8);
      this.nameText.alpha = 0.94;
      this.nameText.visible = false;
      // Brief transition ping ("▼ YOU") shown on spawn, teleport, or returning from map.
      this.youPing = makeText('▼ YOU', {
        fontSize: 11,
        fill: 0xffe066,
        fontWeight: 'bold',
        stroke: labelStroke,
      });
      this.youPing.anchor.set(0.5, 1);
      this.youPing.position.set(0, -HH - 16);
      this.youPing.visible = false;
      this.root.addChild(this.nameText, this.youPing);
    }
  }

  destroy(): void {
    if (this.onStorage && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.onStorage);
      this.onStorage = null;
    }
    this.root.destroy({ children: true });
  }

  /** Show a passenger in the cab window (or nobody). */
  setRider(kind: number | null): void {
    this.skin.setRider(kind);
  }

  /** Override thruster nozzle placement at runtime (for the `?skins` preview editor). */
  setThrusters(thrusters?: SkinThrusters): void {
    this.thrusters = resolveThrusters(thrusters);
  }

  update(
    t: Taxi,
    x: number,
    y: number,
    time: number,
    maxHp: number,
    fuelMax: number,
    localId?: string,
    nameOf?: (id: string) => string,
    showSelfName = false,
    distFromPlayer?: number,
    youPingAlpha = 0,
  ): void {
    this.root.visible = t.status === 'flying' || t.status === 'landed';
    this.root.position.set(x, y);
    // The server decides which way it faces (Taxi.facing; older saves: right).
    this.art.scale.x = t.facing === -1 ? -1 : 1;
    this.skin.setGear(t.gear);
    const stage = hullStage(t.hp, maxHp);
    this.drawFlames(t.thrust, time, t.facing === -1 ? -1 : 1, stage === 4);
    this.skin.setDamage(stage, time);
    this.drawHull(t.hp, maxHp, time);
    const isLocal = !!localId && t.id === localId;
    if (this.tagged) {
      // Gently dim distant rival overhead labels so nearby traffic and your cab stay the focal point.
      const dist = distFromPlayer ?? 0;
      const labelFade =
        dist <= 260 ? 1 : dist >= 580 ? 0.52 : 1 - 0.48 * ((dist - 260) / 320);
      this.hull.alpha = labelFade;
      this.fuel.alpha = labelFade;
      this.nameText.alpha = 0.94 * labelFade;
      if (this.badge) this.badge.alpha = 0.94 * labelFade;
      if (this.money) this.money.alpha = 0.92 * labelFade;
      this.drawFuel(t.fuel / fuelMax, time);
      const cash = `· $${Math.floor(t.cents / 100)}`;
      let relayout = false;
      if (this.money && this.money.text !== cash) {
        this.money.text = cash;
        relayout = true;
      }
      if (this.badge) {
        const displayName = shortTaxiName(nameOf?.(t.id) ?? t.id);
        const arch = personalityArchetype(t.personality);
        const tag = `[${arch.toLowerCase()}]`;
        if (this.nameText.text !== displayName) {
          this.nameText.text = displayName;
          relayout = true;
        }
        if (this.badge.text !== tag) {
          this.badge.text = tag;
          this.badge.style.fill = archetypeColor(arch);
          relayout = true;
        }
        if (relayout) {
          const gap = 3;
          const moneyW = this.money ? this.money.width : 0;
          const totalW =
            this.nameText.width +
            (displayName ? gap : 0) +
            this.badge.width +
            (this.money ? gap + moneyW : 0);
          let xCur = -totalW / 2;
          this.nameText.position.x = xCur;
          if (displayName) xCur += this.nameText.width + gap;
          this.badge.position.x = xCur;
          xCur += this.badge.width + gap;
          if (this.money) this.money.position.x = xCur;
        }
      }
      if (this.statusTag) {
        if (t.vendettaTargetId) {
          const isYou = !!localId && t.vendettaTargetId === localId;
          const targetLabel = shortTaxiName(nameOf?.(t.vendettaTargetId) ?? t.vendettaTargetId);
          const txt = `⚔ Vendetta: ${targetLabel}`;
          if (this.statusTag.text !== txt) this.statusTag.text = txt;
          this.statusTag.style.fill = isYou ? 0xff4d4d : 0xff9f40;
          this.statusTag.alpha = 0.65 + 0.35 * Math.abs(Math.sin(time * 6));
          this.statusTag.visible = true;
        } else if (t.fleeFromId) {
          const txt = 'Fleeing';
          if (this.statusTag.text !== txt) this.statusTag.text = txt;
          this.statusTag.style.fill = 0x8cc8ff;
          this.statusTag.alpha = 0.85;
          this.statusTag.visible = true;
        } else {
          this.statusTag.visible = false;
        }
      }
    } else {
      const showName = showSelfName || (!!localId && t.id !== localId);
      if (showName) {
        const displayName = shortTaxiName(nameOf?.(t.id) ?? t.id ?? '');
        if (this.nameText.text !== displayName) this.nameText.text = displayName;
        this.nameText.position.y = stage > 0 ? -HH - 14 : -HH - 8;
        this.nameText.visible = !!displayName;
      } else {
        this.nameText.visible = false;
      }
      if (this.youPing) {
        const showPing = isLocal && !showSelfName && youPingAlpha > 0.01;
        this.youPing.visible = showPing;
        if (showPing) {
          this.youPing.alpha = youPingAlpha;
          const baseY = stage > 0 ? -HH - 22 : -HH - 14;
          this.youPing.position.y = baseY + Math.sin(time * 7) * 2.5;
        }
      }
    }
  }

  /** One row of hull pips on a dark plate, centered at y. */
  private drawPips(hp: number, maxHp: number, y: number, color: number, alpha: number): void {
    const g = this.hull;
    const { w, h, gap } = PIP;
    const total = maxHp * w + (maxHp - 1) * gap;
    g.roundRect(-total / 2 - 2, y - 2, total + 4, h + 4, 2).fill({ color: 0x05070f, alpha: 0.75 });
    for (let i = 0; i < maxHp; i++) {
      const x = -total / 2 + i * (w + gap);
      if (i < hp) g.roundRect(x, y, w, h, 1).fill({ color, alpha });
      else g.roundRect(x, y, w, h, 1).stroke({ width: 1, color: PIP_EMPTY });
    }
  }

  /**
   * Rivals only (the player has the HUD): a small fuel gauge between the name tag and the
   * hull pips. Green, yellow below 40%, blinking red below 20%.
   */
  private drawFuel(frac: number, time: number): void {
    const g = this.fuel;
    g.clear();
    const f = Math.max(0, Math.min(1, frac));
    const w = 34;
    const y = -HH - 7;
    const color = f < 0.2 ? 0xff5c5c : f < 0.4 ? 0xffe066 : 0x6dff8a;
    const alpha = f < 0.2 ? 0.45 + 0.55 * Math.abs(Math.sin(time * 7)) : 0.9;
    g.rect(-w / 2 - 1, y - 1, w + 2, 5).fill({ color: 0x05070f, alpha: 0.7 });
    if (f > 0) g.rect(-w / 2, y, w * f, 3).fill({ color, alpha });
  }

  /** Hull pips above a damaged taxi (hidden at full health), above any name tag. */
  private drawHull(hp: number, maxHp: number, time: number): void {
    const g = this.hull;
    g.clear();
    const color = hp >= maxHp ? 0x6dff8a : hp <= 2 ? 0xff5c5c : 0xffe066;
    // Fast blink on the last point.
    const alpha = hp === 1 ? 0.35 + 0.65 * (Math.sin(time * 14) > 0 ? 1 : 0.2) : 1;
    // Other taxis always show their hull (above the fuel gauge); yours from 2 points down.
    if (this.tagged) return this.drawPips(hp, maxHp, -HH - 14, color, alpha);
    if (hullStage(hp, maxHp) === 0) return;
    this.drawPips(hp, maxHp, -HH - 10, color, alpha);
  }

  /** Thruster flames; a dying engine (`sputter`) cuts out in short stutters. */
  private drawFlames(thrust: number, time: number, facing: 1 | -1, sputter = false): void {
    const f = this.flames;
    f.clear();
    if (!thrust) return;
    if (sputter && Math.sin(time * 9) + Math.sin(time * 23) > 1.1) return;
    const flick = (k: number) => 0.75 + 0.2 * Math.sin(time * 55 + k * 1.9) + Math.random() * 0.15;
    const flame = (x: number, y: number, dx: number, dy: number, len: number, w: number) => {
      const px = -dy;
      const py = dx;
      f.poly([x + px * w, y + py * w, x - px * w, y - py * w, x + dx * len, y + dy * len]).fill({
        color: 0xff7a1f,
        alpha: 0.9,
      });
      f.poly([
        x + px * w * 0.5,
        y + py * w * 0.5,
        x - px * w * 0.5,
        y - py * w * 0.5,
        x + dx * len * 0.55,
        y + dy * len * 0.55,
      ]).fill(0xfff1a8);
    };
    if (thrust & Input.UP) {
      this.thrusters.bottom.forEach((n, i) => {
        const s = n.scale ?? 1;
        flame(facing * n.x, n.y, 0, 1, 18 * s * flick(i), 4 * s);
      });
    }
    if (thrust & Input.DOWN) {
      this.thrusters.top.forEach((n, i) => {
        const s = n.scale ?? 1;
        flame(facing * n.x, n.y, 0, -1, 11 * s * flick(2 + i), 3 * s);
      });
    }
    if (thrust & Input.LEFT) {
      const list = facing === 1 ? this.thrusters.nose : this.thrusters.tail;
      list.forEach((n, i) => {
        const s = n.scale ?? 1;
        flame(facing * n.x, n.y, 1, 0, 13 * s * flick(3 + i), 3.5 * s);
      });
    }
    if (thrust & Input.RIGHT) {
      const list = facing === 1 ? this.thrusters.tail : this.thrusters.nose;
      list.forEach((n, i) => {
        const s = n.scale ?? 1;
        flame(facing * n.x, n.y, -1, 0, 13 * s * flick(4 + i), 3.5 * s);
      });
    }
  }
}
