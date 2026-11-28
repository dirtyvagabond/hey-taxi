/**
 * Screen & modal controller: Lobby (account sign-in & server browser), skin picker,
 * Server Review overlay, status cards (welcome, destroyed, connecting/replaced), save indicator,
 * and browser-remembered preferences/hints.
 */
import type {
  Account,
  Card,
  ClientMessage,
  Command,
  GameOutcome,
  GameStatus,
  ReviewDetail,
  ReviewGame,
  ServerSummary,
} from '@hey-taxi/sim/protocol';
import { causeText } from './events';
import { LobbyScreen } from './lobby';
import type { ConnectionState } from './net';
import { HUD_COLORS, type Hud, type HudAction } from './render/hud';
import { SkinPicker } from './render/skinPicker';
import type { SkinId } from './render/skins';
import { ReviewScreen } from './review';
import { clock, money } from './ui/theme';

export { clock };

function outcomeLines(o: GameOutcome): string[] {
  return [
    `Cause             ${causeText(o.cause)}`,
    ...(o.byName ? [`${o.cause === 'missile' ? 'Fired by        ' : 'Collided with   '}  ${o.byName}`] : []),
    `Where             ${o.levelName}`,
    `Fares delivered   ${o.fares}`,
    `Rivals destroyed  ${o.rivalsDestroyed} (whole server)`,
    `Time in this taxi ${clock(o.seconds)}`,
    ``,
    `Account balance   ${money(o.cents)} (kept)`,
  ];
}

/** Remembered preferences in this browser. */
const ACCOUNT_KEY = 'hey-taxi.accountId';
const SKIN_KEY = 'hey-taxi.skin';

function rememberAccount(accountId: string | null): void {
  try {
    if (accountId) localStorage.setItem(ACCOUNT_KEY, accountId);
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // storage unavailable
  }
}

function lastSkin(): string | null {
  try {
    return localStorage.getItem(SKIN_KEY);
  } catch {
    return null;
  }
}
function rememberSkin(skin: SkinId): void {
  try {
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    // not remembered; no harm
  }
}

/** One-time tips, remembered per server in this browser (best effort: storage may be unavailable). */
const HINTS_KEY = 'hey-taxi.hintsShown';
const shownThisSession = new Set<string>();
export function hintShown(hint: string, gameId: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '{}') as Record<string, string[]>;
    return (seen[hint] ?? []).includes(gameId);
  } catch {
    return shownThisSession.has(`${hint}:${gameId}`);
  }
}
export function markHintShown(hint: string, gameId: string): void {
  shownThisSession.add(`${hint}:${gameId}`);
  try {
    const seen = JSON.parse(localStorage.getItem(HINTS_KEY) ?? '{}') as Record<string, string[]>;
    seen[hint] = [...(seen[hint] ?? []), gameId].slice(-50);
    localStorage.setItem(HINTS_KEY, JSON.stringify(seen));
  } catch {
    // storage unavailable: remembered for this session only
  }
}

export interface ScreenHooks {
  readonly hud: Hud;
  send(msg: ClientMessage): void;
  command(cmd: Command, skin?: SkinId, color?: number): void;
  clearKeys(): void;
  getStatus(): GameStatus | null;
  openOverview(): void;
  openSettings(): void;
  returnToPlayer(): void;
  reclaim(): void;
}

export class ScreenController {
  private picker: SkinPicker | null = null;
  private reviewAfterMenu: string | null = null;
  private currentAccountName = '';
  private review: ReviewScreen;
  private lobby: LobbyScreen;

  constructor(private readonly hooks: ScreenHooks) {
    this.review = new ReviewScreen(
      (msg) => hooks.send(msg),
      () => {
        const st = hooks.getStatus();
        if (st?.mode === 'menu') this.lobby.open();
      },
    );
    this.lobby = new LobbyScreen({
      onCreateAccount: (name) => hooks.send({ t: 'createAccount', name }),
      onSelectAccount: (accountId) => hooks.send({ t: 'selectAccount', accountId }),
      onCreateServer: (name) => hooks.send({ t: 'createServer', name }),
      onDeleteServer: (serverId) => hooks.send({ t: 'deleteServer', serverId }),
      onJoinServer: (server) => this.joinServer(server),
      onReviewServer: (serverId) => this.openReview(serverId ?? undefined),
    });
  }

  get isReviewOpen(): boolean {
    return this.review.isOpen;
  }

  get isLobbyOpen(): boolean {
    return this.lobby.isOpen;
  }

  get isPickerOpen(): boolean {
    return this.picker !== null;
  }

