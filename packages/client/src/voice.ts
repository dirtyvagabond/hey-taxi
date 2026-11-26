/**
 * Procedural C64-style passenger voice synthesizer (zero audio assets).
 *
 * Uses Mark Barton's 1982 SAM architecture from first principles:
 *  - Glottal-reset additive formants (`A1*sin(φ1) + A2*sin(φ2) + A3*wave(φ3)`), resetting
 *    all three formant phases at every pitch period (`sr / F0`) for crisp harmonic combs.
 *  - 10 ms coarticulation frames with rank-ordered consonant locus sweeps (`P/T/K/B/D/G`).
 *  - 16-bit LFSR bitstream + 2-pole resonators for unvoiced consonants & pitch-synced
 *    glottal breathiness on female voices.
 *  - 4-bit MOS 6581 SID `$D418` volume-register quantization + R-2R DAC curve & CRT rolloff.
 */
import type { CommentCategory } from './dialogue';

interface PhonemeDef {
  readonly f?: readonly [number, number, number];
  readonly a?: readonly [number, number, number];
  readonly d?: number;
  readonly rank?: number;
  readonly inT?: number;
  readonly outT?: number;
  readonly noise?: number;
  readonly nFreq?: number;
  readonly nBw?: number;
  readonly stop?: number;
  readonly voicedStop?: boolean;
  readonly asp?: number;
  readonly pause?: boolean;
  readonly glide?: readonly [string, string];
  readonly d1?: number;
  readonly d2?: number;
}

