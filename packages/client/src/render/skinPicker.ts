/**
 * Choosing a taxi's look before it flies: shown for New Game and for each fresh taxi after
 * one is lost. Every skin, drawn large by the in-game renderer, on a carousel that scrolls to
 * keep the chosen one centered; it sits on a pad with its gear down, the others hover with
 * theirs up. ◀ ▶ (keys or the edge arrows, or clicking a side card) for skin, ▲ ▼ (or swatches
 * / custom color picker) for paint color, ENTER (or clicking the centered card) to fly, ESC to
 * go back.
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
/** Carousel easing rate (per second): how quickly the strip slides to the chosen card. */
const SCROLL_RATE = 12;
/** Opacity of a card one slot off center; farther cards fade further. */
const SIDE_ALPHA = 0.5;

interface PaintSwatch {
  name: string;
  /** 24-bit RGB paint color. */
  color: number;
}

const SWATCHES: PaintSwatch[] = [
  { name: 'Classic Gold', color: 0xffc83d },
  { name: 'Crimson', color: 0xff4d6d },
  { name: 'Cobalt', color: 0x4ea8ff },
  { name: 'Emerald', color: 0x4ee68c },
  { name: 'Tangerine', color: 0xff8c38 },
  { name: 'Violet', color: 0xb97aff },
  { name: 'Arctic Cyan', color: 0x4ef2f2 },
  { name: 'Pearl White', color: 0xf0f4ff },
  { name: 'Hot Pink', color: 0xff6fae },
];

const SESSION_COLORS_KEY = 'hey-taxi.skinColors';

