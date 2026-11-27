/**
 * One persistent MMORPG-style game server: a world of locales that all keep running together,
 * per-account player state (each player account keeps its own dollar balance across taxi deaths),
 * and a reconciled financial ledger. No networking or I/O here, so it can be driven tick by tick
 * in tests; saving is done by the host from `toSave()`.
 */
import { randomUUID } from 'node:crypto';
import {
  crash,
  DEFAULT_CONFIG,
  isActive,
  levelById,
  personalityArchetype,
  riderOf,
  serviceCraftFor,
  taxiColor,
  taxiSkin,
  toCents,
  type SimConfig,
  type SimEvent,
  type SimState,
  type Taxi,
  type TaxiSkin,
} from '@hey-taxi/sim';
import { Ledger, type LedgerEntry } from './ledger';
import type {
  Account,
  Card,
  Command,
  Frame,
  GameMode,
  GameOutcome,
  GameStatus,
  LocaleInfo,
  OverviewLocale,
  OverviewTaxi,
  PlayerAlert,
  SaveStatus,
  WireSim,
  WorldFeedEvent,
  WorldOverview,
} from '@hey-taxi/sim/protocol';
import { World, WORLD_LEVELS, WorldContentError, type SavedWorld, type TeleportResult } from './world';

/** Bump when GameSave's shape changes; older saves are reported as unsupported. */
export const SAVE_VERSION = 9;

/** After the player's taxi is destroyed the world runs this long (the explosion plays out), then the card appears. */
const DEATH_SECONDS = 2;
/** Refresh the locale summaries (teleport panel) this often while playing. */
const LOCALE_INFO_TICKS = 30;
/** How many recent world events to keep for the World Overview live ticker. */
const WORLD_FEED_LIMIT = 14;
/** How long a damage alert stays up when the player's cab is hit while looking away. */
const DAMAGE_ALERT_TICKS = 180;

/** Where a suspended player was, so rejoining puts them back. */
export type PlayMode = Exclude<GameMode, 'menu'>;

/** Persistent state for one player account on this server. */
export interface PlayerServerState {
  accountId: string;
  name: string;
  /** Account's persistent dollar balance on this server (integer cents), kept across taxi deaths. */
  cents: number;
  /** Current taxi ID (active or most recently destroyed), or null before first spawn. */
  taxiId: string | null;
  /** How many taxis this account has spawned on this server. */
  taxiCount: number;
  totalFares: number;
  lifeFares: number;
  lifeStartTick: number;
  deaths: GameOutcome[];
  playMode: PlayMode;
  dying: { cause: string; byTaxiId?: string | null; ticksLeft: number } | null;
  card: Card | null;
  /** Living taxi stashed safely if another account took over while this account was offline. */
  stashedTaxi: { localeId: string; taxi: Taxi } | null;
}

/** Everything needed to restore a persistent server exactly (with its ledger, stored alongside). */
export interface GameSave {
  saveVersion: number;
  serverId: string;
  serverName: string;
  seed: number;
  createdAt: string;
  config: SimConfig;
  /** The whole world: every locale's simulation and the taxi registry. */
  world: SavedWorld;
  /** Per-account player state on this server, keyed by accountId. */
  players: Record<string, PlayerServerState>;
  /** Rivals destroyed so far (permanently gone). */
  deadRivals: string[];
  /** Last ledger entry included in this save. */
  ledgerSeq: number;
}

export class SaveError extends Error {
  constructor(
    message: string,
    readonly kind: 'unsupported' | 'damaged',
  ) {
    super(message);
  }
}

/** Next seed in a deterministic sequence (tests); the host uses real randomness instead. */
function nextSeedAfter(seed: number): number {
  return (Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1) >>> 0) || 1;
}

export interface SessionOptions {
  seed: number;
  newSeed?: () => number;
  config?: Partial<SimConfig>;
}

export class GameSession {
  /** False until a server is created or loaded: the lobby shows a placeholder world. */
  hasGame = false;
  seed: number;
  serverId = '';
  serverName = '';
  createdAt = '';
  config: SimConfig;
  world: World;
  players: Record<string, PlayerServerState> = {};
  /** Account currently signed in / playing on this server (null in the lobby). */
  activeAccountId: string | null = null;
  activeAccount: Account | null = null;
  mode: GameMode = 'menu';
  paused = false;
  deadRivals: string[] = [];
  ledger = new Ledger('');
  /** Saving state, shown to the player (the host updates it). */
  save: SaveStatus = { state: 'none' };
  /** Problem with a saved server found at startup or join (shown in the lobby). */
  menuNotice: string | null = null;
  /** While a new server's first save is being written, play waits. */
  awaitingFirstSave = false;
  /** Set whenever the status changed; the host sends it and clears the flag. */
  statusDirty = true;
  /** Set when the player's view jumps (join, respawn, new locale): the host sends a fresh frame. */
  simReset = true;
  /** Set when something worth saving right away happened (pause, menu, locale change…). */
  saveRequest: string | null = null;

  /** Ephemeral viewing state (not persisted): World Overview HUD, Follow Mode, and Full-Level Watch Mode. */
  overviewOpen = false;
  spectatingId: string | null = null;
  watchingLocaleId: string | null = null;
  private spectateDying: { taxiId: string; ticksLeft: number } | null = null;
  private feed: WorldFeedEvent[] = [];
  private playerDamageAlertTicks = 0;
  private lastAlertKey = '';

