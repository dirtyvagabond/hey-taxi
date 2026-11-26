/**
 * Choosing a taxi's look before it flies: shown for New Game and for each fresh taxi after
 * one is lost. Every skin, drawn large by the in-game renderer; the chosen one sits on a pad
 * with its gear down, the others hover with theirs up. ◀ ▶ for skin, ▲ ▼ (or swatches / custom
 * color picker) for paint color, ENTER (or a card click) to fly, ESC to go back.
 */
import { Container, Graphics, type Text } from 'pixi.js';
import { DEFAULT_CONFIG, TAXI, type Taxi } from '@hey-taxi/sim';
import { VIEW_H, VIEW_W } from '../camera';
import { HUD_COLORS } from './hud';
import { SKINS, type SkinId } from './skins';
import { TaxiView } from './taxi';
import { makeText } from './text';

const ART_SCALE = 3.4;
const CARD_W = 270;
const CARD_H = 240;
const GAP = 24;
const GEAR_SPEED = 1 / DEFAULT_CONFIG.gearTime;

interface PaintSwatch {
  name: string;
  /** undefined = use each skin's default playerColor (classic yellow/gold). */
  color: number | undefined;
  /** Swatch display color. */
  preview: number;
}

const SWATCHES: PaintSwatch[] = [
  { name: 'Classic Gold', color: undefined, preview: 0xffc83d },
  { name: 'Crimson', color: 0xff4d6d, preview: 0xff4d6d },
  { name: 'Cobalt', color: 0x4ea8ff, preview: 0x4ea8ff },
  { name: 'Emerald', color: 0x4ee68c, preview: 0x4ee68c },
  { name: 'Tangerine', color: 0xff8c38, preview: 0xff8c38 },
  { name: 'Violet', color: 0xb97aff, preview: 0xb97aff },
  { name: 'Arctic Cyan', color: 0x4ef2f2, preview: 0x4ef2f2 },
  { name: 'Pearl White', color: 0xf0f4ff, preview: 0xf0f4ff },
  { name: 'Hot Pink', color: 0xff6fae, preview: 0xff6fae },
];

interface Card {
  id: SkinId;
  frame: Graphics;
  name: Text;
  view: TaxiView;
  art: Container;
  gear: number;
}

export class SkinPicker {
  readonly root = new Container();
  private cards: Card[];
  private index: number;
  private color: number | undefined;
  private swatchRings: Graphics[] = [];
  private customRing: Graphics;
  private customFill: Graphics;
  private colorLabel: Text;
  private colorInput: HTMLInputElement | null = null;
  private done = false;

