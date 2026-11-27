import { Container, Graphics } from 'pixi.js';
import { registerExtraSkins, TAXI } from '@hey-taxi/sim';
import { lookFor } from '../passengers';
import { PIXEL_CAB } from './pixelCab';
import { JET_RETRO } from './jetRetro';
import { SHORT_BUS } from './shortBus';
import { NEON_GHOST } from './ghost';
import { CYBER_TAXI } from './cyber';
import { SHUTTLE } from './shuttle';
import { BATH_CAB } from './bathCab';
import { UAP } from './uap';
import { TACTICAL_TAXI } from './tacticalTaxi';
import { mix, type SkinDef, type SkinPluginModule, type SkinSDK } from './types';

export type {
  BuiltinSkinId,
  FlameColors,
  HullStage,
  NozzleSpec,
  SkinArt,
  SkinDef,
  SkinId,
  SkinPluginModule,
  SkinSDK,
  SkinThrusters,
  SkinTickContext,
  ThrusterNozzle,
} from './types';

const skinsList: SkinDef[] = [
  PIXEL_CAB,
  JET_RETRO,
  SHORT_BUS,
  NEON_GHOST,
  CYBER_TAXI,
  SHUTTLE,
  BATH_CAB,
  UAP,
  TACTICAL_TAXI,
];

/** Every taxi skin (built-in plus any loaded runtime plug-ins), in the order the player sees them. */
export const SKINS: readonly SkinDef[] = skinsList;

let pluginsPromise: Promise<void> | null = null;

/**
 * Load optional runtime skin plug-ins served by the game server at `/plugins/manifest.json`.
 * Safe to call multiple times; silently no-ops when no plug-in directory is configured.
 */
export function loadSkinPlugins(): Promise<void> {
  if (pluginsPromise) return pluginsPromise;
  pluginsPromise = (async () => {
    try {
      const res = await fetch('/plugins/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const manifest = (await res.json()) as { entry?: string | null; skins?: string[]; rivalShare?: number };
      if (!manifest.entry || typeof manifest.entry !== 'string') return;
      const url = `/plugins/${manifest.entry.replace(/^\/+/, '')}`;
      const mod = (await import(/* @vite-ignore */ url)) as Partial<SkinPluginModule>;
      if (typeof mod.register !== 'function') return;
      const sdk: SkinSDK = { Graphics, Container, TAXI, mix, lookFor };
      const added = mod.register(sdk);
      const addedIds: string[] = [];
      for (const def of added) {
        if (!def?.id || skinsList.some((s) => s.id === def.id)) continue;
        skinsList.push(def);
        addedIds.push(def.id);
      }
      if (addedIds.length > 0) {
        registerExtraSkins(addedIds, typeof manifest.rivalShare === 'number' ? manifest.rivalShare : 0.75);
      }
    } catch (err) {
      console.warn('Skipping optional skin plug-ins:', err);
    }
  })();
  return pluginsPromise;
}

/** A skin by ID; anything unknown defaults to THE SHORT BUS. */
export function skinDef(id: string | null | undefined): SkinDef {
  return skinsList.find((s) => s.id === id) ?? SHORT_BUS;
}