  private held = 0;
  private latched = 0;
  private pendingSelfDestruct = false;
  private readonly newSeed: () => number;

  constructor(opts: SessionOptions) {
    this.seed = opts.seed;
    let next = opts.seed;
    this.newSeed =
      opts.newSeed ??
      (() => {
        const s = next;
        next = nextSeedAfter(next);
        return s;
      });
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    // Placeholder world behind the lobby until a server is joined.
    this.world = World.create(this.config, this.seed, []);
  }

  get gameId(): string {
    return this.serverId;
  }

  /** Active player's server state, or null when in the lobby. */
  get currentPlayer(): PlayerServerState | null {
    return this.activeAccountId ? (this.players[this.activeAccountId] ?? null) : null;
  }

  /** The world (every locale) advances while playing, or while spectating from the destroyed card. */
  get running(): boolean {
    if (this.paused || !this.activeAccountId) return false;
    if (this.mode === 'playing') return true;
    return this.mode === 'destroyed' && (this.overviewOpen || this.spectatingId !== null || this.watchingLocaleId !== null);
  }

  /** The active player's current taxi ID (empty in lobby or before first spawn). */
  get playerId(): string {
    return this.currentPlayer?.taxiId ?? '';
  }

  get levelId(): string {
    const pid = this.playerId;
    if (pid && this.world.taxis[pid]) return this.world.localeOf(pid).id;
    return this.world.locales[0]?.id ?? WORLD_LEVELS[0];
  }

  get sim(): SimState {
    return this.world.locale(this.levelId).sim;
  }

  /** The locale currently streamed to the browser (followed taxi's locale, watched locale, or player's). */
  get viewLocaleId(): string {
    if (this.spectatingId && this.world.taxis[this.spectatingId]) {
      return this.world.localeOf(this.spectatingId).id;
    }
    if (this.watchingLocaleId && this.world.locales.some((l) => l.id === this.watchingLocaleId)) {
      return this.watchingLocaleId;
    }
    return this.levelId;
  }

  get viewSim(): SimState {
    return this.world.locale(this.viewLocaleId).sim;
  }

  get worldTick(): number {
    return this.world.tick;
  }

  get player(): Taxi | undefined {
    const pid = this.playerId;
    return pid ? this.world.taxi(pid) : undefined;
  }

  get dying(): { cause: string; byTaxiId?: string | null; ticksLeft: number } | null {
    return this.currentPlayer?.dying ?? null;
  }

  get card(): Card | null {
    return this.currentPlayer?.card ?? null;
  }

  /** World Overview & Follow Mode are available while landed in play, or from the destroyed card. */
  canExamineWorld(): boolean {
    if (this.dying) return false;
    if (this.mode === 'destroyed') return true;
    return this.mode === 'playing' && this.player?.status === 'landed';
  }

  private get isExamining(): boolean {
    return this.overviewOpen || this.spectatingId !== null || this.watchingLocaleId !== null;
  }

  setOverview(open: boolean): boolean {
    if (!open) {
      if (this.overviewOpen) {
        this.overviewOpen = false;
        if (this.mode === 'destroyed' && !this.isExamining) this.paused = false;
        this.statusDirty = true;
      }
      return true;
    }
    if (!this.canExamineWorld()) return false;
    const prevLocale = this.viewLocaleId;
    const hadWatch = this.watchingLocaleId !== null;
    this.watchingLocaleId = null;
    if (!this.overviewOpen || hadWatch) {
      this.overviewOpen = true;
      this.clearInput();
      if (hadWatch && this.viewLocaleId !== prevLocale) this.simReset = true;
      this.statusDirty = true;
    }
    return true;
  }

  setSpectate(taxiId: string | null): boolean {
    if (taxiId === null || (this.mode === 'playing' && taxiId === this.playerId)) {
      const changed = this.spectatingId !== null || this.overviewOpen || this.watchingLocaleId !== null;
      const prevLocale = this.viewLocaleId;
      this.spectatingId = null;
      this.watchingLocaleId = null;
      this.spectateDying = null;
      this.overviewOpen = false;
      if (this.mode === 'destroyed') this.paused = false;
      if (changed) {
        if (this.viewLocaleId !== prevLocale || prevLocale === this.levelId) this.simReset = true;
        this.statusDirty = true;
      }
      return true;
    }
    if (!this.canExamineWorld()) return false;
    const target = this.world.taxi(taxiId);
    if (!target || !isActive(target)) return false;
    this.spectatingId = taxiId;
    this.watchingLocaleId = null;
    this.spectateDying = null;
    this.overviewOpen = false;
    this.clearInput();
    this.simReset = true;
    this.statusDirty = true;
    return true;
  }

  setWatchLocale(localeId: string | null): boolean {
    if (localeId === null) {
      const changed = this.watchingLocaleId !== null;
      this.watchingLocaleId = null;
      if (this.mode === 'destroyed' && !this.isExamining) this.paused = false;
      if (changed) {
        this.simReset = true;
        this.statusDirty = true;
      }
      return true;
    }
    if (!this.canExamineWorld()) return false;
    if (!this.world.locales.some((l) => l.id === localeId)) return false;
    this.watchingLocaleId = localeId;
    this.spectatingId = null;
    this.spectateDying = null;
    this.overviewOpen = false;
    this.clearInput();
    this.simReset = true;
    this.statusDirty = true;
    return true;
  }