  constructor(
    o: { title: string; sub: string; selected: string | null; color?: number },
    private onPick: (skin: SkinId, color?: number) => void,
    private onCancel: () => void,
  ) {
    this.color = o.color;
    this.root.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x05070f, alpha: 0.97 }));
    const title = makeText(o.title, { fontSize: 40, fill: 0xffc83d, letterSpacing: 4 });
    title.anchor.set(0.5);
    title.position.set(VIEW_W / 2, 96);
    const sub = makeText(o.sub, { fontSize: 16, fill: HUD_COLORS.dim, letterSpacing: 2 });
    sub.anchor.set(0.5);
    sub.position.set(VIEW_W / 2, 140);
    this.root.addChild(title, sub);

    const total = SKINS.length * CARD_W + (SKINS.length - 1) * GAP;
    const top = 176;
    this.cards = SKINS.map((skin, i) => {
      const x = VIEW_W / 2 - total / 2 + i * (CARD_W + GAP);
      const card = new Container();
      card.position.set(x, top);
      const frame = new Graphics();
      const art = new Container();
      art.scale.set(ART_SCALE);
      art.position.set(CARD_W / 2, 114);
      const groundY = 114 + (TAXI.halfH + TAXI.gearLength) * ART_SCALE;
      const pad = new Graphics()
        .rect(CARD_W / 2 - 110, groundY, 220, 10)
        .fill(0x1c2244)
        .rect(CARD_W / 2 - 110, groundY, 220, 2)
        .fill(0x6170c4);
      const view = new TaxiView(this.color ?? skin.playerColor, false, skin.id);
      art.addChild(view.root);
      const name = makeText(skin.name.toUpperCase(), { fontSize: 18, fill: HUD_COLORS.text, letterSpacing: 2 });
      name.anchor.set(0.5);
      name.position.set(CARD_W / 2, CARD_H - 24);
      card.addChild(frame, pad, art, name);
      card.eventMode = 'static';
      card.cursor = 'pointer';
      card.on('pointerover', () => this.select(i));
      card.on('pointertap', () => {
        this.select(i);
        this.confirm();
      });
      this.root.addChild(card);
      return { id: skin.id, frame, name, view, art, gear: 0 };
    });

    // Paint color row below the cards.
    const rowY = top + CARD_H + 54;
    this.colorLabel = makeText('', { fontSize: 14, fill: HUD_COLORS.text, letterSpacing: 2 });
    this.colorLabel.anchor.set(0.5);
    this.colorLabel.position.set(VIEW_W / 2, rowY - 28);
    this.root.addChild(this.colorLabel);

    const swatchSize = 30;
    const swatchGap = 14;
    const customW = 104;
    const rowW = SWATCHES.length * swatchSize + (SWATCHES.length - 1) * swatchGap + 22 + customW;
    const startX = VIEW_W / 2 - rowW / 2;

    SWATCHES.forEach((sw, i) => {
      const sx = startX + i * (swatchSize + swatchGap);
      const box = new Container();
      box.position.set(sx, rowY);
      const ring = new Graphics();
      const fill = new Graphics().roundRect(0, 0, swatchSize, swatchSize, 6).fill(sw.preview);
      box.addChild(ring, fill);
      box.eventMode = 'static';
      box.cursor = 'pointer';
      box.on('pointertap', () => this.setColor(sw.color));
      this.root.addChild(box);
      this.swatchRings.push(ring);
    });

    // Custom color picker button (triggers a hidden native <input type="color">).
    const customX = startX + SWATCHES.length * (swatchSize + swatchGap) + 8;
    const customBtn = new Container();
    customBtn.position.set(customX, rowY);
    this.customRing = new Graphics();
    this.customFill = new Graphics();
    const customTxt = makeText('CUSTOM', { fontSize: 12, fill: HUD_COLORS.text, letterSpacing: 1 });
    customTxt.anchor.set(0.5);
    customTxt.position.set(customW / 2 + 10, swatchSize / 2);
    customBtn.addChild(this.customRing, this.customFill, customTxt);
    customBtn.eventMode = 'static';
    customBtn.cursor = 'pointer';
    customBtn.on('pointertap', () => this.openCustomColor());
    this.root.addChild(customBtn);

    const hint = makeText('◀ ▶ skin · ▲ ▼ paint color · ENTER to fly · ESC to go back', {
      fontSize: 14,
      fill: HUD_COLORS.dim,
    });
    hint.anchor.set(0.5);
    hint.position.set(VIEW_W / 2, rowY + swatchSize + 36);
    this.root.addChild(hint);

    this.index = Math.max(0, this.cards.findIndex((c) => c.id === o.selected));
    this.cards[this.index]!.gear = 1;
    this.select(this.index);
    this.refreshSwatches();
  }

  get isOpen(): boolean {
    return !this.done;
  }

  move(step: number): void {
    const n = this.cards.length;
    this.select((this.index + step + n) % n);
  }

  moveColor(step: number): void {
    const cur = SWATCHES.findIndex((s) => s.color === this.color);
    const base = cur >= 0 ? cur : 0;
    const next = (base + step + SWATCHES.length) % SWATCHES.length;
    this.setColor(SWATCHES[next]!.color);
  }

  confirm(): void {
    if (this.done) return;
    const skin = this.cards[this.index]!.id;
    const color = this.color;
    this.close();
    this.onPick(skin, color);
  }

  cancel(): void {
    if (this.done) return;
    this.close();
    this.onCancel();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.colorInput?.remove();
    this.colorInput = null;
    this.root.destroy({ children: true });
  }

  /** Animate: the chosen taxi lowers its gear onto the pad; the others raise theirs and hover. */
  update(time: number, dt: number): void {
    if (this.done) return;
    this.cards.forEach((c, i) => {
      const chosen = i === this.index;
      c.gear = Math.max(0, Math.min(1, c.gear + (chosen ? 1 : -1) * GEAR_SPEED * dt));
      const bob = chosen ? 0 : Math.sin(time * 2.4 + i) * 2.5 - 8;
      const taxi = {
        id: `preview-${c.id}`,
        status: 'flying',
        gear: c.gear,
        hp: DEFAULT_CONFIG.taxiMaxHp,
        thrust: 0,
        vx: 0,
        vy: 0,
        fuel: DEFAULT_CONFIG.fuelMax,
        cents: 0,
      } as Taxi;
      c.view.update(taxi, 0, bob, time, DEFAULT_CONFIG.taxiMaxHp, DEFAULT_CONFIG.fuelMax, taxi.id);
    });
  }

  private setColor(color: number | undefined): void {
    if (this.done) return;
    this.color = color;
    this.cards.forEach((c, i) => {
      const skin = SKINS[i]!;
      c.art.removeChild(c.view.root);
      c.view.destroy();
      c.view = new TaxiView(this.color ?? skin.playerColor, false, skin.id);
      c.art.addChild(c.view.root);
    });
    this.refreshSwatches();
  }

  private openCustomColor(): void {
    if (this.done) return;
    if (!this.colorInput) {
      const input = document.createElement('input');
      input.type = 'color';
      input.style.position = 'fixed';
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';
      input.addEventListener('input', () => {
        const parsed = parseInt(input.value.slice(1), 16);
        if (Number.isInteger(parsed)) this.setColor(parsed);
      });
      document.body.appendChild(input);
      this.colorInput = input;
    }
    const hex = (this.color ?? 0xffc83d).toString(16).padStart(6, '0');
    this.colorInput.value = `#${hex}`;
    this.colorInput.click();
  }

  private refreshSwatches(): void {
    const swIdx = SWATCHES.findIndex((s) => s.color === this.color);
    const isCustom = swIdx === -1;
    this.swatchRings.forEach((ring, i) => {
      ring.clear();
      if (i === swIdx) {
        ring.roundRect(-4, -4, 38, 38, 9).stroke({ width: 2.5, color: 0xffffff });
      }
    });
    this.customRing.clear();
    this.customRing
      .roundRect(0, 0, 104, 30, 6)
      .fill({ color: 0x161b36, alpha: 0.95 })
      .stroke({ width: isCustom ? 2.5 : 1, color: isCustom ? 0xffffff : 0x3b4980 });
    this.customFill.clear();
    this.customFill.roundRect(6, 6, 18, 18, 4).fill(this.color ?? 0xffc83d);

    const label = isCustom
      ? `PAINT · CUSTOM #${this.color!.toString(16).padStart(6, '0').toUpperCase()}`
      : `PAINT · ${SWATCHES[swIdx]!.name.toUpperCase()}`;
    this.colorLabel.text = label;
    this.colorLabel.style.fill = this.color ?? 0xffc83d;
  }

  private select(i: number): void {
    if (this.done) return;
    this.index = i;
    this.cards.forEach((c, k) => {
      const on = k === i;
      c.frame.clear();
      c.frame.roundRect(0, 0, CARD_W, CARD_H, 14).fill({ color: on ? 0x1c2244 : 0x0e1230, alpha: 0.95 });
      c.frame.roundRect(0, 0, CARD_W, CARD_H, 14).stroke({ width: on ? 3 : 1, color: on ? 0xffc83d : 0x2c3a6e });
      c.name.style.fill = on ? 0xffc83d : HUD_COLORS.text;
      c.name.text = on ? `▶ ${SKINS[k]!.name.toUpperCase()} ◀` : SKINS[k]!.name.toUpperCase();
    });
  }
}
