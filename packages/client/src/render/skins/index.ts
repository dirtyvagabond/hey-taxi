import { ORIGINAL } from './original';
import { PIXEL_HOMAGE } from './pixel';
import { SOFT_RETRO } from './soft';
import { NEON_GHOST } from './ghost';
import { CYBER_TAXI } from './cyber';
import { SHUTTLE } from './shuttle';
import { BATH_CAB } from './bathCab';
import { SAUCER_CAB } from './saucer';
import type { SkinDef } from './types';

export type { HullStage, SkinArt, SkinDef, SkinId, SkinThrusters } from './types';

/** Every taxi skin, in the order the player sees them. */
export const SKINS: readonly SkinDef[] = [
  ORIGINAL,
  PIXEL_HOMAGE,
  SOFT_RETRO,
  NEON_GHOST,
  CYBER_TAXI,
  SHUTTLE,
  BATH_CAB,
  SAUCER_CAB,
];

/** A skin by ID; anything unknown (an older save, a typo) is CLAUDE'S BUS. */
export function skinDef(id: string | null | undefined): SkinDef {
  return SKINS.find((s) => s.id === id) ?? ORIGINAL;
}
