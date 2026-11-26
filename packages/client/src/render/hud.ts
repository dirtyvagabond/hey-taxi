import { Container, Graphics, type Text, type TextStyleAlign } from 'pixi.js';
import {
  atService,
  atStore,
  gravityZoneAt,
  isActive,
  landingMaxVy,
  riderOf,
  serviceCraftFor,
  sideThrustAvailable,
  storeItem,
  windAt,
  type Passenger,
  type SimConfig,
  type SimState,
  type StoreItem,
  type Taxi,
} from '@hey-taxi/sim';
import type { LocaleInfo, PlayerAlert } from '@hey-taxi/sim/protocol';
import { HUD_H, VIEW_H, VIEW_W } from '../camera';
import { PALETTE } from '../ui/theme';
import { SERVICE_COLOR } from './service';
import { makeText } from './text';

export const HUD_COLORS: Record<'good' | 'warn' | 'bad' | 'info' | 'dim' | 'text', number> = {
  good: PALETTE.good,
  warn: PALETTE.warn,
  bad: PALETTE.bad,
  info: PALETTE.info,
  dim: PALETTE.dim,
  text: PALETTE.text,
};

export interface HudAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}

const FUEL_W = 200;
export const RIVAL_HUD_COLOR = 0xff6fae;

/** The waiting passenger closest to a taxi (the one worth racing for). */
export function nearestWaiting(sim: SimState, t: Taxi): Passenger | undefined {
  let best: Passenger | undefined;
  let bestD = Infinity;
  for (const p of sim.passengers) {
    if (p.state !== 'waiting') continue;
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
const JOB_CX = VIEW_W / 2;

/**
 * `bar`     – status bar drawn above the playfield (0,0 → VIEW_W×HUD_H).
 * `overlay` – messages, cards and pause screen drawn over the playfield (place at y = HUD_H).
 */
export class Hud {
  readonly bar = new Container();
  readonly overlay = new Container();

  private fuelBar = new Graphics();
  private ammo = new Graphics();
  private ammoText = this.barText('', 15, 133, 8);
  private flareText = this.barText('', 15, 181, 8);
  private shop: Shop | null = null;
  private teleportPanel: TeleportPanel | null = null;
  private fuelText = this.barText('', 14, 16, 9);
  private moneyText = this.barText('', 20, 240, 7);
  private faresText = this.barText('', 13, 240, 38);
  private rivalText = this.barText('', 13, 330, 38);
  private jobText = this.barText('', 15, JOB_CX, 11, 0.5);
  private payText = this.barText('', 15, JOB_CX, 37, 0.5);
  private gearText = this.barText('', 14, 864, 10);
  private hullText = this.barText('HULL', 11, 1004, 13);
  private hullPips = new Graphics();
  private statusText = this.barText('', 14, 864, 37);
  private vyText = this.barText('', 17, VIEW_W - 16, 9, 1);
  private vxText = this.barText('', 17, VIEW_W - 16, 35, 1);

  private controlsHint!: Text;
  private flashText = this.overlayText('', 30, VIEW_W / 2, 90);
  private flashSub = this.overlayText('', 16, VIEW_W / 2, 126);
  private alertVisible = false;
  private pauseLayer = new Container();
  private pauseSub!: Text;
  private pauseButtons = new Container();
  private pauseHint!: Text;
  private card = new Container();
  private cardBg = new Graphics();
  private cardTitle = makeText('', { fontSize: 34, fill: HUD_COLORS.text, letterSpacing: 2, align: 'center' });
  private cardBody = makeText('', { fontSize: 16, fill: HUD_COLORS.text, lineHeight: 26 });
  private cardButtons = new Container();
  private cardFooter = makeText('', { fontSize: 14, fill: HUD_COLORS.dim });
  private flashTime = 0;
  private menu: Container | null = null;
  private menuItems: Text[] = [];
  private menuLabels: string[] = [];

  constructor() {
    const bg = new Graphics()
      .rect(0, 0, VIEW_W, HUD_H)
      .fill(PALETTE.barBg)
      .rect(0, HUD_H - 2, VIEW_W, 2)
      .fill(PALETTE.borderSubtle);
    for (const x of [224, 432, 848]) bg.rect(x, 10, 1, HUD_H - 20).fill({ color: PALETTE.borderSubtle });
    this.bar.addChildAt(bg, 0);
    this.bar.addChild(this.fuelBar, this.ammo, this.hullPips);

    this.controlsHint = this.overlayText(
      '←↑→↓/WASD thrust · SPACE gear · F missile · C flares · R service · H co-pilot · TAB map · P pause · M mute',
      12,
      VIEW_W / 2,
      VIEW_H - 20,
    );
    this.controlsHint.alpha = 0.55;
    this.controlsHint.visible = false;

    const dim = new Graphics().rect(-2000, -2000, VIEW_W + 4000, VIEW_H + 4000).fill({ color: 0x000000, alpha: 0.62 });
    const paused = makeText('PAUSED', { fontSize: 48, fill: HUD_COLORS.text, letterSpacing: 8 });
    paused.anchor.set(0.5);
    paused.position.set(VIEW_W / 2, VIEW_H / 2 - 58);
    this.pauseSub = makeText('', { fontSize: 13, fill: HUD_COLORS.info, letterSpacing: 2 });
    this.pauseSub.anchor.set(0.5);
    this.pauseSub.position.set(VIEW_W / 2, VIEW_H / 2 - 14);
    this.pauseButtons.position.set(VIEW_W / 2, VIEW_H / 2 + 28);
    this.pauseHint = makeText('P / ESC to resume · Q for server menu', { fontSize: 13, fill: HUD_COLORS.dim });
    this.pauseHint.anchor.set(0.5);
    this.pauseHint.position.set(VIEW_W / 2, VIEW_H / 2 + 78);
    this.pauseLayer.addChild(dim, paused, this.pauseSub, this.pauseButtons, this.pauseHint);
    this.pauseLayer.visible = false;
    this.overlay.addChild(this.pauseLayer);

    for (const t of [this.cardTitle, this.cardBody, this.cardFooter]) t.anchor.set(0.5, 0);
    this.card.addChild(
      new Graphics().rect(-2000, -2000, VIEW_W + 4000, VIEW_H + 4000).fill({ color: 0x000000, alpha: 0.5 }),
      this.cardBg,
      this.cardTitle,
      this.cardBody,
      this.cardButtons,
      this.cardFooter,
    );
    this.card.visible = false;
    this.overlay.addChild(this.card);
  }

  private barText(s: string, size: number, x: number, y: number, anchorX = 0): Text {
    const t = makeText(s, { fontSize: size, fill: HUD_COLORS.text });
    t.anchor.set(anchorX, 0);
    t.position.set(x, y);
    this.bar.addChild(t);
    return t;
  }

  private overlayText(s: string, size: number, x: number, y: number): Text {
    const t = makeText(s, { fontSize: size, fill: HUD_COLORS.text });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.overlay.addChild(t);
    return t;
  }

  setControlsHintVisible(visible: boolean): void {
    this.controlsHint.visible = visible;
  }

  flash(message: string, color: number, sub = ''): void {
    set(this.flashText, message, color);
    set(this.flashSub, sub, HUD_COLORS.text);
    this.positionFlash();
    this.flashTime = 2.2;
  }

  private positionFlash(): void {
    const baseY = this.alertVisible ? 124 : 90;
    this.flashText.y = baseY;
    this.flashSub.y = baseY + 36;
  }

  setPaused(
    paused: boolean,
    opts: { subtitle?: string; hint?: string; actions?: HudAction[] } | string = {},
  ): void {
    this.pauseLayer.visible = paused;
    const cfg = typeof opts === 'string' ? { hint: opts } : opts;
    const hint = cfg.hint ?? 'P / ESC to resume · Q for server menu';
    const sub = cfg.subtitle ?? '';
    if (this.pauseSub.text !== sub) this.pauseSub.text = sub;
    if (this.pauseHint.text !== hint) this.pauseHint.text = hint;
    if (paused && cfg.actions) {
      renderActionRow(this.pauseButtons, cfg.actions);
      this.pauseHint.position.set(VIEW_W / 2, VIEW_H / 2 + 80);
    } else if (!paused) {
      this.pauseButtons.removeChildren().forEach((c) => c.destroy({ children: true }));
    }
  }

  /**
   * Co-pilot panel (H while landed): proficiency, what it means, flares, and whether automatic
   * protection is available right now. Informational; doesn't pause the world.
   */
  updateCoPilot(open: boolean, t: Taxi, c: SimConfig): void {
    if (!this.copilot) {
      const root = new Container();
      const bg = new Graphics();
      const body = makeText('', { fontSize: 14, fill: HUD_COLORS.text, lineHeight: 22 });
      body.position.set(16, 12);
      const status = makeText('', { fontSize: 14, fill: HUD_COLORS.good, lineHeight: 22 });
      const footer = makeText('H to close · closes on takeoff', { fontSize: 12, fill: HUD_COLORS.dim });
      root.addChild(bg, body, status, footer);
      root.position.set(24, 220);
      this.overlay.addChildAt(root, this.overlay.getChildIndex(this.pauseLayer));
      this.copilot = { root, bg, body, status, footer, lastKey: '' };
    }
    const panel = this.copilot;
    panel.root.visible = open;
    if (!open) return;
    const p = t.copilot.countermeasureProficiency;
    const decoy = Math.round(c.flareSuccess * 100);
    const protect = Math.round(p * c.flareSuccess);
    const [statusLabel, statusColor]: [string, number] =
      t.flares <= 0
        ? ['UNAVAILABLE · no flares (buy them at a store)', HUD_COLORS.bad]
        : t.flareCooldownTicks > 0
          ? ['COOLING DOWN', HUD_COLORS.warn]
          : ['AVAILABLE', HUD_COLORS.good];
    const bodyText = [
      'CO-PILOT',
      `Countermeasure proficiency   ${p}`,
      '',
      `When a missile closes in, your co-pilot pops flares in time`,
      `${p}% of the time (one try per missile). Each burst fools each`,
      `missile ${decoy}% of the time: about ${protect}% protection per missile.`,
      `You can always press C yourself.`,
    ].join('\n');
    const statusText = `Flares: ${t.flares}   Automatic protection: ${statusLabel}`;
    const key = `${bodyText}|${statusText}|${statusColor}`;
    if (panel.lastKey !== key) {
      panel.lastKey = key;
      panel.body.text = bodyText;
      set(panel.status, statusText, statusColor);
      panel.status.position.set(16, panel.body.y + panel.body.height + 12);
      panel.footer.position.set(16, panel.status.y + panel.status.height + 12);
      const w = Math.max(panel.body.width, panel.status.width, panel.footer.width) + 32;
      const h = panel.footer.y + panel.footer.height + 14;
      panel.bg
        .clear()
        .roundRect(0, 0, w, h, 10)
        .fill({ color: PALETTE.surface, alpha: 0.94 })
        .stroke({ width: 2, color: AMMO_COLORS.flare, alpha: 0.8 });
    }
  }
  private copilot: { root: Container; bg: Graphics; body: Text; status: Text; footer: Text; lastKey: string } | null = null;

  /** Developer diagnostics text block (top-left of the playfield; empty = hidden). */
  setDiagnostics(text: string): void {
    if (!this.diagText) {
      this.diagText = makeText('', { fontSize: 11, fill: 0xb8f7c8, lineHeight: 15 });
      this.diagText.position.set(10, 8);
      this.diagBg = new Graphics();
      this.overlay.addChild(this.diagBg, this.diagText);
    }
    if (this.diagText.text !== text) {
      this.diagText.text = text;
      this.diagBg!.clear();
      if (text) this.diagBg!.roundRect(4, 4, this.diagText.width + 12, this.diagText.height + 8, 6).fill({ color: 0x000000, alpha: 0.7 });
    }
  }
  private diagText: Text | null = null;
  private diagBg: Graphics | null = null;

  /** Small save indicator in the playfield's top-right corner (empty = hidden). */
  setSave(text: string, color: number): void {
    if (!this.saveText) {
      this.saveText = makeText('', { fontSize: 11, fill: color, letterSpacing: 1 });
      this.saveText.anchor.set(1, 0);
      this.saveText.position.set(VIEW_W - 10, 6);
      this.saveText.alpha = 0.8;
      this.overlay.addChild(this.saveText);
    }
    set(this.saveText, text, color);
  }
  private saveText: Text | null = null;

  /** Follow Mode frame and header banner when spectating another taxi. */
  updateSpectator(info: { name: string; locale: string; activity: string; color: number } | null): void {
    if (!info) {
      if (this.spectator) this.spectator.root.visible = false;
      return;
    }
    if (!this.spectator) {
      const root = new Container();
      const frame = new Graphics();
      const pill = new Graphics();
      const title = makeText('', { fontSize: 15, fill: HUD_COLORS.text, letterSpacing: 1 });
      const sub = makeText('←/→ or [ / ] cycle taxi  ·  P pause  ·  TAB world map  ·  ESC return to your taxi', {
        fontSize: 11,
        fill: HUD_COLORS.dim,
      });
      title.anchor.set(0.5, 0);
      sub.anchor.set(0.5, 0);
      title.position.set(VIEW_W / 2, 12);
      sub.position.set(VIEW_W / 2, 33);
      root.addChild(frame, pill, title, sub);
      this.overlay.addChildAt(root, this.overlay.getChildIndex(this.pauseLayer));
      this.spectator = { root, frame, pill, title, sub, lastKey: '' };
    }
    const s = this.spectator;
    s.root.visible = true;
    const line = `FOLLOWING  ·  ${info.name.toUpperCase()}  ·  ${info.locale.toUpperCase()}  ·  ${info.activity.toUpperCase()}`;
    const key = `${line}|${info.color}`;
    if (s.lastKey !== key) {
      s.lastKey = key;
      set(s.title, line, info.color);
      const w = Math.max(s.title.width, s.sub.width) + 40;
      s.frame
        .clear()
        .rect(2, 2, VIEW_W - 4, VIEW_H - 4)
        .stroke({ width: 3, color: info.color, alpha: 0.65 });
      s.pill
        .clear()
        .roundRect((VIEW_W - w) / 2, 6, w, 48, 8)
        .fill({ color: 0x070a18, alpha: 0.88 })
        .stroke({ width: 1.5, color: info.color, alpha: 0.85 });
    }
  }
  private spectator: {
    root: Container;
    frame: Graphics;
    pill: Graphics;
    title: Text;
    sub: Text;
    lastKey: string;
  } | null = null;

  /** Slim translucent header pill for Full-Level Watch Mode. */
  updateWatchBanner(
    info: { name: string; fareMultiplier: number; taxis: number; waiting: number } | null,
  ): void {
    if (!info) {
      if (this.watchBanner) this.watchBanner.root.visible = false;
      return;
    }
    if (!this.watchBanner) {
      const root = new Container();
      const pill = new Graphics();
      const title = makeText('', { fontSize: 15, fill: HUD_COLORS.info, letterSpacing: 1 });
      const sub = makeText('←/→ or [ / ] switch city  ·  click any taxi to follow  ·  P pause  ·  ESC world overview', {
        fontSize: 11,
        fill: HUD_COLORS.dim,
      });
      title.anchor.set(0.5, 0);
      sub.anchor.set(0.5, 0);
      title.position.set(VIEW_W / 2, 10);
      sub.position.set(VIEW_W / 2, 31);
      root.addChild(pill, title, sub);
      this.overlay.addChildAt(root, this.overlay.getChildIndex(this.pauseLayer));
      this.watchBanner = { root, pill, title, sub, lastKey: '' };
    }
    const b = this.watchBanner;
    b.root.visible = true;
    const line = `${info.name.toUpperCase()}  ·  ×${info.fareMultiplier.toFixed(2)}  ·  ${info.taxis} TAXI${info.taxis === 1 ? '' : 'S'}  ·  ${info.waiting} WAITING`;
    if (b.lastKey !== line) {
      b.lastKey = line;
      set(b.title, line, HUD_COLORS.info);
      const w = Math.max(b.title.width, b.sub.width) + 40;
      b.pill
        .clear()
        .roundRect((VIEW_W - w) / 2, 4, w, 46, 8)
        .fill({ color: 0x070a18, alpha: 0.86 })
        .stroke({ width: 1.5, color: HUD_COLORS.info, alpha: 0.7 });
    }
  }
  private watchBanner: { root: Container; pill: Graphics; title: Text; sub: Text; lastKey: string } | null = null;

  /** Loud, pulsing warning banner when the player's own taxi is threatened while spectating. */
  updatePlayerAlert(alert: PlayerAlert | null, time: number): void {
    this.alertVisible = alert !== null;
    this.positionFlash();
    if (!alert) {
      if (this.alertBanner) this.alertBanner.root.visible = false;
      return;
    }
    if (!this.alertBanner) {
      const root = new Container();
      const bg = new Graphics();
      const text = makeText('', { fontSize: 16, fill: 0xffffff, letterSpacing: 1 });
      text.anchor.set(0.5, 0.5);
      text.position.set(VIEW_W / 2, 82);
      root.addChild(bg, text);
      this.overlay.addChildAt(root, this.overlay.getChildIndex(this.pauseLayer));
      this.alertBanner = { root, bg, text, lastText: '' };
    }
    const b = this.alertBanner;
    b.root.visible = true;
    const msg = `⚠  ${alert.text}  ⚠`;
    if (b.lastText !== msg) {
      b.lastText = msg;
      b.text.text = msg;
    }
    const pulse = 0.68 + 0.32 * Math.abs(Math.sin(time * 9));
    const w = Math.max(540, b.text.width + 44);
    b.bg
      .clear()
      .roundRect((VIEW_W - w) / 2, 64, w, 36, 8)
      .fill({ color: 0xb81d1d, alpha: 0.85 * pulse })
      .stroke({ width: 2, color: 0xff8080, alpha: pulse });
  }
  private alertBanner: { root: Container; bg: Graphics; text: Text; lastText: string } | null = null;

  /** Centered panel for level intros and summaries. */
  showCard(o: {
    kicker?: string;
    title: string;
    color: number;
    body: string;
    footer: string;
    align?: TextStyleAlign;
    /** Tables: a smaller body font so wide rows fit. */
    wide?: boolean;
    actions?: HudAction[];
  }): void {
    this.cardTitle.text = o.kicker ? `${o.kicker}\n${o.title}` : o.title;
    this.cardTitle.style.fill = o.color;
    this.cardBodySize ??= Number(this.cardBody.style.fontSize);
    this.cardBody.style.fontSize = o.wide ? 13 : this.cardBodySize;
    this.cardBody.text = o.body;
    this.cardBody.style.align = o.align ?? 'center';
    this.cardFooter.text = o.footer;
    const hasActions = !!o.actions?.length;
    const btnRowW = hasActions ? renderActionRow(this.cardButtons, o.actions!) : 0;
    if (!hasActions) this.cardButtons.removeChildren().forEach((c) => c.destroy({ children: true }));
    const btnBlockH = hasActions ? 52 : 0;
    const w = Math.max(560, this.cardBody.width + 80, this.cardTitle.width + 80, btnRowW + 80);
    const h = 36 + this.cardTitle.height + 24 + this.cardBody.height + btnBlockH + 24 + this.cardFooter.height + 28;
    const x = (VIEW_W - w) / 2;
    const y = (VIEW_H - h) / 2;
    this.cardBg.clear();
    this.cardBg
      .roundRect(x, y, w, h, 14)
      .fill({ color: PALETTE.surface, alpha: 0.96 })
      .stroke({ width: 2, color: o.color, alpha: 0.75 });
    this.cardTitle.position.set(VIEW_W / 2, y + 36);
    this.cardBody.position.set(VIEW_W / 2, this.cardTitle.y + this.cardTitle.height + 24);
    this.cardButtons.position.set(VIEW_W / 2, this.cardBody.y + this.cardBody.height + 34);
    this.cardFooter.position.set(VIEW_W / 2, this.cardBody.y + this.cardBody.height + btnBlockH + 24);
    this.card.visible = true;
    this.flashTime = 0;
  }

  private cardBodySize: number | undefined;

  hideCard(): void {
    this.card.visible = false;
  }

  /** Title screen with a vertical list of options (mouse or keyboard). */
  showMenu(
    items: string[],
    selected: number,
    onPick: (index: number) => void,
    onHover?: (index: number) => void,
    /** A problem to point out under the menu (e.g. a save that couldn't be loaded). */
    notice?: string | null,
  ): void {
    this.hideMenu();
    this.hideCard();
    const menu = new Container();
    menu.addChild(new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x05070f, alpha: 0.72 }));
    const title = makeText('HEY, TAXI!', { fontSize: 56, fill: 0xffc83d, letterSpacing: 6 });
    title.anchor.set(0.5);
    title.position.set(VIEW_W / 2, VIEW_H / 2 - 150);
    const sub = makeText('fly · land · deliver', { fontSize: 16, fill: HUD_COLORS.dim, letterSpacing: 4 });
    sub.anchor.set(0.5);
    sub.position.set(VIEW_W / 2, VIEW_H / 2 - 100);
    menu.addChild(title, sub);
    this.menuItems = items.map((label, i) => {
      const t = makeText(label, { fontSize: 24, fill: HUD_COLORS.text });
      t.anchor.set(0.5);
      t.position.set(VIEW_W / 2, VIEW_H / 2 - 20 + i * 48);
      t.eventMode = 'static';
      t.cursor = 'pointer';
      t.on('pointerover', () => {
        this.setMenuSelection(i);
        onHover?.(i);
      });
      t.on('pointertap', () => onPick(i));
      menu.addChild(t);
      return t;
    });
    this.menuLabels = items;
    const hint = makeText('↑ ↓ to choose · ENTER to select', { fontSize: 13, fill: HUD_COLORS.dim });
    hint.anchor.set(0.5);
    hint.position.set(VIEW_W / 2, VIEW_H / 2 - 20 + items.length * 48 + 30);
    menu.addChild(hint);
    if (notice) {
      const n = makeText(notice, {
        fontSize: 13,
        fill: HUD_COLORS.bad,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: VIEW_W - 160,
        breakWords: true,
      });
      n.anchor.set(0.5, 0);
      n.position.set(VIEW_W / 2, VIEW_H / 2 - 20 + items.length * 48 + 64);
      menu.addChild(n);
    }
    this.menu = menu;
    this.overlay.addChild(menu);
    this.setMenuSelection(selected);
    this.flashTime = 0;
  }

  setMenuSelection(index: number): void {
    this.menuItems.forEach((t, i) => {
      const on = i === index;
      t.text = on ? `▶  ${this.menuLabels[i]}  ◀` : this.menuLabels[i]!;
      t.style.fill = on ? 0xffc83d : HUD_COLORS.text;
    });
  }

  hideMenu(): void {
    this.menu?.destroy({ children: true });
    this.menu = null;
    this.menuItems = [];
  }

  /** Center of the bar: who to pick up, or where to go and what they'll pay. */
  private updateJob(t: Taxi, sim: SimState): void {
    const pads = sim.level.pads;
    const rider = riderOf(sim, t.id);
    if (rider) {
      // The tip is a percentage of the fare; the clock shows the time left to arrive on time.
      const pct = rider.tipPercent ?? 0;
      const tipColor = pct >= 15 ? HUD_COLORS.good : pct >= 8 ? HUD_COLORS.warn : HUD_COLORS.bad;
      const left = Math.ceil(((rider.dueTicks ?? 0) - (rider.rideTicks ?? 0)) / 60);
      const clock = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'LATE';
      set(this.jobText, `TAKE TO PAD ${pads[rider.destPadIndex]!.label} · ${clock}`, left > 0 ? HUD_COLORS.warn : HUD_COLORS.bad);
      set(this.payText, `$${rider.fare.toFixed(2)} + TIP $${Math.max(0, rider.tip).toFixed(2)} (${Math.floor(pct)}%)`, tipColor);
      return;
    }
    const boarding = sim.passengers.some((p) => p.state === 'walking' && p.taxiId === t.id);
    const waiting = nearestWaiting(sim, t);
    const others = sim.passengers.filter((p) => p.state === 'waiting').length - 1;
    if (boarding) {
      set(this.jobText, 'PASSENGER BOARDING…', HUD_COLORS.good);
    } else if (waiting) {
      set(this.jobText, `PICK UP AT PAD ${pads[waiting.padIndex]!.label}`, HUD_COLORS.good);
    } else {
      set(this.jobText, 'WAITING FOR A FARE…', HUD_COLORS.dim);
    }
    set(this.payText, !boarding && others > 0 ? `+${others} more waiting` : '', HUD_COLORS.dim);
  }

  /** Hull meter: one pip per hit point (green → yellow → red). */
  private drawHull(t: Taxi, sim: SimState): void {
    const g = this.hullPips;
    g.clear();
    const max = sim.config.taxiMaxHp;
    const hp = t.status === 'destroyed' ? 0 : t.hp;
    const color = hp >= max ? HUD_COLORS.good : hp <= 2 ? HUD_COLORS.bad : HUD_COLORS.warn;
    set(this.hullText, 'HULL', hp >= max ? HUD_COLORS.dim : color);
    // Critical: a slow pulse at 2 left, a fast blink at the last point.
    const now = performance.now() / 1000;
    const alpha = hp === 1 ? (Math.sin(now * 14) > 0 ? 1 : 0.25) : hp === 2 ? 0.6 + 0.4 * Math.abs(Math.sin(now * 3)) : 1;
    this.hullText.alpha = hp > 0 && hp <= 2 ? alpha : 1;
    for (let i = 0; i < max; i++) {
      const x = 1044 + i * 18;
      if (i < hp) g.roundRect(x, 14, 14, 10, 2).fill({ color, alpha });
      else g.roundRect(x, 14, 14, 10, 2).stroke({ width: 1, color: 0x5d668c });
    }
  }

  /** Missile and flare counts right of the fuel label: icon + number each. */
  private drawAmmo(t: Taxi, sim: SimState): void {
    const g = this.ammo;
    g.clear();
    const y = 10;
    // Missile icon at x=120.
    const mc = t.missiles > 0 || sim.config.missilesUnlimited ? AMMO_COLORS.missile : HUD_COLORS.bad;
    const mx = 120;
    g.rect(mx + 2, y + 5, 5, 11).fill(mc);
    g.poly([mx + 2, y + 5, mx + 7, y + 5, mx + 4.5, y]).fill(mc);
    g.poly([mx, y + 16, mx + 2, y + 12, mx + 2, y + 16]).fill(mc);
    g.poly([mx + 9, y + 16, mx + 7, y + 12, mx + 7, y + 16]).fill(mc);
    set(this.ammoText, sim.config.missilesUnlimited ? '∞' : `${t.missiles}`, mc);
    // Flare icon (a starburst) at x=166.
    const fc = t.flares > 0 ? AMMO_COLORS.flare : HUD_COLORS.bad;
    const fx = 170;
    const fy = y + 8;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      g.moveTo(fx - Math.cos(a) * 7, fy - Math.sin(a) * 7).lineTo(fx + Math.cos(a) * 7, fy + Math.sin(a) * 7);
    }
    g.stroke({ width: 1.5, color: fc });
    g.circle(fx, fy, 2.5).fill(fc);
    set(this.flareText, `${t.flares}`, fc);
  }

  /**
   * Teleport dialog, shown while the player is parked on a teleport pad: the other locales,
   * with what they pay and how busy they are. Non-modal (the world keeps running). Travel is
   * free but needs an empty cab.
   */
  updateTeleport(
    open: boolean,
    destinations: readonly LocaleInfo[],
    riding: boolean,
    onPick: (localeId: string) => void,
  ): void {
    if (!open) {
      if (this.teleportPanel) this.teleportPanel.root.visible = false;
      return;
    }
    if (!this.teleportPanel || this.teleportPanel.rows.length !== destinations.length) {
      this.teleportPanel?.root.destroy({ children: true });
      this.teleportPanel = buildTeleport(destinations.length, (i) => this.teleportPanel?.pick(i));
      this.overlay.addChildAt(this.teleportPanel.root, this.overlay.getChildIndex(this.pauseLayer));
    }
    const panel = this.teleportPanel;
    panel.root.visible = true;
    panel.pick = (i) => {
      const d = destinations[i];
      if (d) onPick(d.id);
    };
    destinations.forEach((d, i) => {
      const line =
        `[${i + 1}]  ${d.name.padEnd(20)} fares ×${d.fareMultiplier.toFixed(2)}  ` +
        `${d.size}× · ${d.waiting} waiting · ${d.taxis} taxi${d.taxis === 1 ? '' : 's'}`;
      set(panel.rows[i]!.text, line, riding ? HUD_COLORS.dim : HUD_COLORS.text);
      panel.rows[i]!.setEnabled(!riding);
    });
    set(
      panel.note,
      riding ? 'Drop off your passenger first: teleports need an empty cab' : 'Free travel. You keep everything you have.',
      riding ? HUD_COLORS.warn : HUD_COLORS.good,
    );
  }

  /**
   * Store dialog, shown while the player is parked at a convenience store or docked with
   * a mobile service craft. The game keeps running; items are bought with keys 1–5 or by
   * clicking. `onBuy` receives the row clicked.
   */
  updateShop(t: Taxi, sim: SimState, open: boolean, onBuy: (item: ShopAction) => void, service = false): void {
    if (!open) {
      if (this.shop) this.shop.root.visible = false;
      return;
    }
    if (!this.shop) {
      this.shop = buildShop(onBuy);
      // Under the pause screen and cards.
      this.overlay.addChildAt(this.shop.root, this.overlay.getChildIndex(this.pauseLayer));
    }
    const shop = this.shop;
    shop.root.visible = true;
    const c = sim.config;
    const mult = service ? c.servicePriceMultiplier : 1;
    const accent = service ? SERVICE_COLOR : 0xff9f1c;
    if (shop.isService !== service) {
      shop.isService = service;
      drawShopFrame(shop.bg, accent);
    }
    set(
      shop.title,
      service ? `MOBILE SERVICE · ${mult}× RATES` : 'CORNER STORE · OPEN 24/7',
      accent,
    );
    set(
      shop.safe,
      service
        ? `Flying convenience service · ${mult}× normal store prices`
        : "Safe zone: missiles can't see you while parked here",
      service ? HUD_COLORS.warn : HUD_COLORS.good,
    );
    set(
      shop.leave,
      service ? 'Press 1–5 or click to buy · take off to dismiss' : 'Press 1–5 or click to buy · take off to leave',
      HUD_COLORS.dim,
    );
    const names: Record<StoreItem, string> = {
      missile: 'Missile    ',
      flare: 'Flare burst',
      repair: 'Hull repair',
      gas: 'Gas, 1 gal ',
    };
    STORE_ITEMS.forEach((item, i) => {
      const { price, have, cap } = storeItem(sim, t, item, mult);
      const full = item === 'gas' ? cap - have < 0.005 : have >= cap;
      // Gas tops off with a fraction of a gallon, so any cash at all buys some.
      const broke = item === 'gas' ? t.cents <= 0 : t.cents < Math.round(price * 100);
      const ok = !full && !broke;
      const status =
        item === 'repair' ? `hull ${have}/${cap}` : item === 'gas' ? `tank ${have.toFixed(1)}/${cap} gal` : `you have ${have}`;
      const why = full ? (item === 'repair' ? 'hull full' : item === 'gas' ? 'tank full' : 'full') : broke ? "can't afford" : status;
      const line = `[${i + 1}]  ${names[item]}  $${price.toFixed(2).padStart(5)}   ${why}`;
      set(shop.rows[item].text, line, ok ? HUD_COLORS.text : HUD_COLORS.dim);
      shop.rows[item].setEnabled(ok);
    });
    // [5] Fill up: the whole tank, or as much as you can afford.
    const gallonPrice = c.gallonPrice * mult;
    const missing = (c.fuelMax - t.fuel) / c.fuelPerGallon;
    const gallons = Math.min(missing, Math.max(0, t.cents / 100) / gallonPrice);
    const fillText =
      missing < 0.005
        ? 'tank full'
        : gallons < 0.005
          ? "can't afford"
          : `${gallons.toFixed(1)} gal  $${(gallons * gallonPrice).toFixed(2)}${gallons < missing - 0.005 ? '  (all you can afford)' : ''}`;
    set(shop.rows.fill.text, `[5]  Fill up      ${fillText}`, gallons >= 0.005 ? HUD_COLORS.text : HUD_COLORS.dim);
    shop.rows.fill.setEnabled(gallons >= 0.005);
    const pct = Math.round((t.fuel / c.fuelMax) * 100);
    const fuelColor = pct >= 100 ? HUD_COLORS.good : pct < 20 ? HUD_COLORS.bad : accent;
    set(shop.fuel, pct >= 100 ? 'Tank full' : `Tank ${pct}% · gas isn't automatic: buy it here`, fuelColor);
  }

  update(t: Taxi, sim: SimState, dt: number): void {
    const c = sim.config;

    const frac = Math.max(0, Math.min(1, t.fuel / c.fuelMax));
    const fuelColor = frac < 0.2 ? HUD_COLORS.bad : frac < 0.4 ? HUD_COLORS.warn : HUD_COLORS.good;
    this.fuelBar.clear();
    this.fuelBar.roundRect(16, 34, FUEL_W, 12, 3).fill(0x1c2244);
    if (frac > 0) this.fuelBar.roundRect(16, 34, FUEL_W * frac, 12, 3).fill(fuelColor);
    set(this.fuelText, `FUEL ${String(Math.round(frac * 100)).padStart(3)}%`, fuelColor);
    this.drawAmmo(t, sim);
    this.drawHull(t, sim);
    set(this.moneyText, `$${(t.cents / 100).toFixed(2)}`, t.cents < 0 ? HUD_COLORS.bad : HUD_COLORS.text);
    set(this.faresText, `FARES ${t.fares}`, HUD_COLORS.text);
    const activeRivals = sim.taxis.filter((o) => o.npc && isActive(o)).length;
    set(this.rivalText, `RIVALS ${activeRivals}`, activeRivals ? RIVAL_HUD_COLOR : HUD_COLORS.dim);
    this.updateJob(t, sim);

    const vy = Math.round(t.vy);
    const vx = Math.round(t.vx);
    const vyColor =
      t.status !== 'flying'
        ? HUD_COLORS.dim
        : vy <= c.landSmoothVy
          ? HUD_COLORS.good
          : vy <= landingMaxVy(c, t.vx)
            ? HUD_COLORS.warn
            : HUD_COLORS.bad;
    const vxColor =
      t.status !== 'flying' ? HUD_COLORS.dim : Math.abs(vx) <= c.landMaxVx ? HUD_COLORS.good : HUD_COLORS.bad;
    set(this.vyText, `VY ${vy > 0 ? '↓' : vy < 0 ? '↑' : ' '} ${String(Math.abs(vy)).padStart(3)}`, vyColor);
    set(this.vxText, `VX ${vx > 0 ? '→' : vx < 0 ? '←' : ' '} ${String(Math.abs(vx)).padStart(3)}`, vxColor);

    // Side jets only work with the gear fully up: say so while they're off.
    const sideOff = !sideThrustAvailable(t);
    const gearLabel =
      t.gear >= 1 ? 'GEAR DOWN' : t.gear <= 0 ? 'GEAR UP' : t.gearDown ? 'GEAR ▼▼▼' : 'GEAR ▲▲▲';
    set(
      this.gearText,
      sideOff ? `${gearLabel} ✕◀▶` : `${gearLabel} ◀▶`,
      t.gear >= 1 ? HUD_COLORS.good : t.gear <= 0 ? HUD_COLORS.warn : HUD_COLORS.info,
    );

    let status = 'FLYING';
    let statusColor = HUD_COLORS.dim;
    if (t.status === 'flying') {
      if (sim.level.wind) {
        const w = windAt(sim.level, sim.tick, t.x, t.y);
        const arrow = w.globalDir >= 0 ? '▶' : '◀';
        if (w.sheltered) {
          status = 'SHELTERED';
          statusColor = HUD_COLORS.good;
        } else if (w.gusting) {
          status = `GUST ${arrow}${arrow}`;
          statusColor = HUD_COLORS.warn;
        } else if (w.warning) {
          status = `GUST SOON ${arrow}`;
          statusColor = HUD_COLORS.warn;
        } else {
          status = `WIND ${arrow}`;
          statusColor = HUD_COLORS.info;
        }
      } else if (sim.level.gravityZones.length) {
        const z = gravityZoneAt(sim.level, t.x, t.y);
        if (z && z.gyScale < 0) {
          status = 'INVERTED G ▲';
          statusColor = 0xff66d9;
        } else if (z && z.gyScale < 0.8) {
          status = 'LOW-G';
          statusColor = HUD_COLORS.info;
        }
      } else if (sim.level.thrustScale > 1.1) {
        status = `TURBO ${sim.level.thrustScale.toFixed(1)}×`;
        statusColor = HUD_COLORS.warn;
      }
    }
    if (t.status === 'destroyed') {
      status = 'DESTROYED';
      statusColor = HUD_COLORS.bad;
    } else if (t.status === 'landed') {
      const pad = sim.level.pads[t.padIndex];
      const svc = serviceCraftFor(sim, t.id);
      if (atService(sim, t)) {
        status = 'MOBILE SERVICE (1–5)';
        statusColor = SERVICE_COLOR;
      } else if (svc) {
        status = 'SERVICE EN ROUTE…';
        statusColor = SERVICE_COLOR;
      } else if (t.fuel <= 0 && !atStore(sim, t)) {
        status = 'DRY TANK · R SERVICE';
        statusColor = HUD_COLORS.bad;
      } else {
        status = pad
          ? pad.kind === 'fuel'
            ? 'AT THE STORE'
            : pad.kind === 'teleport'
              ? 'AT THE TELEPORT'
              : `ON PAD ${pad.label} · R SVC`
          : 'LANDED · R SERVICE';
        statusColor = pad?.kind === 'fuel' ? 0xff9f1c : pad?.kind === 'teleport' ? TELEPORT_COLOR : HUD_COLORS.info;
        if (pad?.kind === 'fuel' && t.fuel < c.fuelMax) status = 'BUY GAS (4/5)';
      }
    }
    set(this.statusText, status, statusColor);

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      const a = Math.min(1, this.flashTime / 0.5);
      this.flashText.alpha = a;
      this.flashSub.alpha = a * 0.85;
    } else {
      this.flashText.alpha = 0;
      this.flashSub.alpha = 0;
    }
  }
}

