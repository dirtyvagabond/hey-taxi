import { Container, Graphics, type Text } from 'pixi.js';
import { archetypeColor, Input, personalityArchetype, shortTaxiName, TAXI, type Taxi } from '@hey-taxi/sim';
import { skinDef, type HullStage, type SkinArt, type SkinId } from './skins';
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

/**
 * A taxi on screen: its skin's artwork (gear, body, damage, passenger), thruster flames, and
 * the readouts above it. Skins draw inside the physics geometry so crashes look fair.
 */
export class TaxiView {
  readonly root = new Container();
  /** The skin's layers, mirrored when the taxi faces left. */
  private art = new Container();
  private skin: SkinArt;
  private flames = new Graphics();
  private hull = new Graphics();
  private fuel = new Graphics();
  private money: Text | null = null;
  private nameText: Text;
  private badge: Text | null = null;
  private statusTag: Text | null = null;
  private tagged: boolean;

  /** `npc`: a computer-driven taxi, which always shows its cash, hull, fuel, name, and archetype above the cab. */
  constructor(color = 0xffc83d, npc = false, skin: SkinId | string = 'original') {
    const def = skinDef(skin);
    this.skin = def.create(color);
    this.tagged = npc;
    this.art.addChild(this.skin.gear, this.skin.body, this.skin.scars, this.skin.rider);
    this.root.addChild(this.flames, this.art, this.hull, this.fuel);
    if (npc) {
      // Cash, above the hull pips and fuel gauge.
      this.money = makeText('', { fontSize: 10, fill: 0xe6ebff });
      this.money.anchor.set(0.5, 1);
      this.money.position.set(0, -HH - 19);
      this.money.alpha = 0.85;
      // Name and personality archetype side-by-side above cash: "Alva T. [hothead]".
      this.nameText = makeText('', { fontSize: 9, fill: 0xe6ebff, fontWeight: 'bold' });
      this.nameText.anchor.set(0, 1);
      this.nameText.position.set(0, -HH - 30);
      this.nameText.alpha = 0.92;
      this.badge = makeText('', { fontSize: 9, fill: 0xb0badb, fontWeight: 'bold' });
      this.badge.anchor.set(0, 1);
      this.badge.position.set(0, -HH - 30);
      this.badge.alpha = 0.92;
      // Dynamic status tag (Vendetta / Fleeing) above the nameplate.
      this.statusTag = makeText('', { fontSize: 9, fill: 0xff5c5c, fontWeight: 'bold' });
      this.statusTag.anchor.set(0.5, 1);
      this.statusTag.position.set(0, -HH - 41);
      this.statusTag.visible = false;
      this.root.addChild(this.money, this.nameText, this.badge, this.statusTag);
    } else {
      // Player nameplate: shown on other human players and while watching/spectating.
      this.nameText = makeText('', { fontSize: 9, fill: 0xe6ebff, fontWeight: 'bold' });
      this.nameText.anchor.set(0.5, 1);
      this.nameText.position.set(0, -HH - 8);
      this.nameText.alpha = 0.92;
      this.nameText.visible = false;
      this.root.addChild(this.nameText);
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  /** Show a passenger in the cab window (or nobody). */
  setRider(kind: number | null): void {
    this.skin.setRider(kind);
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
  ): void {
    this.root.visible = t.status === 'flying' || t.status === 'landed';
    this.root.position.set(x, y);
    // The server decides which way it faces (Taxi.facing; older saves: right).
    this.art.scale.x = t.facing === -1 ? -1 : 1;
    this.skin.setGear(t.gear);
    const stage = hullStage(t.hp, maxHp);
    this.drawFlames(t.thrust, time, stage === 4);
    this.skin.setDamage(stage, time);
    this.drawHull(t.hp, maxHp, time);
    if (this.tagged) {
      this.drawFuel(t.fuel / fuelMax, time);
      const cash = `$${Math.floor(t.cents / 100)}`;
      if (this.money && this.money.text !== cash) this.money.text = cash;
      if (this.badge) {
        const displayName = shortTaxiName(nameOf?.(t.id) ?? t.id);
        const arch = personalityArchetype(t.personality);
        const tag = `[${arch.toLowerCase()}]`;
        let relayout = false;
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
          const gap = displayName ? 3 : 0;
          const totalW = this.nameText.width + gap + this.badge.width;
          this.nameText.position.x = -totalW / 2;
          this.badge.position.x = -totalW / 2 + this.nameText.width + gap;
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
    const y = -HH - 9;
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
    if (this.tagged) return this.drawPips(hp, maxHp, -HH - 17, color, alpha);
    if (hullStage(hp, maxHp) === 0) return;
    this.drawPips(hp, maxHp, -HH - 10, color, alpha);
  }

  /** Thruster flames; a dying engine (`sputter`) cuts out in short stutters. */
  private drawFlames(thrust: number, time: number, sputter = false): void {
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
      flame(-6, HH, 0, 1, 18 * flick(0), 4);
      flame(6, HH, 0, 1, 18 * flick(1), 4);
    }
    if (thrust & Input.DOWN) flame(0, -HH, 0, -1, 11 * flick(2), 3);
    if (thrust & Input.LEFT) flame(HW, 0, 1, 0, 13 * flick(3), 3.5);
    if (thrust & Input.RIGHT) flame(-HW, 0, -1, 0, 13 * flick(4), 3.5);
  }
}