  get accountName(): string {
    return this.currentAccountName;
  }

  setLobby(accounts: Account[], account: Account | null, servers: ServerSummary[]): void {
    this.currentAccountName = account?.name ?? '';
    rememberAccount(account?.accountId ?? null);
    if (account?.skin) rememberSkin(account.skin as SkinId);
    this.lobby.update(accounts, account, servers);
    // Recover if the lobby was closed eagerly (e.g., joinServer failed and server returned lobby).
    if (this.hooks.getStatus()?.mode === 'menu' && !this.review.isOpen && !this.picker && !this.lobby.isOpen) {
      this.lobby.open();
    }
  }

  setReviewGames(games: ReviewGame[]): void {
    this.review.setGames(games);
  }

  setReviewDetail(gameId: string, detail: ReviewDetail | null, error?: string): void {
    this.review.setDetail(gameId, detail, error);
  }

  reviewBack(): void {
    this.review.back();
  }

  openReviewAfterMenu(): void {
    const st = this.hooks.getStatus();
    this.reviewAfterMenu = st?.serverId || '__list__';
    this.hooks.command('menu');
  }

  cancelPicker(): void {
    this.picker?.cancel();
  }

  confirmPicker(): void {
    this.picker?.confirm();
  }

  movePicker(step: number): void {
    this.picker?.move(step);
  }

  movePickerColor(step: number): void {
    this.picker?.moveColor(step);
  }

  updatePicker(time: number, dt: number): void {
    this.picker?.update(time, dt);
  }

  chooseFreshTaxi(taxiNumber: number): void {
    this.chooseSkin(
      'A FRESH TAXI',
      `Your taxi #${taxiNumber} · choose its look`,
      (skin, color) => this.hooks.command('respawn', skin, color),
      () => {},
    );
  }

  showConnectionState(state: ConnectionState): void {
    const { hud } = this.hooks;
    this.lobby.close();
    hud.hideMenu();
    hud.setPaused(false);
    if (state === 'replaced') {
      hud.showCard({
        kicker: 'DISCONNECTED',
        title: 'OPENED IN ANOTHER TAB',
        color: HUD_COLORS.warn,
        body: 'This session is being played in another browser tab.',
        footer: '↑↓ SELECT · ENTER',
        actions: [{ label: 'Play Here', primary: true, onClick: () => this.hooks.reclaim() }],
      });
    } else {
      hud.showCard({
        title: 'CONNECTING…',
        color: HUD_COLORS.info,
        body: 'Waiting for the game server.',
        footer: 'Start it with: npm run dev',
      });
    }
  }

  /** Sync lobby, review, picker, status cards, and save badge to the server's GameStatus. */
  syncStatus(_prev: GameStatus | null, status: GameStatus, _modeChanged: boolean): void {
    const { hud } = this.hooks;
    const subParts: string[] = [];
    if (status.serverName) subParts.push(status.serverName.toUpperCase());
    if (this.currentAccountName) subParts.push(`PILOT ${this.currentAccountName.toUpperCase()}`);
    const subtitle = subParts.join(' · ');

    let pauseActions: HudAction[];
    if (status.watchingLocaleId) {
      pauseActions = [
        { label: 'Resume', primary: true, onClick: () => this.hooks.command('pause') },
        { label: 'World Overview', onClick: () => this.hooks.openOverview() },
        { label: 'Settings', onClick: () => this.hooks.openSettings() },
      ];
    } else if (status.spectatingId) {
      pauseActions = [
        { label: 'Resume', primary: true, onClick: () => this.hooks.command('pause') },
        { label: 'Return to Taxi', onClick: () => this.hooks.returnToPlayer() },
        { label: 'Settings', onClick: () => this.hooks.openSettings() },
      ];
    } else {
      pauseActions = [
        { label: 'Resume', primary: true, onClick: () => this.hooks.command('pause') },
        { label: 'World Overview', onClick: () => this.hooks.openOverview() },
        { label: 'Settings', onClick: () => this.hooks.openSettings() },
        { label: 'Server Review', onClick: () => this.openReviewAfterMenu() },
        { label: 'Server Menu', onClick: () => this.hooks.command('menu') },
      ];
    }
    hud.setPaused(status.paused, { subtitle, hint: '↑↓ SELECT · ENTER · ESC RESUME', actions: pauseActions });
    this.showSave(status);

    // The picker belongs to the lobby (first join) or the "destroyed" card; anything else closes it.
    if (this.picker && status.mode !== 'menu' && status.mode !== 'destroyed') {
      this.picker.close();
      this.picker = null;
    }
    if (status.mode === 'menu') {
      hud.hideCard();
      this.lobby.setNotice(status.menu.notice);
      if (this.reviewAfterMenu) {
        const target = this.reviewAfterMenu === '__list__' ? undefined : this.reviewAfterMenu;
        this.reviewAfterMenu = null;
        this.openReview(target);
        return;
      }
      if (this.review.isOpen || this.picker) return;
      this.lobby.open();
      return;
    }
    this.lobby.close();
    hud.hideMenu();
    if (this.review.isOpen) this.review.close();
    const examining = status.overviewOpen || status.spectatingId !== null || status.watchingLocaleId !== null;
    if (status.card && !examining) this.showStatusCard(status.card);
    else hud.hideCard();
  }