export const AMMO_COLORS = { missile: 0xff8a3d, flare: 0xfff1a8, repair: 0x6dff8a, gas: 0xff9f1c };

const STORE_ITEMS: StoreItem[] = ['missile', 'flare', 'repair', 'gas'];

/** A store-panel row: one of the store items, or "fill the tank". */
export type ShopAction = StoreItem | 'fill';

interface PanelRow {
  text: Text;
  setEnabled(enabled: boolean): void;
}

interface Shop {
  root: Container;
  bg: Graphics;
  title: Text;
  rows: Record<ShopAction, PanelRow>;
  fuel: Text;
  safe: Text;
  leave: Text;
  isService: boolean;
}

export const TELEPORT_COLOR = PALETTE.teleport;

interface TeleportPanel {
  root: Container;
  rows: PanelRow[];
  note: Text;
  pick: (index: number) => void;
}

function makePanelRow(parent: Container, width: number, ry: number, onClick: () => void): PanelRow {
  let enabled = true;
  let hovered = false;
  const hit = new Graphics();
  const redraw = () => {
    hit.clear().roundRect(8, ry - 4, width - 16, 26, 6).fill({ color: 0xffffff, alpha: enabled && hovered ? 0.09 : 0.001 });
  };
  redraw();
  hit.eventMode = 'static';
  hit.cursor = 'pointer';
  hit.on('pointerover', () => {
    hovered = true;
    redraw();
  });
  hit.on('pointerout', () => {
    hovered = false;
    redraw();
  });
  hit.on('pointertap', () => {
    if (enabled) onClick();
  });
  const text = makeText('', { fontSize: 14, fill: HUD_COLORS.text });
  text.position.set(18, ry);
  parent.addChild(hit, text);
  return {
    text,
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      hit.cursor = enabled ? 'pointer' : 'default';
      redraw();
    },
  };
}

