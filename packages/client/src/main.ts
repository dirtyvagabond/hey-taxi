import { Application, Container, Graphics } from 'pixi.js';
import type GUI from 'lil-gui';
import {
  atService,
  atStore,
  atTeleport,
  DEFAULT_CONFIG,
  DT,
  inSafeZone,
  Input,
  isActive,
  levelById,
  levelByName,
  localeName,
  needsTransfer,
  canTravel,
  parseLevel,
  riderOf,
  sideThrustAvailable,
  TAXI,
  WORLD,
  WORLD_LEVELS,
  type Level,
  type Passenger,
  type SimState,
  type Taxi,
} from '@hey-taxi/sim';
import type { Command, Frame, GameStatus, ServerMessage } from '@hey-taxi/sim/protocol';
import { Sound } from './audio';
import {
  Camera,
  cameraZoomPreset,
  cameraZoomTag,
  HUD_H,
  nextCameraZoom,
  SCREEN_H,
  SCREEN_W,
  targetCameraZoom,
  VIEW_H,
  VIEW_W,
} from './camera';
import { createDebugPanel, loadOptions, resetStorageIfNeeded, saveOptions } from './debug';
import { isUrgentCategory, pickLine, type CommentCategory } from './dialogue';
import { EventPresenter, rivalColor } from './events';
import { Keyboard } from './input';
import { Connection, type ConnectionState } from './net';
import { GUIDE_COLORS, Guides, type GuideTarget } from './render/guides';
import { HUD_COLORS, Hud, nearestWaiting, TELEPORT_COLOR, type ShopAction } from './render/hud';
import { lockTarget, MissileLayer } from './render/missiles';
import { arrival, damageSmoke, flareTrail, missileTrail, Particles } from './render/particles';
import { PassengerLayer } from './render/passengers';
import { ServiceLayer } from './render/service';
import { loadSkinPlugins, skinDef, type SkinId } from './render/skins';
import { hullStage, TaxiView } from './render/taxi';
import { setTextResolution } from './render/text';
import { EnvironmentView } from './render/environment';
import { COLORS, WorldView } from './render/world';
import { WorldOverviewScreen } from './overview';
import { hintShown, markHintShown, ScreenController } from './screens';
import { SettingsUI } from './ui/settings';
import { clock } from './ui/theme';

const MAX_FRAME_TIME = 0.25;

/** Store-panel rows → the input bit that buys them (same as keys 1–5). */
const SHOP_BITS: Record<ShopAction, number> = {
  missile: Input.BUY_MISSILE,
  flare: Input.BUY_FLARE,
  repair: Input.BUY_REPAIR,
  gas: Input.BUY_GAS,
  fill: Input.BUY_FILL,
};

class Game {
  private app = new Application();
  /** Virtual SCREEN_W×SCREEN_H surface (status bar + playfield), scaled + letterboxed into the window. */
  private view = new Container();
  /** VIEW_W×VIEW_H camera viewport below the status bar. */
  private playfield = new Container();
  private playfieldMask = new Graphics();
  private playfieldSky = new Graphics();
  private backgroundSlot = new Container();
  private world = new Container();
  private terrainSlot = new Container();
  private debugGfx = new Graphics();
  private watchGfx = new Graphics();
  private padShieldGfx = new Graphics();
  private teleportBeamGfx = new Graphics();
  private teleportFlashGfx = new Graphics();
  private padShieldLevels = new Map<number, number>();
  private padShieldFlashes = new Map<number, number>();
  private teleportFx: {
    t: number;
    dur: number;
    x: number;
    y: number;
    streaks: Array<{ angle: number; r0: number; len: number; speed: number; width: number; color: number }>;
    sparkles: Array<{ ox: number; oy: number; phase: number; speed: number; color: number }>;
  } | null = null;
  private pendingTeleportFx = false;
  private weaponsLockedAlertAt = -Infinity;
  private vpW = VIEW_W;
  private vpH = VIEW_H;
  private viewScale = 1;
  private zoom = 1.25;
  private playerPingTime = 0;
  private watchTransform = { scale: 1, ox: 0, oy: 0 };
  private hoveredWatchTaxiId: string | null = null;
  private particles = new Particles();
  private taxiLayer = new Container();
  private taxiViews = new Map<string, TaxiView>();
  private serviceLayer = new ServiceLayer();
  private missileLayer = new MissileLayer();
  private envView = new EnvironmentView();
  private hud = new Hud();
  private camera = new Camera();
  private keyboard = new Keyboard();
  private sound = new Sound();
  private guides = new Guides();
  private passengers = new PassengerLayer(
    (p, firstSight) => needsTransfer(this.sim, p) ? localeName(p.destination.localeId) + ', please!' : (firstSight && Math.random() < 0.45 ? 'Hey, taxi!' : pickLine('hail')),
    (p, line, firstSight) => this.onPassengerHail(p, line, firstSight),
  );

  /** The game's tuning, as the server last reported it (the panel edits it in place). */
  private config = { ...DEFAULT_CONFIG };
  private options = loadOptions(WORLD[0]!.data.name);
  /** The server's latest state, with this level's geometry and the config attached. */
  private sim!: SimState;
  private status: GameStatus | null = null;
  private conn = new Connection(
    (msg) => this.receive(msg),
    (state) => this.connectionChanged(state),
  );
  private levels = new Map<string, Level>();
  private levelId = '';
  /** When the latest frame arrived (ms), for interpolating toward it. */
  private frameAt = 0;
  /** Input bits last sent to the server. */
  private sentBits = -1;
  private worldView: WorldView | null = null;
  private gui!: GUI;
  private guiVisible = false;
  private settings!: SettingsUI;

  /** Per-taxi position before the latest tick (for interpolation) and as last rendered. */
  private prev = new Map<string, { x: number; y: number }>();
  private prevService = new Map<number, { x: number; y: number }>();
  private rendered = new Map<string, { x: number; y: number }>();
  private time = 0;
  private lastHailVoiceAt = -Infinity;
  private lastSpawnCalloutAt = -Infinity;
  /** Input bits from the previous frame, to detect menu/picker/teleport presses. */
  private prevInputBits = 0;
  /** Missiles already announced as "incoming", and when the lock-warning beep last played. */
  private warnedMissiles = new Set<number>();
  private warningBeepAt = 0;
  private playerAlertBeepAt = 0;
  private dryTankAlertAt = -Infinity;
  private hullBeepIn = 0;
  private showDiagnostics = false;
  private copilotOpen = false;
  private padMenuOpen = false;
  private wasAtPadMenu = false;
  private arrivedByTeleport = false;
  private overview = new WorldOverviewScreen(
    () => this.setOverview(false),
    (taxiId) => this.followTaxi(taxiId),
    () => this.returnToPlayer(),
    (localeId) => this.watchLocale(localeId),
    () => this.command('pause'),
  );

  private screens = new ScreenController({
    hud: this.hud,
    send: (msg) => this.conn.send(msg),
    command: (cmd, skin, color) => this.command(cmd, skin, color),
    clearKeys: () => this.keyboard.clear(),
    getStatus: () => this.status,
    openOverview: () => this.setOverview(true),
    openSettings: () => this.settings.open(),
    returnToPlayer: () => this.returnToPlayer(),
    reclaim: () => this.conn.reclaim(),
  });

  private presenter: EventPresenter;

  constructor() {
    const game = this;
    this.presenter = new EventPresenter({
      get sim() {
        return game.sim;
      },
      get config() {
        return game.config;
      },
      get localId() {
        return game.localId;
      },
      get spectatingId() {
        return game.spectatingId;
      },
      particles: this.particles,
      sound: this.sound,
      hud: this.hud,
      passengers: this.passengers,
      camera: this.camera,
      nameOf: (id) => this.nameOf(id),
      drawnAt: (id) => this.drawnAt(id),
      onTaxiArrived: (t) => {
        this.prev.set(t.id, { x: t.x, y: t.y });
        this.rendered.delete(t.id);
      },
      onPassengerSpawned: (p) => this.onPassengerSpawned(p),
      isPassengerOnScreen: (p) => this.isPassengerOnScreen(p),
      speakPassenger: (text, kind, passengerId, category) => this.speakPassenger(text, kind, passengerId, category),
    });
  }

