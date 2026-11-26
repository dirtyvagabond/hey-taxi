/**
 * JSON encoding for saves that round-trips what plain JSON would lose: typed arrays come back
 * as the same typed array, and non-finite numbers (Infinity, NaN) and -0 survive.
 */

const TYPED = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
} as const;
type TypedName = keyof typeof TYPED;

const TAG = '$t';

export function encode(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string) {
    // `this[key]` is the raw value (before toJSON), so typed arrays are still recognizable.
    const raw = key === '' ? value : this[key];
    if (ArrayBuffer.isView(raw) && !(raw instanceof DataView)) {
      return { [TAG]: raw.constructor.name, v: Array.from(raw as unknown as ArrayLike<number>, num) };
    }
    if (typeof raw === 'number') return num(raw);
    if (raw instanceof Map || raw instanceof Set) throw new Error(`can't save a ${raw.constructor.name} (at "${key}")`);
    return raw;
  });
}

export function decode<T = unknown>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && TAG in v) {
      const tagged = v as { [TAG]: string; v: unknown };
      if (tagged[TAG] === 'num') return unnum(tagged.v as string);
      const Ctor = TYPED[tagged[TAG] as TypedName];
      if (!Ctor) throw new Error(`unknown typed array "${tagged[TAG]}" in save`);
      return Ctor.from((tagged.v as (number | { [TAG]: string; v: string })[]).map((x) => (typeof x === 'number' ? x : unnum(x.v))));
    }
    return v;
  }) as T;
}

/** Numbers JSON can't hold become tagged strings. */
function num(n: number): number | { [TAG]: 'num'; v: string } {
  if (Number.isFinite(n) && !Object.is(n, -0)) return n;
  return { [TAG]: 'num', v: Object.is(n, -0) ? '-0' : String(n) };
}

function unnum(s: string): number {
  return s === '-0' ? -0 : Number(s);
}
