import { PIXEL_CAB } from './pixelCab';
import { JET_RETRO } from './jetRetro';
import { ORIGINAL } from './original';
import { NEON_GHOST } from './ghost';
import { CYBER_TAXI } from './cyber';
import { SHUTTLE } from './shuttle';
import { BATH_CAB } from './bathCab';
import { UAP } from './uap';
import type { SkinDef } from './types';

export type { HullStage, SkinArt, SkinDef, SkinId, SkinThrusters } from './types';

/** Every taxi skin, in the order the player sees them. */
export const SKINS: readonly SkinDef[] = [
  PIXEL_CAB,
  JET_RETRO,
  ORIGINAL,
  NEON_GHOST,
  CYBER_TAXI,
  SHUTTLE,
  BATH_CAB,
  UAP,
];

/** A skin by ID; anything unknown (an older save, a typo) is CLAUDE'S BUS. */
export function skinDef(id: string | null | undefined): SkinDef {
  return SKINS.find((s) => s.id === id) ?? ORIGINAL;
}
