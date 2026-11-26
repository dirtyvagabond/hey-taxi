/**
 * Game review (main menu → Game review → a game): an HTML overlay with the list of games and,
 * for one game, an overview of your finances, every taxi (living and destroyed), and every
 * transaction with filters and search. Opened outside gameplay; Escape goes back a level.
 */
import { archetypeColor, formatStats, type Personality } from '@hey-taxi/sim';
import type {
  GameOutcome,
  ReviewDetail,
  ReviewEntry,
  ReviewGame,
  ReviewTaxi,
} from '@hey-taxi/sim/protocol';
import { causeOf, clock, el, ensureTheme, money } from './ui/theme';

type Tab = 'overview' | 'taxis' | 'transactions';

const CATEGORY_NAMES: Record<string, string> = {
  opening: 'Starting funds',
  spawn: 'Replacement taxi',
  fare: 'Fare',
  tip: 'Tip',
  gas: 'Gas',
  missile: 'Missile',
  flare: 'Flares',
  repair: 'Repair',
  passengerHit: 'Penalty',
  adjustment: 'Adjustment',
  destroyed: 'Destroyed',
  transfer: 'Teleport',
};
/** Show at most this many transactions at once (the rest are a filter or search away). */
const MAX_ROWS = 500;

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?';

const STYLE = `
.rv { position: fixed; inset: 0; z-index: 20; background: rgba(5,7,15,0.96); color: var(--tx-text);
  font: 14px/1.45 var(--tx-font); overflow: auto; padding: 24px 32px 64px; box-sizing: border-box; }
.rv h1 { font-size: 22px; color: var(--tx-info); margin: 0 0 4px; letter-spacing: 2px; }
.rv .sub { color: var(--tx-dim); margin-bottom: 18px; }
.rv .bar { display: flex; gap: 8px; align-items: center; margin: 14px 0; flex-wrap: wrap; }
.rv button { font: inherit; color: var(--tx-text); background: var(--tx-surface-raised); border: 1px solid var(--tx-border); border-radius: 6px;
  padding: 5px 12px; cursor: pointer; }
.rv button:hover { border-color: var(--tx-info); }
.rv button.on { background: var(--tx-info); color: var(--tx-bg); border-color: var(--tx-info); font-weight: 700; }
.rv select, .rv input { font: inherit; color: var(--tx-text); background: var(--tx-surface); border: 1px solid var(--tx-border);
  border-radius: 6px; padding: 5px 8px; }
.rv input { min-width: 220px; }
.rv table { border-collapse: collapse; width: 100%; }
.rv th { text-align: left; color: var(--tx-dim); font-weight: normal; border-bottom: 1px solid var(--tx-border); padding: 6px 10px; position: sticky; top: -24px; background: var(--tx-bar-bg); }
.rv td { padding: 5px 10px; border-bottom: 1px solid #141936; white-space: nowrap; }
.rv td.num, .rv th.num { text-align: right; }
.rv tr.click { cursor: pointer; }
.rv tr.click:hover td { background: #141936; }
.rv .good { color: var(--tx-good); } .rv .bad { color: var(--tx-bad); } .rv .dim { color: var(--tx-dim); } .rv .warn { color: var(--tx-warn); }
.rv .you { color: var(--tx-gold); }
.rv .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.rv .box { border: 1px solid var(--tx-border); border-radius: 10px; padding: 14px 18px; background: var(--tx-surface); }
.rv .box h2 { font-size: 15px; color: var(--tx-info); margin: 0 0 10px; letter-spacing: 1px; }
.rv .row { display: flex; justify-content: space-between; gap: 16px; }
.rv .row.total { border-top: 1px solid var(--tx-border); margin-top: 6px; padding-top: 6px; font-weight: bold; }
.rv .hint { color: var(--tx-dim); font-size: 12px; margin-top: 18px; }
.rv .events { margin: 0; padding-left: 18px; }
`;

export class ReviewScreen {
  private root: HTMLDivElement | null = null;
  private games: ReviewGame[] | null = null;
  private detail: ReviewDetail | null = null;
  private error: string | null = null;
  private gameId: string | null = null;
  private tab: Tab = 'overview';
  private taxiId: string | null = null;
  private filters = { taxi: '', locale: '', category: '', search: '' };