const PH: Record<string, PhonemeDef> = {
  // Vowels
  IY: { f: [275, 2290, 3010], a: [0.90, 0.72, 0.36], d: 9, rank: 1, inT: 3, outT: 3 },
  IH: { f: [400, 1990, 2550], a: [0.95, 0.68, 0.30], d: 7, rank: 1, inT: 3, outT: 3 },
  EH: { f: [530, 1840, 2480], a: [1.00, 0.70, 0.30], d: 8, rank: 1, inT: 3, outT: 3 },
  AE: { f: [660, 1720, 2410], a: [1.00, 0.76, 0.32], d: 10, rank: 1, inT: 3, outT: 3 },
  AA: { f: [730, 1090, 2440], a: [1.00, 0.65, 0.25], d: 10, rank: 1, inT: 3, outT: 3 },
  AO: { f: [570, 840, 2410], a: [1.00, 0.60, 0.22], d: 10, rank: 1, inT: 3, outT: 3 },
  AH: { f: [640, 1190, 2390], a: [0.98, 0.62, 0.24], d: 8, rank: 1, inT: 3, outT: 3 },
  UH: { f: [440, 1020, 2240], a: [0.95, 0.52, 0.20], d: 7, rank: 1, inT: 3, outT: 3 },
  UW: { f: [300, 870, 2240], a: [0.95, 0.45, 0.18], d: 9, rank: 1, inT: 3, outT: 3 },
  ER: { f: [490, 1350, 1690], a: [0.95, 0.65, 0.38], d: 10, rank: 1, inT: 3, outT: 3 },

  // Diphthongs
  EY: { glide: ['EH', 'IY'], d1: 6, d2: 6 },
  AY: { glide: ['AA', 'IY'], d1: 7, d2: 6 },
  OW: { glide: ['AO', 'UW'], d1: 6, d2: 6 },
  AW: { glide: ['AE', 'UW'], d1: 6, d2: 6 },
  OY: { glide: ['AO', 'IY'], d1: 6, d2: 6 },

  // Glides & Liquids
  W: { f: [300, 610, 2200], a: [0.85, 0.42, 0.14], d: 6, rank: 2, inT: 3, outT: 4 },
  Y: { f: [275, 2250, 2950], a: [0.85, 0.65, 0.32], d: 5, rank: 2, inT: 3, outT: 3 },
  L: { f: [360, 1050, 2650], a: [0.85, 0.45, 0.22], d: 6, rank: 2, inT: 3, outT: 3 },
  R: { f: [410, 1280, 1620], a: [0.88, 0.55, 0.35], d: 6, rank: 2, inT: 3, outT: 3 },

  // Nasals
  M: { f: [270, 900, 2150], a: [0.75, 0.16, 0.08], d: 6, rank: 3, inT: 2, outT: 3 },
  N: { f: [270, 1650, 2450], a: [0.75, 0.20, 0.10], d: 6, rank: 3, inT: 2, outT: 3 },
  NG: { f: [270, 2100, 2400], a: [0.75, 0.18, 0.08], d: 7, rank: 3, inT: 2, outT: 3 },

  // Unvoiced Fricatives
  HH: { f: [500, 1500, 2500], a: [0, 0, 0], d: 6, rank: 2, inT: 1, outT: 2, noise: 0.48, nFreq: 1700, nBw: 0.65 },
  S: { f: [300, 1800, 2700], a: [0, 0, 0], d: 8, rank: 4, inT: 2, outT: 2, noise: 0.80, nFreq: 5400, nBw: 0.25 },
  SH: { f: [300, 1900, 2500], a: [0, 0, 0], d: 8, rank: 4, inT: 2, outT: 2, noise: 0.72, nFreq: 2900, nBw: 0.32 },
  F: { f: [300, 1000, 2300], a: [0, 0, 0], d: 7, rank: 4, inT: 2, outT: 2, noise: 0.42, nFreq: 4400, nBw: 0.55 },
  TH: { f: [300, 1500, 2500], a: [0, 0, 0], d: 6, rank: 4, inT: 2, outT: 2, noise: 0.36, nFreq: 4100, nBw: 0.60 },

  // Voiced Fricatives
  Z: { f: [280, 1750, 2600], a: [0.45, 0.25, 0.12], d: 7, rank: 4, inT: 2, outT: 2, noise: 0.62, nFreq: 5200, nBw: 0.28 },
  V: { f: [280, 1050, 2300], a: [0.50, 0.24, 0.10], d: 6, rank: 4, inT: 2, outT: 2, noise: 0.30, nFreq: 4000, nBw: 0.55 },
  DH: { f: [300, 1550, 2450], a: [0.52, 0.28, 0.12], d: 5, rank: 4, inT: 2, outT: 2, noise: 0.22, nFreq: 3800, nBw: 0.60 },

  // Unvoiced Stops
  P: { f: [240, 780, 2100], a: [0, 0, 0], d: 2, stop: 4, asp: 2, rank: 5, inT: 2, outT: 3, noise: 0.78, nFreq: 950, nBw: 0.50 },
  T: { f: [260, 1800, 2700], a: [0, 0, 0], d: 2, stop: 4, asp: 3, rank: 5, inT: 2, outT: 3, noise: 0.85, nFreq: 4000, nBw: 0.30 },
  K: { f: [260, 2350, 2850], a: [0, 0, 0], d: 2, stop: 4, asp: 3, rank: 5, inT: 2, outT: 3, noise: 0.82, nFreq: 2150, nBw: 0.34 },
  CH: { f: [260, 1900, 2600], a: [0, 0, 0], d: 5, stop: 3, asp: 1, rank: 5, inT: 2, outT: 2, noise: 0.82, nFreq: 3100, nBw: 0.30 },

  // Voiced Stops
  B: { f: [220, 780, 2100], a: [0.45, 0.18, 0.08], d: 2, stop: 3, voicedStop: true, rank: 5, inT: 2, outT: 3, noise: 0.42, nFreq: 900, nBw: 0.50 },
  D: { f: [240, 1780, 2650], a: [0.45, 0.20, 0.10], d: 2, stop: 3, voicedStop: true, rank: 5, inT: 2, outT: 3, noise: 0.45, nFreq: 3600, nBw: 0.35 },
  G: { f: [240, 2300, 2750], a: [0.45, 0.20, 0.10], d: 2, stop: 3, voicedStop: true, rank: 5, inT: 2, outT: 3, noise: 0.45, nFreq: 2100, nBw: 0.38 },
  JH: { f: [250, 1850, 2550], a: [0.45, 0.22, 0.10], d: 5, stop: 3, voicedStop: true, rank: 5, inT: 2, outT: 2, noise: 0.55, nFreq: 2900, nBw: 0.34 },

  // Pauses
  _: { f: [450, 1400, 2400], a: [0, 0, 0], d: 5, rank: 0, inT: 1, outT: 1, pause: true },
  ',': { f: [450, 1400, 2400], a: [0, 0, 0], d: 11, rank: 0, inT: 1, outT: 1, pause: true },
  '.': { f: [450, 1400, 2400], a: [0, 0, 0], d: 15, rank: 0, inT: 1, outT: 1, pause: true },
};

