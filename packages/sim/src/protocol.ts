/**
 * Messages between the browser and the authoritative game server (JSON over a WebSocket at
 * /ws). The server owns the simulation; the browser sends inputs and commands, and draws the
 * state and events the server sends back.
 */
import type { Archetype, Personality, SimConfig, SimEvent, SimState, Taxi } from './index';

/** One recent rival-population decision (diagnostics and saves). */
export interface Decision {
  tick: number;
  text: string;
}

export interface LocaleDiagnostics {
  id: string;
  name: string;
  waiting: number;
  /** Unclaimed passengers past the wait threshold. */
  backlog: number;
  oldestWaitSeconds: number;
  rivalsLiving: number;
  rivalsActive: number;
  /** Responses on the way. */
  reserved: number;
}

/** Rival population diagnostics (dev builds show them with `I`). */
export interface Diagnostics {
  locales: LocaleDiagnostics[];
  activeRivals: number;
  livingRivals: number;
  maxRivals: number;
  /** Seconds until another rival may be created (0 = now). */
  spawnCooldownSeconds: number;
  decisions: Decision[];
}

/** Bump when the message format changes; a mismatched browser reloads itself. */
export const PROTOCOL_VERSION = 4;

/** Server lifecycle of the current session, as the browser should present it. */
/** menu = lobby (account selection + server browser); intro = welcome card on first join. */
export type GameMode = 'menu' | 'intro' | 'playing' | 'destroyed';

/** Top-level player account (global identity across all servers). */
export interface Account {
  accountId: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  skin?: string | null;
  color?: number | null;
}

/** An account's progress on a specific server, shown in the Server Browser. */
export interface ServerAccountSummary {
  joined: boolean;
  cents: number;
  levelName: string | null;
  taxisLost: number;
  destroyed: boolean;
}

/** One persistent MMORPG-style server in the Server Browser. */
export interface ServerSummary {
  serverId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'suspended' | 'unreadable';
  /** World age in seconds of simulation. */
  seconds: number;
  /** Number of distinct player accounts that have joined this server. */
  playerCount: number;
  error?: string;
  /** Current signed-in account's status on this server (null if not signed in or unreadable). */
  account?: ServerAccountSummary | null;
}

/** A taxi as sent to the browser (AI memory stays on the server). */
export type WireTaxi = Omit<Taxi, 'ai'> & { ai: null };

/** Simulation state as sent to the browser: no level geometry (it has the content) or config. */
export type WireSim = Omit<SimState, 'level' | 'config' | 'taxis'> & { levelId: string; taxis: WireTaxi[] };

export interface Frame {
  sim: WireSim;
  /** Events produced by the tick that led to this state (none for a fresh/reset frame). */
  events: SimEvent[];
}

/** Card shown over the game (welcome / taxi destroyed). */
export type Card =
  | {
      kind: 'welcome';
      /** Server name. */
      serverName: string;
      /** Signed-in player's account name. */
      accountName: string;
      /** Where the player starts. */
      name: string;
      hint: string;
      fareMultiplier: number;
      localeCount: number;
    }
  /** The player's taxi was destroyed: their account keeps its balance for the next taxi. */
  | { kind: 'destroyed'; death: GameOutcome; taxiNumber: number; accountCents: number };

/** How one of the player's taxis was lost (its summary). */
export interface GameOutcome {
  cause: string;
  /** Whose missile it was (or the taxi it collided with), and that taxi's name. */
  byTaxiId?: string;
  byName?: string;
  levelName: string;
  /** Account balance at destruction, in cents (kept for future taxis). */
  cents: number;
  fares: number;
  /** Seconds of play in this taxi. */
  seconds: number;
  rivalsDestroyed: number;
  endedAt: string;
}

export interface MenuInfo {
  /** A problem to tell the player about (e.g. a server save that couldn't be loaded). */
  notice: string | null;
}

/** Whether the server is safely on disk. */
export type SaveStatus =
  | { state: 'none' }
  | { state: 'saving' }
  /** Everything through world tick `tick` is committed. */
  | { state: 'saved'; tick: number }
  | { state: 'error'; message: string };

export interface PlayerAlert {
  kind: 'missile' | 'damage' | 'lowFuel';
  text: string;
}

export interface OverviewLocaleTaxi {
  id: string;
  x: number;
  y: number;
  color?: number;
  player: boolean;
  riding: boolean;
  underFire: boolean;
  status: Taxi['status'];
}