function loadSessionColors(): Partial<Record<SkinId, number>> {
  try {
    const raw = sessionStorage.getItem(SESSION_COLORS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<Record<SkinId, number>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) {
        out[k as SkinId] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveSessionColor(skin: SkinId, color: number): void {
  try {
    const map = loadSessionColors();
    map[skin] = color;
    sessionStorage.setItem(SESSION_COLORS_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable; no harm
  }
}

interface Card {
  id: SkinId;
  color: number;
  root: Container;
  frame: Graphics;
  name: Text;
  view: TaxiView;
  art: Container;
  gear: number;
}

export class SkinPicker {
  readonly root = new Container();
  /** The row of cards; slides horizontally to center the chosen one. */
  private strip = new Container();
  private cards: Card[];
  private index: number;
  private swatchRings: Graphics[] = [];
  private customRing: Graphics;
  private customFill: Graphics;
  private colorLabel: Text;
  private dots = new Graphics();
  private wheelHandler: ((e: WheelEvent) => void) | null = null;
  private colorInput: HTMLInputElement | null = null;
  private done = false;

  constructor(
    o: { title: string; sub: string; selected: string | null },
    private onPick: (skin: SkinId, color?: number) => void,
    private onCancel: () => void,
  ) {
    const savedColors = loadSessionColors();
    this.root.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x05070f, alpha: 0.97 }));
    const title = makeText(o.title, { fontSize: 40, fill: 0xffc83d, letterSpacing: 4 });
    title.anchor.set(0.5);
    title.position.set(VIEW_W / 2, 96);
    const sub = makeText(o.sub, { fontSize: 16, fill: HUD_COLORS.dim, letterSpacing: 2 });
    sub.anchor.set(0.5);
    sub.position.set(VIEW_W / 2, 140);
    this.root.addChild(title, sub);

    const top = 176;
    this.strip.y = top;
    this.root.addChild(this.strip);
    this.cards = SKINS.map((skin, i) => {
      const card = new Container();
      card.position.set(i * (CARD_W + GAP), 0);
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
      const cardColor = savedColors[skin.id] ?? skin.playerColor;
      const view = new TaxiView(cardColor, false, skin.id);
      art.addChild(view.root);
      const name = makeText(skin.name.toUpperCase(), { fontSize: 18, fill: HUD_COLORS.text, letterSpacing: 2 });
      name.anchor.set(0.5);
      name.position.set(CARD_W / 2, CARD_H - 24);
      card.addChild(frame, pad, art, name);
      card.eventMode = 'static';
      card.cursor = 'pointer';
      // No hover-select: the strip slides under the pointer, so hovering would chase it.
      card.on('pointertap', () => {
        if (i === this.index) this.confirm();
        else this.select(i);
      });
      this.strip.addChild(card);
      return { id: skin.id, color: cardColor, root: card, frame, name, view, art, gear: 0 };
    });

    // Edge arrows: step through the carousel.
    for (const step of [-1, 1]) {
      const arrow = new Container();
      arrow.position.set(step < 0 ? 40 : VIEW_W - 40, top + CARD_H / 2);
      const glyph = makeText(step < 0 ? '◀' : '▶', { fontSize: 22, fill: 0xffc83d });
      glyph.anchor.set(0.5);
      arrow.addChild(
        new Graphics().circle(0, 0, 24).fill({ color: 0x05070f, alpha: 0.85 }).stroke({ width: 1.5, color: 0x3b4980 }),
        glyph,
      );
      arrow.eventMode = 'static';
      arrow.cursor = 'pointer';
      arrow.on('pointertap', () => this.move(step));
      this.root.addChild(arrow);
    }

    // Pagination dots below the carousel so players can see how many skins exist.
    this.dots.position.set(VIEW_W / 2, top + CARD_H + 14);
    this.root.addChild(this.dots);

    // Paint color row below the cards.
    const rowY = top + CARD_H + 62;
    this.colorLabel = makeText('', { fontSize: 14, fill: HUD_COLORS.text, letterSpacing: 2 });
    this.colorLabel.anchor.set(0.5);
    this.colorLabel.position.set(VIEW_W / 2, rowY - 28);
    this.root.addChild(this.colorLabel);

    const swatchSize = 30;
    const swatchGap = 14;
    const customW = 104;
    const rowW = SWATCHES.length * swatchSize + (SWATCHES.length - 1) * swatchGap + 22 + customW;
    const startX = VIEW_W / 2 - rowW / 2;

    SWATCHES.forEach((sw) => {
      const sx = startX + this.swatchRings.length * (swatchSize + swatchGap);
      const box = new Container();
      box.position.set(sx, rowY);
      const ring = new Graphics();
      const fill = new Graphics().roundRect(0, 0, swatchSize, swatchSize, 6).fill(sw.color);
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
    this.strip.x = this.stripTarget();
    this.fadeCards();
    this.refreshSwatches();

    this.wheelHandler = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 4) return;
      this.move(delta > 0 ? 1 : -1);
    };
    window.addEventListener('wheel', this.wheelHandler, { passive: true });
  }

  /** Strip x that puts the chosen card at the center of the view. */
  private stripTarget(): number {
    return VIEW_W / 2 - CARD_W / 2 - this.index * (CARD_W + GAP);
  }

  /** Fade cards by their distance from the center slot. */
  private fadeCards(): void {
    const slot = CARD_W + GAP;
    for (const c of this.cards) {
      const center = this.strip.x + c.root.x + CARD_W / 2;
      const off = Math.abs(center - VIEW_W / 2) / slot;
      c.root.alpha = Math.max(0.15, 1 - (1 - SIDE_ALPHA) * Math.min(off, 1) - 0.25 * Math.max(0, off - 1));
    }
  }

  get isOpen(): boolean {
    return !this.done;
  }

  move(step: number): void {
    const n = this.cards.length;
    this.select((this.index + step + n) % n);
  }

  moveColor(step: number): void {
    const activeColor = this.cards[this.index]!.color;
    const cur = SWATCHES.findIndex((s) => s.color === activeColor);
    const base = cur >= 0 ? cur : 0;
    const next = (base + step + SWATCHES.length) % SWATCHES.length;
    this.setColor(SWATCHES[next]!.color);
  }

  confirm(): void {
    if (this.done) return;
    const card = this.cards[this.index]!;
    this.close();
    this.onPick(card.id, card.color);
  }

  cancel(): void {
    if (this.done) return;
    this.close();
    this.onCancel();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    if (this.wheelHandler) {
      window.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
    }
    this.colorInput?.remove();
    this.colorInput = null;
    this.root.destroy({ children: true });
  }

  /** Animate: the chosen taxi lowers its gear onto the pad; the others raise theirs and hover. */
  update(time: number, dt: number): void {
    if (this.done) return;
    this.strip.x += (this.stripTarget() - this.strip.x) * (1 - Math.exp(-SCROLL_RATE * dt));
    this.fadeCards();
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

  private setColor(color: number): void {
    if (this.done) return;
    const card = this.cards[this.index]!;
    card.color = color;
    card.art.removeChild(card.view.root);
    card.view.destroy();
    card.view = new TaxiView(color, false, card.id);
    card.art.addChild(card.view.root);
    saveSessionColor(card.id, color);
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
    const hex = this.cards[this.index]!.color.toString(16).padStart(6, '0');
    this.colorInput.value = `#${hex}`;
    this.colorInput.click();
  }

  private refreshSwatches(): void {
    const activeColor = this.cards[this.index]!.color;
    const swIdx = SWATCHES.findIndex((s) => s.color === activeColor);
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
    this.customFill.roundRect(6, 6, 18, 18, 4).fill(activeColor);

    const label = isCustom
      ? `PAINT · CUSTOM #${activeColor.toString(16).padStart(6, '0').toUpperCase()}`
      : `PAINT · ${SWATCHES[swIdx]!.name.toUpperCase()}`;
    this.colorLabel.text = label;
    this.colorLabel.style.fill = activeColor;
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
    this.dots.clear();
    const dotGap = 14;
    const start = -((this.cards.length - 1) * dotGap) / 2;
    for (let k = 0; k < this.cards.length; k++) {
      const on = k === i;
      this.dots.circle(start + k * dotGap, 0, on ? 4 : 2.5).fill(on ? 0xffc83d : 0x3b4980);
    }
    this.refreshSwatches();
  }
}