/** Hand-tuned lexicon covering all passenger dialogue lines + pad numbers. */
const LEXICON: Record<string, readonly string[]> = {
  // Hails & core cab words
  hey: ['HH', 'EY*'],
  taxi: ['T', 'AE*', 'K', 'S', 'IY'],
  cab: ['K', 'AE*', 'B'],
  over: ['OW*', 'V', 'ER'],
  here: ['HH', 'IY*', 'R'],
  please: ['P', 'L', 'IY*', 'Z'],
  yoo: ['Y', 'UW*'],
  hoo: ['HH', 'UW*'],
  pad: ['P', 'AE*', 'D'],
  to: ['T', 'UW'],
  and: ['AE', 'N', 'D'],
  step: ['S', 'T', 'EH*', 'P'],
  on: ['AA*', 'N'],
  it: ['IH', 'T'],
  no: ['N', 'OW*'],
  rush: ['R', 'AH*', 'SH'],
  ok: ['OW', 'K', 'EY*'],
  some: ['S', 'AH*', 'M'],
  up: ['AH*', 'P'],

  // Numbers 0–12
  '0': ['Z', 'IH*', 'R', 'OW'],
  zero: ['Z', 'IH*', 'R', 'OW'],
  '1': ['W', 'AH*', 'N'],
  one: ['W', 'AH*', 'N'],
  '2': ['T', 'UW*'],
  two: ['T', 'UW*'],
  '3': ['TH', 'R', 'IY*'],
  three: ['TH', 'R', 'IY*'],
  '4': ['F', 'AO*', 'R'],
  four: ['F', 'AO*', 'R'],
  '5': ['F', 'AY*', 'V'],
  five: ['F', 'AY*', 'V'],
  '6': ['S', 'IH*', 'K', 'S'],
  six: ['S', 'IH*', 'K', 'S'],
  '7': ['S', 'EH*', 'V', 'AH', 'N'],
  seven: ['S', 'EH*', 'V', 'AH', 'N'],
  '8': ['EY*', 'T'],
  eight: ['EY*', 'T'],
  '9': ['N', 'AY*', 'N'],
  nine: ['N', 'AY*', 'N'],
  '10': ['T', 'EH*', 'N'],
  ten: ['T', 'EH*', 'N'],
  '11': ['IH', 'L', 'EH*', 'V', 'AH', 'N'],
  '12': ['T', 'W', 'EH*', 'L', 'V'],

  // Annoyed / hit / rough
  wait: ['W', 'EY*', 'T'],
  come: ['K', 'AH*', 'M'],
  back: ['B', 'AE*', 'K'],
  rude: ['R', 'UW*', 'D'],
  seriously: ['S', 'IH*', 'R', 'IY', 'AH', 'S', 'L', 'IY'],
  ow: ['AW*'],
  watch: ['W', 'AA*', 'CH'],
  whoa: ['W', 'OW*'],
  easy: ['IY*', 'Z', 'IY'],
  my: ['M', 'AY*'],
  coffee: ['K', 'AO*', 'F', 'IY'],
  careful: ['K', 'EH*', 'R', 'F', 'AH', 'L'],
  the: ['DH', 'AH'],
  walls: ['W', 'AO*', 'L', 'Z'],
  neck: ['N', 'EH*', 'K'],

  // Thanks / drop-off
  keep: ['K', 'IY*', 'P'],
  change: ['CH', 'EY*', 'N', 'JH'],
  wow: ['W', 'AW*'],
  smooth: ['S', 'M', 'UW*', 'DH'],
  ride: ['R', 'AY*', 'D'],
  stars: ['S', 'T', 'AA*', 'R', 'Z'],
  thanks: ['TH', 'AE*', 'NG', 'K', 'S'],
  cheers: ['CH', 'IY*', 'R', 'Z'],
  not: ['N', 'AA*', 'T'],
  bad: ['B', 'AE*', 'D'],
  finally: ['F', 'AY*', 'N', 'AH', 'L', 'IY'],
  took: ['T', 'UH*', 'K'],
  you: ['Y', 'UW'],
  long: ['L', 'AO*', 'NG'],
  enough: ['IH', 'N', 'AH*', 'F'],
  never: ['N', 'EH*', 'V', 'ER'],
  again: ['AH', 'G', 'EH*', 'N'],

  // Late / full / rival cab
  im: ['AY*', 'M'],
  going: ['G', 'OW*', 'IH', 'NG'],
  be: ['B', 'IY'],
  late: ['L', 'EY*', 'T'],
  any: ['EH*', 'N', 'IY'],
  time: ['T', 'AY*', 'M'],
  now: ['N', 'AW*'],
  is: ['IH', 'Z'],
  this: ['DH', 'IH', 'S'],
  scenic: ['S', 'IY*', 'N', 'IH', 'K'],
  route: ['R', 'AW*', 'T'],
  ive: ['AY*', 'V'],
  had: ['HH', 'AE*', 'D'],
  marriages: ['M', 'EH*', 'R', 'IH', 'JH', 'IH', 'Z'],
  shorter: ['SH', 'AO*', 'R', 'T', 'ER'],
  than: ['DH', 'AE', 'N'],
  i: ['AY'],
  could: ['K', 'UH', 'D'],
  have: ['HH', 'AE', 'V'],
  hitchhiked: ['HH', 'IH*', 'CH', 'HH', 'AY', 'K', 'T'],
  faster: ['F', 'AE*', 'S', 'T', 'ER'],
  youre: ['Y', 'UH*', 'R'],
  full: ['F', 'UH*', 'L'],
  room: ['R', 'UW*', 'M'],
  ill: ['AY*', 'L'],
  sorry: ['S', 'AA*', 'R', 'IY'],
  called: ['K', 'AO*', 'L', 'D'],
  other: ['AH*', 'DH', 'ER'],
  already: ['AO', 'L', 'R', 'EH*', 'D', 'IY'],
  got: ['G', 'AA*', 'T'],
  a: ['AH'],
};