export interface OverviewLocale {
  id: string;
  name: string;
  fareMultiplier: number;
  size: number;
  cols: number;
  rows: number;
  waiting: number;
  backlog: number;
  here: boolean;
  taxis: OverviewLocaleTaxi[];
  passengers: { x: number; y: number; waitSeconds: number }[];
  missiles: { x: number; y: number }[];
}

export interface OverviewTaxi {
  id: string;
  name: string;
  player: boolean;
  localeId: string;
  localeName: string;
  color?: number;
  cents: number;
  hp: number;
  maxHp: number;
  fuel: number;
  fuelMax: number;
  activity: string;
  underFire: boolean;
  riding: boolean;
  archetype?: Archetype;
  personality?: Personality | null;
  vendettaTargetId?: string | null;
  vendettaTargetName?: string | null;
  fleeFromId?: string | null;
}

export interface WorldFeedEvent {
  tick: number;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
}

export interface WorldOverview {
  tick: number;
  locales: OverviewLocale[];
  taxis: OverviewTaxi[];
  feed: WorldFeedEvent[];
}

export interface GameStatus {
  mode: GameMode;
  paused: boolean;
  levelId: string;
  config: SimConfig;
  card: Card | null;
  menu: MenuInfo;
  save: SaveStatus;
  /** Current joined server's ID ('' while in the lobby). */
  serverId: string;
  /** Current joined server's name ('' while in the lobby). */
  serverName: string;
  /** Alias for serverId (used for per-server client hints). */
  gameId: string;
  /** Currently signed-in player account, or null before sign-in. */
  account: Account | null;
  /** Signed-in account's dollar balance on the current server, in cents. */
  accountCents: number;
  /** The player's current taxi ID (changes when they take a fresh taxi). */
  playerId: string;
  /** Taxi currently being followed in Spectator/Follow Mode, or null when viewing own taxi. */
  spectatingId: string | null;
  /** Short activity label for the followed taxi (e.g. "Delivering → Pad 3"). */
  spectatingActivity: string | null;
  /** Locale currently expanded in full-level Watch Mode, or null. */
  watchingLocaleId: string | null;
  /** Whether the World Overview HUD is currently open. */
  overviewOpen: boolean;
  /** Threat warning for the player's own taxi while looking away in overview/follow mode. */
  playerAlert: PlayerAlert | null;
  /** Living taxi IDs in stable order, for cycling in Follow Mode. */
  livingTaxiIds: string[];
  /** Every locale, for the teleport panel (refreshed every half second while playing). */
  locales: LocaleInfo[];
  /** Display names of every taxi in the server (by ID). */
  taxiNames: Record<string, string>;
  /** Rival population and passenger demand, for the developer overlay. */
  diagnostics: Diagnostics;
}

export interface LocaleInfo {
  id: string;
  name: string;
  /** Fare multiplier there (applies to the base fare, not tips). */
  fareMultiplier: number;
  /** Passengers waiting for a taxi. */
  waiting: number;
  /** Taxis active there (NPC taxis plus players if present). */
  taxis: number;
  /** World size relative to the smallest locale (by area). */
  size: number;
  /** The player is here. */
  here: boolean;
}

export type ClientMessage =
  | { t: 'hello'; protocol: number; build: string; accountId?: string }
  /** Account management. */
  | { t: 'createAccount'; name: string }
  | { t: 'selectAccount'; accountId: string }
  /** Server browser management. */
  | { t: 'listServers' }
  | { t: 'createServer'; name: string }
  | { t: 'deleteServer'; serverId: string }
  | { t: 'joinServer'; serverId: string; skin?: string; color?: number }
  | { t: 'leaveServer' }
  /** Held input bits (Input bitfield). Sent whenever they change. */
  | { t: 'input'; bits: number }
  /** `skin` & `color`: for respawn, how the new taxi looks. */
  | { t: 'cmd'; cmd: Command; skin?: string; color?: number }
  /** Replace the server's tuning (from the tuning panel). */
  | { t: 'config'; config: SimConfig }
  /** Jump to a level (tuning panel). */
  | { t: 'loadLevel'; levelId: string }
  /** Parked on a teleport pad: travel to another locale. */
  | { t: 'teleport'; localeId: string }
  /** Toggle the live World Overview HUD (landed only, or from the destroyed card). */
  | { t: 'overview'; open: boolean }
  /** Follow another living taxi with the camera (null = return to own taxi). */
  | { t: 'spectate'; taxiId: string | null }
  /** Expand a whole locale in full-level Watch Mode (null = return to own taxi). */
  | { t: 'watchLocale'; localeId: string | null }
  /** Server review: list all servers, or one server's accounts & ledger. */
  | { t: 'review' }
  | { t: 'reviewGame'; gameId: string }
  /** Development builds only: patch a taxi's state (automated checks). */
  | { t: 'debug'; taxiId: string; patch: Record<string, unknown> };

