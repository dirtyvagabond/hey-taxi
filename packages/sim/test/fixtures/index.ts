/**
 * Test-only level content: the retired campaign maps and the free-flight sandbox maps. They are
 * not part of the game; the simulation tests use them as small, stable maps.
 */
import { contentLevel, type ContentLevel } from '../../src/content';
import type { LevelData } from '../../src/level';
import l01 from './campaign/01-first-shift.json';
import l02 from './campaign/02-downtown.json';
import l03 from './campaign/03-awnings.json';
import l04 from './campaign/04-elevator-shafts.json';
import l05 from './campaign/05-moonwalk.json';
import l06 from './campaign/06-tight-squeeze.json';
import l07 from './campaign/07-heavy-load.json';
import l08 from './campaign/08-rush-hour.json';
import scrollTest from './sandbox/scroll-test.json';
import testFlight from './sandbox/test-flight.json';

export const CAMPAIGN: ContentLevel[] = [
  contentLevel('campaign/01-first-shift', l01 as LevelData),
  contentLevel('campaign/02-downtown', l02 as LevelData),
  contentLevel('campaign/03-awnings', l03 as LevelData),
  contentLevel('campaign/04-elevator-shafts', l04 as LevelData),
  contentLevel('campaign/05-moonwalk', l05 as LevelData),
  contentLevel('campaign/06-tight-squeeze', l06 as LevelData),
  contentLevel('campaign/07-heavy-load', l07 as LevelData),
  contentLevel('campaign/08-rush-hour', l08 as LevelData),
];

/** Endless free-flight maps for tuning (no fare quota). */
export const SANDBOX: ContentLevel[] = [
  contentLevel('sandbox/test-flight', testFlight as LevelData),
  contentLevel('sandbox/scroll-test', scrollTest as LevelData),
];
