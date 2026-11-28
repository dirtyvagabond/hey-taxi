/**
 * Live World Overview HUD ("Dispatch Board"): an HTML + canvas overlay showing all 9 persistent
 * locales as live schematic mini-maps, a clickable roster of every active taxi, and a rolling
 * world event feed. Clicking any taxi jumps straight into Follow Mode.
 */
import { archetypeColor, formatStats, levelById, parseLevel, type Level } from '@hey-taxi/sim';
import type { OverviewLocale, OverviewTaxi, PlayerAlert, WorldOverview } from '@hey-taxi/sim/protocol';
import { rivalColor } from './events';
import { clock, ensureTheme, hex, money } from './ui/theme';

const THEME_BG: Record<Level['theme'], string> = {
  city: '#0a0f22',
  winter: '#0c1628',
  singularity: '#110a22',
  polarity: '#091520',
  vault: '#130d1c',
  canyon: '#1a0e10',
  beach: '#0e2440',
};

const THEME_WALL: Record<Level['theme'], string> = {
  city: '#2b3663',
  winter: '#38527a',
  singularity: '#3d2a66',
  polarity: '#254a5e',
  vault: '#47315e',
  canyon: '#5e3328',
  beach: '#a6824e',
};

const STYLE = `
.wo { position: fixed; inset: 0; z-index: 25; background: rgba(5,7,15,0.94); color: var(--tx-text);
  font: 13px/1.4 var(--tx-font); display: flex; flex-direction: column;
  padding: 16px 20px; box-sizing: border-box; gap: 12px; overflow: hidden; user-select: none; }
.wo-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  border-bottom: 1px solid #263160; padding-bottom: 10px; }
.wo-title { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.wo-title h1 { font-size: 18px; color: var(--tx-info); margin: 0; letter-spacing: 2px; }
.wo-stats { color: var(--tx-dim); font-size: 12px; }
.wo-actions { display: flex; gap: 8px; align-items: center; }
.wo button { font: inherit; color: var(--tx-text); background: var(--tx-surface-raised); border: 1px solid var(--tx-border); border-radius: 6px;
  padding: 5px 12px; cursor: pointer; }
.wo button:hover { border-color: var(--tx-info); color: #ffffff; }
.wo button.primary { background: var(--tx-info); color: var(--tx-bg); border-color: var(--tx-info); font-weight: 700; }
.wo button.danger { background: var(--tx-bad); color: var(--tx-bg); border-color: var(--tx-bad); font-weight: 700; }
.wo button.paused { background: var(--tx-warn); color: var(--tx-bg); border-color: var(--tx-warn); font-weight: 700; }
.wo-paused-pill { display: none; font-size: 11px; font-weight: 700; letter-spacing: 1.5px;
  padding: 2px 8px; border-radius: 4px; background: rgba(255,224,102,0.2); border: 1px solid var(--tx-warn); color: var(--tx-warn); }
.wo-paused-pill.show { display: inline-block; }
.wo-alert { display: none; align-items: center; justify-content: space-between; gap: 12px;
  background: rgba(255, 64, 64, 0.22); border: 2px solid var(--tx-bad); border-radius: 8px;
  padding: 8px 14px; color: #ffd4d4; font-weight: 700; letter-spacing: 0.5px;
  animation: wo-pulse 0.8s ease-in-out infinite alternate; }
.wo-alert.show { display: flex; }
@keyframes wo-pulse { from { background: rgba(255,64,64,0.18); } to { background: rgba(255,64,64,0.36); } }
.wo-body { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; flex: 1; min-height: 0; }
@media (max-width: 1020px) { .wo-body { grid-template-columns: 1fr; overflow: auto; } }
.wo-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: minmax(175px, 1fr);
  align-content: start; gap: 10px; min-height: 0; overflow-y: auto; padding-right: 4px; }
@media (max-width: 1360px) { .wo-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.wo-card { background: var(--tx-surface); border: 1px solid #263160; border-radius: 8px; padding: 8px;
  display: flex; flex-direction: column; gap: 6px; min-height: 0; position: relative; cursor: pointer;
  transition: border-color 0.1s, box-shadow 0.1s; }
.wo-card:hover { border-color: #4f66a8; }
.wo-card.here { border-color: var(--tx-info); box-shadow: 0 0 0 1px rgba(57,208,255,0.25) inset; }
.wo-card.sel { border-color: var(--tx-gold); box-shadow: 0 0 0 2px rgba(255,200,61,0.5) inset; }
.wo-card-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11px; }
.wo-card-name { font-weight: 700; color: var(--tx-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wo-pill { font-size: 10px; padding: 1px 5px; border-radius: 4px; background: var(--tx-surface-raised); color: var(--tx-dim); white-space: nowrap; }
.wo-pill.here { background: rgba(57,208,255,0.2); color: var(--tx-info); }
.wo-pill.warn { background: rgba(255,224,102,0.18); color: var(--tx-warn); }
.wo-pill.bad { background: rgba(255,92,92,0.25); color: #ff7a7a; }
.wo-map-wrap { flex: 1; min-height: 92px; position: relative; background: var(--tx-bar-bg); border-radius: 5px;
  border: 1px solid #1a2247; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.wo-map-wrap canvas { width: 100%; height: 100%; display: block; }
.wo-card-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--tx-dim); }
.wo-side { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.wo-panel { background: var(--tx-surface); border: 1px solid #263160; border-radius: 8px; padding: 10px;
  display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.wo-panel.roster { flex: 1.4; }
.wo-panel.feed { flex: 1; }
.wo-panel h2 { font-size: 11px; color: var(--tx-dim); text-transform: uppercase; letter-spacing: 1.5px; margin: 0;
  display: flex; justify-content: space-between; }
.wo-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px; flex: 1; }
.wo-row { background: var(--tx-surface-alt); border: 1px solid #222c58; border-radius: 6px; padding: 7px 9px;
  cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: border-color 0.1s; }
.wo-row:hover { border-color: var(--tx-info); background: #141c3f; }
.wo-row.spec { border-color: var(--tx-info); box-shadow: 0 0 0 1px rgba(57,208,255,0.35) inset; }
.wo-row.fire { border-color: var(--tx-bad); }
.wo-row-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.wo-row-name { display: flex; align-items: center; gap: 6px; font-weight: 700; min-width: 0; }
.wo-row-name span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wo-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.45); }
.wo-cash { color: var(--tx-good); font-weight: 700; font-size: 12px; }
.wo-row-mid { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--tx-dim); }
.wo-bars { display: flex; align-items: center; gap: 6px; }
.wo-bar { width: 42px; height: 5px; background: var(--tx-surface-raised); border-radius: 3px; overflow: hidden; }
.wo-bar > i { display: block; height: 100%; }
.wo-act { font-size: 11px; color: #b7c4f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wo-act.fire { color: #ff7a7a; font-weight: 700; }
.wo-act.ride { color: var(--tx-warn); }
.wo-feed-item { font-size: 11px; color: #b8c2e6; border-left: 2px solid var(--tx-border); padding-left: 7px; }
.wo-feed-item.bad { border-color: var(--tx-bad); color: #ffb3b3; }
.wo-feed-item.warn { border-color: var(--tx-warn); }
.wo-feed-item.good { border-color: var(--tx-good); }
.wo-feed-time { color: #6f7aa3; margin-right: 6px; }
.wo-tip { position: fixed; z-index: 30; pointer-events: none; background: rgba(7,10,24,0.96);
  border: 1px solid var(--tx-info); border-radius: 6px; padding: 5px 8px; font-size: 11px; color: var(--tx-text);
  box-shadow: 0 4px 16px rgba(0,0,0,0.6); display: none; white-space: nowrap; }
.wo-legend { display: flex; gap: 12px; font-size: 11px; color: var(--tx-dim); flex-wrap: wrap; align-items: center; padding-right: 170px; }
.wo-legend span { display: inline-flex; align-items: center; gap: 5px; }
.wo-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
`;