  private clearViewing(): void {
    const hadView = this.overviewOpen || this.spectatingId !== null || this.watchingLocaleId !== null;
    this.overviewOpen = false;
    this.spectatingId = null;
    this.watchingLocaleId = null;
    this.spectateDying = null;
    this.playerDamageAlertTicks = 0;
    this.lastAlertKey = '';
    if (hadView) this.simReset = true;
  }

  // ── Input & commands ─────────────────────────────────────────────────────────

  /** Held input bits. A press is latched until the next tick so a quick tap is never lost. */
  setInput(bits: number): void {
    this.held = bits;
    this.latched |= bits;
  }

  clearInput(): void {
    this.held = 0;
    this.latched = 0;
  }

  /** `skin` & `color`: how the new taxi looks, for respawn. */
  command(cmd: Command, skin?: string, color?: number): void {
    switch (cmd) {
      case 'advance':
        this.advance();
        break;
      case 'pause':
        this.togglePause();
        break;
      case 'menu':
        if (this.paused || this.mode === 'destroyed' || this.mode === 'intro') this.leaveAccount();
        break;
      case 'respawn':
        if (this.mode === 'destroyed') this.respawn(taxiSkin(skin), taxiColor(color));
        break;
      case 'selfDestruct':
        if (this.mode === 'playing' && !this.paused) this.pendingSelfDestruct = true;
        break;
    }
  }