/** HUD-style teleport panel at the right of the playfield. Non-modal: the game keeps running. */
function buildTeleport(count: number, onPick: (index: number) => void): TeleportPanel {
  const W = 640;
  const H = 140 + count * 30;
  const root = new Container();
  root.position.set(VIEW_W - W - 24, Math.max(80, Math.min(220, VIEW_H - H - 40))); // fits 7+ locales cleanly
  const bg = new Graphics()
    .roundRect(0, 0, W, H, 10)
    .fill({ color: PALETTE.surface, alpha: 0.92 })
    .stroke({ width: 2, color: TELEPORT_COLOR, alpha: 0.8 })
    .rect(0, 40, W, 1)
    .fill({ color: TELEPORT_COLOR, alpha: 0.4 });
  const title = makeText('TELEPORT · TRAVEL TO', { fontSize: 16, fill: TELEPORT_COLOR, letterSpacing: 2 });
  title.position.set(16, 12);
  root.addChild(bg, title);
  const rows = Array.from({ length: count }, (_, i) => makePanelRow(root, W, 54 + i * 30, () => onPick(i)));
  const y = 54 + count * 30 + 6;
  const note = makeText('', { fontSize: 13, fill: HUD_COLORS.good });
  note.position.set(18, y);
  const safe = makeText("Safe zone: missiles can't see you while parked here", { fontSize: 12, fill: HUD_COLORS.good });
  safe.position.set(18, y + 26);
  const keys = makeText(`Press ${count > 1 ? `1–${count}` : '1'} or click to travel · take off to stay`, { fontSize: 12, fill: HUD_COLORS.dim });
  keys.position.set(18, y + 48);
  root.addChild(note, safe, keys);
  return { root, rows, note, pick: onPick };
}

