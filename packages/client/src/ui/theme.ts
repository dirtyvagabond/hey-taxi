/**
 * Shared UI design tokens, formatters, DOM helper, and base CSS variables used across
 * all HTML overlays (Lobby, World Overview, Server Review, Settings) and the Pixi HUD.
 */
import type { CrashReason } from '@hey-taxi/sim';

/** Numeric RGB palette for Pixi canvas rendering. */
export const PALETTE = {
  bg: 0x05070f,
  barBg: 0x070a18,
  surface: 0x0b0f24,
  surfaceAlt: 0x0f1530,
  surfaceRaised: 0x1c2244,
  border: 0x2c3a6e,
  borderSubtle: 0x2b3260,
  text: 0xe6ebff,
  dim: 0x8a93b8,
  info: 0x39d0ff,
  good: 0x6dff8a,
  warn: 0xffe066,
  bad: 0xff5c5c,
  gold: 0xffc83d,
  teleport: 0xb48cff,
  rival: 0xff6fae,
} as const;

export const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Format integer cents as currency with a proper minus sign (e.g. "$12.50", "−$5.00"). */
export const money = (cents: number): string => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Format elapsed seconds as `m:ss`, or `h:mm:ss` once >= 1 hour. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export const CRASH_CAUSES: Record<CrashReason, string> = {
  body: 'Hull impact',
  gearUp: 'Landing gear not down',
  hardLanding: 'Landed too hard',
  badFooting: 'Missed the ledge',
  missile: 'Hit by a missile',
  outOfFuel: 'Out of fuel',
  selfDestruct: 'Self-destructed',
};

/** Sentence-case crash cause (for Review tables and summaries). */
export const causeLabel = (cause: string): string => CRASH_CAUSES[cause as CrashReason] ?? cause;

/** ALL-CAPS crash cause (for HUD crash flashes and cards). */
export const causeCaps = (cause: string): string => causeLabel(cause).toUpperCase();

/** A lost taxi's cause, naming whose missile it was (or who it collided with). */
export function causeOf(o: { cause: string; byName?: string }): string {
  if (!o.byName) return causeLabel(o.cause);
  return o.cause === 'missile'
    ? `Hit by ${o.byName}'s missile`
    : `${causeLabel(o.cause)} (collided with ${o.byName})`;
}

/** Build an HTML element: el('div.cls1.cls2', { attrs }, ...children). */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.') as [K, ...string[]];
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== false && c !== undefined) node.append(c);
  return node;
}

const THEME_CSS = `
:root {
  --tx-bg: ${hex(PALETTE.bg)};
  --tx-bar-bg: ${hex(PALETTE.barBg)};
  --tx-surface: ${hex(PALETTE.surface)};
  --tx-surface-alt: ${hex(PALETTE.surfaceAlt)};
  --tx-surface-raised: ${hex(PALETTE.surfaceRaised)};
  --tx-border: ${hex(PALETTE.border)};
  --tx-border-subtle: #1e264a;
  --tx-text: ${hex(PALETTE.text)};
  --tx-dim: ${hex(PALETTE.dim)};
  --tx-info: ${hex(PALETTE.info)};
  --tx-good: ${hex(PALETTE.good)};
  --tx-warn: ${hex(PALETTE.warn)};
  --tx-bad: ${hex(PALETTE.bad)};
  --tx-gold: ${hex(PALETTE.gold)};
  --tx-teleport: ${hex(PALETTE.teleport)};
  --tx-font: ${FONT_STACK};
}
.tx-btn {
  font: inherit;
  color: var(--tx-text);
  background: var(--tx-surface-raised);
  border: 1px solid var(--tx-border);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.tx-btn:hover:not(:disabled) { border-color: var(--tx-info); color: #ffffff; }
.tx-btn:disabled { opacity: 0.45; cursor: default; }
.tx-btn.primary { background: var(--tx-info); color: var(--tx-bg); border-color: var(--tx-info); font-weight: 700; }
.tx-btn.primary:hover:not(:disabled) { background: #6de0ff; color: var(--tx-bg); }
.tx-btn.danger { color: #ff8c8c; border-color: #4a2334; background: #1f101a; }
.tx-btn.danger:hover:not(:disabled) { border-color: var(--tx-bad); color: var(--tx-bad); }
.tx-btn.danger.solid, .tx-btn.danger.confirm { background: var(--tx-bad); color: var(--tx-bg); border-color: var(--tx-bad); font-weight: 700; }
.tx-btn.warn { background: var(--tx-warn); color: var(--tx-bg); border-color: var(--tx-warn); font-weight: 700; }
`;

/** Inject the shared CSS variables and base utility classes into <head> once. */
export function ensureTheme(): void {
  if (document.getElementById('tx-theme-style')) return;
  document.head.append(el('style', { id: 'tx-theme-style' }, THEME_CSS));
}