  setConfig(config: SimConfig): void {
    const next = { ...this.config } as Record<string, unknown>;
    const defaults = DEFAULT_CONFIG as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(config)) {
      if (k in defaults && typeof v === typeof defaults[k]) next[k] = v;
    }
    this.config = next as unknown as SimConfig;
    this.world.setConfig(this.config);
    this.statusDirty = true;
  }

  /**
   * Development checks only: patch a taxi's state. A balance change still goes through the
   * ledger (as an adjustment), so accounts stay reconciled.
   */
  debugPatch(taxiId: string, patch: Record<string, unknown>): void {
    const t = this.world.taxi(taxiId);
    if (!t) return;
    const { cents, ...rest } = patch;
    Object.assign(t, rest);
    if (typeof cents === 'number' && Number.isInteger(cents)) {
      const accountId = this.world.taxis[taxiId]?.accountId ?? null;
      this.ledger.adjustTo(t.id, cents, this.world.localeOf(taxiId).id, this.worldTick, 'debug', accountId);
      t.cents = cents;
      if (accountId && this.players[accountId]) this.players[accountId]!.cents = cents;
    }
  }

  /** Disconnected browser: nobody is flying, so hold the server (and save it). */
  onDisconnect(): void {
    this.clearInput();
    this.clearViewing();
    if (this.mode === 'playing' && !this.paused) {
      this.paused = true;
      this.statusDirty = true;
    }
    if (this.hasGame) this.saveRequest = 'disconnect';
  }

  // ── Simulation ───────────────────────────────────────────────────────────────

  /**
   * Advance the whole world one tick (only while running). Returns the events of the
   * viewed locale (what the browser shows); every locale's money and losses are recorded.
   */
  tick(): SimEvent[] {
    if (!this.running) return [];
    const ps = this.currentPlayer;
    if (!ps) return [];
    const examining = this.overviewOpen || this.spectatingId !== null || this.watchingLocaleId !== null;
    const input = ps.dying || this.mode === 'destroyed' || examining ? 0 : this.held | this.latched;
    this.latched = 0;
    const viewLocale = this.viewLocaleId;
    const me = this.playerId;
    const results = this.world.step(me ? { [me]: input } : {});
    if (this.pendingSelfDestruct) {
      this.pendingSelfDestruct = false;
      if (me && this.mode === 'playing' && !ps.dying) {
        const loc = this.world.localeOf(me);
        const t = loc.sim.taxis.find((x) => x.id === me);
        const entry = results.find((r) => r.locale.id === loc.id);
        if (t && isActive(t) && entry) crash(loc.sim, t, 'selfDestruct', entry.events);
      }
    }
    if (this.playerDamageAlertTicks > 0) this.playerDamageAlertTicks--;
    let playerDestroyed: { cause: string; byTaxiId: string | null } | null = null;
    let shown: SimEvent[] = [];
    for (const { locale, events } of results) {
      if (locale.id === viewLocale) shown = events;
      for (const e of events) {
        if (e.type === 'ledger') {
          const accountId = this.world.taxis[e.taxiId]?.accountId ?? null;
          this.ledger.record({
            accountId,
            taxiId: e.taxiId,
            locale: locale.id,
            tick: this.worldTick,
            category: e.category,
            amount: e.amount,
            balance: e.balance,
            ref: e.ref,
          });
          if (accountId && this.players[accountId]) {
            this.players[accountId]!.cents = e.balance;
          }
        }
        if (e.type === 'taxiDamaged' && e.taxiId === me && examining && this.mode === 'playing') {
          this.playerDamageAlertTicks = DAMAGE_ALERT_TICKS;
        }
        if (e.type === 'arrived' && this.world.taxis[e.taxiId]?.npc) {
          this.pushFeed(`${this.world.nameOf(e.taxiId)} entered ${locale.sim.level.name}`, 'info');
          this.statusDirty = true;
        }
        if (e.type === 'crashed') {
          if (e.taxiId === me) {
            playerDestroyed = { cause: e.reason, byTaxiId: e.byTaxiId };
          } else if (this.world.taxis[e.taxiId]?.npc) {
            if (!this.deadRivals.includes(e.taxiId)) this.deadRivals.push(e.taxiId);
            const who = this.world.nameOf(e.taxiId);
            const killer = e.byTaxiId ? this.world.nameOf(e.byTaxiId) : '';
            const text =
              e.reason === 'missile' && killer
                ? `${who} shot down by ${killer} (${locale.sim.level.name})`
                : e.reason === 'outOfFuel'
                  ? `${who} ran dry in ${locale.sim.level.name}`
                  : `${who} crashed in ${locale.sim.level.name}`;
            this.pushFeed(text, 'bad');
          }
          if (e.taxiId === this.spectatingId && !this.spectateDying) {
            this.spectateDying = { taxiId: e.taxiId, ticksLeft: Math.round(DEATH_SECONDS * 60) };
          }
        }
        if (e.type === 'fareCompleted' && e.taxiId === me) {
          ps.totalFares++;
          ps.lifeFares++;
        }
        if (e.type === 'vendettaStarted') {
          const who = this.world.nameOf(e.taxiId);
          const target = this.world.nameOf(e.targetId);
          this.pushFeed(`${who} has a vendetta against ${target}! (${locale.sim.level.name})`, 'bad');
        }
        if (e.type === 'npcFleeing') {
          const who = this.world.nameOf(e.taxiId);
          const from = this.world.nameOf(e.fromTaxiId);
          this.pushFeed(`${who} is fleeing ${from} (${locale.sim.level.name})`, 'warn');
        }
      }
    }
    for (const m of this.world.processRelocations()) {
      this.recordTransfer(m.taxiId, m.from, m.to);
      if (m.taxiId === this.spectatingId) {
        this.simReset = true;
        this.statusDirty = true;
      }
    }
    if (playerDestroyed && !ps.dying) {
      if (this.overviewOpen || this.spectatingId !== null || this.watchingLocaleId !== null) {
        this.clearViewing();
        this.simReset = true;
        this.statusDirty = true;
      }
      ps.dying = { ...playerDestroyed, ticksLeft: Math.round(DEATH_SECONDS * 60) };
      this.saveRequest = 'destroyed';
    } else if (ps.dying && --ps.dying.ticksLeft <= 0) {
      this.taxiDestroyed(ps.dying);
    }
    if (this.spectateDying && --this.spectateDying.ticksLeft <= 0) {
      this.spectateDying = null;
      this.spectatingId = null;
      if (this.mode === 'destroyed') this.overviewOpen = true;
      this.simReset = true;
      this.statusDirty = true;
    }
    const alert = this.playerAlert();
    const alertKey = alert ? `${alert.kind}:${alert.text}` : '';
    if (alertKey !== this.lastAlertKey) {
      this.lastAlertKey = alertKey;
      this.statusDirty = true;
    }
    if (this.worldTick % LOCALE_INFO_TICKS === 0) this.statusDirty = true;
    return shown;
  }

  frame(events: SimEvent[] = []): Frame {
    return { sim: wireSim(this.viewSim, this.viewLocaleId), events };
  }

  private pushFeed(text: string, tone: WorldFeedEvent['tone']): void {
    this.feed.push({ tick: this.worldTick, text, tone });
    if (this.feed.length > WORLD_FEED_LIMIT) this.feed.splice(0, this.feed.length - WORLD_FEED_LIMIT);
  }

  private playerAlert(): PlayerAlert | null {
    if (this.mode !== 'playing' || (!this.overviewOpen && this.spectatingId === null && this.watchingLocaleId === null)) {
      return null;
    }
    const sim = this.sim;
    const me = this.player;
    if (!me || !isActive(me)) return null;
    if (sim.missiles.some((m) => m.targetId === me.id)) {
      return { kind: 'missile', text: `MISSILE LOCK ON YOUR TAXI IN ${sim.level.name.toUpperCase()} — PRESS ESC TO RETURN` };
    }
    if (this.playerDamageAlertTicks > 0) {
      return { kind: 'damage', text: `YOUR TAXI TOOK DAMAGE IN ${sim.level.name.toUpperCase()} — PRESS ESC TO RETURN` };
    }
    return null;
  }

  private activityOf(sim: SimState, t: Taxi): string {
    if (!isActive(t)) return 'Destroyed';
    if (sim.missiles.some((m) => m.targetId === t.id)) return 'Under fire';
    const rider = riderOf(sim, t.id);
    if (rider) {
      const pad = sim.level.pads[rider.destPadIndex];
      return pad ? `Delivering → Pad ${pad.label}` : 'Delivering';
    }
    if (sim.passengers.some((p) => p.state === 'walking' && p.taxiId === t.id)) return 'Boarding';
    const svc = serviceCraftFor(sim, t.id);
    if (svc) return svc.status === 'docked' ? 'Rescue Service' : 'Waiting for rescue';
    if (!t.npc) return t.status === 'landed' ? 'Parked' : 'Flying';
    const goal = t.ai?.goal ?? '';
    if (goal.startsWith('emergency:')) return 'Emergency landing';
    if (goal.startsWith('hunt:') && t.vendettaTargetId) {
      return `Vendetta → ${this.world.nameOf(t.vendettaTargetId)}`;
    }
    if (goal.startsWith('flee:') && t.fleeFromId) {
      return `Fleeing ${this.world.nameOf(t.fleeFromId)}`;
    }
    if (goal === 'fuel') {
      const atFuel = t.status === 'landed' && t.padIndex >= 0 && sim.level.pads[t.padIndex]?.kind === 'fuel';
      return atFuel ? 'Shopping' : 'Heading to store';
    }
    if (goal === 'teleport' || t.relocateTo) {
      const dest = t.relocateTo ? levelById(t.relocateTo)?.data.name : undefined;
      if (t.vendettaTargetId) {
        return dest ? `Pursuing ${this.world.nameOf(t.vendettaTargetId)} → ${dest}` : `Pursuing ${this.world.nameOf(t.vendettaTargetId)}`;
      }
      return dest ? `Relocating → ${dest}` : 'Relocating';
    }
    if (goal.startsWith('pick:')) {
      const pad = t.ai && t.ai.padIndex >= 0 ? sim.level.pads[t.ai.padIndex] : undefined;
      return pad ? `Pickup → Pad ${pad.label}` : 'Seeking fare';
    }
    return 'Idle';
  }

  private livingTaxiIds(): string[] {
    const ids: string[] = [];
    for (const l of this.world.locales) {
      for (const t of l.sim.taxis) {
        if (isActive(t)) ids.push(t.id);
      }
    }
    return ids;
  }

  /** Lightweight snapshot of all locales, taxis, and recent world events for the World Overview HUD. */
  worldOverview(): WorldOverview {
    const here = this.levelId;
    const area = (l: World['locales'][number]) => l.sim.level.cols * l.sim.level.rows;
    const smallest = Math.min(...this.world.locales.map(area));
    const waitTicks = Math.round(this.config.demandWaitSeconds * 60);
    const locales: OverviewLocale[] = [];
    const taxis: OverviewTaxi[] = [];

    for (const l of this.world.locales) {
      const sim = l.sim;
      const waitingPs = sim.passengers.filter((p) => p.state === 'waiting');
      const backlog = waitingPs.filter((p) => p.waitTicks >= waitTicks).length;
      const activeTaxis = sim.taxis.filter((t) => isActive(t));
      locales.push({
        id: l.id,
        name: sim.level.name,
        fareMultiplier: sim.level.fareMultiplier,
        size: Math.round((area(l) / smallest) * 10) / 10,
        cols: sim.level.cols,
        rows: sim.level.rows,
        waiting: waitingPs.length,
        backlog,
        here: l.id === here,
        taxis: activeTaxis.map((t) => ({
          id: t.id,
          x: Math.round(t.x),
          y: Math.round(t.y),
          color: t.color,
          player: t.id === this.playerId,
          riding: !!riderOf(sim, t.id),
          underFire: sim.missiles.some((m) => m.targetId === t.id),
          status: t.status,
        })),
        passengers: waitingPs.map((p) => ({
          x: Math.round(p.x),
          y: Math.round(p.y),
          waitSeconds: Math.round(p.waitTicks / 60),
        })),
        missiles: sim.missiles.filter((m) => m.life > 0).map((m) => ({ x: Math.round(m.x), y: Math.round(m.y) })),
      });
      for (const t of activeTaxis) {
        taxis.push({
          id: t.id,
          name: this.world.nameOf(t.id),
          player: t.id === this.playerId,
          localeId: l.id,
          localeName: sim.level.name,
          color: t.color,
          cents: t.cents,
          hp: t.hp,
          maxHp: this.config.taxiMaxHp,
          fuel: t.fuel,
          fuelMax: this.config.fuelMax,
          activity: this.activityOf(sim, t),
          underFire: sim.missiles.some((m) => m.targetId === t.id),
          riding: !!riderOf(sim, t.id),
          ...(t.npc
            ? {
                archetype: personalityArchetype(t.personality),
                personality: t.personality ?? null,
                vendettaTargetId: t.vendettaTargetId ?? null,
                vendettaTargetName: t.vendettaTargetId ? this.world.nameOf(t.vendettaTargetId) : null,
                fleeFromId: t.fleeFromId ?? null,
              }
            : {}),
        });
      }
    }
    taxis.sort((a, b) => {
      if (a.player !== b.player) return a.player ? -1 : 1;
      const [aFirst = '', ...aRest] = a.name.split(' ');
      const [bFirst = '', ...bRest] = b.name.split(' ');
      const firstCmp = aFirst.localeCompare(bFirst, undefined, { sensitivity: 'base' });
      if (firstCmp !== 0) return firstCmp;
      const lastCmp = aRest.join(' ').localeCompare(bRest.join(' '), undefined, { sensitivity: 'base' });
      return lastCmp !== 0 ? lastCmp : a.id.localeCompare(b.id);
    });
    return { tick: this.worldTick, locales, taxis, feed: [...this.feed].reverse() };
  }

  status(accountOverride?: Account | null): GameStatus {
    const specTaxi = this.spectatingId ? this.world.taxi(this.spectatingId) : undefined;
    const specSim = this.spectatingId && this.world.taxis[this.spectatingId] ? this.world.localeOf(this.spectatingId).sim : undefined;
    const acct = accountOverride !== undefined ? accountOverride : this.activeAccount;
    const ps = this.currentPlayer;
    return {
      mode: this.mode,
      paused: this.paused,
      levelId: this.levelId,
      config: this.config,
      card: this.mode === 'menu' ? null : this.card,
      menu: {
        notice: this.menuNotice,
      },
      save: this.save,
      serverId: this.serverId,
      serverName: this.serverName,
      gameId: this.serverId,
      account: acct,
      accountCents: ps?.cents ?? 0,
      playerId: this.playerId,
      spectatingId: this.spectatingId,
      spectatingActivity: specTaxi && specSim ? this.activityOf(specSim, specTaxi) : null,
      watchingLocaleId: this.watchingLocaleId,
      overviewOpen: this.overviewOpen,
      playerAlert: this.playerAlert(),
      livingTaxiIds: this.livingTaxiIds(),
      locales: this.localeInfo(),
      taxiNames: Object.fromEntries(Object.values(this.world.taxis).map((r) => [r.id, r.name])),
      diagnostics: this.world.policy.diagnostics(),
    };
  }

  /** Every locale at a glance: fare multiplier, waiting passengers, active taxis, size. */
  localeInfo(): LocaleInfo[] {
    const here = this.levelId;
    const area = (l: World['locales'][number]) => l.sim.level.cols * l.sim.level.rows;
    const smallest = Math.min(...this.world.locales.map(area));
    return this.world.locales.map((l) => ({
      id: l.id,
      name: l.sim.level.name,
      fareMultiplier: l.sim.level.fareMultiplier,
      waiting: l.sim.passengers.filter((p) => p.state === 'waiting').length,
      taxis: l.sim.taxis.filter((t) => t.status === 'flying' || t.status === 'landed').length,
      size: Math.round((area(l) / smallest) * 10) / 10,
      here: l.id === here,
    }));
  }

  /**
   * The player, parked on a teleport pad, travels to another locale (free; empty cab only).
   * Returns why not, if it didn't happen.
   */
  teleport(localeId: string): TeleportResult | 'notPlaying' {
    if (!this.running || this.dying || !this.playerId) return 'notPlaying';
    const from = this.levelId;
    const result = this.world.teleport(this.playerId, localeId);
    if (result !== 'ok') return result;
    this.recordTransfer(this.playerId, from, localeId);
    this.clearInput();
    this.simReset = true;
    this.statusDirty = true;
    return 'ok';
  }

  /** A completed transfer goes into the taxi's history (no money moves) and is saved at once. */
  private recordTransfer(taxiId: string, from: string, to: string): void {
    const accountId = this.world.taxis[taxiId]?.accountId ?? null;
    const balance = accountId ? this.ledger.balanceOfAccount(accountId) : this.ledger.balanceOf(taxiId);
    this.ledger.record({
      accountId,
      taxiId,
      locale: to,
      tick: this.worldTick,
      category: 'transfer',
      amount: 0,
      balance,
      ref: `teleport:${from}->${to}`,
    });
    const toName = levelById(to)?.data.name ?? to;
    this.pushFeed(`${this.world.nameOf(taxiId)} → ${toName}`, 'info');
    this.saveRequest = 'transfer';
  }

  // ── Saving ───────────────────────────────────────────────────────────────────

  /** Shallow snapshot view for worker serialization (postMessage clones once, avoiding double structuredClone). */
  toSaveView(): GameSave {
    const ps = this.currentPlayer;
    if (ps && this.mode !== 'menu') {
      ps.playMode = this.mode;
    }
    return {
      saveVersion: SAVE_VERSION,
      serverId: this.serverId,
      serverName: this.serverName,
      seed: this.seed,
      createdAt: this.createdAt,
      config: this.config,
      world: this.world.snapshot(),
      players: this.players,
      deadRivals: this.deadRivals,
      ledgerSeq: this.ledger.entries.at(-1)?.seq ?? 0,
    };
  }

  /** A complete, self-contained snapshot of this server at the current tick boundary. */
  toSave(): GameSave {
    return structuredClone(this.toSaveView());
  }

  /**
   * Load a saved persistent server (suspended, at the menu). Throws SaveError if the save is
   * from an unsupported version or its contents don't add up; nothing is changed in that case.
   */
  restore(save: GameSave, entries: LedgerEntry[]): void {
    if (save.saveVersion !== SAVE_VERSION) {
      throw new SaveError(`saved by an unsupported version (save format ${save.saveVersion})`, 'unsupported');
    }
    const config = { ...DEFAULT_CONFIG, ...save.config };
    const stashedIds = new Set<string>();
    for (const ps of Object.values(save.players ?? {})) {
      if (ps.stashedTaxi) stashedIds.add(ps.stashedTaxi.taxi.id);
    }
    let world: World;
    try {
      world = World.restore(save.world, config, stashedIds);
    } catch (err) {
      const kind = err instanceof WorldContentError ? 'unsupported' : 'damaged';
      throw new SaveError(kind === 'damaged' ? `it's damaged: ${(err as Error).message}` : (err as Error).message, kind);
    }
    const ledger = new Ledger(save.serverId);
    try {
      for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
        const { seq: _seq, gameId: _gameId, ...rest } = e;
        const recorded = ledger.record(rest);
        if (recorded.seq !== e.seq) throw new Error(`ledger entry ${e.seq} is missing or out of order`);
      }
    } catch (err) {
      throw new SaveError(`its ledger is damaged: ${(err as Error).message}`, 'damaged');
    }
    if ((ledger.entries.at(-1)?.seq ?? 0) !== save.ledgerSeq) {
      throw new SaveError("it's damaged: its ledger does not match the saved server", 'damaged');
    }
    const accountBalances: Record<string, number> = {};
    for (const [accountId, ps] of Object.entries(save.players ?? {})) {
      accountBalances[accountId] = ps.cents;
    }
    const off = ledger.mismatches(
      world.locales.flatMap((l) => l.sim.taxis),
      accountBalances,
    );
    if (off.length) throw new SaveError(`it's damaged: balances don't match the ledger for ${off.join(', ')}`, 'damaged');

    this.hasGame = true;
    this.serverId = save.serverId;
    this.serverName = save.serverName;
    this.seed = save.seed;
    this.createdAt = save.createdAt;
    this.config = config;
    this.world = world;
    this.players = save.players ?? {};
    this.deadRivals = save.deadRivals ?? [];
    this.ledger = ledger;
    this.activeAccountId = null;
    this.activeAccount = null;
    this.mode = 'menu';
    this.paused = false;
    this.clearViewing();
    this.feed = [];
    this.clearInput();
    this.save = { state: 'saved', tick: world.tick };
    this.statusDirty = true;
    this.simReset = true;
  }

  // ── Server & account lifecycle ───────────────────────────────────────────────

  /** Initialize a brand-new persistent named server (with all NPCs, 0 players until someone joins). */
  initServer(name: string, serverId = randomUUID()): void {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 1 || clean.length > 32) {
      throw new Error('Server name must be 1–32 characters');
    }
    this.hasGame = true;
    this.seed = this.newSeed();
    this.serverId = serverId;
    this.serverName = clean;
    this.createdAt = new Date().toISOString();
    this.ledger = new Ledger(this.serverId);
    this.world = World.create(this.config, this.seed, []);
    this.players = {};
    this.activeAccountId = null;
    this.activeAccount = null;
    this.deadRivals = [];
    this.mode = 'menu';
    this.paused = false;
    this.menuNotice = null;
    this.clearViewing();
    this.feed = [];
    this.clearInput();
    this.save = { state: 'none' };
    this.statusDirty = true;
    this.simReset = true;
  }

  /**
   * An account joins this server. First-time visitors get their first taxi with `startMoney`
   * and see the welcome card; returning accounts resume right where they left off.
   */
  joinAccount(account: Account, skin: TaxiSkin = 'original', color?: number): void {
    if (!this.hasGame) throw new Error('no server loaded');
    // If another account was previously active on this server, stash their living taxi safely.
    for (const other of Object.values(this.players)) {
      if (other.accountId === account.accountId) continue;
      if (other.dying) {
        this.finalizeDeathFor(other, other.dying);
      }
      if (other.taxiId && !other.stashedTaxi) {
        const stashed = this.world.stashTaxi(other.taxiId);
        if (stashed) other.stashedTaxi = stashed;
      }
    }

    this.activeAccountId = account.accountId;
    this.activeAccount = account;
    this.menuNotice = null;
    this.clearViewing();
    this.clearInput();

    let ps = this.players[account.accountId];
    if (!ps) {
      const openingCents = toCents(this.config.startMoney);
      const taxiId = this.world.createPlayerTaxi(WORLD_LEVELS[0], {
        accountId: account.accountId,
        name: account.name,
        taxiNumber: 1,
        skin,
        color,
      });
      ps = {
        accountId: account.accountId,
        name: account.name,
        cents: openingCents,
        taxiId,
        taxiCount: 1,
        totalFares: 0,
        lifeFares: 0,
        lifeStartTick: this.worldTick,
        deaths: [],
        playMode: 'intro',
        dying: null,
        card: null,
        stashedTaxi: null,
      };
      this.players[account.accountId] = ps;
      this.welcome(ps);
      this.saveRequest = 'join';
      return;
    }

    ps.name = account.name;
    if (ps.stashedTaxi) {
      this.world.restoreTaxi(ps.stashedTaxi.localeId, ps.stashedTaxi.taxi);
      ps.stashedTaxi = null;
    }
    this.world.playerId = ps.taxiId ?? '';
    // If they disconnected mid-explosion, finish recording that death.
    if (ps.dying) {
      this.finalizeDeathFor(ps, ps.dying);
    }
    this.mode = ps.playMode;
    this.paused = ps.playMode === 'playing';
    this.simReset = true;
    this.statusDirty = true;
  }

  /** Return to the Server Browser: suspend this player's session on the server and save. */
  leaveAccount(): void {
    if (this.mode === 'menu') return;
    const ps = this.currentPlayer;
    if (ps) {
      if (ps.dying) this.finalizeDeathFor(ps, ps.dying);
      ps.playMode = this.mode;
    }
    this.mode = 'menu';
    this.paused = false;
    this.clearViewing();
    this.clearInput();
    this.statusDirty = true;
    this.saveRequest = 'menu';
  }

  /** Development: move the active player to another locale (tuning panel), as if by teleport. */
  jumpTo(localeId: string): void {
    if (!this.hasGame || !this.playerId || this.dying || !this.world.locales.some((l) => l.id === localeId)) return;
    const from = this.levelId;
    if (from === localeId) return;
    this.world.transfer(this.playerId, localeId, this.world.arrivalSpot(this.world.locale(localeId)) ?? undefined);
    this.recordTransfer(this.playerId, from, localeId);
    this.clearInput();
    this.simReset = true;
    this.statusDirty = true;
  }

  /** First join on a server: the welcome card (the world waits until the player starts). */
  private welcome(ps: PlayerServerState): void {
    const level = this.sim.level;
    this.paused = false;
    this.mode = 'intro';
    ps.playMode = 'intro';
    ps.card = {
      kind: 'welcome',
      serverName: this.serverName,
      accountName: ps.name,
      name: level.name,
      hint: level.hint,
      fareMultiplier: level.fareMultiplier,
      localeCount: this.world.locales.length,
    };
    this.clearInput();
    this.simReset = true;
    this.statusDirty = true;
  }

  /** ENTER: start playing from the welcome card. */
  private advance(): void {
    const ps = this.currentPlayer;
    if (!ps || this.mode !== 'intro' || this.awaitingFirstSave || this.paused) return;
    this.mode = 'playing';
    ps.playMode = 'playing';
    ps.card = null;
    this.clearInput();
    this.statusDirty = true;
  }

  /**
   * The active player's taxi was destroyed (after the explosion played out). Their account keeps
   * its dollar balance; the world waits while they choose a fresh taxi, Server Menu, or Review.
   */
  private taxiDestroyed(info: { cause: string; byTaxiId?: string | null }): void {
    const ps = this.currentPlayer;
    if (!ps) return;
    this.finalizeDeathFor(ps, info);
    this.mode = 'destroyed';
    this.paused = false;
    this.clearInput();
    this.statusDirty = true;
    this.saveRequest = 'destroyed';
  }

  private finalizeDeathFor(ps: PlayerServerState, { cause, byTaxiId }: { cause: string; byTaxiId?: string | null }): void {
    ps.dying = null;
    const t = ps.taxiId ? this.world.taxi(ps.taxiId) : undefined;
    if (t) ps.cents = t.cents;
    const locName =
      ps.taxiId && this.world.taxis[ps.taxiId]
        ? this.world.localeOf(ps.taxiId).sim.level.name
        : this.world.locales[0]?.sim.level.name ?? '';
    const death: GameOutcome = {
      cause,
      ...(byTaxiId ? { byTaxiId, byName: this.world.nameOf(byTaxiId) } : {}),
      levelName: locName,
      cents: ps.cents,
      fares: ps.lifeFares,
      seconds: Math.round((this.worldTick - ps.lifeStartTick) / 60),
      rivalsDestroyed: this.deadRivals.length,
      endedAt: new Date().toISOString(),
    };
    ps.deaths.push(death);
    ps.playMode = 'destroyed';
    ps.card = { kind: 'destroyed', death, taxiNumber: ps.taxiCount, accountCents: ps.cents };
  }

  /**
   * A fresh taxi in the first locale, in the same ongoing server: full tank, hull, missiles and
   * flares, carrying the player account's exact persistent dollar balance (no new opening grant).
   */
  private respawn(skin: TaxiSkin = 'original', color?: number): void {
    const ps = this.currentPlayer;
    if (!ps) return;
    ps.taxiCount++;
    const id = this.world.createPlayerTaxi(WORLD_LEVELS[0], {
      accountId: ps.accountId,
      name: ps.name,
      taxiNumber: ps.taxiCount,
      skin,
      color,
      balanceCents: ps.cents,
    });
    ps.taxiId = id;
    ps.lifeFares = 0;
    ps.lifeStartTick = this.worldTick;
    ps.playMode = 'playing';
    ps.card = null;
    this.mode = 'playing';
    this.paused = false;
    this.clearViewing();
    this.clearInput();
    this.simReset = true;
    this.statusDirty = true;
    this.saveRequest = 'respawn';
  }

  private togglePause(): void {
    const canPause =
      this.mode === 'playing' || this.mode === 'intro' || (this.mode === 'destroyed' && this.isExamining);
    if (!canPause) return;
    this.paused = !this.paused;
    this.clearInput();
    this.statusDirty = true;
    if (this.paused) this.saveRequest = 'pause';
  }
}

/** The sim as sent to the browser: no level geometry, config or AI memory. */
export function wireSim(sim: SimState, levelId: string): WireSim {
  const { level: _level, config: _config, taxis, ...rest } = sim;
  return { ...rest, levelId, taxis: taxis.map((t) => ({ ...t, ai: null })) };
}