  async start(): Promise<void> {
    await loadSkinPlugins();
    await this.app.init({
      resizeTo: window,
      background: 0x000000,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    document.body.appendChild(this.app.canvas);
    this.app.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost; waiting for restore…');
    });
    this.app.canvas.addEventListener('webglcontextrestored', () => {
      console.info('WebGL context restored');
      this.layout();
    });
    // Clicking the game always gives it the keyboard back (e.g. after using the tuning panel).
    this.app.canvas.addEventListener('pointerdown', (e) => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el !== document.body) el.blur();
      if (this.isWatchingLocale && !this.overview.isOpen) {
        const hit = this.pickWatchTaxi(e.clientX, e.clientY);
        if (hit) this.followTaxi(hit.id);
      }
    });
    this.app.canvas.addEventListener('pointermove', (e) => {
      if (!this.isWatchingLocale || this.overview.isOpen) {
        if (this.hoveredWatchTaxiId) {
          this.hoveredWatchTaxiId = null;
          this.app.canvas.style.cursor = 'default';
        }
        return;
      }
      const hit = this.pickWatchTaxi(e.clientX, e.clientY);
      this.hoveredWatchTaxiId = hit?.id ?? null;
      this.app.canvas.style.cursor = hit ? 'pointer' : 'default';
    });

    this.playfield.addChild(
      this.playfieldMask,
      this.playfieldSky,
      this.backgroundSlot,
      this.world,
      this.envView.weather,
      this.teleportFlashGfx,
      this.guides.screen,
      this.hud.overlay,
    );
    this.playfield.mask = this.playfieldMask;
    this.playfield.y = HUD_H;
    this.view.addChild(this.hud.bar, this.playfield);
    this.world.addChild(
      this.envView.underlay,
      this.terrainSlot,
      this.envView.overlay,
      this.guides.world,
      this.particles.gfx,
      this.serviceLayer.root,
      this.taxiLayer,
      this.missileLayer.gfx,
      this.passengers.root,
      this.padShieldGfx,
      this.teleportBeamGfx,
      this.debugGfx,
      this.watchGfx,
    );
    this.app.stage.addChild(this.view);

    this.zoom = cameraZoomPreset(this.options.cameraZoom).zoom;
    this.layout();
    window.addEventListener('resize', () => this.layout());
    this.bindKeys();

    this.gui = createDebugPanel(this.config, this.options, {
      levels: WORLD_LEVELS.map((id) => levelById(id)!.data.name),
      loadLevel: (name) => {
        const content = levelByName(name);
        if (content) this.conn.send({ t: 'loadLevel', levelId: content.id });
      },
      configChanged: () => this.conn.send({ t: 'config', config: { ...this.config } }),
      notify: (msg) => this.hud.flash(msg, HUD_COLORS.info),
    });

    this.settings = new SettingsUI(this.options, {
      onToggleMute: () => this.toggleMute(),
      onVolumeChange: (v) => {
        this.options.volume = v;
        this.applyAudio();
        saveOptions(this.options);
      },
      onOptionChanged: () => {
        this.applyAudio();
        saveOptions(this.options);
        this.updateTextResolution();
      },
      onToggleTuning: () => this.toggleTuning(),
      isTuningVisible: () => this.guiVisible,
    });

    this.applyAudio();
    this.showLevel(WORLD[0]!.id);
    this.connectionChanged('connecting');
    this.conn.connect();
    let lastFrameErrAt = 0;
    this.app.ticker.add((ticker) => {
      try {
        this.frame(ticker.deltaMS / 1000);
      } catch (err) {
        const now = performance.now();
        if (now - lastFrameErrAt > 2000) {
          lastFrameErrAt = now;
          console.error('Frame error:', err);
        }
      }
    });
  }

  private bindKeys(): void {
    this.keyboard.onKey('Enter', () => {
      if (this.settings.isOpen) return;
      this.advance();
    });
    this.keyboard.onKey('NumpadEnter', () => {
      if (this.settings.isOpen) return;
      this.advance();
    });
    this.keyboard.onKey('KeyP', () => {
      if (this.settings.isOpen || this.screens.isReviewOpen || this.screens.isLobbyOpen || this.screens.isPickerOpen) return;
      this.command('pause');
    });
    this.keyboard.onKey('KeyQ', () => {
      if (this.settings.isOpen || this.screens.isLobbyOpen || this.screens.isPickerOpen || this.overview.isOpen || this.isSpectating || this.isWatchingLocale) return;
      if (this.paused || this.mode === 'destroyed' || this.mode === 'intro') this.command('menu');
    });
    this.keyboard.onKey('Escape', () => {
      if (this.settings.isOpen) this.settings.close();
      else if (this.screens.isReviewOpen) this.screens.reviewBack();
      else if (this.screens.isLobbyOpen) return;
      else if (this.screens.isPickerOpen) this.screens.cancelPicker();
      else if (this.overview.isOpen) {
        if (this.status?.playerAlert) this.returnToPlayer();
        else this.setOverview(false);
      } else if (this.isWatchingLocale) this.setOverview(true);
      else if (this.isSpectating) this.returnToPlayer();
      else if (this.padMenuOpen) {
        this.padMenuOpen = false;
        this.keyboard.clear();
      } else this.command('pause');
    });
    this.keyboard.onKey('Tab', () => {
      if (this.settings.isOpen) return;
      this.toggleOverview();
    });
    this.keyboard.onKey('BracketLeft', () => {
      if (this.settings.isOpen || this.overview.isOpen) return;
      if (this.isWatchingLocale) this.cycleWatchLocale(-1);
      else if (this.isSpectating) this.cycleSpectate(-1);
    });
    this.keyboard.onKey('BracketRight', () => {
      if (this.settings.isOpen || this.overview.isOpen) return;
      if (this.isWatchingLocale) this.cycleWatchLocale(1);
      else if (this.isSpectating) this.cycleSpectate(1);
    });
    this.keyboard.onKey('KeyV', () => {
      if (
        this.settings.isOpen ||
        this.mode !== 'destroyed' ||
        !this.connected ||
        this.screens.isPickerOpen ||
        this.overview.isOpen ||
        this.isSpectating ||
        this.isWatchingLocale
      ) {
        return;
      }
      this.screens.openReviewAfterMenu();
    });
    this.keyboard.onKey('KeyM', () => this.toggleMute());
    this.keyboard.onKey('KeyZ', () => this.cycleCameraZoom());
    // Temporary convenience control: explode current taxi to start over via normal death UI.
    const selfDestruct = () => this.triggerSelfDestruct();
    this.keyboard.onKey('Delete', selfDestruct);
    this.keyboard.onKey('Backspace', selfDestruct);
    if (import.meta.env.DEV) {
      this.keyboard.onKey('KeyI', () => {
        this.showDiagnostics = !this.showDiagnostics;
        if (!this.showDiagnostics) this.hud.setDiagnostics('');
      });
    }
    this.keyboard.onKey('KeyH', () => {
      if (this.settings.isOpen || this.isSpectating || this.overview.isOpen || this.screens.isLobbyOpen || this.screens.isReviewOpen) return;
      const me = this.taxiById(this.localId);
      if (!me || me.status !== 'landed' || this.mode !== 'playing') return;
      this.copilotOpen = !this.copilotOpen;
    });
    this.keyboard.onKey('Backquote', () => this.toggleTuning());
    // Keys 6–9 for teleport destinations beyond the first five (1–5 use the store keys).
    for (let n = 6; n <= 9; n++) {
      const pick = () => {
        if (this.settings.isOpen || !this.padMenuOpen) return;
        const running = this.connected && !this.paused && this.mode === 'playing';
        const me = running ? this.taxiById(this.localId) : undefined;
        if (!me || !atTeleport(this.sim, me)) return;
        const dest = this.destinations()[n - 1];
        if (dest) this.sendTeleport(dest.id);
      };
      this.keyboard.onKey(`Digit${n}`, pick);
      this.keyboard.onKey(`Numpad${n}`, pick);
    }
  }

  private toggleMute(): void {
    this.options.muted = !this.options.muted;
    this.applyAudio();
    saveOptions(this.options);
    this.hud.flash(this.options.muted ? 'SOUND OFF' : 'SOUND ON', HUD_COLORS.info);
  }

  private cycleCameraZoom(): void {
    if (
      this.settings.isOpen ||
      this.screens.isLobbyOpen ||
      this.screens.isReviewOpen ||
      this.screens.isPickerOpen ||
      this.overview.isOpen ||
      this.isWatchingLocale
    ) {
      return;
    }
    const next = nextCameraZoom(this.options.cameraZoom);
    this.options.cameraZoom = next.id;
    saveOptions(this.options);
    this.settings?.sync();
    this.updateTextResolution();
    this.hud.flash(
      `ZOOM: ${next.label.toUpperCase()} (${cameraZoomTag(next)})`,
      HUD_COLORS.info,
      'Press Z to cycle · or change in Settings',
    );
  }

  private triggerSelfDestruct(): void {
    if (
      !this.connected ||
      this.paused ||
      this.mode !== 'playing' ||
      this.settings.isOpen ||
      this.screens.isLobbyOpen ||
      this.screens.isReviewOpen ||
      this.screens.isPickerOpen ||
      this.overview.isOpen ||
      this.isSpectating ||
      this.isWatchingLocale
    ) {
      return;
    }
    this.command('selfDestruct');
  }

  private toggleTuning(): void {
    this.guiVisible = !this.guiVisible;
    this.gui.show(this.guiVisible);
    if (this.guiVisible) this.gui.open();
    this.settings?.sync();
  }

  // ── Server link ──────────────────────────────────────────────────────────────

  private command(cmd: Command, skin?: SkinId, color?: number): void {
    this.keyboard.clear();
    const msg: { t: 'cmd'; cmd: Command; skin?: string; color?: number } = { t: 'cmd', cmd };
    if (skin) msg.skin = skin;
    if (color !== undefined) msg.color = color;
    this.conn.send(msg);
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.screens.setLobby(msg.accounts, msg.account, msg.servers);
        this.applyFrames([msg.frame], true);
        this.applyStatus(msg.status);
        this.sentBits = -1;
        break;
      case 'lobby':
        this.screens.setLobby(msg.accounts, msg.account, msg.servers);
        break;
      case 'status':
        this.applyStatus(msg.status);
        break;
      case 'frames':
        this.applyFrames(msg.frames, msg.reset === true);
        break;
      case 'worldOverview':
        this.overview.update(msg.overview);
        break;
      case 'review':
        this.screens.setReviewGames(msg.games);
        break;
      case 'reviewGame':
        this.screens.setReviewDetail(msg.gameId, msg.detail, msg.error);
        break;
      case 'error':
        this.hud.flash('SERVER ERROR', HUD_COLORS.bad, msg.message);
        break;
      case 'notice':
        this.hud.flash(msg.title, msg.tone === 'good' ? HUD_COLORS.good : msg.tone === 'bad' ? HUD_COLORS.bad : HUD_COLORS.warn, msg.text);
        break;
      case 'replaced':
        break;
    }
  }

  private connectionChanged(state: ConnectionState): void {
    if (state === 'open') {
      if (this.status) this.applyStatus(this.status, true);
      return;
    }
    this.screens.showConnectionState(state);
  }

  private get connected(): boolean {
    return this.conn.state === 'open' && this.status !== null;
  }

  private get mode(): GameStatus['mode'] {
    return this.status?.mode ?? 'menu';
  }

  private get paused(): boolean {
    return this.status?.paused ?? false;
  }

  private applyStatus(status: GameStatus, force = false): void {
    const prev = this.status;
    this.status = status;
    Object.assign(this.config, status.config);
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    this.options.level = levelById(status.levelId)?.data.name ?? this.options.level;

    const modeChanged = force || !prev || prev.mode !== status.mode || prev.levelId !== status.levelId;
    const watchChanged = (prev?.watchingLocaleId ?? null) !== status.watchingLocaleId;
    if (prev?.watchingLocaleId && status.overviewOpen) this.overview.selectLocale(prev.watchingLocaleId);
    this.screens.syncStatus(prev, status, modeChanged);
    this.overview.setContext(status.serverName, this.screens.accountName);
    if (status.overviewOpen) this.overview.open(status.spectatingId, status.playerAlert);
    else if (this.overview.isOpen) this.overview.close();
    this.overview.setSpectating(status.spectatingId);
    this.overview.setAlert(status.playerAlert);
    this.overview.setPaused(status.paused);
    this.sound.setSpectateDuck(status.spectatingId !== null || status.watchingLocaleId !== null || status.overviewOpen);
    if (watchChanged) {
      this.hoveredWatchTaxiId = null;
      this.app.canvas.style.cursor = 'default';
      this.layout();
    }
    if (status.mode === 'menu') return;

    // Arrived somewhere new by teleport (no intro card): keep teleport menu closed and announce arrival.
    if (prev && prev.levelId !== status.levelId && status.mode === 'playing' && !status.spectatingId && !status.watchingLocaleId) {
      this.padMenuOpen = false;
      this.arrivedByTeleport = true;
      this.pendingTeleportFx = true;
      const here = status.locales.find((l) => l.here);
      if (here) {
        this.hud.flash(
          `ARRIVED · ${here.name.toUpperCase()}`,
          TELEPORT_COLOR,
          `Fares ×${here.fareMultiplier.toFixed(2)} · ${here.waiting} waiting · ${here.taxis - 1} other taxi${here.taxis - 1 === 1 ? '' : 's'}`,
        );
      }
    }
    if (
      modeChanged ||
      watchChanged ||
      prev?.paused !== status.paused ||
      prev?.overviewOpen !== status.overviewOpen ||
      prev?.spectatingId !== status.spectatingId
    ) {
      this.sentBits = -1;
    }
    if (modeChanged) this.warnedMissiles.clear();
  }

  /** ENTER: activate highlighted menu item, confirm skin, expand overview city, or open pad menu. */
  private advance(): void {
    if (this.conn.state === 'replaced') {
      this.conn.reclaim();
      return;
    }
    if (!this.connected || this.screens.isReviewOpen || this.screens.isLobbyOpen) return;
    if (this.overview.isOpen) {
      this.overview.confirmSelection();
      return;
    }
    if (this.paused) {
      this.hud.confirmPause();
      return;
    }
    if (this.isSpectating || this.isWatchingLocale) return;
    if (this.screens.isPickerOpen) {
      this.screens.confirmPicker();
      return;
    }
    if (this.hud.isCardOpen) {
      this.hud.confirmCard();
      return;
    }
    if (this.mode === 'playing') {
      const me = this.taxiById(this.localId);
      const atPad = !!me && (atStore(this.sim, me) || atService(this.sim, me) || atTeleport(this.sim, me));
      if (this.padMenuOpen) {
        if (this.hud.isShopOpen) this.hud.confirmShop();
        else if (this.hud.isTeleportOpen) this.hud.confirmTeleport();
        return;
      }
      if (atPad) {
        this.padMenuOpen = true;
        this.keyboard.clear();
      }
    }
  }

  // ── Simulation frames & scene ────────────────────────────────────────────────

  private applyFrames(frames: Frame[], reset: boolean): void {
    for (const [i, f] of frames.entries()) {
      const fresh = reset && i === 0;
      const newLevel = f.sim.levelId !== this.levelId;
      if (fresh || newLevel) this.showLevel(f.sim.levelId);
      const before = this.sim;
      if (!fresh) {
        for (const taxi of before.taxis) this.prev.set(taxi.id, { x: taxi.x, y: taxi.y });
        this.prevService.clear();
        for (const c of before.serviceCrafts ?? []) this.prevService.set(c.id, { x: c.x, y: c.y });
      }
      const fuelBefore = this.taxiById(this.localId)?.fuel ?? 0;
      this.sim = { ...f.sim, level: this.sim.level, config: this.config } as unknown as SimState;
      if (fresh) {
        this.sentBits = -1;
        this.snapToTaxi();
        if (this.pendingTeleportFx) {
          this.pendingTeleportFx = false;
          this.triggerTeleportArrivalFx();
        }
        continue;
      }
      if (!newLevel) this.teleportedTaxis(before.taxis);
      for (const e of f.events) {
        if (e.type === 'taxiBump') {
          for (const id of e.taxiIds) {
            const bumped = this.taxiById(id);
            if (bumped && inSafeZone(this.sim, bumped)) {
              this.padShieldFlashes.set(bumped.padIndex, 1);
            }
          }
        }
      }
      this.presenter.handle(f.events);
      this.presenter.fuelSounds(fuelBefore, this.taxiById(this.localId)?.fuel ?? 0);
      this.presenter.checkIncomingMissiles();
      for (const taxi of this.sim.taxis) {
        if (taxi.status === 'flying' || taxi.status === 'landed') {
          damageSmoke(this.particles, taxi, hullStage(taxi.hp, this.config.taxiMaxHp));
          const def = skinDef(taxi.skin);
          if (def.onTick) {
            const col = taxi.npc ? (taxi.color ?? rivalColor(taxi.id)) : (taxi.color ?? def.playerColor);
            def.onTick({ particles: this.particles, taxi, color: col });
          }
        }
      }
      for (const m of this.sim.missiles) if (m.life > 0) missileTrail(this.particles, m.x, m.y, m.vx, m.vy);
      for (const d of this.sim.decoys) flareTrail(this.particles, d.x, d.y);
    }
    this.frameAt = performance.now();
  }

  private taxiById(id: string): Taxi | undefined {
    return this.sim.taxis.find((t) => t.id === id);
  }

  private drawnAt(id: string): { x: number; y: number } {
    const t = this.taxiById(id);
    return this.rendered.get(id) ?? { x: t?.x ?? 0, y: t?.y ?? 0 };
  }

  private levelGeometry(levelId: string): Level {
    let level = this.levels.get(levelId);
    if (!level) {
      level = parseLevel((levelById(levelId) ?? WORLD[0]!).data);
      this.levels.set(levelId, level);
    }
    return level;
  }

  private sendTeleport(localeId: string): void {
    this.padMenuOpen = false;
    this.arrivedByTeleport = true;
    this.pendingTeleportFx = true;
    this.keyboard.clear();
    this.conn.send({ t: 'teleport', localeId });
  }

  private triggerTeleportArrivalFx(): void {
    const me = this.taxiById(this.localId);
    if (!me) return;
    this.sound.teleport();
    arrival(this.particles, me.x, me.y, TELEPORT_COLOR, 0xffffff);
    const streakColors = [0xffffff, 0xd8c0ff, TELEPORT_COLOR, 0x67b6bd];
    const streaks = Array.from({ length: 56 }, (_, i) => ({
      angle: (i / 56) * Math.PI * 2 + (Math.random() - 0.5) * 0.14,
      r0: 18 + Math.random() * 140,
      len: 40 + Math.random() * 140,
      speed: 950 + Math.random() * 1150,
      width: 1.2 + Math.random() * 2.2,
      color: streakColors[i % streakColors.length]!,
    }));
    const sparkleColors = [0xffffff, 0xffe066, 0x67b6bd, 0xd8c0ff, TELEPORT_COLOR];
    const sparkles = Array.from({ length: 30 }, (_, i) => ({
      ox: (Math.random() - 0.5) * 64,
      oy: Math.random() * 170,
      phase: Math.random() * Math.PI * 2,
      speed: 55 + Math.random() * 85,
      color: sparkleColors[i % sparkleColors.length]!,
    }));
    this.teleportFx = { t: 0, dur: 1.65, x: me.x, y: me.y, streaks, sparkles };
    this.zoom = cameraZoomPreset(this.options.cameraZoom).zoom * 0.72;
  }

  private showLevel(levelId: string): void {
    const level = this.levelGeometry(levelId);
    const changed = this.levelId !== '' && this.levelId !== levelId;
    this.levelId = levelId;
    if (changed) {
      this.padMenuOpen = false;
      this.arrivedByTeleport = true;
    }
    this.padShieldLevels.clear();
    this.padShieldFlashes.clear();
    this.padShieldGfx.clear();
    this.teleportBeamGfx.clear();
    this.teleportFlashGfx.clear();
    if (!this.sim || this.sim.level !== level) {
      this.sim = { ...(this.sim ?? {}), level, config: this.config, taxis: this.sim?.taxis ?? [] } as SimState;
    }
    this.worldView?.destroy();
    this.worldView = new WorldView(level);
    this.envView.setLevel(level);
    this.backgroundSlot.addChild(this.worldView.background);
    this.terrainSlot.addChild(this.worldView.terrain);

    for (const v of this.taxiViews.values()) v.destroy();
    this.taxiViews.clear();
    this.rendered.clear();
    this.prev.clear();
    this.prevService.clear();
    this.serviceLayer.clear();
    this.particles.clear();
    this.passengers.clear();
    this.sound.stopVoice();
    this.presenter.reset();
  }

  private teleportedTaxis(before: readonly Taxi[]): void {
    const now = new Set(this.sim.taxis.map((t) => t.id));
    for (const t of before) {
      if (now.has(t.id)) continue;
      if (t.status === 'flying' || t.status === 'landed') arrival(this.particles, t.x, t.y, TELEPORT_COLOR);
      this.taxiViews.get(t.id)?.destroy();
      this.taxiViews.delete(t.id);
      this.prev.delete(t.id);
      this.rendered.delete(t.id);
    }
    const was = new Set(before.map((t) => t.id));
    for (const t of this.sim.taxis) {
      if (was.has(t.id) || !t.npc || t.status !== 'landed') continue;
      if (this.sim.level.pads[t.padIndex]?.kind === 'teleport') arrival(this.particles, t.x, t.y, TELEPORT_COLOR);
    }
  }

  private viewOf(t: Taxi): TaxiView {
    let view = this.taxiViews.get(t.id);
    if (!view) {
      view = t.npc
        ? new TaxiView(t.color ?? rivalColor(t.id), true, t.skin)
        : new TaxiView(t.color ?? skinDef(t.skin).playerColor, false, t.skin);
      this.taxiViews.set(t.id, view);
      if (t.npc) this.taxiLayer.addChildAt(view.root, 0);
      else this.taxiLayer.addChild(view.root);
    }
    return view;
  }

  private applyAudio(): void {
    this.sound.setVolume(this.options.volume, this.options.muted);
    this.sound.setVoiceEnabled(this.options.passengerVoice);
    this.settings?.sync();
  }

  private isPassengerOnScreen(p: Passenger): boolean {
    const vw = this.vpW / this.zoom;
    const vh = this.vpH / this.zoom;
    return (
      p.x >= this.camera.x - 20 &&
      p.x <= this.camera.x + vw + 20 &&
      p.y >= this.camera.y &&
      p.y - 48 <= this.camera.y + vh
    );
  }

  /** Stereo pan `[-0.65, +0.65]` and distance outside the viewport (0 when on-screen). */
  private spatialFor(x: number, y: number): { pan: number; offscreenDist: number } {
    const vw = this.vpW / this.zoom;
    const vh = this.vpH / this.zoom;
    const cx = this.camera.x + vw / 2;
    const pan = Math.max(-0.65, Math.min(0.65, (x - cx) / (vw * 0.85)));
    const dx = x < this.camera.x ? this.camera.x - x : x > this.camera.x + vw ? x - (this.camera.x + vw) : 0;
    const dy = y < this.camera.y ? this.camera.y - y : y - 48 > this.camera.y + vh ? y - 48 - (this.camera.y + vh) : 0;
    return { pan, offscreenDist: Math.hypot(dx, dy) };
  }

  private canAmbientHail(): boolean {
    if (this.paused || this.overview.isOpen || this.isWatchingLocale) return false;
    if (this.mode !== 'playing' && !this.isSpectating) return false;
    const taxi = this.taxiById(this.viewedId);
    return !!taxi && isActive(taxi) && !riderOf(this.sim, taxi.id);
  }

  /** Classic C64 "new fare appeared" callout (even off-screen, panned & attenuated). */
  private onPassengerSpawned(p: Passenger): void {
    if (!this.canAmbientHail()) return;
    const onScreen = this.isPassengerOnScreen(p);
    const cooldown = onScreen ? 4 : 15;
    if (this.time - this.lastSpawnCalloutAt < cooldown) return;
    const { pan } = this.spatialFor(p.x, p.y);
    const gainScale = onScreen ? 1.0 : 0.55;
    this.passengers.forceHail(p, 'Hey, taxi!', onScreen);
    if (this.sound.speak('Hey, taxi!', { kind: p.kind, passengerId: p.person.voiceSeed, category: 'hail', priority: 'hail', pan, gainScale })) {
      this.lastSpawnCalloutAt = this.time;
      this.lastHailVoiceAt = this.time;
    }
  }

  private onPassengerHail(p: Passenger, line: string, firstSight: boolean): void {
    if (!this.canAmbientHail()) return;
    const { pan, offscreenDist } = this.spatialFor(p.x, p.y);
    if (offscreenDist > 420) return;
    const minGap = firstSight ? 1.2 : 2.5;
    if (this.time - this.lastHailVoiceAt < minGap) return;
    const gainScale = offscreenDist <= 0 ? 1.0 : 1.0 - 0.55 * (offscreenDist / 420);
    if (this.sound.speak(line, { kind: p.kind, passengerId: p.person.voiceSeed, category: 'hail', priority: 'hail', pan, gainScale })) {
      this.lastHailVoiceAt = this.time;
    }
  }

  private speakPassenger(text: string, kind: number, passengerId: number, category: CommentCategory): boolean {
    if (this.paused || this.overview.isOpen || this.isWatchingLocale) return false;
    return this.sound.speak(text, {
      kind,
      passengerId: this.sim.passengers.find(p => p.id === passengerId)?.person.voiceSeed ?? passengerId,
      category,
      priority: isUrgentCategory(category) ? 'urgent' : 'event',
      delay: category === 'board' ? 0.08 : 0,
    });
  }

  private snapToTaxi(): void {
    this.zoom = cameraZoomPreset(this.options.cameraZoom).zoom;
    this.playerPingTime = 2.2;
    for (const t of this.sim.taxis) this.prev.set(t.id, { x: t.x, y: t.y });
    const target = this.taxiById(this.viewedId) ?? this.sim.taxis[0];
    if (target) this.camera.snap(target.x, target.y, this.sim.level.width, this.sim.level.height, this.zoom, this.vpW, this.vpH);
  }

  private updateTextResolution(): void {
    const targetZoom = cameraZoomPreset(this.options.cameraZoom).zoom;
    setTextResolution(Math.max(1, this.viewScale * Math.max(1, targetZoom) * this.app.renderer.resolution));
  }

  private layout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.min(w / SCREEN_W, h / SCREEN_H);
    this.viewScale = s;
    this.view.scale.set(s);
    if (this.isWatchingLocale) {
      // Full-bleed viewport: hide the cockpit bar and use 100% of the window.
      this.vpW = w / s;
      this.vpH = h / s;
      this.view.position.set(0, 0);
      this.hud.bar.visible = false;
      this.hud.bar.x = 0;
      this.playfield.y = 0;
      this.hud.overlay.x = (this.vpW - VIEW_W) / 2;
    } else {
      // Full-width widescreen playfield with centered 1280u HUD instruments on a full-bleed bar.
      this.vpW = Math.max(VIEW_W, w / s);
      this.vpH = VIEW_H;
      this.view.position.set(Math.floor((w - this.vpW * s) / 2), Math.floor((h - SCREEN_H * s) / 2));
      this.hud.bar.visible = true;
      this.hud.bar.x = (this.vpW - VIEW_W) / 2;
      this.playfield.y = HUD_H;
      this.hud.overlay.x = (this.vpW - VIEW_W) / 2;
    }
    this.playfieldMask.clear().rect(0, 0, this.vpW, this.vpH).fill(0xffffff);
    this.playfieldSky.clear().rect(0, 0, this.vpW, this.vpH).fill(COLORS.sky);
    this.updateTextResolution();
  }

  // ── Frame & render loop ──────────────────────────────────────────────────────

  private frame(rawDt: number): void {
    const dt = Math.min(rawDt, MAX_FRAME_TIME);
    this.time += dt;
    this.hud.tickMenus(dt);

    const bits = this.keyboard.sample();
    const pressedNow = bits & ~this.prevInputBits;
    this.prevInputBits = bits;

    const examining = this.overview.isOpen || this.isSpectating || this.isWatchingLocale;
    const running =
      this.connected && !this.paused && (this.mode === 'playing' || (this.mode === 'destroyed' && examining));
    const livePlayer =
      running && !examining && this.mode === 'playing' && this.sim?.taxis.length ? this.taxiById(this.localId) : undefined;
    const atStrNow = !!livePlayer && atStore(this.sim, livePlayer);
    const atSvcNow = !!livePlayer && !atStrNow && atService(this.sim, livePlayer);
    const atTelNow = !!livePlayer && !atSvcNow && atTeleport(this.sim, livePlayer);
    const atAnyPadMenu = atStrNow || atSvcNow || atTelNow;
    if (livePlayer?.status === 'flying') {
      this.arrivedByTeleport = false;
    }
    if (!atAnyPadMenu) {
      this.padMenuOpen = false;
    } else if (!this.wasAtPadMenu && !this.arrivedByTeleport) {
      this.padMenuOpen = true;
    }
    this.wasAtPadMenu = atAnyPadMenu;

    if (this.settings.isOpen || this.screens.isReviewOpen || this.screens.isLobbyOpen) {
      // HTML overlay handles its own controls.
    } else if (this.overview.isOpen) {
      const dx = (pressedNow & Input.RIGHT ? 1 : 0) - (pressedNow & Input.LEFT ? 1 : 0);
      const dy = (pressedNow & Input.DOWN ? 1 : 0) - (pressedNow & Input.UP ? 1 : 0);
      if (dx || dy) this.overview.moveSelection(dx, dy);
    } else if (this.paused) {
      const dy = (pressedNow & Input.DOWN ? 1 : 0) - (pressedNow & Input.UP ? 1 : 0);
      if (dy) this.hud.movePause(dy);
    } else if (this.screens.isPickerOpen) {
      const move = (pressedNow & Input.RIGHT ? 1 : 0) - (pressedNow & Input.LEFT ? 1 : 0);
      if (move) this.screens.movePicker(move);
      const colorMove = (pressedNow & Input.DOWN ? 1 : 0) - (pressedNow & Input.UP ? 1 : 0);
      if (colorMove) this.screens.movePickerColor(colorMove);
      this.screens.updatePicker(this.time, dt);
    } else if (this.hud.isCardOpen && !examining) {
      const dy = (pressedNow & Input.DOWN ? 1 : 0) - (pressedNow & Input.UP ? 1 : 0);
      if (dy) this.hud.moveCard(dy);
    } else if (this.padMenuOpen && atAnyPadMenu) {
      const dy = (pressedNow & Input.DOWN ? 1 : 0) - (pressedNow & Input.UP ? 1 : 0);
      if (dy) {
        if (atStrNow || atSvcNow) this.hud.moveShop(dy);
        else if (atTelNow) this.hud.moveTeleport(dy);
      }
    }

    if (!this.overview.isOpen && !this.paused && this.connected) {
      const cycle = (pressedNow & Input.RIGHT ? 1 : 0) - (pressedNow & Input.LEFT ? 1 : 0);
      if (cycle) {
        if (this.isWatchingLocale) this.cycleWatchLocale(cycle);
        else if (this.isSpectating) this.cycleSpectate(cycle);
      }
    }
    if (running && !examining && this.mode === 'playing') this.sideJetHint(bits);
    if (running && !examining && this.mode === 'playing' && this.sim?.taxis.length && pressedNow) {
      const me = this.taxiById(this.localId);
      if (me && me.status === 'landed' && me.fuel <= 0 && !this.padMenuOpen && pressedNow & Input.UP) {
        if (this.time - this.dryTankAlertAt >= 2) {
          this.dryTankAlertAt = this.time;
          this.sound.fuelEmpty();
          this.hud.flash(
            'OUT OF FUEL',
            HUD_COLORS.bad,
            atStore(this.sim, me) || atService(this.sim, me)
              ? 'Press ENTER to open the store and buy gas'
              : 'Tank empty · press R to summon Rescue Service for gas',
          );
        }
      }
      if (me && inSafeZone(this.sim, me) && pressedNow & (Input.FIRE | Input.FLARE)) {
        if (this.time - this.weaponsLockedAlertAt >= 1.5) {
          this.weaponsLockedAlertAt = this.time;
          this.sound.weaponsLocked();
          this.hud.flash('WEAPONS OFFLINE', HUD_COLORS.info, 'Safe zone — take off to use weapons');
        }
      }
      if (this.padMenuOpen && me && atTeleport(this.sim, me) && !atService(this.sim, me)) {
        const dests = this.destinations();
        const keys = [Input.BUY_MISSILE, Input.BUY_FLARE, Input.BUY_REPAIR, Input.BUY_GAS, Input.BUY_FILL];
        keys.forEach((bit, i) => {
          if (pressedNow & bit && dests[i]) this.sendTeleport(dests[i].id);
        });
      }
    }

    if (this.status?.playerAlert && examining && !this.paused) {
      if (this.time - this.playerAlertBeepAt >= 0.55) {
        this.playerAlertBeepAt = this.time;
        this.sound.playerAlertBeep();
      }
    }

    const BUY_MASK = Input.BUY_MISSILE | Input.BUY_FLARE | Input.BUY_REPAIR | Input.BUY_GAS | Input.BUY_FILL;
    const MOVE_MASK = Input.UP | Input.DOWN | Input.LEFT | Input.RIGHT;
    const filteredBits = this.padMenuOpen ? bits & ~MOVE_MASK : atAnyPadMenu ? bits & ~BUY_MASK : bits;
    const send = running && !examining && !this.settings.isOpen && this.mode === 'playing' ? filteredBits : 0;
    if (this.connected && send !== this.sentBits) {
      this.sentBits = send;
      this.conn.send({ t: 'input', bits: send });
    }
    if (!this.paused) this.particles.update(dt);
    if (!this.sim || (!this.sim.taxis.length && !this.isWatchingLocale)) return;

    const alpha = running ? Math.min(1, (performance.now() - this.frameAt) / (DT * 1000)) : 1;
    this.render(alpha, dt);
  }

  private render(alpha: number, dt: number): void {
    const watching = this.isWatchingLocale;
    const spectating = this.isSpectating;
    const showSelfName = watching || spectating;
    if (this.playerPingTime > 0 && !this.paused && !watching && !spectating && !this.overview.isOpen) {
      this.playerPingTime = Math.max(0, this.playerPingTime - dt);
    }
    const youPingAlpha = this.playerPingTime > 0 ? Math.min(1, this.playerPingTime / 0.6) : 0;
    const localTaxi = this.taxiById(this.localId);
    const localPos = localTaxi
      ? (() => {
          const p = this.prev.get(localTaxi.id) ?? localTaxi;
          return { x: p.x + (localTaxi.x - p.x) * alpha, y: p.y + (localTaxi.y - p.y) * alpha };
        })()
      : null;
    for (const taxi of this.sim.taxis) {
      const view = this.viewOf(taxi);
      const prev = this.prev.get(taxi.id) ?? taxi;
      const pos = { x: prev.x + (taxi.x - prev.x) * alpha, y: prev.y + (taxi.y - prev.y) * alpha };
      this.rendered.set(taxi.id, pos);
      const distFromPlayer =
        !watching && localPos && taxi.id !== this.localId ? Math.hypot(pos.x - localPos.x, pos.y - localPos.y) : 0;
      view.update(
        taxi,
        pos.x,
        pos.y,
        this.time,
        this.config.taxiMaxHp,
        this.config.fuelMax,
        this.localId,
        (id) => this.nameOf(id),
        showSelfName,
        distFromPlayer,
        youPingAlpha,
      );
      const rider = riderOf(this.sim, taxi.id);
      view.setRider(rider ? rider.kind : null);
    }
    const t = this.taxiById(this.viewedId) ?? this.sim.taxis[0];
    if (!t && !watching) return;
    const live =
      !this.paused && (this.mode === 'playing' || (this.mode === 'destroyed' && (this.overview.isOpen || spectating || watching)));
    this.hullWarning(spectating || watching ? undefined : t, live, dt);
    const canFirstSight = this.canAmbientHail() ? (p: Passenger) => this.isPassengerOnScreen(p) : undefined;
    this.passengers.update(this.sim.passengers, this.paused ? 0 : dt, canFirstSight);
    if (watching) {
      this.sound.setThrust(0, false);
    } else if (t) {
      const thrust = live ? t.thrust : 0;
      const thrusters = [Input.UP, Input.DOWN, Input.LEFT, Input.RIGHT].filter((b) => thrust & b).length;
      this.sound.setThrust(thrusters, (thrust & Input.UP) !== 0);
    }

    const level = this.sim.level;
    if (watching) {
      const topPad = 58;
      const pad = 14;
      const fitScale = Math.min((this.vpW - pad * 2) / level.width, (this.vpH - topPad - pad) / level.height);
      const ox = (this.vpW - level.width * fitScale) / 2;
      const oy = topPad + (this.vpH - topPad - pad - level.height * fitScale) / 2;
      this.watchTransform = { scale: fitScale, ox, oy };
      this.world.scale.set(fitScale);
      this.world.position.set(ox, oy);
      if (this.worldView) this.worldView.background.visible = false;
      this.guides.world.visible = false;
      this.guides.screen.visible = false;
    } else if (t) {
      const preset = cameraZoomPreset(this.options.cameraZoom);
      const speed = live ? Math.hypot(t.vx, t.vy) : 0;
      const targetZoom = targetCameraZoom(preset, speed);
      const rate = preset.dynamic ? (targetZoom < this.zoom ? 3.5 : 1.8) : 10;
      const zk = 1 - Math.exp(-dt * rate);
      this.zoom += (targetZoom - this.zoom) * zk;
      if (Math.abs(targetZoom - this.zoom) < 0.001) this.zoom = targetZoom;
      const { x, y } = this.drawnAt(t.id);
      if (live) this.camera.follow(x, y, t.vx, t.vy, level.width, level.height, dt, this.zoom, this.vpW, this.vpH);
      else this.camera.snap(x, y, level.width, level.height, this.zoom, this.vpW, this.vpH);
      const shake = this.options.screenShake && !this.paused ? this.camera.shakeOffset(dt) : { x: 0, y: 0 };
      this.world.scale.set(this.zoom);
      this.world.position.set(-this.camera.x * this.zoom + shake.x, -this.camera.y * this.zoom + shake.y);
      if (this.worldView) this.worldView.background.visible = true;
      this.worldView?.updateParallax(this.camera.x, this.camera.y);
      this.guides.world.visible = true;
      this.guides.screen.visible = true;
      this.guides.update(this.guideTarget(t), this.camera.x, this.camera.y, this.time, this.zoom, this.vpW, this.vpH);
    }
    this.envView.update(this.sim, this.time, this.paused ? 0 : dt, this.vpW);

    const armed = !!t && !inSafeZone(this.sim, t) && (t.missiles > 0 || this.config.missilesUnlimited);
    const target =
      !spectating && !watching && t && armed && (t.status === 'flying' || t.status === 'landed')
        ? lockTarget(this.sim, t)
        : undefined;
    this.serviceLayer.update(this.sim.serviceCrafts ?? [], this.prevService, alpha, this.time);
    this.missileLayer.update(this.sim.missiles, this.sim.decoys, target ? this.drawnAt(target.id) : null, alpha, this.time);
    this.particles.draw();
    this.drawPadShields(this.paused ? 0 : dt);
    this.drawTeleportFx(this.paused ? 0 : dt, watching);
    this.drawHitboxes();
    this.drawWatchMarkers(watching);
    if (t && !watching) this.hud.update(t, this.sim, dt, this.padMenuOpen);
    this.hud.updateSpectator(
      spectating && t
        ? {
            name: this.nameOf(t.id),
            locale: level.name,
            activity: this.status?.spectatingActivity ?? 'Active',
            color: t.color ?? rivalColor(t.id),
          }
        : null,
    );
    this.hud.updateWatchBanner(
      watching
        ? {
            name: level.name,
            fareMultiplier: level.fareMultiplier,
            taxis: this.sim.taxis.filter((x) => isActive(x)).length,
            waiting: this.sim.passengers.filter((p) => p.state === 'waiting').length,
          }
        : null,
    );
    this.hud.updatePlayerAlert(spectating || watching ? (this.status?.playerAlert ?? null) : null, this.time);
    if (!spectating && !watching) this.missileAlarm(live);
    this.drawDiagnostics();
    const showFlyingControls =
      this.options.showControls &&
      this.mode === 'playing' &&
      !this.paused &&
      !watching &&
      !spectating &&
      !this.overview.isOpen &&
      !this.screens.isLobbyOpen &&
      !this.screens.isReviewOpen &&
      !this.screens.isPickerOpen;
    this.hud.setControlsHintVisible(showFlyingControls);
    const player = !spectating && !watching ? this.taxiById(this.localId) : undefined;
    if (!player || player.status !== 'landed' || !live || this.overview.isOpen) this.copilotOpen = false;
    if (t) {
      this.hud.updateCoPilot(this.copilotOpen, player ?? t, this.config);
      const atStr = !!player && live && !this.overview.isOpen && atStore(this.sim, player);
      const atSvc = !!player && live && !this.overview.isOpen && !atStr && atService(this.sim, player);
      const atTel = !!player && live && !this.overview.isOpen && !atSvc && atTeleport(this.sim, player);
      this.hud.updateShop(
        player ?? t,
        this.sim,
        (atStr || atSvc) && this.padMenuOpen,
        (item) => this.keyboard.pulse(SHOP_BITS[item]),
        atSvc,
      );
      this.hud.updateTeleport(
        atTel && this.padMenuOpen,
        this.destinations(),
        this.sim.passengers.some((p) => p.state === 'walking' && p.taxiId === this.localId),
        riderOf(this.sim, this.localId),
        (localeId) => this.sendTeleport(localeId),
      );
    }
  }

  private hullWarning(t: Taxi | undefined, live: boolean, dt: number): void {
    const last = !!t && live && (t.status === 'flying' || t.status === 'landed') && hullStage(t.hp, this.config.taxiMaxHp) === 4;
    if (!last) {
      this.hullBeepIn = 0;
      return;
    }
    this.hullBeepIn -= dt;
    if (this.hullBeepIn <= 0) {
      this.sound.hullWarning();
      this.hullBeepIn = 1.5;
    }
  }

  private drawDiagnostics(): void {
    const d = this.status?.diagnostics;
    if (!this.showDiagnostics || !d) return;
    const lines = [
      `RIVALS ${d.activeRivals}/${d.livingRivals} active (max ${d.maxRivals}) · next new rival in ${d.spawnCooldownSeconds}s   (I to hide)`,
      ...d.locales.map(
        (l) =>
          `${l.name.padEnd(20)} waiting ${l.waiting} · backlog ${l.backlog} · oldest ${l.oldestWaitSeconds}s · rivals ${l.rivalsActive}/${l.rivalsLiving}${l.reserved ? ` · ${l.reserved} on the way` : ''}`,
      ),
      '',
      ...d.decisions.slice(-6).map((x) => `${clock(Math.round(x.tick / 60))}  ${x.text}`),
    ];
    this.hud.setDiagnostics(lines.join('\n'));
  }

  private get localId(): string {
    return this.status?.playerId ?? 'p1';
  }

  private get spectatingId(): string | null {
    return this.status?.spectatingId ?? null;
  }

  private get isSpectating(): boolean {
    return this.spectatingId !== null;
  }

  private get watchingLocaleId(): string | null {
    return this.status?.watchingLocaleId ?? null;
  }

  private get isWatchingLocale(): boolean {
    return this.watchingLocaleId !== null;
  }

  private get viewedId(): string {
    return this.spectatingId ?? this.localId;
  }

  private toggleOverview(): void {
    if (!this.connected || this.screens.isReviewOpen || this.screens.isPickerOpen) return;
    if (this.mode !== 'playing' && this.mode !== 'destroyed') return;
    this.setOverview(!this.overview.isOpen);
  }

  private setOverview(open: boolean): void {
    if (!this.connected) return;
    this.keyboard.clear();
    if (!open) this.playerPingTime = 2.0;
    this.conn.send({ t: 'overview', open });
  }

  private watchLocale(localeId: string): void {
    if (!this.connected) return;
    this.keyboard.clear();
    this.conn.send({ t: 'watchLocale', localeId });
  }

  private cycleWatchLocale(step: number): void {
    const locales = this.status?.locales ?? [];
    if (!locales.length) return;
    const cur = this.watchingLocaleId ? locales.findIndex((l) => l.id === this.watchingLocaleId) : 0;
    const next = locales[(cur + step + locales.length) % locales.length]!;
    if (next.id !== this.watchingLocaleId) this.watchLocale(next.id);
  }

  private pickWatchTaxi(clientX: number, clientY: number): Taxi | undefined {
    if (!this.sim) return undefined;
    const rect = this.app.canvas.getBoundingClientRect();
    const vx = (clientX - rect.left) / this.viewScale;
    const vy = (clientY - rect.top) / this.viewScale;
    const { scale, ox, oy } = this.watchTransform;
    const wx = (vx - ox) / scale;
    const wy = (vy - oy) / scale;
    const hitRadius = Math.max(30, 22 / scale);
    let best: Taxi | undefined;
    let bestD = hitRadius;
    for (const t of this.sim.taxis) {
      if (!isActive(t)) continue;
      const pos = this.drawnAt(t.id);
      const d = Math.hypot(wx - pos.x, wy - pos.y);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  /** Subtle zoomed-out callout rings in Full-Level Watch Mode so taxis/passengers stay easy to spot and click. */
  private drawWatchMarkers(watching: boolean): void {
    const g = this.watchGfx;
    g.clear();
    if (!watching) return;
    const s = this.watchTransform.scale;
    const zoomedOut = s < 0.6;
    const inv = 1 / Math.max(0.1, s);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 7);

    if (zoomedOut) {
      for (const p of this.sim.passengers) {
        if (p.state !== 'waiting') continue;
        const color = p.waitTicks >= 25 * 60 ? HUD_COLORS.warn : HUD_COLORS.info;
        g.circle(p.x, p.y - 16, 4.5 * inv).fill({ color, alpha: 0.75 + 0.25 * pulse });
      }
      for (const m of this.sim.missiles) {
        if (m.life <= 0) continue;
        g.circle(m.x, m.y, 6 * inv).stroke({ width: 1.8 * inv, color: HUD_COLORS.bad, alpha: 0.9 });
      }
    }

    for (const t of this.sim.taxis) {
      if (!isActive(t)) continue;
      const hovered = t.id === this.hoveredWatchTaxiId;
      if (!zoomedOut && !hovered) continue;
      const pos = this.drawnAt(t.id);
      const underFire = this.sim.missiles.some((m) => m.targetId === t.id);
      const color = t.id === this.localId ? 0xffc83d : (t.color ?? rivalColor(t.id));
      const r = Math.max(28, (hovered ? 18 : 13) * inv);
      g.circle(pos.x, pos.y, r).stroke({
        width: (hovered ? 2.6 : 1.6) * inv,
        color: underFire ? HUD_COLORS.bad : hovered ? 0xffffff : color,
        alpha: hovered ? 0.95 : 0.75,
      });
      if (t.id === this.localId) {
        g.circle(pos.x, pos.y, r + 3 * inv).stroke({ width: 1.2 * inv, color: 0xffffff, alpha: 0.65 });
      }
    }
  }

  private followTaxi(taxiId: string): void {
    if (!this.connected) return;
    this.keyboard.clear();
    if (this.mode === 'playing' && taxiId === this.localId) {
      this.returnToPlayer();
      return;
    }
    this.conn.send({ t: 'spectate', taxiId });
  }

  private returnToPlayer(): void {
    if (!this.connected) return;
    this.keyboard.clear();
    this.playerPingTime = 2.0;
    this.conn.send({ t: 'spectate', taxiId: null });
  }

  private cycleSpectate(step: number): void {
    const ids = (this.status?.livingTaxiIds ?? []).filter((id) => id !== this.localId);
    if (!ids.length) return;
    const cur = this.spectatingId ? ids.indexOf(this.spectatingId) : -1;
    const next = ids[(cur + step + ids.length) % ids.length]!;
    if (next !== this.spectatingId) this.conn.send({ t: 'spectate', taxiId: next });
  }

  private nameOf(taxiId: string): string {
    return this.status?.taxiNames[taxiId] ?? taxiId;
  }

  private destinations() {
    const taxi = this.taxiById(this.localId);
    return (this.status?.locales ?? []).filter((l) => !l.here && (!taxi || canTravel(taxi, l.id)));
  }

  private sideJetHint(bits: number): void {
    const gameId = this.status?.gameId;
    const t = this.sim.taxis.find((x) => x.id === this.localId);
    if (!gameId || !t || t.status !== 'flying' || !(bits & (Input.LEFT | Input.RIGHT)) || sideThrustAvailable(t)) return;
    if (hintShown('sideJets', gameId)) return;
    markHintShown('sideJets', gameId);
    this.hud.flash('SIDE JETS OFF', HUD_COLORS.warn, 'They only work with the gear fully up · SPACE to raise it');
  }

  private missileAlarm(live: boolean): void {
    const me = this.taxiById(this.localId);
    const incoming = this.sim.missiles.filter((m) => m.targetId === this.localId);
    if (!live || !me || !incoming.length) return;
    for (const m of incoming) {
      if (this.warnedMissiles.has(m.id)) continue;
      this.warnedMissiles.add(m.id);
      const hint =
        me.flares > 0
          ? `Your co-pilot (${me.copilot.countermeasureProficiency}%) handles flares · C to pop them yourself`
          : 'No flares left. Dodge, or hide at a store or teleport!';
      this.hud.flash('⚠ MISSILE LOCK ⚠', HUD_COLORS.bad, hint);
    }
    const nearest = Math.min(...incoming.map((m) => Math.hypot(m.x - me.x, m.y - me.y)));
    const interval = nearest < 200 ? 0.12 : 0.35;
    if (this.time - this.warningBeepAt >= interval) {
      this.warningBeepAt = this.time;
      this.sound.missileWarning();
    }
  }

  private guideTarget(t: Taxi): GuideTarget | null {
    const pads = this.sim.level.pads;
    const padTarget = (index: number, color: number): GuideTarget | null => {
      const pad = pads[index];
      if (!pad) return null;
      return { x: pad.x, y: pad.y, w: pad.w, label: `PAD ${pad.label}`, color };
    };
    const rider = riderOf(this.sim, t.id);
    if (rider) return padTarget(rider.destPadIndex, GUIDE_COLORS.dropoff);
    const waiting = nearestWaiting(this.sim, t);
    if (!waiting) return null;
    return padTarget(waiting.padIndex, GUIDE_COLORS.pickup) ??
      { x: waiting.x - 20, y: waiting.y, w: 40, label: waiting.person.name, color: GUIDE_COLORS.pickup };
  }

  /** Pad-anchored energy dome over occupied store and teleport pads (pad-matched amber/violet). */
  private drawPadShields(dt: number): void {
    const g = this.padShieldGfx;
    g.clear();
    const pads = this.sim.level.pads;
    const occupied = new Set<number>();
    for (const t of this.sim.taxis) {
      if (inSafeZone(this.sim, t)) occupied.add(t.padIndex);
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.2);
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i]!;
      if (pad.kind !== 'fuel' && pad.kind !== 'teleport') continue;
      const target = occupied.has(i) ? 1 : 0;
      const prev = this.padShieldLevels.get(i) ?? 0;
      const next = target > prev ? Math.min(1, prev + dt * 4.5) : Math.max(0, prev - dt * 4.5);
      if (next <= 0.005) {
        this.padShieldLevels.delete(i);
        this.padShieldFlashes.delete(i);
        continue;
      }
      this.padShieldLevels.set(i, next);
      const flash = Math.max(0, (this.padShieldFlashes.get(i) ?? 0) - dt * 4.0);
      if (flash > 0.005) this.padShieldFlashes.set(i, flash);
      else this.padShieldFlashes.delete(i);

      const ease = next * (2 - next);
      const color = pad.kind === 'fuel' ? 0xffa62b : TELEPORT_COLOR;
      const x0 = pad.x - 2;
      const x1 = pad.x + pad.w + 2;
      const cx = (x0 + x1) / 2;
      const halfW = (x1 - x0) / 2;
      const crestH = 58 * ease;
      const ctrlY = pad.y - crestH * 2;

      // Subtle translucent canopy fill + glowing rim.
      g.moveTo(x0, pad.y)
        .quadraticCurveTo(cx, ctrlY, x1, pad.y)
        .closePath()
        .fill({ color, alpha: (0.08 + 0.025 * pulse + 0.14 * flash) * ease });
      g.moveTo(x0, pad.y)
        .quadraticCurveTo(cx, ctrlY, x1, pad.y)
        .stroke({ width: 1.5 + flash * 1.6, color, alpha: (0.52 + 0.18 * pulse + 0.35 * flash) * ease });
      // Crisp white specular crest highlight.
      g.moveTo(x0 + 4, pad.y - 1)
        .quadraticCurveTo(cx, ctrlY + 3, x1 - 4, pad.y - 1)
        .stroke({ width: 0.9, color: 0xffffff, alpha: (0.18 + 0.42 * flash) * ease });

      // 3 faint rising scanlines clipped to the parabolic dome contour.
      for (let s = 0; s < 3; s++) {
        const u = ((this.time * 0.45 + s / 3) % 1) * 0.86 + 0.07;
        const sy = pad.y - crestH * u;
        const span = halfW * Math.sqrt(Math.max(0, 1 - u)) - 3;
        if (span > 6) {
          g.moveTo(cx - span, sy)
            .lineTo(cx + span, sy)
            .stroke({ width: 1, color, alpha: (0.14 + 0.22 * flash) * (1 - u * 0.5) * ease });
        }
      }
    }
  }

  /** Hybrid Hyperspace Warp-Tunnel punch + Transporter materialize beam over the arrival pad. */
  private drawTeleportFx(dt: number, watching: boolean): void {
    const beam = this.teleportBeamGfx;
    const flash = this.teleportFlashGfx;
    beam.clear();
    flash.clear();
    const localView = this.taxiViews.get(this.localId);
    if (!this.teleportFx) {
      if (localView && localView.root.alpha !== 1) localView.root.alpha = 1;
      return;
    }
    const fx = this.teleportFx;
    fx.t += dt;
    if (fx.t >= fx.dur) {
      this.teleportFx = null;
      if (localView) localView.root.alpha = 1;
      return;
    }
    const t = fx.t;

    // Phase 1 (0.00 → 0.48 s): Screen-space Hyperspace Warp Tunnel (deep indigo veil + radial star streaks + shockwave).
    if (!watching && t < 0.52) {
      const cx = this.vpW / 2;
      const cy = this.vpH / 2;
      const veilAlpha = t < 0.16 ? 0.92 : Math.max(0, 0.92 * Math.pow(1 - (t - 0.16) / 0.28, 1.7));
      if (veilAlpha > 0.01) {
        flash.rect(0, 0, this.vpW, this.vpH).fill({ color: 0x160a33, alpha: veilAlpha });
      }
      // Bright warp-core flash right at jump peak.
      const coreAlpha = t < 0.14 ? (t / 0.14) * 0.52 : Math.max(0, 0.52 * Math.pow(1 - (t - 0.14) / 0.24, 2));
      if (coreAlpha > 0.01) {
        flash.rect(0, 0, this.vpW, this.vpH).fill({ color: 0xefe6ff, alpha: coreAlpha });
      }
      // Radial hyperspace star-streaks shooting outward from screen center.
      const streakFade = t < 0.22 ? 1 : Math.max(0, 1 - (t - 0.22) / 0.28);
      if (streakFade > 0.01) {
        for (const s of fx.streaks) {
          const rStart = s.r0 + s.speed * t;
          const rEnd = rStart + s.len * (0.6 + t * 4.5);
          const cos = Math.cos(s.angle);
          const sin = Math.sin(s.angle);
          flash
            .moveTo(cx + cos * rStart, cy + sin * rStart)
            .lineTo(cx + cos * rEnd, cy + sin * rEnd)
            .stroke({ width: s.width, color: s.color, alpha: 0.85 * streakFade });
        }
      }
      // Expanding shockwave ring as the warp tunnel parts.
      if (t > 0.12) {
        const rp = (t - 0.12) / 0.38;
        if (rp < 1) {
          const maxR = Math.hypot(cx, cy);
          flash
            .circle(cx, cy, 24 + maxR * rp)
            .stroke({ width: 4 * (1 - rp) + 1, color: 0xd8c0ff, alpha: 0.75 * (1 - rp) });
        }
      }
    }

    // Phase 2 (0.22 → 1.65 s): World-space Transporter materialize beam + scan-bars + shimmering sparkles.
    if (t >= 0.22) {
      const bp = Math.min(1, (t - 0.22) / (fx.dur - 0.22));
      const rampIn = Math.min(1, (t - 0.22) / 0.14);
      const fade = rampIn * Math.pow(1 - bp, 1.5);
      const { x, y } = fx;
      const baseY = y + TAXI.halfH + TAXI.gearLength;
      const beamH = 290;

      // Concentric glowing transporter columns.
      const layers: Array<[number, number, number]> = [
        [78 * (1 - 0.35 * bp), TELEPORT_COLOR, 0.28 * fade],
        [42 * (1 - 0.35 * bp), 0xd8c0ff, 0.46 * fade],
        [16 * (1 - 0.5 * bp), 0xffffff, 0.72 * fade],
      ];
      for (const [w, color, alpha] of layers) {
        beam.rect(x - w / 2, baseY - beamH, w, beamH).fill({ color, alpha });
      }

      // Horizontal transporter scan-bars sweeping through the cab.
      const barW = 66 * (1 - 0.25 * bp);
      for (let i = 0; i < 4; i++) {
        const sy = baseY - ((t * 170 + i * 48) % 180);
        beam.rect(x - barW / 2, sy, barW, 2.5).fill({ color: 0xffffff, alpha: 0.65 * fade });
      }

      // Shimmering transporter motes drifting upward inside the beam.
      for (const sp of fx.sparkles) {
        const sy = baseY - ((sp.oy + t * sp.speed) % 185);
        const flicker = 0.45 + 0.55 * Math.abs(Math.sin(t * 26 + sp.phase));
        const sz = (1.8 + 1.4 * flicker) * (1 - 0.35 * bp);
        beam.rect(x + sp.ox * (1 - 0.3 * bp) - sz / 2, sy - sz / 2, sz, sz).fill({
          color: sp.color,
          alpha: flicker * fade,
        });
      }

      // Double expanding rings at the pad base.
      beam
        .ellipse(x, baseY - 2, 24 + 54 * bp, 5 + 11 * bp)
        .stroke({ width: 2, color: TELEPORT_COLOR, alpha: 0.85 * fade });
      beam
        .ellipse(x, baseY - 2, 14 + 34 * bp, 3 + 7 * bp)
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 * fade });
    }

    // Taxi materialization shimmer: starts after the warp veil clears (0.30 → 1.38 s) so the eye clearly sees it form.
    if (localView) {
      if (t < 0.3) {
        localView.root.alpha = 0;
      } else if (t < 1.38) {
        const mp = (t - 0.3) / 1.08;
        const flutter = 0.22 * Math.sin(t * 54) * (1 - mp * 0.75);
        localView.root.alpha = Math.max(0.06, Math.min(1, mp * mp * 0.35 + mp * 0.65 + flutter));
      } else {
        localView.root.alpha = 1;
      }
    }
  }

  private drawHitboxes(): void {
    const g = this.debugGfx;
    g.clear();
    if (!this.options.hitboxes) return;
    const { halfW, halfH, feetHalfW, gearLength } = TAXI;
    for (const t of this.sim.taxis) {
      if (t.status === 'destroyed' || t.status === 'offstage') continue;
      const { x, y } = this.drawnAt(t.id);
      g.rect(x - halfW, y - halfH, halfW * 2, halfH * 2).stroke({ width: 1, color: 0xff3df2 });
      const fh = gearLength * t.gear;
      if (fh > 0) {
        g.rect(x - feetHalfW, y + halfH, feetHalfW * 2, fh).stroke({ width: 1, color: t.gear >= 1 ? 0x3dff9e : 0xffe066 });
      }
    }
  }
}

// Development only: `?skins` shows the taxi skin preview instead of the game.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('skins')) {
  void import('./preview').then((m) => m.startSkinPreview());
} else {
  // Must run before Game reads any saved settings.
  resetStorageIfNeeded();
  const game = new Game();
  if (import.meta.env.DEV) (window as unknown as { __heyTaxi: Game }).__heyTaxi = game;

  game.start().catch((err) => {
    console.error(err);
    document.body.textContent = `Failed to start: ${(err as Error).message}`;
    document.body.style.color = '#fff';
  });
}
