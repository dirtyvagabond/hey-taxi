/**
 * Runs the active persistent server in real time (60 ticks per second), manages global player
 * accounts and the MMORPG-style server registry, keeps servers saved, and connects to one
 * browser over a WebSocket.
 */
import { randomInt } from 'node:crypto';
import { DT, taxiColor, taxiSkin, type SimConfig } from '@hey-taxi/sim';
import type { WebSocket } from 'ws';
import { decode } from './codec';
import {
  PROTOCOL_VERSION,
  type Account,
  type ClientMessage,
  type Command,
  type Frame,
  type ServerMessage,
  type ServerSummary,
} from '@hey-taxi/sim/protocol';
import { gameDetail, listGames, listServers } from './review';
import { GameSaver } from './saver';
import { GameSession, SaveError, type GameSave } from './session';
import type { SaveStore } from './store';

const TICK_MS = DT * 1000;
/** Never try to catch up more than this many ticks at once (e.g. after the Mac slept). */
const MAX_CATCH_UP = 8;
/** Wall-clock budget per loop invocation to prevent simulation catch-up spirals. */
const MAX_LOOP_WORK_MS = 10;
const LOOP_MS = 4;
const IDLE_LOOP_MS = 50;
/** Push live World Overview snapshots at ~4 Hz while the overview HUD is open. */
const OVERVIEW_MS = 250;
/** Ping the connected browser periodically to detect dead/half-open sockets. */
const HEARTBEAT_MS = 15_000;
/** Drop non-critical frame/overview updates if the socket send buffer exceeds this limit. */
const MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_SERVER_NAME = 'Metro One';

export class GameHost {
  private client: WebSocket | null = null;
  private clientAlive = true;
  private timer: NodeJS.Timeout | null = null;
  private loopDelay = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private started = false;
  private transitioning = 0;
  private last = 0;
  private acc = 0;
  private lastOverviewAt = 0;
  /** Currently signed-in player account for the connected client. */
  activeAccount: Account | null = null;
  /** Saves the currently loaded server (null until one is loaded/created). */
  saver: GameSaver | null = null;
  private opQueue: Promise<void> = Promise.resolve();

  constructor(
    public session: GameSession,
    private readonly build: string,
    private readonly store: SaveStore | null = null,
  ) {}

  /**
   * Startup initialization: ensure at least one default starter server exists if none are
   * on disk, and surface any unreadable server files as a lobby notice.
   */
  async init(): Promise<void> {
    if (!this.store) return;
    const listed = await this.store.list();
    const notices = listed.filter((g) => g.error).map((g) => `Couldn't read server file ${g.file}: ${g.error}`);
    if (listed.length === 0) {
      await this.createServerOnDisk(DEFAULT_SERVER_NAME);
    }
    if (notices.length) {
      for (const n of notices) console.error(n);
      this.session.menuNotice = notices.join('\n');
      this.session.statusDirty = true;
    }
  }

