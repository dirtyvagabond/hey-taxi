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
  | 'wrongPad'
  | 'full'
  | 'otherCab'
  | 'incoming'
  | 'playerFired'
  | 'missileHit'
  | 'hullCritical'
  | 'lowFuel'
  | 'outOfFuel';

const URGENT_CATEGORIES = new Set<CommentCategory>(['incoming', 'missileHit', 'hullCritical', 'outOfFuel']);

export function isUrgentCategory(category: CommentCategory): boolean {
  return URGENT_CATEGORIES.has(category);
}

export const LINES: Record<CommentCategory, readonly string[]> = {
  hail: ['Taxi!', 'Hey, taxi!', 'Over here!', 'Taxi, please!', 'Yoo-hoo! Taxi!', 'Cab!', 'Need a lift!', 'Down here!'],
  board: [
    'Pad {pad}, please!',
    'To pad {pad}!',
    'Pad {pad}, and step on it!',
    'Pad {pad}, and hurry!',
    'Pad {pad}, on the double!',
    "Pad {pad}, and don't dilly dally!",
    'Pad {pad}, make it snappy!',
    'Take me to pad {pad}.',
  ],
  annoyed: ['Hey! Wait!', 'Come back!', 'Rude!', 'Seriously?!', "Hey, I'm walkin' here!", "Don't leave me!", 'Oh, come on!'],
  thanksBig: [
    'Keep the change!',
    'Wow, smooth ride!',
    'Five stars!',
    'Amazing!',
    'Best pilot in town!',
    'Like butter!',
    "You're a pro!",
    'First class!',
  ],
  thanks: ['Thanks!', 'Cheers!', 'Not bad.', 'Okie dokie.', 'Appreciate it.', 'See ya!', 'Have a good one.'],
  thanksButLate: [
    'Finally…',
    'Took you long enough.',
    'Never again.',
    'Whatever.',
    'I missed my meeting.',
    'Faster next time.',
    'My watch stopped waiting.',
  ],
  thanksButBumpy: [
    'My coffee went everywhere…',
    'I think I bit my tongue.',
    'Smoother next time?',
    'My chiropractor thanks you.',
    'Need a seatbelt in here.',
    'My spine!',
    'Rough crowd today.',
  ],
  hit: ['Ow!!', 'Hey!!', 'Watch it!', 'D-OH!', 'My foot!', 'Watch the bumper!', 'Oof!'],
  rough: ['Whoa!', 'Easy!', 'My coffee!', 'Careful!', 'Watch the walls!', 'My neck!', 'Ouch!', 'Yikes!'],
  late: [
    "I'm going to be late!",
    'Any time now…',
    'Is this the scenic route?',
    'I could have hitchhiked faster.',
    'Tick tock!',
    'Step on it!',
    'Any decade now…',
  ],
  wrongPad: ["This isn't pad {pad}!", 'Wrong stop!', 'Hey, I said pad {pad}!', 'Close, try pad {pad}!'],
  full: ["You're full!", 'No room? Come back!', "I'll wait…", 'No room? Bummer.', 'Next cab then!'],
  otherCab: ['Sorry, called the other cab!', 'Already got a ride!', 'Too slow, pal!', 'They beat you to it!'],
  incoming: [
    'Incoming!',
    'Look out!',
    'Smoke in the air!',
    'Missile!',
    'Bogey on our tail!',
    'Heads up!',
    'Evasive action!',
    'Hard left! No, right!',
  ],
  playerFired: [
    'Whoa, you have missiles?!',
    "Get 'em!",
    'Is that street legal?!',
    'Remind me to tip well…',
    'Easy on the trigger!',
    "Show 'em who's boss!",
  ],
  missileHit: [
    "We're hit!",
    'Was that a missile?!',
    'Are we on fire?!',
    "I didn't sign up for this!",
    'My ears are ringing!',
    'Tell my mom I love her!',
  ],
  hullCritical: ['Let me out!', 'Pull over!', 'This cab is toast!', 'Mayday!', 'Is that smoke?!'],
  lowFuel: ['Are we low on gas?', 'Running on fumes?', 'Hit a gas station!', "We're gonna make it, right?"],
  outOfFuel: ['Why did the engine stop?!', 'Are we gliding?!', "Tell me we're landing!", 'Uh… engines?!'],
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
