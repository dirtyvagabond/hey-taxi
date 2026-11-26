/**
 * Passenger dialogue lines by situation. Speech bubbles and the procedural C64 voice
 * synthesizer (`voice.ts`) consume the exact same chosen text and `CommentCategory`.
 */

export type CommentCategory =
  | 'hail'
  | 'board'
  | 'annoyed'
  | 'thanksBig'
  | 'thanks'
  | 'thanksButLate'
  | 'thanksButBumpy'
  | 'hit'
  | 'rough'
  | 'late'
  | 'full'
  | 'otherCab';

export const LINES: Record<CommentCategory, readonly string[]> = {
  hail: ['Taxi!', 'Hey, taxi!', 'Over here!', 'Taxi, please!', 'Yoo-hoo! Taxi!'],
  board: ['Pad {pad}, please!', 'To pad {pad}!', 'Pad {pad}, and step on it!', 'Pad {pad}, and hurry!', 'Pad {pad}, on the double!', 'Pad {pad}, and don`t dilly dally'],
  annoyed: ['Hey! Wait!', 'Come back!', 'Rude!', 'Seriously?!'],
  thanksBig: ['Keep the change!', 'Wow, smooth ride!', 'Five stars!', 'Amazing!'],
  thanks: ['Thanks!', 'Cheers!', 'Not bad.', 'Okie dokie.'],
  thanksButLate: ['Finally…', 'Took you long enough.', 'Never again.', 'Whatever.'],
  thanksButBumpy: ['My coffee went everywhere…', 'I think I bit my tongue.', 'Smoother next time?', 'My chiropractor thanks you.'],
  hit: ['Ow!!', 'Hey!!', 'Watch it!', 'D-OH!'],
  rough: ['Whoa!', 'Easy!', 'My coffee!', 'Careful!', 'Watch the walls!', 'My neck!', 'Ouch!', 'Yikes!'],
  late: [
    "I'm going to be late!",
    'Any time now…',
    'Is this the scenic route?',
    'I could have hitchhiked faster.',
  ],
  full: ["You're full!", 'No room? Come back!', "I'll wait…"],
  otherCab: ['Sorry, called the other cab!', 'Already got a ride!'],
};

/**
 * How a passenger says goodbye. A late or bumpy ride never gets a happy thanks, however big
 * the tip (an early-arrival bonus can refill a bumpy ride's tip). Both late and bumpy: a coin
 * flip decides which complaint they lead with.
 */
export function farewellCategory(
  ride: { smooth: boolean; late: boolean; tipPercent: number },
  random: () => number = Math.random,
): CommentCategory {
  const bumpy = !ride.smooth;
  if (bumpy && ride.late) return random() < 0.5 ? 'thanksButBumpy' : 'thanksButLate';
  if (bumpy) return 'thanksButBumpy';
  if (ride.late) return 'thanksButLate';
  return ride.tipPercent >= 20 ? 'thanksBig' : 'thanks';
}

export function pickLine(category: CommentCategory, pad = ''): string {
  const lines = LINES[category];
  return lines[Math.floor(Math.random() * lines.length)]!.replace('{pad}', pad);
}

/**
 * Pick a line from `category` that isn't already in `used`, record it in `used`, and return
 * it (with `{pad}` substituted). Returns `null` once every line in `category` has been used,
 * so a passenger never repeats the same phrase in the same trip.
 */
export function pickUnusedLine(
  category: CommentCategory,
  used: Set<string>,
  pad = '',
  random: () => number = Math.random,
): string | null {
  const candidates = LINES[category].filter((line) => !used.has(line));
  if (candidates.length === 0) return null;
  const chosen = candidates[Math.floor(random() * candidates.length)]!;
  used.add(chosen);
  return chosen.replace('{pad}', pad);
}