export type Command = 'advance' | 'pause' | 'menu' | 'respawn' | 'selfDestruct';

export type ServerMessage =
  | {
      t: 'welcome';
      protocol: number;
      build: string;
      accounts: Account[];
      account: Account | null;
      servers: ServerSummary[];
      status: GameStatus;
      frame: Frame;
    }
  | {
      t: 'lobby';
      accounts: Account[];
      account: Account | null;
      servers: ServerSummary[];
    }
  | { t: 'status'; status: GameStatus }
  /** One or more ticks of simulation, oldest first. `reset` = new level/restart: don't interpolate. */
  | { t: 'frames'; frames: Frame[]; reset?: boolean }
  /** Lightweight live snapshot of all locales, sent while the World Overview HUD is open. */
  | { t: 'worldOverview'; overview: WorldOverview }
  | { t: 'review'; games: ReviewGame[] }
  | { t: 'reviewGame'; gameId: string; detail: ReviewDetail | null; error?: string }
  /** Something to tell the player (e.g. why a teleport didn't happen). */
  | { t: 'notice'; title: string; text: string; tone: 'good' | 'warn' | 'bad' }
  /** Another browser tab took over this session; this one is disconnected. */
  | { t: 'replaced' }
  | { t: 'error'; message: string };

/** One server in the Server review list. */
export interface ReviewGame {
  gameId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'suspended' | 'unreadable';
  /** Seconds of world time. */
  seconds: number;
  /** Signed-in (or primary) player's account balance on this server, in cents. */
  cents: number;
  levelName: string;
  /** Player taxis lost so far. */
  taxisLost: number;
  playerCount: number;
  error?: string;
}

/** A moment in a taxi's life (it started, teleported, was destroyed). */
export interface ReviewEvent {
  /** Game time, seconds. */
  seconds: number;
  kind: 'started' | 'teleported' | 'destroyed';
  text: string;
  localeName: string;
}

/** One taxi's accounts in a reviewed server (all amounts in cents). */
export interface ReviewTaxi {
  taxiId: string;
  accountId?: string | null;
  name: string;
  /** Co-pilot's countermeasure proficiency (65–95). */
  proficiency: number;
  /** NPC rolled personality attributes (3–18), if NPC. */
  personality?: Personality | null;
  /** Derived NPC archetype title, if NPC. */
  archetype?: Archetype;
  player: boolean;
  status: 'active' | 'destroyed' | 'not arrived';
  /** How it was destroyed, e.g. "Hit by Rival 3's missile" (destroyed taxis only). */
  destroyedBy?: string;
  /** Where it is (or was last). */
  localeName: string;
  opening: number;
  /** Fares and tips (earned income, excluding opening funds). */
  income: number;
  /** Purchases and penalties (positive number). */
  expenses: number;
  /** Other adjustments (net). */
  adjustments: number;
  balance: number;
  fares: number;
  entries: number;
  /** Sum of the ledger equals the final balance. */
  reconciled: boolean;
  events: ReviewEvent[];
}

/** One ledger entry, ready to show. */
export interface ReviewEntry {
  seq: number;
  /** Game time, seconds. */
  seconds: number;
  accountId?: string | null;
  taxiId: string;
  taxiName: string;
  player: boolean;
  locale: string;
  localeName: string;
  category: string;
  /** Signed cents (negative = debit). */
  amount: number;
  /** The wallet's balance after it. */
  balance: number;
  description: string;
}

/** A player account's finances on a server (all amounts in cents), across all of their taxis. */
export interface ReviewOverview {
  accountName: string;
  /** Opening funds granted when the account joined this server. */
  startingFunds: number;
  fareRevenue: number;
  tips: number;
  /** Fares + tips. */
  earned: number;
  /** By category (positive numbers): gas, missile, flare, repair, passengerHit. */
  expensesByCategory: Record<string, number>;
  expenses: number;
  adjustments: number;
  /** Earned − expenses (+ adjustments). */
  netProfit: number;
  /** Account's current balance (kept across taxi deaths). */
  endingCash: number;
  fares: number;
  taxisUsed: number;
  /** Each lost taxi: when, where and why. */
  deaths: GameOutcome[];
}

export interface ReviewDetail {
  game: ReviewGame;
  overview: ReviewOverview;
  taxis: ReviewTaxi[];
  entries: ReviewEntry[];
}