  constructor(
    private readonly request: (msg: { t: 'review' } | { t: 'reviewGame'; gameId: string }) => void,
    private readonly onClose: () => void,
  ) {
    ensureTheme();
    if (!document.getElementById('rv-style')) document.head.append(el('style', { id: 'rv-style' }, STYLE));
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(serverId?: string): void {
    if (!this.root) {
      this.root = el('div.rv', { role: 'dialog', 'aria-label': 'Server review' });
      // Escape works even while typing in the search box.
      this.root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.back();
        }
      });
      document.body.append(this.root);
    }
    this.games = null;
    this.gameId = serverId ?? null;
    this.detail = null;
    this.error = null;
    this.tab = 'overview';
    this.taxiId = null;
    this.filters = { taxi: '', locale: '', category: '', search: '' };
    this.render();
    this.request({ t: 'review' });
    if (serverId) this.request({ t: 'reviewGame', gameId: serverId });
  }

  setGames(games: ReviewGame[]): void {
    this.games = games;
    if (!this.gameId) this.render();
  }

  setDetail(gameId: string, detail: ReviewDetail | null, error?: string): void {
    if (gameId !== this.gameId) return;
    this.detail = detail;
    this.error = error ?? null;
    this.render();
  }

  /** Escape: from a taxi back to its game, from a game back to the list, then close. */
  back(): void {
    if (this.taxiId) this.taxiId = null;
    else if (this.gameId) {
      this.gameId = null;
      this.detail = null;
      this.error = null;
    } else return this.close();
    this.render();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.onClose();
  }

  private openGame(g: ReviewGame): void {
    if (g.status === 'unreadable') return;
    this.gameId = g.gameId;
    this.detail = null;
    this.error = null;
    this.tab = 'overview';
    this.taxiId = null;
    this.filters = { taxi: '', locale: '', category: '', search: '' };
    this.render();
    this.request({ t: 'reviewGame', gameId: g.gameId });
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  private render(): void {
    const root = this.root;
    if (!root) return;
    const top = root.scrollTop;
    root.replaceChildren(...(this.gameId ? this.gameView() : this.listView()));
    root.scrollTop = this.gameId ? top : 0;
  }

  private header(title: string, sub: string, backLabel: string): Node[] {
    const back = el('button', {}, `← ${backLabel}`);
    back.addEventListener('click', () => this.back());
    return [el('div.bar', {}, back, el('span.dim', {}, 'Esc')), el('h1', {}, title), el('div.sub', {}, sub)];
  }

  private listView(): Node[] {
    const head = this.header('SERVER REVIEW', 'Every persistent server. Pick one to inspect its accounts and ledger.', 'Server menu');
    if (!this.games) return [...head, el('p.dim', {}, 'Loading…')];
    if (!this.games.length) return [...head, el('p.dim', {}, 'No servers yet.')];
    const rows = this.games.map((g) => {
      const tr = el(
        'tr.click',
        {},
        el('td', {}, g.name || g.gameId.slice(0, 8)),
        el('td', {}, when(g.updatedAt || g.createdAt)),
        el('td', {}, statusLabel(g)),
        el('td.num', {}, clock(g.seconds)),
        el('td.num', {}, money(g.cents)),
        el('td.num', {}, String(g.taxisLost)),
        el('td', {}, g.status === 'unreadable' ? el('span.bad', {}, g.error ?? 'unreadable') : g.levelName || '—'),
      );
      tr.addEventListener('click', () => this.openGame(g));
      return tr;
    });
    return [
      ...head,
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Server'), el('th', {}, 'Updated'), el('th', {}, 'Status'), el('th.num', {}, 'World age'), el('th.num', {}, 'Balance'), el('th.num', {}, 'Taxis lost'), el('th', {}, 'Location'))),
        el('tbody', {}, ...rows),
      ),
    ];
  }

  private gameView(): Node[] {
    const g = this.games?.find((x) => x.gameId === this.gameId) ?? this.detail?.game;
    const title = g ? `${(g.name || 'SERVER').toUpperCase()} · ${statusLabel(g).toUpperCase()}` : 'SERVER';
    const sub = g ? `World age ${clock(g.seconds)} · ${g.taxisLost} taxi${g.taxisLost === 1 ? '' : 's'} lost · ${g.levelName || 'not joined'}` : '';
    if (this.taxiId && this.detail) return this.taxiView(title);
    const head = this.header(title, sub, 'All servers');
    if (this.error) return [...head, el('p.bad', {}, `Couldn't load this server: ${this.error}`)];
    if (!this.detail) return [...head, el('p.dim', {}, 'Loading…')];
    const tabs = el('div.bar', {});
    for (const [tab, label] of [['overview', 'Overview'], ['taxis', 'Taxis'], ['transactions', 'Transactions']] as const) {
      const b = el('button', tab === this.tab ? { class: 'on' } : {}, label);
      b.addEventListener('click', () => {
        this.tab = tab;
        this.render();
      });
      tabs.append(b);
    }
    const body =
      this.tab === 'overview' ? this.overviewView(this.detail) : this.tab === 'taxis' ? this.taxisView(this.detail) : this.transactionsView(this.detail);
    return [...head, tabs, ...body];
  }

  private overviewView(d: ReviewDetail): Node[] {
    const o = d.overview;
    const row = (label: string, value: string, cls = '') => el(`div.row${cls ? `.${cls}` : ''}` as 'div', {}, el('span', {}, label), el('span', {}, value));
    const expenses = Object.entries(o.expensesByCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, cents]) => row(CATEGORY_NAMES[cat] ?? cat, money(-cents)));
    const deaths = o.deaths.map((x: GameOutcome, i) =>
      el('li', {}, `Taxi ${i + 1}: ${causeOf(x)} in ${x.levelName} after ${clock(x.seconds)} (${money(x.cents)} retained in account) · ${x.fares} fare${x.fares === 1 ? '' : 's'}`),
    );
    return [
      el(
        'div.grid',
        {},
        el(
          'div.box',
          {},
          el('h2', {}, 'EARNED'),
          row('Fare revenue', money(o.fareRevenue)),
          row('Tips', money(o.tips)),
          row('Total earned', money(o.earned), 'total'),
          el('div.dim', {}, `${o.fares} fare${o.fares === 1 ? '' : 's'} delivered`),
        ),
        el('div.box', {}, el('h2', {}, 'SPENT'), ...(expenses.length ? expenses : [el('div.dim', {}, 'Nothing yet')]), row('Total spent', money(-o.expenses), 'total')),
        el(
          'div.box',
          {},
          el('h2', {}, `ACCOUNT · ${o.accountName.toUpperCase()}`),
          row('Net profit (earned − spent)', money(o.netProfit), o.netProfit >= 0 ? 'good' : 'bad'),
          o.adjustments ? row('Adjustments', money(o.adjustments)) : null,
          row('Starting funds (joined server)', money(o.startingFunds)),
          row('Account balance', money(o.endingCash), 'total'),
          el('div.dim', {}, `${o.taxisUsed} taxi${o.taxisUsed === 1 ? '' : 's'} used`),
        ),
      ),
      deaths.length
        ? el('div.box', { style: 'margin-top:16px' }, el('h2', {}, 'TAXIS LOST'), el('ul.events', {}, ...deaths))
        : el('p.dim', {}, 'No taxis lost.'),
      el('p.hint', {}, 'All figures come from the recorded ledger. Starting funds are granted once when your account joins a server, and your balance carries across taxi deaths.'),
    ];
  }

  private taxisView(d: ReviewDetail): Node[] {
    const rows = d.taxis.map((t) => {
      const tr = el(
        'tr.click',
        {},
        el('td', {}, t.player ? el('span.you', {}, t.name) : t.name),
        el(
          'td',
          {},
          t.archetype
            ? el(
                'span',
                {
                  style: `color:#${archetypeColor(t.archetype).toString(16).padStart(6, '0')};font-weight:bold`,
                  title: t.personality ? formatStats(t.personality) : '',
                },
                t.archetype,
              )
            : el('span.dim', {}, '—'),
        ),
        el(
          'td',
          {},
          el(`span.${t.status === 'destroyed' ? 'bad' : t.status === 'active' ? 'good' : 'dim'}` as 'span', {}, t.status),
          ...(t.destroyedBy ? [el('span.dim', {}, ` · ${t.destroyedBy}`)] : []),
        ),
        el('td.num', {}, String(t.proficiency)),
        el('td.num', {}, String(t.fares)),
        el('td.num', {}, money(t.income)),
        el('td.num', {}, money(-t.expenses)),
        el('td.num', {}, money(t.balance)),
        el('td', {}, t.localeName),
        el('td', {}, t.reconciled ? '' : el('span.bad', {}, '⚠ ledger mismatch')),
      );
      tr.addEventListener('click', () => {
        this.taxiId = t.taxiId;
        this.render();
      });
      return tr;
    });
    return [
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Taxi'),
            el('th', {}, 'Trait'),
            el('th', {}, 'Status'),
            el('th.num', {}, 'Co-pilot'),
            el('th.num', {}, 'Fares'),
            el('th.num', {}, 'Income'),
            el('th.num', {}, 'Expenses'),
            el('th.num', {}, 'Balance'),
            el('th', {}, 'Where'),
            el('th', {}, ''),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
      el('p.hint', {}, 'Income is fares and tips (not starting funds). Co-pilot = countermeasure proficiency. Click a taxi for its history.'),
    ];
  }

  private transactionsView(d: ReviewDetail, onlyTaxi?: string): Node[] {
    const f = this.filters;
    const bar = el('div.bar', {});
    const select = (key: 'taxi' | 'locale' | 'category', label: string, options: [string, string][]) => {
      const s = el('select', { 'aria-label': label }, el('option', { value: '' }, `All ${label}`), ...options.map(([v, t]) => el('option', { value: v }, t)));
      s.value = f[key];
      s.addEventListener('change', () => {
        f[key] = s.value;
        this.render();
      });
      bar.append(s);
    };
    if (!onlyTaxi) select('taxi', 'taxis', d.taxis.map((t) => [t.taxiId, t.name]));
    const locales = [...new Map(d.entries.map((e) => [e.locale, e.localeName])).entries()];
    select('locale', 'locales', locales);
    const cats = [...new Set(d.entries.map((e) => e.category))];
    select('category', 'categories', cats.map((c) => [c, CATEGORY_NAMES[c] ?? c]));
    const search = el('input', { type: 'search', placeholder: 'Search names and descriptions', value: f.search, 'aria-label': 'Search' });
    search.addEventListener('input', () => {
      f.search = search.value;
      // Re-render without losing the caret in the search box.
      const pos = search.selectionStart;
      this.render();
      const again = this.root?.querySelector<HTMLInputElement>('input[type=search]');
      again?.focus();
      if (again && pos !== null) again.setSelectionRange(pos, pos);
    });
    bar.append(search);

    const needle = f.search.trim().toLowerCase();
    const taxi = onlyTaxi ?? f.taxi;
    const shown = d.entries.filter(
      (e: ReviewEntry) =>
        (!taxi || e.taxiId === taxi) &&
        (!f.locale || e.locale === f.locale) &&
        (!f.category || e.category === f.category) &&
        (!needle || `${e.taxiName} ${e.description} ${e.localeName} ${CATEGORY_NAMES[e.category] ?? e.category}`.toLowerCase().includes(needle)),
    );
    const rows = shown.slice(-MAX_ROWS).map((e) =>
      el(
        'tr',
        {},
        el('td.num', {}, clock(e.seconds)),
        el('td', {}, e.player ? el('span.you', {}, e.taxiName) : e.taxiName),
        el('td', {}, e.localeName),
        el('td', {}, CATEGORY_NAMES[e.category] ?? e.category),
        el('td.num.bad', {}, e.amount < 0 ? money(-e.amount) : ''),
        el('td.num.good', {}, e.amount > 0 ? money(e.amount) : ''),
        el('td.num', {}, money(e.balance)),
        el('td.dim', {}, e.description),
      ),
    );
    const count = el(
      'div.dim',
      {},
      shown.length > MAX_ROWS
        ? `Showing the latest ${MAX_ROWS} of ${shown.length} matching transactions (narrow it down with the filters).`
        : `${shown.length} transaction${shown.length === 1 ? '' : 's'}${shown.length !== d.entries.length ? ` (of ${d.entries.length})` : ''}`,
    );
    return [
      bar,
      count,
      el(
        'table',
        {},
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th.num', {}, 'Time'),
            el('th', {}, 'Taxi'),
            el('th', {}, 'Locale'),
            el('th', {}, 'Category'),
            el('th.num', {}, 'Debit'),
            el('th.num', {}, 'Credit'),
            el('th.num', {}, 'Balance'),
            el('th', {}, 'Description'),
          ),
        ),
        el('tbody', {}, ...rows),
      ),
    ];
  }

  private taxiView(gameTitle: string): Node[] {
    const d = this.detail!;
    const t = d.taxis.find((x: ReviewTaxi) => x.taxiId === this.taxiId);
    if (!t) return [el('p.bad', {}, 'Taxi not found')];
    const head = this.header(t.name.toUpperCase(), `${gameTitle} · ${t.player ? 'your taxi' : 'another taxi'} · co-pilot ${t.proficiency}`, 'Back to server');
    const summary = el(
      'div.box',
      {},
      el('h2', {}, 'ACCOUNT'),
      el('div.row', {}, el('span', {}, 'Starting funds'), el('span', {}, money(t.opening))),
      el('div.row', {}, el('span', {}, `Income (${t.fares} fare${t.fares === 1 ? '' : 's'} + tips)`), el('span', {}, money(t.income))),
      el('div.row', {}, el('span', {}, 'Expenses'), el('span', {}, money(-t.expenses))),
      t.adjustments ? el('div.row', {}, el('span', {}, 'Adjustments'), el('span', {}, money(t.adjustments))) : null,
      el('div.row.total', {}, el('span', {}, t.status === 'destroyed' ? 'Final balance' : 'Balance'), el('span', {}, money(t.balance))),
    );
    const events = el(
      'div.box',
      {},
      el('h2', {}, 'LIFE'),
      el('ul.events', {}, ...t.events.map((e) => el('li', {}, `${clock(e.seconds)}  ${e.text}`))),
      el('div.dim', {}, t.status === 'destroyed' ? `Destroyed (permanently): ${t.destroyedBy ?? 'cause unknown'}.` : t.status === 'active' ? `Now in ${t.localeName}.` : 'Not arrived yet.'),
    );
    const personalityBox = t.personality ? renderPersonalityBox(t.archetype ?? 'Steady', t.personality) : null;
    return [
      ...head,
      el('div.grid', {}, summary, ...(personalityBox ? [personalityBox] : []), events),
      el('h2', { style: 'color:#39d0ff;font-size:15px;margin:20px 0 6px' }, 'TRANSACTIONS'),
      ...this.transactionsView(d, t.taxiId),
    ];
  }
}

function renderPersonalityBox(archetype: string, p: Personality): HTMLElement {
  const rows: [string, number][] = [
    ['Aggression (AGG)', p.aggression],
    ['Vengeance (VNG)', p.vengeance],
    ['Nerve (NRV)', p.nerve],
    ['Hustle (HSL)', p.hustle],
    ['Piloting Skill (SKL)', p.skill],
  ];
  return el(
    'div.box',
    {},
    el('h2', {}, `PERSONALITY · ${archetype.toUpperCase()}`),
    ...rows.map(([label, val]) => {
      const cls = val >= 15 ? 'good' : val <= 6 ? 'warn' : '';
      return el('div.row', {}, el('span', {}, label), el(`span${cls ? `.${cls}` : ''}` as 'span', {}, `${val} / 18`));
    }),
  );
}

function statusLabel(g: ReviewGame): string {
  return g.status === 'running' ? 'in progress' : g.status;
}