interface CardRefs {
  root: HTMLDivElement;
  herePill: HTMLSpanElement;
  waitPill: HTMLSpanElement;
  taxiCount: HTMLSpanElement;
  canvas: HTMLCanvasElement;
  locale: OverviewLocale | null;
  hitRect: { ox: number; oy: number; scale: number; levelW: number; levelH: number };
}

export class WorldOverviewScreen {
  private root: HTMLDivElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private titleEl: HTMLHeadingElement | null = null;
  private statsEl: HTMLSpanElement | null = null;
  private alertEl: HTMLDivElement | null = null;
  private alertTextEl: HTMLSpanElement | null = null;
  private pausedPillEl: HTMLSpanElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private returnBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private paused = false;
  private hasAlert = false;
  private serverName = '';
  private accountName = '';
  private gridEl: HTMLDivElement | null = null;
  private rosterEl: HTMLDivElement | null = null;
  private feedEl: HTMLDivElement | null = null;
  private tipEl: HTMLDivElement | null = null;
  private cards = new Map<string, CardRefs>();
  private staticMaps = new Map<string, { canvas: HTMLCanvasElement; level: Level }>();
  private latest: WorldOverview | null = null;
  private spectatingId: string | null = null;
  private hoveredTaxiId: string | null = null;
  private selectedLocaleId: string | null = null;
  private localeOrder: string[] = [];

