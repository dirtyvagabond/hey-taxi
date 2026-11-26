/**
 * A server's financial ledger. Every balance change in the simulation arrives as a `ledger`
 * event and becomes one numbered entry here. Amounts and balances are integer cents.
 *
 * Player taxis share their owning account's wallet (`accountId`), so balances persist across
 * taxi deaths; NPC taxis each have their own wallet (`taxiId`). For each wallet, the amounts
 * sum to its balance, and each entry's balance follows from the previous one.
 */
import type { LedgerCategory } from '@hey-taxi/sim';

export interface LedgerEntry {
  /** Unique, increasing within a server. */
  seq: number;
  gameId: string;
  /** Owning player account ID (null/undefined for NPC taxis). */
  accountId?: string | null;
  taxiId: string;
  /** Where it happened (the level/locale ID). */
  locale: string;
  /** World-wide simulation tick (60 per second of play). */
  tick: number;
  category: LedgerCategory;
  /** Signed cents: positive = credit, negative = debit. Zero for history entries. */
  amount: number;
  /** The wallet's balance after this entry (cents). */
  balance: number;
  /** What triggered it, e.g. "passenger:12", "store:gas", "crash:missile". */
  ref: string;
}

export type NewEntry = Omit<LedgerEntry, 'seq' | 'gameId'>;

export class LedgerError extends Error {}

export function walletKeyOf(e: { accountId?: string | null; taxiId: string }): string {
  return e.accountId ? `acct:${e.accountId}` : e.taxiId;
}

export function accountWalletKey(accountId: string): string {
  return `acct:${accountId}`;
}

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  private balances = new Map<string, number>();
  private nextSeq = 1;

  constructor(readonly gameId: string) {}

  /** Record an entry. Its balance must follow from the wallet's previous balance. */
  record(e: NewEntry): LedgerEntry {
    if (!Number.isInteger(e.amount) || !Number.isInteger(e.balance)) {
      throw new LedgerError(`ledger amounts are integer cents: ${JSON.stringify(e)}`);
    }
    const key = walletKeyOf(e);
    const before = this.balances.get(key) ?? 0;
    if (before + e.amount !== e.balance) {
      throw new LedgerError(
        `ledger out of balance for ${key} (${e.taxiId}): ${before} + ${e.amount} ≠ ${e.balance} (${e.category}, ${e.ref})`,
      );
    }
    const entry: LedgerEntry = { seq: this.nextSeq++, gameId: this.gameId, ...e };
    this.entries.push(entry);
    this.balances.set(key, e.balance);
    return entry;
  }

  /** A server-side correction that brings a wallet's balance to `target`. */
  adjustTo(
    taxiId: string,
    target: number,
    locale: string,
    tick: number,
    ref: string,
    accountId: string | null = null,
  ): void {
    const key = accountId ? accountWalletKey(accountId) : taxiId;
    const amount = target - this.balanceOfKey(key);
    if (amount !== 0) {
      this.record({ accountId, taxiId, locale, tick, category: 'adjustment', amount, balance: target, ref });
    }
  }

  /** Current balance in cents for an NPC taxi ID or wallet key, or 0 if no entries. */
  balanceOf(taxiIdOrKey: string): number {
    return this.balances.get(taxiIdOrKey) ?? 0;
  }

  /** Current balance in cents for a player account, or 0 if no entries. */
  balanceOfAccount(accountId: string): number {
    return this.balances.get(accountWalletKey(accountId)) ?? 0;
  }

  private balanceOfKey(key: string): number {
    return this.balances.get(key) ?? 0;
  }

  hasAccount(taxiIdOrKey: string): boolean {
    return this.balances.has(taxiIdOrKey);
  }

  hasPlayerAccount(accountId: string): boolean {
    return this.balances.has(accountWalletKey(accountId));
  }

  /** All wallets with entries, and their balances. */
  accounts(): Record<string, number> {
    return Object.fromEntries(this.balances);
  }

  /**
   * Wallets whose live balance disagrees with the ledger (should always be empty).
   * Pass `accountBalances` for player accounts; `taxis` checks NPCs (and any taxis without an accountId).
   */
  mismatches(
    taxis: readonly { id: string; cents: number; npc?: boolean }[],
    accountBalances?: Readonly<Record<string, number>>,
  ): string[] {
    const off: string[] = [];
    for (const t of taxis) {
      if (accountBalances && t.npc === false) continue;
      if (this.hasAccount(t.id) && this.balanceOf(t.id) !== t.cents) off.push(t.id);
    }
    if (accountBalances) {
      for (const [accountId, cents] of Object.entries(accountBalances)) {
        if (this.hasPlayerAccount(accountId) && this.balanceOfAccount(accountId) !== cents) {
          off.push(`account:${accountId}`);
        }
      }
    }
    return off;
  }
}