const SHOP_W = 430;
const SHOP_H = 286;

function drawShopFrame(bg: Graphics, accent: number): void {
  bg.clear()
    .roundRect(0, 0, SHOP_W, SHOP_H, 10)
    .fill({ color: PALETTE.surface, alpha: 0.92 })
    .stroke({ width: 2, color: accent, alpha: 0.8 })
    .rect(0, 40, SHOP_W, 1)
    .fill({ color: accent, alpha: 0.4 });
}

/** HUD-style store panel at the right of the playfield. Non-modal: the game keeps running. */
function buildShop(onBuy: (item: ShopAction) => void): Shop {
  const W = SHOP_W;
  const x = VIEW_W - W - 24;
  const y = 92;
  const root = new Container();
  root.position.set(x, y);
  const bg = new Graphics();
  drawShopFrame(bg, 0xff9f1c);
  const title = makeText('CORNER STORE · OPEN 24/7', { fontSize: 16, fill: 0xff9f1c, letterSpacing: 2 });
  title.position.set(16, 12);
  root.addChild(bg, title);
  const rows = {
    missile: makePanelRow(root, W, 54, () => onBuy('missile')),
    flare: makePanelRow(root, W, 84, () => onBuy('flare')),
    repair: makePanelRow(root, W, 114, () => onBuy('repair')),
    gas: makePanelRow(root, W, 144, () => onBuy('gas')),
    fill: makePanelRow(root, W, 174, () => onBuy('fill')),
  };
  const fuel = makeText('', { fontSize: 13, fill: 0xff9f1c });
  fuel.position.set(18, 210);
  const safe = makeText("Safe zone: missiles can't see you while parked here", { fontSize: 12, fill: HUD_COLORS.good });
  safe.position.set(18, 234);
  const leave = makeText('Press 1–5 or click to buy · take off to leave', { fontSize: 12, fill: HUD_COLORS.dim });
  leave.position.set(18, 256);
  root.addChild(fuel, safe, leave);
  return { root, bg, title, rows, fuel, safe, leave, isService: false };
}

