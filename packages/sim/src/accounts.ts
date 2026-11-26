/**
 * Accounting: the only way a taxi's balance changes. Balances are integer cents. Every change
 * emits a `ledger` event (category, signed amount, resulting balance, and what caused it); the
 * server turns those into its persistent ledger. Zero-amount entries record history (e.g. a
 * taxi destroyed) without moving money.
 */
import type { SimEvent, SimState, Taxi } from './sim';

export type LedgerCategory =
  /** Starting funds of a new taxi. */
  | 'opening'
  /** Base fare for a delivered passenger (stored separately from the tip). */
  | 'fare'
  | 'tip'
  /** Store purchases. */
  | 'gas'
  | 'missile'
  | 'flare'
  | 'repair'
  /** Penalty for knocking over a passenger. */
  | 'passengerHit'
  /** Server-side correction (e.g. a restarted level rolls balances back). */
  | 'adjustment'
  /** History: the taxi was destroyed (no money moves). */
  | 'destroyed'
  /** History: a replacement taxi was issued (no money moves; account keeps its balance). */
  | 'spawn'
  /** History: the taxi teleported to another locale (no money moves; travel is free). */
  | 'transfer';

/** Dollars (config prices, fares) → integer cents. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Change a taxi's balance by `amount` cents (negative = debit) and record why. `ref` names
 * the triggering event, e.g. "passenger:12" or "store:missile".
 */
export function post(
  s: SimState,
  t: Taxi,
  category: LedgerCategory,
  amount: number,
  ref: string,
  ev: SimEvent[],
): void {
  if (!Number.isInteger(amount)) throw new Error(`ledger amounts are integer cents (got ${amount})`);
  t.cents += amount;
  ev.push({ type: 'ledger', taxiId: t.id, tick: s.tick, category, amount, balance: t.cents, ref });
}