  private joinServer(server: ServerSummary): void {
    if (!server.account?.joined) {
      this.lobby.close();
      this.chooseSkin(
        'CHOOSE YOUR TAXI',
        `Joining ${server.name} · the look is yours, the physics are the same`,
        (skin, color) => {
          this.hooks.send({ t: 'joinServer', serverId: server.serverId, skin, color });
        },
        () => {
          const st = this.hooks.getStatus();
          if (st?.mode === 'menu') this.lobby.open();
        },
      );
      return;
    }
    this.lobby.close();
    this.hooks.send({ t: 'joinServer', serverId: server.serverId });
  }

  private openReview(serverId?: string): void {
    this.lobby.close();
    this.hooks.hud.hideMenu();
    this.hooks.hud.hideCard();
    this.review.open(serverId);
  }

  private chooseSkin(title: string, sub: string, go: (skin: SkinId, color?: number) => void, back: () => void): void {
    this.picker?.close();
    this.hooks.clearKeys();
    this.picker = new SkinPicker(
      { title, sub, selected: lastSkin() },
      (skin, color) => {
        this.picker = null;
        rememberSkin(skin);
        go(skin, color);
      },
      () => {
        this.picker = null;
        back();
      },
    );
    this.hooks.hud.overlay.addChild(this.picker.root);
  }

  private showStatusCard(card: Card): void {
    const { hud } = this.hooks;
    if (card.kind === 'welcome') {
      hud.showCard({
        kicker: `${card.serverName.toUpperCase()} · PILOT ${card.accountName.toUpperCase()} · ${card.localeCount} CITIES`,
        title: card.name.toUpperCase(),
        color: HUD_COLORS.info,
        body:
          `Fly passengers between pads and build your account balance.\n` +
          `Stores sell gas, missiles, flares and repairs. Violet teleports take you to the other\n` +
          `cities: bigger ones pay more per fare. Other taxis are hostile.\n` +
          `If your taxi is destroyed, your account keeps its full dollar balance for your next cab.\n\n${card.hint}`,
        footer: '↑↓ SELECT · ENTER',
        actions: [
          { label: 'Start Shift', primary: true, onClick: () => this.hooks.command('advance') },
          { label: 'Server Menu', onClick: () => this.hooks.command('menu') },
        ],
      });
    } else {
      hud.showCard({
        kicker: card.taxiNumber > 1 ? `YOUR TAXI #${card.taxiNumber}` : 'YOUR TAXI',
        title: 'WAS DESTROYED',
        color: HUD_COLORS.bad,
        body: [
          ...outcomeLines(card.death),
          '',
          'The server goes on. Your account keeps its balance.',
          `Take a fresh taxi in First Shift (full tank, hull, 3 missiles, 3 flares)`,
          `carrying your ${money(card.accountCents)} balance.`,
        ].join('\n'),
        footer: '↑↓ SELECT · ENTER',
        align: 'left',
        actions: [
          { label: 'Fresh Taxi', primary: true, onClick: () => this.chooseFreshTaxi(card.taxiNumber + 1) },
          { label: 'World Overview', onClick: () => this.hooks.openOverview() },
          { label: 'Server Review', onClick: () => this.openReviewAfterMenu() },
          { label: 'Server Menu', onClick: () => this.hooks.command('menu') },
        ],
      });
    }
  }

  private showSave(status: GameStatus): void {
    const { hud } = this.hooks;
    const s = status.save;
    if (s.state === 'error') hud.setSave(`SAVE FAILED · ${s.message}`, HUD_COLORS.bad);
    else if (s.state === 'saving') hud.setSave('SAVING…', HUD_COLORS.dim);
    else if (s.state === 'saved') hud.setSave('SAVED', HUD_COLORS.dim);
    else hud.setSave('', HUD_COLORS.dim);
  }
}