interface VoiceArchetype {
  readonly pitch: number;
  readonly mouth: number;
  readonly throat: number;
  readonly speed: number;
  readonly damp: number;
  readonly rate: number;
  readonly expr: number;
  readonly shift: number;
  readonly breath: number;
  readonly f3Rect: boolean;
}

/**
 * 4 passenger archetypes indexed by `kind % 4` (2 female, 2 male), built from
 * the locked Male Baritone baseline (kind 3).
 */
const ARCHETYPES: readonly VoiceArchetype[] = [
  // kind 0: Female Alto (Warm)
  { pitch: 168, mouth: 1.10, throat: 1.04, speed: 1.15, damp: 0.46, rate: 9500, expr: 0.95, shift: 1.00, breath: 0.05, f3Rect: false },
  // kind 1: Male Tenor (Snappy)
  { pitch: 110, mouth: 0.98, throat: 0.95, speed: 1.18, damp: 0.26, rate: 8500, expr: 0.85, shift: 0.98, breath: 0.00, f3Rect: true },
  // kind 2: Female Soprano (Bright)
  { pitch: 192, mouth: 1.16, throat: 1.08, speed: 1.20, damp: 0.50, rate: 10500, expr: 1.05, shift: 1.02, breath: 0.06, f3Rect: false },
  // kind 3: Male Baritone (Baseline)
  { pitch: 89, mouth: 0.92, throat: 0.90, speed: 1.15, damp: 0.30, rate: 8000, expr: 0.75, shift: 0.93, breath: 0.00, f3Rect: true },
];

interface MoodMod {
  readonly pitchMul: number;
  readonly speedMul: number;
  readonly exprMul: number;
  readonly dampDelta: number;
}

function moodFor(category: CommentCategory): MoodMod {
  switch (category) {
    case 'thanksBig':
      return { pitchMul: 1.06, speedMul: 1.04, exprMul: 1.30, dampDelta: 0.02 };
    case 'annoyed':
    case 'rough':
    case 'thanksButBumpy':
    case 'hit':
      return { pitchMul: 1.10, speedMul: 1.09, exprMul: 1.20, dampDelta: -0.08 };
    case 'thanksButLate':
    case 'late':
      return { pitchMul: 0.95, speedMul: 0.91, exprMul: 0.42, dampDelta: 0.05 };
    default:
      return { pitchMul: 1.00, speedMul: 1.00, exprMul: 1.00, dampDelta: 0.00 };
  }
}

/** Deterministic `[-1, 1]` hash so a passenger keeps the exact same voice all trip. */
function hashUnit(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x = (x ^ (x >>> 16)) >>> 0;
  return (x / 0xffffffff) * 2 - 1;
}

