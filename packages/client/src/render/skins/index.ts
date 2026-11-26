import { ORIGINAL } from './original';
import { PIXEL_HOMAGE } from './pixel';
import { SOFT_RETRO } from './soft';
import { GHOST_NEON } from './ghost';
import type { SkinDef } from './types';

export type { HullStage, SkinArt, SkinDef, SkinId } from './types';

/** Every taxi skin, in the order the player sees them. */
export const SKINS: readonly SkinDef[] = [ORIGINAL, PIXEL_HOMAGE, SOFT_RETRO, GHOST_NEON];

/** A skin by ID; anything unknown (an older save, a typo) is CLAUDE'S BUS. */
export function skinDef(id: string | null | undefined): SkinDef {
  return SKINS.find((s) => s.id === id) ?? ORIGINAL;
}
