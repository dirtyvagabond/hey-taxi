/**
 * Keeps one persistent server saved: creates its file (and commits the initial record),
 * checkpoints it on a timer and on lifecycle moments, and tracks which ledger entries are
 * committed so a failed write is retried rather than lost or duplicated.
 *
 * Snapshots are captured synchronously (at a tick boundary) and written in order by the
 * store's worker, so a later checkpoint can never be overwritten by an earlier one.
 */
import type { GameSession } from './session';
import type { CheckpointArgs, SaveStore } from './store';

export const CHECKPOINT_INTERVAL_MS = 3000;

export interface SavedPlayerSummary {
  name: string;
  cents: number;
  levelId: string | null;
  taxisLost: number;
  destroyed: boolean;
}

export interface ServerMetaSummary {
  worldTick: number;
  players: Record<string, SavedPlayerSummary>;
}

export class GameSaver {
  /** Ledger entries through this seq are on disk. */
  private committedSeq: number;
  /** Ledger entries through this seq have been sent (possibly not yet committed). */
  private sentSeq: number;
  private inFlight = 0;
  private lastQueuedAt = 0;
  private created: boolean;
  readonly serverId: string;

  constructor(
    private readonly store: SaveStore,
    private readonly session: GameSession,
    /** The server is already on disk (loaded from a save) through this ledger seq. */
    loadedSeq: number | null = null,
  ) {
    this.serverId = session.serverId;
    this.created = loadedSeq !== null;
    this.committedSeq = loadedSeq ?? 0;
    this.sentSeq = this.committedSeq;
  }

  /** Create the save file and commit the initial record. */
  async create(): Promise<boolean> {
    const s = this.session;
    s.awaitingFirstSave = true;
    this.setStatus({ state: 'saving' });
    const args = this.capture('new-server');
    this.inFlight++;
    try {
      await this.store.create(this.serverId, args);
      this.created = true;
      this.committedSeq = Math.max(this.committedSeq, args.ledgerSeq);
      if (this.isCurrent()) {
        s.awaitingFirstSave = false;
        this.setStatus({ state: 'saved', tick: args.tick });
      }
      return true;
    } catch (err) {
      this.sentSeq = this.committedSeq;
      this.setStatus({ state: 'error', message: `Couldn't create the save file: ${(err as Error).message}` });
      return false;
    } finally {
      this.inFlight--;
    }
  }

  /** Checkpoint every few seconds while the server runs (coalesced when a write is already in flight). */
  maybeCheckpoint(now: number): void {
    if (this.inFlight > 0) return;
    if (now - this.lastQueuedAt >= CHECKPOINT_INTERVAL_MS) void this.checkpoint('periodic');
  }

  /**
   * Capture the server now and queue the write. The returned promise settles when it's
   * committed (or failed; failures are shown to the player, never thrown).
   */
  async checkpoint(reason: string): Promise<boolean> {
    if (!this.created) {
      if (this.session.awaitingFirstSave && this.inFlight === 0) return this.create();
      return this.created;
    }
    this.lastQueuedAt = performance.now();
    const args = this.capture(reason);
    this.inFlight++;
    if (this.isCurrent()) this.setStatus({ state: 'saving' });
    try {
      await this.store.checkpoint(this.serverId, args);
      this.committedSeq = Math.max(this.committedSeq, args.ledgerSeq);
      if (this.isCurrent() && this.inFlight === 1) this.setStatus({ state: 'saved', tick: args.tick });
      return true;
    } catch (err) {
      this.sentSeq = this.committedSeq;
      if (this.isCurrent()) this.setStatus({ state: 'error', message: `Save failed: ${(err as Error).message}` });
      return false;
    } finally {
      this.inFlight--;
    }
  }

  private capture(reason: string): CheckpointArgs {
    const s = this.session;
    const save = s.toSaveView();
    const entries = s.ledger.entries.filter((e) => e.seq > this.sentSeq);
    this.sentSeq = save.ledgerSeq;
    const players: Record<string, SavedPlayerSummary> = {};
    for (const [accountId, ps] of Object.entries(save.players)) {
      const levelId = ps.taxiId ? (save.world.taxis[ps.taxiId]?.localeId ?? null) : null;
      players[accountId] = {
        name: ps.name,
        cents: ps.cents,
        levelId,
        taxisLost: ps.deaths.length,
        destroyed: ps.playMode === 'destroyed',
      };
    }
    const summary: ServerMetaSummary = {
      worldTick: save.world.tick,
      players,
    };
    return {
      tick: save.world.tick,
      ledgerSeq: save.ledgerSeq,
      reason,
      // Passed as a raw object; postMessage clones once and store-worker.mjs encodes off-thread.
      state: save,
      entries,
      meta: {
        saveVersion: String(save.saveVersion),
        serverId: save.serverId,
        name: save.serverName,
        createdAt: save.createdAt,
        updatedAt: new Date().toISOString(),
        status: s.mode === 'menu' || reason === 'shutdown' || reason === 'disconnect' ? 'suspended' : 'running',
        summary: JSON.stringify(summary),
      },
    };
  }

  private isCurrent(): boolean {
    return this.session.serverId === this.serverId;
  }

  private setStatus(save: GameSession['save']): void {
    this.session.save = save;
    this.session.statusDirty = true;
  }
}