const DIGRAPHS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['tion', ['SH', 'AH', 'N']],
  ['ch', ['CH']],
  ['sh', ['SH']],
  ['th', ['TH']],
  ['ph', ['F']],
  ['ng', ['NG']],
  ['ck', ['K']],
  ['qu', ['K', 'W']],
  ['ee', ['IY']],
  ['ea', ['IY']],
  ['oo', ['UW']],
  ['ou', ['AW']],
  ['ow', ['OW']],
  ['ay', ['EY']],
  ['ai', ['EY']],
  ['oi', ['OY']],
  ['oy', ['OY']],
  ['ar', ['AA', 'R']],
  ['er', ['ER']],
  ['ir', ['ER']],
  ['ur', ['ER']],
  ['or', ['AO', 'R']],
  ['wh', ['W']],
];

const SINGLES: Record<string, string | readonly string[]> = {
  a: 'AE',
  b: 'B',
  c: 'K',
  d: 'D',
  e: 'EH',
  f: 'F',
  g: 'G',
  h: 'HH',
  i: 'IH',
  j: 'JH',
  k: 'K',
  l: 'L',
  m: 'M',
  n: 'N',
  o: 'AA',
  p: 'P',
  q: 'K',
  r: 'R',
  s: 'S',
  t: 'T',
  u: 'AH',
  v: 'V',
  w: 'W',
  x: ['K', 'S'],
  y: 'IY',
  z: 'Z',
};

