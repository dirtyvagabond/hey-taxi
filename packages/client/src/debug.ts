import GUI from 'lil-gui';
import { DEFAULT_CONFIG, type SimConfig } from '@hey-taxi/sim';

/** Display/audio preferences for this browser. Game tuning lives on the server, with the game. */
const OPTIONS_KEY = 'hey-taxi.options.v2';

/**
 * Bump to wipe every browser's saved game data (progress, settings, tuning) on next load.
 * 3 = hard reset requested 2026-11-24.
 */
const STORAGE_VERSION = '3';
const VERSION_KEY = 'hey-taxi.storageVersion';

/**
 * Hard reset of saved data when STORAGE_VERSION changes, or on demand by opening the game
 * with `?reset` in the URL. Call before loading any settings.
 */
export function resetStorageIfNeeded(): void {
  try {
    const url = new URL(window.location.href);
    const requested = url.searchParams.has('reset');
    if (!requested && localStorage.getItem(VERSION_KEY) === STORAGE_VERSION) return;
    for (const key of Object.keys(localStorage)) if (key.startsWith('hey-taxi.')) localStorage.removeItem(key);
    localStorage.setItem(VERSION_KEY, STORAGE_VERSION);
    if (requested) {
      url.searchParams.delete('reset');
      window.history.replaceState(null, '', url);
    }
  } catch {
    // storage unavailable: nothing saved to reset
  }
}

export interface DebugOptions {
  level: string;
  hitboxes: boolean;
  screenShake: boolean;
  showControls: boolean;
  panelOpen: boolean;
  volume: number;
  muted: boolean;
  passengerVoice: boolean;
}

export function loadOptions(defaultLevel: string): DebugOptions {
  const saved = readJson(OPTIONS_KEY);
  return {
    level: typeof saved.level === 'string' ? saved.level : defaultLevel,
    hitboxes: saved.hitboxes === true,
    screenShake: saved.screenShake !== false,
    showControls: saved.showControls !== false,
    panelOpen: saved.panelOpen === true,
    volume: typeof saved.volume === 'number' ? saved.volume : 0.6,
    muted: saved.muted === true,
    passengerVoice: saved.passengerVoice !== false,
  };
}

export function saveOptions(o: DebugOptions): void {
  writeJson(OPTIONS_KEY, o);
}

export interface DebugHooks {
  levels: string[];
  loadLevel(name: string): void;
  /** The tuning changed: send it to the server (which owns the game). */
  configChanged(): void;
  notify(message: string): void;
}

/**
 * Developer tuning panel (hidden by default; toggle with ` or from Settings).
 * Edits `config` in place and reports each change to the server.
 */