  /** Create a brand-new persistent named server on disk without disturbing the active session. */
  async createServerOnDisk(name: string): Promise<ServerSummary> {
    const temp = new GameSession({
      seed: randomInt(1, 2 ** 31),
      newSeed: () => randomInt(1, 2 ** 31),
      config: this.session.config,
    });
    temp.initServer(name);
    if (this.store) {
      const saver = new GameSaver(this.store, temp);
      const ok = await saver.create();
      if (!ok) throw new Error('Failed to create server save file');
      await this.store.close(temp.serverId);
    }
    return {
      serverId: temp.serverId,
      name: temp.serverName,
      createdAt: temp.createdAt,
      updatedAt: temp.createdAt,
      status: 'suspended',
      seconds: 0,
      playerCount: 0,
      account: this.activeAccount
        ? { joined: false, cents: 0, levelName: null, taxisLost: 0, destroyed: false }
        : null,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.last = performance.now();
    this.scheduleLoop();
    this.heartbeat = setInterval(() => {
      const ws = this.client;
      if (!ws || ws.readyState !== ws.OPEN) return;
      if (!this.clientAlive) {
        ws.terminate();
        return;
      }
      this.clientAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private scheduleLoop(): void {
    if (!this.started || this.timer) return;
    const delay = this.session.running && this.client ? LOOP_MS : IDLE_LOOP_MS;
    this.loopDelay = delay;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loop();
      this.scheduleLoop();
    }, delay);
  }

  /** Wake the loop promptly only when transitioning from idle sleep to running. */
  private pokeLoop(): void {
    if (!this.started || !this.session.running || !this.client) return;
    if (this.timer && this.loopDelay === LOOP_MS) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.last = performance.now();
    this.scheduleLoop();
  }

  /** Intentional shutdown: save the active server (as suspended), then stop. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.session.onDisconnect();
    this.session.saveRequest = null;
    if (this.saver && this.session.hasGame) await this.saver.checkpoint('shutdown');
    this.client?.close(1001, 'server shutting down');
  }

  /** A browser connected. It becomes the host's active client. */
  connect(ws: WebSocket): void {
    ws.on('pong', () => {
      if (this.client === ws) this.clientAlive = true;
    });
    ws.on('error', (err) => {
      console.warn('WebSocket error:', err.message);
    });
    ws.on('message', (raw) => {
      if (this.client === ws) this.clientAlive = true;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      this.receive(ws, msg);
    });
    ws.on('close', () => {
      if (this.client !== ws) return;
      this.client = null;
      this.session.onDisconnect();
      this.processSaves();
    });
  }

  private enqueue(fn: () => Promise<void>): void {
    this.opQueue = this.opQueue.then(fn).catch((err) => {
      console.error('Host operation failed:', err);
      if (this.client) send(this.client, { t: 'error', message: String((err as Error).message) });
    });
  }

  private receive(ws: WebSocket, msg: ClientMessage): void {
    if (msg.t === 'hello') {
      if (this.client && this.client !== ws) {
        send(this.client, { t: 'replaced' });
        this.client.close(4000, 'replaced');
      }
      this.client = ws;
      this.clientAlive = true;
      this.session.clearInput();
      this.enqueue(() => this.handleHello(ws, msg.accountId));
      return;
    }
    if (ws !== this.client) return; // a replaced tab
    switch (msg.t) {
      case 'createAccount':
        this.enqueue(() => this.handleCreateAccount(ws, String(msg.name ?? '')));
        return;
      case 'selectAccount':
        this.enqueue(() => this.handleSelectAccount(ws, String(msg.accountId ?? '')));
        return;
      case 'listServers':
        this.enqueue(() => this.sendLobby(ws));
        return;
      case 'createServer':
        this.enqueue(() => this.handleCreateServer(ws, String(msg.name ?? '')));
        return;
      case 'deleteServer':
        this.enqueue(() => this.handleDeleteServer(ws, String(msg.serverId ?? '')));
        return;
      case 'joinServer':
        this.enqueue(() =>
          this.handleJoinServer(
            ws,
            String(msg.serverId ?? ''),
            typeof msg.skin === 'string' ? msg.skin : undefined,
            typeof msg.color === 'number' ? msg.color : undefined,
          ),
        );
        return;
      case 'leaveServer':
        this.enqueue(() => this.handleLeaveServer(ws));
        return;
      case 'input':
        this.session.setInput(msg.bits | 0);
        break;
      case 'cmd':
        if (msg.cmd === 'menu') {
          this.enqueue(() => this.handleLeaveServer(ws));
          return;
        }
        this.command(
          msg.cmd as Command,
          typeof msg.skin === 'string' ? msg.skin : undefined,
          typeof msg.color === 'number' ? msg.color : undefined,
        );
        break;
      case 'config':
        this.session.setConfig(msg.config as SimConfig);
        break;
      case 'loadLevel':
        if (this.build === 'dev') this.session.jumpTo(String(msg.levelId));
        break;
      case 'teleport': {
        const result = this.session.teleport(String(msg.localeId));
        const why: Record<string, [string, string]> = {
          occupied: ['TELEPORT LOCKED', 'Drop off your passenger first: teleports need an empty cab'],
          blocked: ['ARRIVAL PAD BUSY', 'Every arrival spot there is taken. Try again in a moment'],
          notAtTeleport: ['NOT ON A TELEPORT', 'Land on a teleport pad first'],
        };
        const w = why[result];
        if (w) send(ws, { t: 'notice', title: w[0], text: w[1], tone: 'warn' });
        break;
      }
      case 'overview': {
        const ok = this.session.setOverview(Boolean(msg.open));
        if (!ok && msg.open) {
          send(ws, {
            t: 'notice',
            title: 'LAND FIRST',
            text: 'Land your taxi to open the World Overview',
            tone: 'warn',
          });
        } else if (this.session.overviewOpen) {
          this.lastOverviewAt = performance.now();
          send(ws, { t: 'worldOverview', overview: this.session.worldOverview() });
        }
        break;
      }
      case 'spectate': {
        const ok = this.session.setSpectate(msg.taxiId === null ? null : String(msg.taxiId));
        if (!ok && msg.taxiId !== null) {
          send(ws, {
            t: 'notice',
            title: 'CANNOT FOLLOW',
            text: 'Land your taxi first, or choose a living taxi',
            tone: 'warn',
          });
        }
        break;
      }
      case 'watchLocale': {
        const ok = this.session.setWatchLocale(msg.localeId === null ? null : String(msg.localeId));
        if (!ok && msg.localeId !== null) {
          send(ws, {
            t: 'notice',
            title: 'CANNOT EXPAND LEVEL',
            text: 'Land your taxi first to view a full level',
            tone: 'warn',
          });
        }
        break;
      }
      case 'review':
        this.enqueue(() => this.review(ws));
        return;
      case 'reviewGame':
        this.enqueue(() => this.reviewGame(ws, String(msg.gameId)));
        return;
      case 'debug':
        if (this.build === 'dev') this.session.debugPatch(msg.taxiId, msg.patch);
        break;
    }
    this.processSaves();
    this.flush([]);
    this.pokeLoop();
  }

  private async handleHello(ws: WebSocket, rememberedAccountId?: string): Promise<void> {
    if (this.client !== ws) return;
    if (this.store && rememberedAccountId && !this.activeAccount) {
      const found = await this.store.getAccount(rememberedAccountId).catch(() => null);
      if (found) {
        this.activeAccount = (await this.store.touchAccount(found.accountId).catch(() => found)) ?? found;
      }
    }
    const accounts = this.store ? await this.store.listAccounts() : this.activeAccount ? [this.activeAccount] : [];
    const servers = this.store ? await listServers(this.store, this.activeAccount?.accountId) : [];
    send(ws, {
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      build: this.build,
      accounts,
      account: this.activeAccount,
      servers,
      status: this.session.status(this.activeAccount),
      frame: this.session.frame(),
    });
    this.session.statusDirty = false;
    this.session.simReset = false;
  }

  private async handleCreateAccount(ws: WebSocket, name: string): Promise<void> {
    if (this.client !== ws) return;
    if (!this.store) return;
    try {
      const account = await this.store.createOrSelectAccount(name);
      this.activeAccount = account;
      this.session.activeAccount = account;
      this.session.statusDirty = true;
      await this.sendLobby(ws);
      this.flush([]);
    } catch (err) {
      send(ws, { t: 'notice', title: 'ACCOUNT ERROR', text: (err as Error).message, tone: 'bad' });
    }
  }

  private async handleSelectAccount(ws: WebSocket, accountId: string): Promise<void> {
    if (this.client !== ws) return;
    if (!this.store) return;
    if (!accountId) {
      this.activeAccount = null;
      this.session.activeAccount = null;
      this.session.statusDirty = true;
      await this.sendLobby(ws);
      this.flush([]);
      return;
    }
    const account = await this.store.touchAccount(accountId);
    if (!account) {
      send(ws, { t: 'notice', title: 'ACCOUNT NOT FOUND', text: 'Please select or create an account.', tone: 'warn' });
      await this.sendLobby(ws);
      return;
    }
    this.activeAccount = account;
    this.session.activeAccount = account;
    this.session.statusDirty = true;
    await this.sendLobby(ws);
    this.flush([]);
  }

  private async handleCreateServer(ws: WebSocket, name: string): Promise<void> {
    if (this.client !== ws) return;
    try {
      await this.createServerOnDisk(name);
      await this.sendLobby(ws);
    } catch (err) {
      send(ws, { t: 'notice', title: 'CANNOT CREATE SERVER', text: (err as Error).message, tone: 'bad' });
    }
  }

  private async handleDeleteServer(ws: WebSocket, serverId: string): Promise<void> {
    if (this.client !== ws || !this.store) return;
    this.transitioning++;
    try {
      if (this.session.hasGame && this.session.serverId === serverId) {
        this.session.leaveAccount();
        this.session.saveRequest = null;
        this.session.hasGame = false;
        this.session.serverId = '';
        this.session.serverName = '';
        this.session.activeAccountId = null;
        this.saver = null;
        this.session.statusDirty = true;
      }
      await this.store.delete(serverId);
      await this.sendLobby(ws);
      this.flush([]);
    } catch (err) {
      send(ws, { t: 'notice', title: 'DELETE FAILED', text: (err as Error).message, tone: 'bad' });
    } finally {
      this.transitioning--;
    }
  }

  private async handleJoinServer(ws: WebSocket, serverId: string, skin?: string, color?: number): Promise<void> {
    if (this.client !== ws) return;
    if (!this.activeAccount) {
      send(ws, { t: 'notice', title: 'SIGN IN FIRST', text: 'Enter or select a player account before joining a server.', tone: 'warn' });
      await this.sendLobby(ws);
      return;
    }
    if (!this.store) return;
    this.transitioning++;
    try {
      // Save and close any previously loaded server if switching.
      if (this.session.hasGame && this.session.serverId !== serverId) {
        const prevId = this.session.serverId;
        this.session.leaveAccount();
        this.session.saveRequest = null;
        if (this.saver) await this.saver.checkpoint('switch');
        await this.store.close(prevId).catch(() => null);
        this.saver = null;
      }

      // Load the target server from disk if not already loaded.
      if (!this.session.hasGame || this.session.serverId !== serverId) {
        const file = this.store.fileFor(serverId);
        const loaded = await this.store.load(file);
        let save: GameSave;
        try {
          save = decode<GameSave>(loaded.state);
        } catch (err) {
          throw new SaveError(`its snapshot is damaged: ${(err as Error).message}`, 'damaged');
        }
        this.session.restore(save, loaded.entries);
        this.saver = new GameSaver(this.store, this.session, loaded.ledgerSeq);
      }

      this.session.joinAccount(this.activeAccount, taxiSkin(skin), taxiColor(color));
      if (skin !== undefined || color !== undefined) {
        this.activeAccount =
          (await this.store.touchAccount(this.activeAccount.accountId, { skin, color: color ?? null }).catch(() => this.activeAccount)) ??
          this.activeAccount;
        this.session.activeAccount = this.activeAccount;
      }
      if (this.session.saveRequest && this.saver) {
        const reason = this.session.saveRequest;
        this.session.saveRequest = null;
        await this.saver.checkpoint(reason);
      }
      this.flush([]);
    } catch (err) {
      send(ws, { t: 'notice', title: 'CANNOT JOIN SERVER', text: (err as Error).message, tone: 'bad' });
      await this.sendLobby(ws);
    } finally {
      this.transitioning--;
    }
  }

  private async handleLeaveServer(ws: WebSocket): Promise<void> {
    if (this.client !== ws) return;
    this.transitioning++;
    try {
      this.session.leaveAccount();
      const reason = this.session.saveRequest;
      this.session.saveRequest = null;
      if (reason && this.saver && this.session.hasGame) {
        await this.saver.checkpoint(reason);
      }
      await this.sendLobby(ws);
      this.flush([]);
    } finally {
      this.transitioning--;
    }
  }

  private async sendLobby(ws: WebSocket): Promise<void> {
    if (this.client !== ws) return;
    const accounts = this.store ? await this.store.listAccounts() : this.activeAccount ? [this.activeAccount] : [];
    const servers = this.store ? await listServers(this.store, this.activeAccount?.accountId) : [];
    send(ws, { t: 'lobby', accounts, account: this.activeAccount, servers });
  }

  /** Server review: every server (writes queued before this are on disk first). */
  private async review(ws: WebSocket): Promise<void> {
    if (!this.store) return send(ws, { t: 'review', games: [] });
    try {
      send(ws, { t: 'review', games: await listGames(this.store, this.activeAccount?.accountId) });
    } catch (err) {
      send(ws, { t: 'error', message: `Server review failed: ${(err as Error).message}` });
    }
  }

  private async reviewGame(ws: WebSocket, serverId: string): Promise<void> {
    if (!this.store) return;
    try {
      send(ws, { t: 'reviewGame', gameId: serverId, detail: await gameDetail(this.store, serverId, this.activeAccount?.accountId) });
    } catch (err) {
      send(ws, { t: 'reviewGame', gameId: serverId, detail: null, error: (err as Error).message });
    }
  }

  /** Apply an in-game command. */
  command(cmd: Command, skin?: string, color?: number): void {
    this.processSaves();
    this.session.command(cmd, skin, color);
    if (cmd === 'respawn' && this.store && this.activeAccount && (skin !== undefined || color !== undefined)) {
      void this.store.touchAccount(this.activeAccount.accountId, { skin, color: color ?? null }).catch(() => null);
    }
    this.processSaves();
  }

  /** Save right away when the session asked for it (pause, menu, disconnect, level change…). */
  private processSaves(): void {
    const reason = this.session.saveRequest;
    if (!reason) return;
    this.session.saveRequest = null;
    if (this.saver && this.session.hasGame) void this.saver.checkpoint(reason);
  }

  private loop(): void {
    const now = performance.now();
    this.acc += now - this.last;
    this.last = now;
    if (this.transitioning > 0) {
      this.acc = 0;
      return;
    }
    const s = this.session;
    if (!s.running || !this.client) {
      this.acc = 0;
      this.processSaves();
      this.flush([]);
      return;
    }
    const frames: Frame[] = [];
    try {
      while (this.acc >= TICK_MS && frames.length < MAX_CATCH_UP && s.running) {
        frames.push(s.frame(s.tick()));
        this.acc -= TICK_MS;
        if (performance.now() - now >= MAX_LOOP_WORK_MS) break;
      }
    } catch (err) {
      console.error(err);
      s.paused = true;
      s.statusDirty = true;
      if (this.client) send(this.client, { t: 'error', message: String((err as Error).message) });
    }
    if (this.acc >= TICK_MS) this.acc = 0;
    this.processSaves();
    if (s.running) this.saver?.maybeCheckpoint(now);
    this.flush(frames);
  }

  /** Send any status change, then fresh frames (a reset frame first if the sim was replaced). */
  private flush(frames: Frame[]): void {
    const ws = this.client;
    const s = this.session;
    if (!ws) return;
    if (s.statusDirty) {
      s.statusDirty = false;
      send(ws, { t: 'status', status: s.status(this.activeAccount) });
    }
    if (s.simReset) {
      s.simReset = false;
      send(ws, { t: 'frames', frames: [s.frame()], reset: true });
      return;
    }
    if (frames.length) send(ws, { t: 'frames', frames }, true);
    if (s.overviewOpen) {
      const now = performance.now();
      if (now - this.lastOverviewAt >= OVERVIEW_MS) {
        this.lastOverviewAt = now;
        send(ws, { t: 'worldOverview', overview: s.worldOverview() }, true);
      }
    }
  }
}

function send(ws: WebSocket, msg: ServerMessage, droppable = false): void {
  if (ws.readyState !== ws.OPEN) return;
  if (droppable && ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
  ws.send(JSON.stringify(msg));
}