/** Render a horizontal row of centered clickable Pixi pill buttons and return total row width. */
function renderActionRow(container: Container, actions: HudAction[]): number {
  container.removeChildren().forEach((c) => c.destroy({ children: true }));
  const gap = 12;
  const padX = 16;
  const h = 34;
  const built = actions.map((a) => {
    const btn = new Container();
    const label = makeText(a.label, {
      fontSize: 13,
      fill: a.primary ? PALETTE.bg : a.danger ? 0xff9c9c : PALETTE.text,
    });
    label.anchor.set(0.5);
    const w = Math.ceil(label.width) + padX * 2;
    const bg = new Graphics();
    const draw = (hover: boolean) => {
      bg.clear();
      if (a.primary) {
        bg.roundRect(0, -h / 2, w, h, 7)
          .fill(hover ? 0x6de0ff : PALETTE.info)
          .stroke({ width: 1.5, color: hover ? 0x9ceaff : PALETTE.info });
      } else if (a.danger) {
        bg.roundRect(0, -h / 2, w, h, 7)
          .fill(hover ? 0x331624 : 0x1f101a)
          .stroke({ width: 1.5, color: hover ? PALETTE.bad : 0x5a283c });
      } else {
        bg.roundRect(0, -h / 2, w, h, 7)
          .fill(hover ? 0x242e5c : PALETTE.surfaceRaised)
          .stroke({ width: 1.5, color: hover ? PALETTE.info : PALETTE.border });
      }
    };
    draw(false);
    label.position.set(w / 2, 0);
    btn.addChild(bg, label);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.on('pointerover', () => draw(true));
    btn.on('pointerout', () => draw(false));
    btn.on('pointertap', () => a.onClick());
    return { btn, w };
  });
  const totalW = built.reduce((sum, b) => sum + b.w, 0) + Math.max(0, built.length - 1) * gap;
  let x = -totalW / 2;
  for (const b of built) {
    b.btn.position.set(x, 0);
    container.addChild(b.btn);
    x += b.w + gap;
  }
  return totalW;
}

/** Only touch Text when something changed (re-rendering text is expensive). */
function set(t: Text, text: string, color: number): void {
  if (t.text !== text) t.text = text;
  if (t.style.fill !== color) t.style.fill = color;
}