export function createDebugPanel(config: SimConfig, opts: DebugOptions, hooks: DebugHooks): GUI {
  const gui = new GUI({ title: 'Developer Tuning  ( ` to hide )' });
  Object.assign(gui.domElement.style, {
    top: '54px',
    bottom: 'auto',
    right: '12px',
    maxHeight: 'calc(100vh - 110px)',
    overflowY: 'auto',
  });

  // Jumping between levels is a development tool (the server ignores it in production).
  if (import.meta.env.DEV) {
    gui.add(opts, 'level', hooks.levels).name('Level (dev)').onChange((name: string) => hooks.loadLevel(name));
  }
  gui.add(opts, 'hitboxes').name('Show hitboxes');

  const flight = gui.addFolder('Flight');
  flight.add(config, 'gravity', 0, 800, 1);
  flight.add(config, 'thrustUp', 0, 1200, 1);
  flight.add(config, 'thrustSide', 0, 800, 1);
  flight.add(config, 'thrustDown', 0, 600, 1);
  flight.add(config, 'dragGearUp', 0, 3, 0.01);
  flight.add(config, 'dragGearDown', 0, 3, 0.01);
  flight.add(config, 'maxSpeed', 50, 1200, 1);
  flight.add(config, 'gearTime', 0.05, 1, 0.01);

  const landing = gui.addFolder('Landing');
  landing.add(config, 'landMaxVy', 10, 300, 1);
  landing.add(config, 'landMaxVx', 5, 200, 1);
  landing.add(config, 'landSmoothVy', 0, 300, 1);
  landing.add(config, 'landOkVy', 0, 300, 1);
  landing.add(config, 'landGlideVx', 0, 200, 1).name('landGlideVx (sideways for bonus)');
  landing.add(config, 'landGlideBonusVy', 0, 200, 1).name('landGlideBonusVy');
  landing.add(config, 'landRoughVx', 0, 200, 1).name('landRoughVx (rough above)');
  landing.add(config, 'landMinSupport', 0.1, 1, 0.05).name('landMinSupport (skid %)');

  const fuel = gui.addFolder('Fuel');
  fuel.add(config, 'fuelMax', 10, 500, 1);
  fuel.add(config, 'burnUp', 0, 30, 0.1);
  fuel.add(config, 'burnSide', 0, 30, 0.1);
  fuel.add(config, 'burnDown', 0, 30, 0.1);
  fuel.add(config, 'fuelPerGallon', 1, 100, 1).name('fuelPerGallon (tank units)');
  fuel.add(config, 'gallonPrice', 0, 20, 0.25).name('gallonPrice ($)');

  const weapons = gui.addFolder('Missiles');
  weapons.add(config, 'missilesUnlimited').name('Unlimited missiles');
  weapons.add(config, 'flareSuccess', 0, 1, 0.01).name('Flare decoy chance');
  weapons.add(config, 'copilotThreatRange', 0, 320, 5).name('Co-pilot threat range');
  weapons.add(config, 'missileCooldown', 0.1, 3, 0.05).name('Cooldown (s)');
  weapons.add(config, 'missileTurnRate', 0.5, 8, 0.1).name('Turn rate');
  weapons.add(config, 'missileSpeed', 100, 800, 10).name('Top speed');
  weapons.close();

  const world = gui.addFolder('Rivals & demand');
  world.add(config, 'rivalsMaxWorld', 0, 48, 1).name('Max rivals (world)');
  world.add(config, 'rivalsMaxPerLocale', 0, 10, 1).name('Max rivals (per locale)');
  world.add(config, 'demandShortage', 1, 6, 1).name('Shortage: passengers');
  world.add(config, 'demandWaitSeconds', 5, 120, 1).name('Shortage: waited (s)');
  world.add(config, 'dispatchTimeoutSeconds', 10, 180, 1).name('Dispatch reserve (s)');
  world.add(config, 'rivalSpawnCooldownSeconds', 0, 300, 5).name('New rival cooldown (s)');
  world.close();

  const misc = gui.addFolder('Misc');
  misc.add(config, 'startMoney', 0, 1000, 1);
  for (const f of [landing, fuel, misc]) f.close();

  const actions = {
    restoreDefaults: () => {
      Object.assign(config, DEFAULT_CONFIG);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      hooks.configChanged();
      hooks.notify('Tuning restored to defaults');
    },
    copyConfig: () => {
      const json = JSON.stringify(config, null, 2);
      navigator.clipboard?.writeText(json).then(
        () => hooks.notify('Config copied to clipboard'),
        () => console.log(json),
      );
      console.log(json);
    },
  };
  gui.add(actions, 'restoreDefaults').name('Restore default tuning');
  gui.add(actions, 'copyConfig').name('Copy tuning as JSON');

  gui.onChange((e) => {
    if (e.object === config) hooks.configChanged();
  });
  gui.onFinishChange(() => {
    saveOptions(opts);
    // Done editing: hand the keyboard back to the game (otherwise arrow keys would keep
    // changing this control instead of flying the taxi).
    const el = document.activeElement;
    if (el instanceof HTMLElement && gui.domElement.contains(el)) el.blur();
  });
  gui.onOpenClose((g) => {
    if (g === gui) {
      opts.panelOpen = !g._closed;
      saveOptions(opts);
    }
  });
  gui.hide();
  return gui;
}

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode etc.) — tuning just won't persist
  }
}