  constructor(
    private readonly onClose: () => void,
    private readonly onFollow: (taxiId: string) => void,
    private readonly onReturnToPlayer: () => void,
    private readonly onWatchLocale: (localeId: string) => void,
    private readonly onTogglePause: () => void,
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Pre-select a locale card (e.g. when returning from Full-Level View). */
  selectLocale(localeId: string): void {
    this.selectedLocaleId = localeId;
    this.syncSelectionHighlight(true);
  }

  moveSelection(dx: number, dy: number): void {
    const n = this.localeOrder.length;
    if (!n) return;
    let idx = this.selectedLocaleId ? this.localeOrder.indexOf(this.selectedLocaleId) : 0;
    if (idx < 0) idx = 0;
    const cols = this.gridColumns();
    if (dx !== 0) {
      idx = (idx + dx + n) % n;
    } else if (dy !== 0) {
      const next = idx + dy * cols;
      if (next >= 0 && next < n) idx = next;
      else if (dy > 0) idx = idx % cols;
      else {
        const col = idx % cols;
        const lastRow = Math.floor((n - 1) / cols);
        idx = Math.min(n - 1, lastRow * cols + col);
      }
    }
    this.selectedLocaleId = this.localeOrder[idx]!;
    this.syncSelectionHighlight(true);
  }

  confirmSelection(): void {
    const id = this.selectedLocaleId ?? this.localeOrder[0];
    if (id) this.onWatchLocale(id);
  }

  private gridColumns(): number {
    if (!this.gridEl) return 4;
    const tpl = getComputedStyle(this.gridEl).gridTemplateColumns;
    const count = tpl ? tpl.trim().split(/\s+/).length : 0;
    return Math.max(1, count);
  }

  private syncSelectionHighlight(scroll: boolean): void {
    for (const [id, refs] of this.cards) {
      const sel = id === this.selectedLocaleId;
      refs.root.classList.toggle('sel', sel);
      if (sel && scroll) refs.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  setContext(serverName: string, accountName: string): void {
    this.serverName = serverName;
    this.accountName = accountName;
    this.syncTitle();
  }

  private syncTitle(): void {
    if (!this.titleEl) return;
    const parts = ['WORLD OVERVIEW'];
    if (this.serverName) parts.push(this.serverName.toUpperCase());
    if (this.accountName) parts.push(`PILOT ${this.accountName.toUpperCase()}`);
    this.titleEl.textContent = parts.join(' · ');
  }

  open(spectatingId: string | null, alert: PlayerAlert | null): void {
    this.spectatingId = spectatingId;
    if (this.root) {
      this.setAlert(alert);
      this.syncReturnBtn();
      this.syncTitle();
      return;
    }
    ensureTheme();
    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = STYLE;
      document.head.append(this.styleEl);
    }

    const root = document.createElement('div');
    root.className = 'wo';

    const head = document.createElement('div');
    head.className = 'wo-head';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'wo-title';
    const h1 = document.createElement('h1');
    h1.textContent = 'WORLD OVERVIEW';
    const pausedPill = document.createElement('span');
    pausedPill.className = 'wo-paused-pill';
    pausedPill.textContent = 'PAUSED';
    const stats = document.createElement('span');
    stats.className = 'wo-stats';
    stats.textContent = 'Loading cities…';
    titleWrap.append(h1, pausedPill, stats);

    const actions = document.createElement('div');
    actions.className = 'wo-actions';
    const pauseBtn = document.createElement('button');
    pauseBtn.addEventListener('click', () => this.onTogglePause());
    const returnBtn = document.createElement('button');
    returnBtn.className = 'primary';
    returnBtn.textContent = 'Return to Your Taxi';
    returnBtn.addEventListener('click', () => this.onReturnToPlayer());
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close [Tab / Esc]';
    closeBtn.addEventListener('click', () => this.onClose());
    actions.append(pauseBtn, returnBtn, closeBtn);
    head.append(titleWrap, actions);

    const alertEl = document.createElement('div');
    alertEl.className = 'wo-alert';
    const alertText = document.createElement('span');
    const alertBtn = document.createElement('button');
    alertBtn.className = 'danger';
    alertBtn.textContent = 'Return to Your Taxi [Esc]';
    alertBtn.addEventListener('click', () => this.onReturnToPlayer());
    alertEl.append(alertText, alertBtn);

    const body = document.createElement('div');
    body.className = 'wo-body';
    const grid = document.createElement('div');
    grid.className = 'wo-grid';

    const side = document.createElement('div');
    side.className = 'wo-side';

    const rosterPanel = document.createElement('div');
    rosterPanel.className = 'wo-panel roster';
    const rosterTitle = document.createElement('h2');
    rosterTitle.innerHTML = '<span>Active Taxis</span><span>Click to follow</span>';
    const rosterList = document.createElement('div');
    rosterList.className = 'wo-list';
    rosterPanel.append(rosterTitle, rosterList);

    const feedPanel = document.createElement('div');
    feedPanel.className = 'wo-panel feed';
    const feedTitle = document.createElement('h2');
    feedTitle.textContent = 'World Activity';
    const feedList = document.createElement('div');
    feedList.className = 'wo-list';
    feedPanel.append(feedTitle, feedList);

    side.append(rosterPanel, feedPanel);
    body.append(grid, side);

    const legend = document.createElement('div');
    legend.className = 'wo-legend';
    legend.innerHTML =
      '<span><i style="background:#ffc83d;border:1px solid #fff"></i>You</span>' +
      '<span><i style="background:#ff6fae"></i>Rival (click to follow)</span>' +
      '<span><i style="background:#39d0ff"></i>Waiting passenger</span>' +
      '<span><i style="background:#ff5c5c"></i>Missile / Under fire</span>' +
      '<span><i style="background:#3ee07a;border-radius:1px"></i>Pad</span>' +
      '<span><i style="background:#ffc83d;border-radius:1px"></i>Store</span>' +
      '<span><i style="background:#c084fc;border-radius:1px"></i>Teleport</span>' +
      '<span style="margin-left:auto;color:#b7c4f0">←↑→↓ select city · ENTER expand full level</span>';

    const tip = document.createElement('div');
    tip.className = 'wo-tip';

    root.append(head, alertEl, body, legend, tip);
    document.body.append(root);

    this.root = root;
    this.titleEl = h1;
    this.statsEl = stats;
    this.pausedPillEl = pausedPill;
    this.pauseBtn = pauseBtn;
    this.alertEl = alertEl;
    this.alertTextEl = alertText;
    this.returnBtn = returnBtn;
    this.closeBtn = closeBtn;
    this.gridEl = grid;
    this.rosterEl = rosterList;
    this.feedEl = feedList;
    this.tipEl = tip;
    this.cards.clear();
    this.syncTitle();
    this.syncReturnBtn();
    this.syncPausedUI();
    this.setAlert(alert);
    if (this.latest) this.render(this.latest);
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.cards.clear();
    this.hoveredTaxiId = null;
  }

  setSpectating(spectatingId: string | null): void {
    this.spectatingId = spectatingId;
    this.syncReturnBtn();
    if (this.root && this.latest) this.render(this.latest);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncPausedUI();
  }

  private syncPausedUI(): void {
    if (this.pausedPillEl) this.pausedPillEl.classList.toggle('show', this.paused);
    if (this.pauseBtn) {
      this.pauseBtn.textContent = this.paused ? 'Resume [P]' : 'Pause [P]';
      this.pauseBtn.classList.toggle('paused', this.paused);
    }
  }

  setAlert(alert: PlayerAlert | null): void {
    this.hasAlert = alert !== null;
    if (this.closeBtn) {
      this.closeBtn.textContent = this.hasAlert ? 'Close [Tab]' : 'Close [Tab / Esc]';
    }
    if (!this.alertEl || !this.alertTextEl) return;
    if (alert) {
      this.alertTextEl.textContent = `⚠ ${alert.text}`;
      this.alertEl.classList.add('show');
    } else {
      this.alertEl.classList.remove('show');
    }
  }

  update(overview: WorldOverview): void {
    this.latest = overview;
    if (this.root) this.render(overview);
  }

  private syncReturnBtn(): void {
    if (!this.returnBtn) return;
    this.returnBtn.style.display = this.spectatingId ? '' : 'none';
  }

  private render(ov: WorldOverview): void {
    const totalWaiting = ov.locales.reduce((s, l) => s + l.waiting, 0);
    if (this.statsEl) {
      this.statsEl.textContent = `${ov.locales.length} cities · ${ov.taxis.length} active taxi${ov.taxis.length === 1 ? '' : 's'} · ${totalWaiting} waiting · ${clock(Math.floor(ov.tick / 60))}`;
    }

    const taxiMap = new Map<string, OverviewTaxi>();
    for (const t of ov.taxis) taxiMap.set(t.id, t);

    this.localeOrder = ov.locales.map((l) => l.id);
    if (!this.selectedLocaleId || !this.localeOrder.includes(this.selectedLocaleId)) {
      this.selectedLocaleId = ov.locales.find((l) => l.here)?.id ?? this.localeOrder[0] ?? null;
    }

    for (const loc of ov.locales) {
      const card = this.ensureCard(loc);
      card.locale = loc;
      card.root.classList.toggle('here', loc.here);
      card.root.classList.toggle('sel', loc.id === this.selectedLocaleId);
      card.herePill.style.display = loc.here ? '' : 'none';
      card.waitPill.textContent = `${loc.waiting} wait`;
      card.waitPill.className = `wo-pill${loc.backlog >= 2 ? ' bad' : loc.waiting > 0 ? ' warn' : ''}`;
      card.taxiCount.textContent = `${loc.taxis.length} taxi${loc.taxis.length === 1 ? '' : 's'}`;
      this.drawMiniMap(card, loc);
    }

    this.renderRoster(ov.taxis);
    this.renderFeed(ov);
    this.refreshTooltip(taxiMap);
  }

  private ensureCard(loc: OverviewLocale): CardRefs {
    const existing = this.cards.get(loc.id);
    if (existing) return existing;

    const root = document.createElement('div');
    root.className = 'wo-card';

    const head = document.createElement('div');
    head.className = 'wo-card-head';
    const name = document.createElement('span');
    name.className = 'wo-card-name';
    name.textContent = loc.name;
    const pills = document.createElement('div');
    pills.style.display = 'flex';
    pills.style.gap = '4px';
    const herePill = document.createElement('span');
    herePill.className = 'wo-pill here';
    herePill.textContent = 'YOU';
    const multPill = document.createElement('span');
    multPill.className = 'wo-pill';
    multPill.textContent = `×${loc.fareMultiplier.toFixed(2)}`;
    const waitPill = document.createElement('span');
    waitPill.className = 'wo-pill';
    pills.append(herePill, multPill, waitPill);
    head.append(name, pills);

    const wrap = document.createElement('div');
    wrap.className = 'wo-map-wrap';
    const canvas = document.createElement('canvas');
    wrap.append(canvas);

    const foot = document.createElement('div');
    foot.className = 'wo-card-foot';
    const taxiCount = document.createElement('span');
    const sizeText = document.createElement('span');
    sizeText.textContent = `${loc.size}× area`;
    foot.append(taxiCount, sizeText);

    root.append(head, wrap, foot);
    this.gridEl?.append(root);

    const refs: CardRefs = {
      root,
      herePill,
      waitPill,
      taxiCount,
      canvas,
      locale: loc,
      hitRect: { ox: 0, oy: 0, scale: 1, levelW: 1, levelH: 1 },
    };

    canvas.addEventListener('pointermove', (e) => {
      const hit = this.pickTaxiOnCanvas(refs, e.clientX, e.clientY);
      this.hoveredTaxiId = hit?.id ?? null;
      canvas.style.cursor = hit ? 'pointer' : 'default';
      if (hit && this.tipEl && this.latest) {
        const info = this.latest.taxis.find((t) => t.id === hit.id);
        if (info) {
          this.tipEl.textContent = `${info.name} · ${money(info.cents)} · ${info.activity} (click to follow)`;
          this.tipEl.style.left = `${Math.min(window.innerWidth - 260, e.clientX + 12)}px`;
          this.tipEl.style.top = `${Math.max(8, e.clientY - 30)}px`;
          this.tipEl.style.display = 'block';
        }
      } else if (this.tipEl) {
        this.tipEl.style.display = 'none';
      }
      if (refs.locale) this.drawMiniMap(refs, refs.locale);
    });
    canvas.addEventListener('pointerleave', () => {
      this.hoveredTaxiId = null;
      if (this.tipEl) this.tipEl.style.display = 'none';
      if (refs.locale) this.drawMiniMap(refs, refs.locale);
    });
    canvas.addEventListener('click', (e) => {
      const hit = this.pickTaxiOnCanvas(refs, e.clientX, e.clientY);
      if (hit) {
        e.stopPropagation();
        this.onFollow(hit.id);
      }
    });
    root.addEventListener('click', () => {
      this.selectedLocaleId = loc.id;
      this.syncSelectionHighlight(false);
      this.onWatchLocale(loc.id);
    });

    this.cards.set(loc.id, refs);
    return refs;
  }

  private pickTaxiOnCanvas(refs: CardRefs, clientX: number, clientY: number) {
    const loc = refs.locale;
    if (!loc || !loc.taxis.length) return null;
    const rect = refs.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const { ox, oy, scale } = refs.hitRect;
    let best = null;
    let bestD = 16;
    for (const t of loc.taxis) {
      const sx = ox + t.x * scale;
      const sy = oy + t.y * scale;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  private staticMap(localeId: string): { canvas: HTMLCanvasElement; level: Level } | null {
    const cached = this.staticMaps.get(localeId);
    if (cached) return cached;
    const content = levelById(localeId);
    if (!content) return null;
    const level = parseLevel(content.data);
    const pxPerTile = 3;
    const c = document.createElement('canvas');
    c.width = level.cols * pxPerTile;
    c.height = level.rows * pxPerTile;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = THEME_BG[level.theme] ?? '#0a0f22';
    ctx.fillRect(0, 0, c.width, c.height);

    // Subtle gravity zones.
    for (const z of level.gravityZones) {
      ctx.fillStyle = z.gyScale < 0 ? 'rgba(180, 120, 255, 0.14)' : 'rgba(57, 208, 255, 0.1)';
      ctx.fillRect(
        (z.x0 / level.tileSize) * pxPerTile,
        (z.y0 / level.tileSize) * pxPerTile,
        ((z.x1 - z.x0) / level.tileSize) * pxPerTile,
        ((z.y1 - z.y0) / level.tileSize) * pxPerTile,
      );
    }

    // Solid terrain.
    ctx.fillStyle = THEME_WALL[level.theme] ?? '#2b3663';
    for (let r = 0; r < level.rows; r++) {
      for (let col = 0; col < level.cols; col++) {
        if (level.solid[r * level.cols + col]) {
          ctx.fillRect(col * pxPerTile, r * pxPerTile, pxPerTile, pxPerTile);
        }
      }
    }

    // Pads on top of terrain.
    for (const p of level.pads) {
      ctx.fillStyle = p.kind === 'fuel' ? '#ffc83d' : p.kind === 'teleport' ? '#c084fc' : '#3ee07a';
      const x = (p.x / level.tileSize) * pxPerTile;
      const y = (p.y / level.tileSize) * pxPerTile;
      const w = Math.max(2, (p.w / level.tileSize) * pxPerTile);
      ctx.fillRect(x, y - 1, w, Math.max(2, pxPerTile * 0.7));
    }

    // Gravity wells.
    for (const w of level.gravityWells) {
      const x = (w.x / level.tileSize) * pxPerTile;
      const y = (w.y / level.tileSize) * pxPerTile;
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, (w.coreRadius / level.tileSize) * pxPerTile), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Laser gates.
    for (const g of level.laserGates) {
      ctx.strokeStyle = 'rgba(255, 92, 92, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((g.x0 / level.tileSize) * pxPerTile, (g.y0 / level.tileSize) * pxPerTile);
      ctx.lineTo((g.x1 / level.tileSize) * pxPerTile, (g.y1 / level.tileSize) * pxPerTile);
      ctx.stroke();
    }

    const entry = { canvas: c, level };
    this.staticMaps.set(localeId, entry);
    return entry;
  }

  private drawMiniMap(refs: CardRefs, loc: OverviewLocale): void {
    const base = this.staticMap(loc.id);
    if (!base) return;
    const canvas = refs.canvas;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(120, Math.round(rect.width));
    const cssH = Math.max(70, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070a18';
    ctx.fillRect(0, 0, cssW, cssH);

    const pad = 4;
    const scale = Math.min((cssW - pad * 2) / base.level.width, (cssH - pad * 2) / base.level.height);
    const drawW = base.level.width * scale;
    const drawH = base.level.height * scale;
    const ox = (cssW - drawW) / 2;
    const oy = (cssH - drawH) / 2;
    refs.hitRect = { ox, oy, scale, levelW: base.level.width, levelH: base.level.height };

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base.canvas, ox, oy, drawW, drawH);
    ctx.imageSmoothingEnabled = true;

    // Waiting passengers.
    for (const p of loc.passengers) {
      const px = ox + p.x * scale;
      const py = oy + p.y * scale - 2;
      ctx.fillStyle = p.waitSeconds >= 25 ? '#ffe066' : '#39d0ff';
      ctx.beginPath();
      ctx.arc(px, py, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active missiles.
    for (const m of loc.missiles) {
      const mx = ox + m.x * scale;
      const my = oy + m.y * scale;
      ctx.fillStyle = '#ff5c5c';
      ctx.beginPath();
      ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active taxis.
    for (const t of loc.taxis) {
      const tx = ox + t.x * scale;
      const ty = oy + t.y * scale;
      const color = t.player ? '#ffc83d' : hex(t.color ?? rivalColor(t.id));
      const focused = t.id === this.hoveredTaxiId || t.id === this.spectatingId;

      if (t.underFire) {
        ctx.strokeStyle = '#ff5c5c';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(tx, ty, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (focused) {
        ctx.strokeStyle = '#39d0ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(tx, ty, 7, 0, Math.PI * 2);
        ctx.stroke();
      } else if (t.riding) {
        ctx.strokeStyle = '#ffe066';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(tx, ty, 5.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(tx, ty, t.player ? 4.2 : 3.6, 0, Math.PI * 2);
      ctx.fill();
      if (t.player) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  private renderRoster(taxis: OverviewTaxi[]): void {
    const el = this.rosterEl;
    if (!el) return;
    el.innerHTML = '';
    if (!taxis.length) {
      const empty = document.createElement('div');
      empty.style.color = '#8a93b8';
      empty.textContent = 'No active taxis right now.';
      el.append(empty);
      return;
    }
    for (const t of taxis) {
      const row = document.createElement('div');
      row.className = `wo-row${t.id === this.spectatingId ? ' spec' : ''}${t.underFire ? ' fire' : ''}`;
      row.addEventListener('click', () => this.onFollow(t.id));

      const top = document.createElement('div');
      top.className = 'wo-row-top';
      const nameWrap = document.createElement('div');
      nameWrap.className = 'wo-row-name';
      const dot = document.createElement('span');
      dot.className = 'wo-dot';
      dot.style.background = t.player ? '#ffc83d' : hex(t.color ?? rivalColor(t.id));
      const name = document.createElement('span');
      name.textContent = t.name;
      nameWrap.append(dot, name);
      if (t.archetype) {
        const pill = document.createElement('span');
        pill.className = 'wo-pill';
        pill.textContent = t.archetype;
        pill.style.color = hex(archetypeColor(t.archetype));
        if (t.personality) pill.title = formatStats(t.personality);
        nameWrap.append(pill);
      }
      const cash = document.createElement('span');
      cash.className = 'wo-cash';
      cash.textContent = money(t.cents);
      top.append(nameWrap, cash);

      const mid = document.createElement('div');
      mid.className = 'wo-row-mid';
      const loc = document.createElement('span');
      loc.textContent = t.localeName;
      const bars = document.createElement('div');
      bars.className = 'wo-bars';
      const hpFrac = Math.max(0, Math.min(1, t.hp / Math.max(1, t.maxHp)));
      const fuelFrac = Math.max(0, Math.min(1, t.fuel / Math.max(1, t.fuelMax)));
      const hpBar = document.createElement('span');
      hpBar.className = 'wo-bar';
      hpBar.title = `Hull ${t.hp}/${t.maxHp}`;
      hpBar.innerHTML = `<i style="width:${Math.round(hpFrac * 100)}%;background:${hpFrac <= 0.4 ? '#ff5c5c' : hpFrac < 1 ? '#ffe066' : '#6dff8a'}"></i>`;
      const fuelBar = document.createElement('span');
      fuelBar.className = 'wo-bar';
      fuelBar.title = `Fuel ${Math.round(fuelFrac * 100)}%`;
      fuelBar.innerHTML = `<i style="width:${Math.round(fuelFrac * 100)}%;background:${fuelFrac <= 0.2 ? '#ff5c5c' : '#39d0ff'}"></i>`;
      bars.append(hpBar, fuelBar);
      mid.append(loc, bars);

      const act = document.createElement('div');
      const hostile = t.underFire || !!t.vendettaTargetId;
      act.className = `wo-act${hostile ? ' fire' : t.riding ? ' ride' : ''}`;
      act.textContent = t.activity;

      row.append(top, mid, act);
      el.append(row);
    }
  }

  private renderFeed(ov: WorldOverview): void {
    const el = this.feedEl;
    if (!el) return;
    el.innerHTML = '';
    if (!ov.feed.length) {
      const empty = document.createElement('div');
      empty.style.color = '#6f7aa3';
      empty.style.fontSize = '11px';
      empty.textContent = 'Watching all cities for activity…';
      el.append(empty);
      return;
    }
    for (const item of ov.feed) {
      const row = document.createElement('div');
      row.className = `wo-feed-item ${item.tone}`;
      const time = document.createElement('span');
      time.className = 'wo-feed-time';
      time.textContent = clock(Math.floor(item.tick / 60));
      row.append(time, document.createTextNode(item.text));
      el.append(row);
    }
  }

  private refreshTooltip(taxiMap: Map<string, OverviewTaxi>): void {
    if (!this.hoveredTaxiId || !this.tipEl || this.tipEl.style.display === 'none') return;
    const info = taxiMap.get(this.hoveredTaxiId);
    if (!info) {
      this.tipEl.style.display = 'none';
      return;
    }
    this.tipEl.textContent = `${info.name} · ${money(info.cents)} · ${info.activity} (click to follow)`;
  }
}