function wordToPhonemes(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return [];
  const known = LEXICON[w];
  if (known) return [...known];
  const out: string[] = [];
  let i = 0;
  while (i < w.length) {
    let matched = false;
    for (const [pat, ph] of DIGRAPHS) {
      if (w.startsWith(pat, i)) {
        out.push(...ph);
        i += pat.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = w[i]!;
    if (ch === 'e' && i === w.length - 1 && out.length > 1) {
      i++;
      continue;
    }
    const mapped = SINGLES[ch];
    if (typeof mapped === 'string') out.push(mapped);
    else if (mapped) out.push(...mapped);
    i++;
  }
  return out;
}

function textToPhonemes(text: string): string[] {
  const normalized = text.replace(/…|\.{2,}/g, ',').replace(/-/g, ' ');
  const tokens = normalized.match(/[A-Za-z0-9']+|[,!.?]/g) ?? [];
  const seq: string[] = [];
  for (const tok of tokens) {
    if (tok === ',') seq.push(',');
    else if (tok === '.' || tok === '!' || tok === '?') seq.push('.');
    else {
      const ph = wordToPhonemes(tok);
      if (!ph.length) continue;
      if (seq.length && !['_', ',', '.'].includes(seq[seq.length - 1]!)) seq.push('_');
      seq.push(...ph);
    }
  }
  return seq;
}

interface Frame {
  f1: number;
  f2: number;
  f3: number;
  a1: number;
  a2: number;
  a3: number;
  noise: number;
  nFreq: number;
  nBw: number;
  stressed: boolean;
  pause: boolean;
  f0: number;
}

interface ResolvedSeg {
  key: string;
  f: readonly [number, number, number];
  a: readonly [number, number, number];
  rank: number;
  inT: number;
  outT: number;
  noise: number;
  nFreq: number;
  nBw: number;
  pause: boolean;
  frames: number;
  stressed: boolean;
  startFrame: number;
  endFrame: number;
}

const BACK_VOWELS = new Set(['AA', 'AO', 'AH', 'UH', 'UW', 'W']);

/** MOS 6581 SID `$D418` 4-bit R-2R ladder DAC curve (`0..15` -> `-1..1`). */
const SID_6581_DAC = [
  -1.0, -0.878, -0.742, -0.618, -0.468, -0.342, -0.205, -0.072,
  0.068, 0.202, 0.34, 0.47, 0.612, 0.745, 0.875, 1.0,
] as const;

function makeSeg(key: string, def: PhonemeDef, frames: number, stressed: boolean): ResolvedSeg {
  return {
    key,
    f: def.f ?? [450, 1400, 2400],
    a: def.a ?? [0, 0, 0],
    rank: def.rank ?? 1,
    inT: def.inT ?? 2,
    outT: def.outT ?? 2,
    noise: def.noise ?? 0,
    nFreq: def.nFreq ?? 3000,
    nBw: def.nBw ?? 0.4,
    pause: def.pause === true,
    frames,
    stressed,
    startFrame: 0,
    endFrame: 0,
  };
}

export interface SynthesizedVoice {
  readonly samples: Float32Array;
  readonly sr: number;
  readonly shift: number;
}

export function synthesizePassengerVoice(
  text: string,
  opts: { kind: number; passengerId: number; category: CommentCategory },
): SynthesizedVoice | null {
  const rawSeq = textToPhonemes(text);
  if (!rawSeq.length) return null;

  const idx = ((Math.trunc(opts.kind) % ARCHETYPES.length) + ARCHETYPES.length) % ARCHETYPES.length;
  const arch = ARCHETYPES[idx]!;
  const mood = moodFor(opts.category);

  // Deterministic per-passenger micro-jitter so each rider has their own consistent voice.
  const id = Math.trunc(opts.passengerId);
  const jPitch = hashUnit(id * 17 + 1) * 0.07;
  const jTract = hashUnit(id * 31 + 2) * 0.03;
  const jSpeed = hashUnit(id * 47 + 3) * 0.05;
  const jShift = hashUnit(id * 61 + 4) * 0.03;

  const pitch = arch.pitch * (1 + jPitch) * mood.pitchMul;
  const mouth = arch.mouth * (1 + jTract);
  const throat = arch.throat * (1 + jTract);
  const speed = arch.speed * (1 + jSpeed) * mood.speedMul;
  const damp = Math.max(0, Math.min(0.85, arch.damp + mood.dampDelta));
  const expr = arch.expr * mood.exprMul;
  const shift = arch.shift * (1 + jShift);
  const sr = arch.rate;
  const breathAmt = arch.breath;
  const f3Rect = arch.f3Rect;
  const isHeyTaxi = /^\s*hey,?\s*taxi!?\s*$/i.test(text);
  const isQuestion = text.trim().endsWith('?');
  const isExclamation = text.includes('!');

  // 1. Expand diphthongs, stop closures, bursts & post-stop aspiration into 10 ms segments.
  const segs: ResolvedSeg[] = [];
  let commaSeen = false;
  for (const tok of rawSeq) {
    const stressed = tok.endsWith('*');
    const key = stressed ? tok.slice(0, -1) : tok;
    const def = PH[key];
    if (!def) continue;
    if (key === ',') {
      commaSeen = true;
      // Snappier 80 ms pause inside the signature "Hey, taxi!" callout.
      const pauseFrames = isHeyTaxi ? Math.max(4, Math.round(8 / speed)) : Math.max(4, Math.round((def.d ?? 11) / speed));
      segs.push(makeSeg(key, def, pauseFrames, false));
      continue;
    }
    if (def.glide) {
      const a = PH[def.glide[0]]!;
      const b = PH[def.glide[1]]!;
      const holdMul = isHeyTaxi && !commaSeen ? 1.35 : stressed ? 1.25 : 1;
      segs.push(makeSeg(def.glide[0], a, Math.max(2, Math.round(((def.d1 ?? 6) * holdMul) / speed)), stressed));
      segs.push(makeSeg(def.glide[1], b, Math.max(2, Math.round(((def.d2 ?? 6) * holdMul) / speed)), stressed));
    } else {
      if (def.stop) {
        segs.push(
          makeSeg(
            `${key}_cl`,
            {
              f: def.f,
              a: def.voicedStop ? [0.22, 0.04, 0] : [0, 0, 0],
              rank: def.rank,
              inT: 1,
              outT: 1,
              noise: 0,
            },
            Math.max(2, Math.round(def.stop / speed)),
            false,
          ),
        );
      }
      const baseD = (def.d ?? 6) * (stressed ? 1.28 : 1.0);
      segs.push(makeSeg(key, def, Math.max(1, Math.round(baseD / speed)), stressed));
      if (def.asp) {
        segs.push(
          makeSeg(
            `${key}_asp`,
            {
              f: def.f,
              a: [0, 0, 0],
              rank: 2,
              inT: 1,
              outT: 2,
              noise: 0.42,
              nFreq: (def.nFreq ?? 2500) * 0.72,
              nBw: 0.55,
            },
            Math.max(1, Math.round(def.asp / speed)),
            false,
          ),
        );
      }
    }
  }
  if (!segs.length) return null;

  // Context-sensitive velar locus shift before back vowels.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.key.startsWith('K') || s.key.startsWith('G')) {
      const next = segs.slice(i + 1).find((x) => !x.key.endsWith('_asp') && !x.pause);
      if (next && BACK_VOWELS.has(next.key)) {
        s.f = [s.f[0], 1250, 2350];
      }
    }
  }

  // 2. Build 10 ms frame table & apply rank-ordered consonant locus coarticulation.
  const frames: Frame[] = [];
  for (const s of segs) {
    s.startFrame = frames.length;
    for (let k = 0; k < s.frames; k++) {
      frames.push({
        f1: s.f[0] * throat,
        f2: s.f[1] * mouth,
        f3: s.f[2] * (0.35 + 0.65 * mouth),
        a1: s.a[0],
        a2: s.a[1],
        a3: s.a[2],
        noise: s.noise,
        nFreq: s.nFreq,
        nBw: s.nBw,
        stressed: s.stressed,
        pause: s.pause,
        f0: pitch,
      });
    }
    s.endFrame = frames.length;
  }

  for (let i = 0; i < segs.length - 1; i++) {
    const left = segs[i]!;
    const right = segs[i + 1]!;
    if (left.pause || right.pause) continue;
    const boundary = left.endFrame;
    const lLen = Math.min(left.frames, left.rank >= right.rank ? left.outT : right.inT);
    const rLen = Math.min(right.frames, right.rank >= left.rank ? right.inT : left.outT);
    const total = lLen + rLen;
    if (total < 2) continue;

    const lf = frames[Math.max(0, boundary - lLen)]!;
    const rf = frames[Math.min(frames.length - 1, boundary + rLen - 1)]!;
    const startF = boundary - lLen;
    for (let step = 0; step < total; step++) {
      const fIdx = startF + step;
      if (fIdx < 0 || fIdx >= frames.length) continue;
      const t = (step + 0.5) / total;
      const fr = frames[fIdx]!;
      fr.f1 = lf.f1 + (rf.f1 - lf.f1) * t;
      fr.f2 = lf.f2 + (rf.f2 - lf.f2) * t;
      fr.f3 = lf.f3 + (rf.f3 - lf.f3) * t;
      if ((lf.a1 > 0 && rf.a1 > 0) || step === 0 || step === total - 1) {
        fr.a1 = lf.a1 + (rf.a1 - lf.a1) * t;
        fr.a2 = lf.a2 + (rf.a2 - lf.a2) * t;
        fr.a3 = lf.a3 + (rf.a3 - lf.a3) * t;
      }
    }
  }

  const totalF = Math.max(1, frames.length);
  const pauseIdx = isHeyTaxi ? frames.findIndex((f) => f.pause) : -1;
  for (let i = 0; i < frames.length; i++) {
    const frac = i / totalF;
    let mul: number;
    if (isHeyTaxi && pauseIdx > 0) {
      // Dedicated 2-beat arcade prosody: rising-ringing "HEY!" -> crisp break -> punchy "TAX-i!"
      if (i < pauseIdx) {
        const u = i / Math.max(1, pauseIdx - 1);
        mul = 1.0 + (0.12 + 0.14 * u) * Math.max(0.75, expr);
      } else {
        const after = Math.max(1, frames.length - pauseIdx - 1);
        const u = (i - pauseIdx) / after;
        const stressBump = frames[i]!.stressed ? 0.18 : 0;
        mul = 1.0 + (0.06 - 0.18 * u + stressBump) * Math.max(0.75, expr);
      }
    } else {
      mul = 1.0 + (0.09 - 0.19 * frac) * expr;
      if (frames[i]!.stressed) mul *= 1 + 0.18 * expr;
      if (isExclamation && frac < 0.30) mul *= 1 + 0.11 * expr;
      if (isQuestion && frac > 0.72) mul *= 1 + 0.34 * ((frac - 0.72) / 0.28) * expr;
    }
    frames[i]!.f0 = pitch * mul;
  }

  // 3. Synthesize samples with glottal phase-reset, LFSR consonants, breathy pulse & 6581 DAC.
  const frameSamples = Math.max(1, Math.round(sr * 0.01));
  const totalSamples = Math.max(1, frames.length * frameSamples);
  const out = new Float32Array(totalSamples);

  let phi1 = 0;
  let phi2 = 0;
  let phi3 = 0;
  let glottalPos = 0;
  let lfsr = 0xace1;
  let bp1 = 0;
  let bp2 = 0;
  let breathBp1 = 0;
  let breathBp2 = 0;
  let lpState = 0;
  let hpState = 0;
  let prevIn = 0;

  for (let fIdx = 0; fIdx < frames.length; fIdx++) {
    const fr = frames[fIdx]!;
    const nextFr = frames[Math.min(frames.length - 1, fIdx + 1)]!;
    const base = fIdx * frameSamples;

    const fc = Math.min(sr * 0.44, fr.nFreq);
    const r = Math.max(0.15, Math.min(0.92, 1 - fr.nBw * 0.85));
    const c1 = 2 * r * Math.cos((2 * Math.PI * fc) / sr);
    const c2 = -(r * r);
    const normNoise = (1 - r) * 1.8;

    const bFc = Math.min(sr * 0.42, Math.max(900, fr.f2));
    const bR = 0.62;
    const bC1 = 2 * bR * Math.cos((2 * Math.PI * bFc) / sr);
    const bC2 = -(bR * bR);
    const bNorm = (1 - bR) * 1.6;

    for (let s = 0; s < frameSamples; s++) {
      const u = s / frameSamples;
      const f0 = fr.f0 + (nextFr.f0 - fr.f0) * u;
      const f1 = fr.f1 + (nextFr.f1 - fr.f1) * u;
      const f2 = fr.f2 + (nextFr.f2 - fr.f2) * u;
      const f3 = fr.f3 + (nextFr.f3 - fr.f3) * u;
      const a1 = fr.a1 + (nextFr.a1 - fr.a1) * u;
      const a2 = fr.a2 + (nextFr.a2 - fr.a2) * u;
      const a3 = fr.a3 + (nextFr.a3 - fr.a3) * u;
      const nAmt = fr.noise;

      const period = sr / Math.max(40, f0);
      glottalPos += 1;
      if (glottalPos >= period) {
        glottalPos -= period;
        phi1 = 0;
        phi2 = 0;
        phi3 = 0;
      }
      const glottalFrac = glottalPos / period;

      phi1 += (2 * Math.PI * f1) / sr;
      phi2 += (2 * Math.PI * f2) / sr;
      phi3 += (2 * Math.PI * f3) / sr;

      const w1 = Math.sin(phi1);
      const w2 = Math.sin(phi2);
      const w3 = f3Rect ? (Math.sin(phi3) >= 0 ? 1 : -1) : Math.sin(phi3);
      const env = damp > 0 ? Math.exp(-damp * 3.2 * glottalFrac) : 1.0;
      const voiced = (a1 * w1 + a2 * w2 + a3 * w3) * env * 0.58;

      let unvoiced = 0;
      let breathy = 0;
      if (nAmt > 0.001 || (breathAmt > 0.001 && a1 > 0.1)) {
        const bit = ((lfsr >> 0) ^ (lfsr >> 2) ^ (lfsr >> 3) ^ (lfsr >> 5)) & 1;
        lfsr = (lfsr >> 1) | (bit << 15);
        const rawBit = bit ? 1 : -1;

        if (nAmt > 0.001) {
          const y = rawBit * normNoise + c1 * bp1 + c2 * bp2;
          bp2 = bp1;
          bp1 = y;
          unvoiced = y * nAmt * 0.85;
        } else {
          bp1 *= 0.8;
          bp2 *= 0.8;
        }

        if (breathAmt > 0.001 && a1 > 0.1) {
          const by = rawBit * bNorm + bC1 * breathBp1 + bC2 * breathBp2;
          breathBp2 = breathBp1;
          breathBp1 = by;
          const openPulse = 0.35 + 0.65 * Math.sin(Math.PI * glottalFrac);
          breathy = by * breathAmt * a1 * openPulse * 2.2;
        } else {
          breathBp1 *= 0.8;
          breathBp2 *= 0.8;
        }
      } else {
        bp1 *= 0.8;
        bp2 *= 0.8;
        breathBp1 *= 0.8;
        breathBp2 *= 0.8;
      }

      let sample = Math.tanh((voiced + unvoiced + breathy) * 1.45);
      const nibble = Math.max(0, Math.min(15, Math.round((sample * 0.5 + 0.5) * 15)));
      sample = SID_6581_DAC[nibble]!;

      const hp = 0.94 * (hpState + sample - prevIn);
      prevIn = sample;
      hpState = hp;
      const alphaLp = Math.min(0.85, (2 * Math.PI * 3800) / (sr + 2 * Math.PI * 3800));
      lpState += alphaLp * (hp - lpState);
      out[base + s] = lpState * 0.85;
    }
  }

  const fade = Math.min(48, Math.floor(out.length / 10));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i]! *= g;
    out[out.length - 1 - i]! *= g;
  }

  return { samples: out, sr, shift };
}
