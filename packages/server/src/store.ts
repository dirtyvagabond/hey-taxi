/**
 * Persistent storage on the server side:
 * - Global player accounts in `<dir>/accounts.sqlite`
 * - One SQLite database per persistent server in `<dir>/servers/<serverId>.sqlite`
 *
 * All SQLite I/O runs in a worker thread (store-worker.mjs) so saving never blocks simulation ticks.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { LedgerEntry } from './ledger';
import type { Account } from '@hey-taxi/sim/protocol';

/** Shown in the Server Browser and Server Review. */
export interface GameMeta {
  saveVersion: string;
  serverId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** running | suspended */
  status: string;
  /** JSON summary: worldTick, players map (per-account balance, locale, taxisLost, destroyed). */
  summary: string;
}

export interface ListedGame {
  file: string;
  meta?: Partial<GameMeta>;
  tick?: number | null;
  savedAt?: string | null;
  error?: string;
}

export interface LoadedGame {
  meta: Partial<GameMeta>;
  tick: number;
  ledgerSeq: number;
  /** Encoded GameSave (see codec.ts). */
  state: string;
  entries: LedgerEntry[];
}

export interface CheckpointArgs {
  meta: Partial<GameMeta>;
  tick: number;
  ledgerSeq: number;
  reason: string;
  /** Pre-encoded JSON string or raw GameSave object (encoded off-thread in store-worker.mjs). */
  state: unknown;
  /** Ledger entries not yet committed, oldest first. */
  entries: LedgerEntry[];
}

const DEFAULT_CALL_TIMEOUT_MS = 15_000;

/** The worker sits next to this file (src/ in development, the release folder in production). */
function workerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, 'store-worker.mjs');
  if (!existsSync(file)) throw new Error(`save worker missing: ${file}`);
  return file;
}

export class SaveStore {
  private worker: Worker | null = null;
  private nextId = 1;
  private waiting = new Map<
    number,
    { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }
  >();
  private closed = false;
  private readonly callTimeoutMs: number;

  constructor(readonly dir: string, callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
    this.callTimeoutMs = callTimeoutMs;
    this.spawnWorker();
  }

  private spawnWorker(): Worker {
    const worker = new Worker(workerPath());
    this.worker = worker;
    worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      clearTimeout(w.timer);
      if (msg.ok) w.resolve(msg.result);
      else w.reject(new Error(msg.error));
    });
    const fail = (err: Error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const w of this.waiting.values()) {
        clearTimeout(w.timer);
        w.reject(err);
      }
      this.waiting.clear();
    };
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`save worker stopped (exit ${code})`)));
    return worker;
  }

  get serversDir(): string {
    return join(this.dir, 'servers');
  }

  get accountsFile(): string {
    return join(this.dir, 'accounts.sqlite');
  }

  fileFor(serverId: string): string {
    return join(this.serversDir, `${serverId}.sqlite`);
  }

  // ── Accounts ─────────────────────────────────────────────────────────────────

  listAccounts(): Promise<Account[]> {
    return this.call('accountsList', { file: this.accountsFile });
  }

  getAccount(accountId: string): Promise<Account | null> {
    return this.call('accountsGet', { file: this.accountsFile, accountId });
  }

  createOrSelectAccount(name: string): Promise<Account> {
    return this.call('accountsCreateOrSelect', {
      file: this.accountsFile,
      accountId: randomUUID(),
      name,
    });
  }

  touchAccount(accountId: string, prefs?: { skin?: string; color?: number | null }): Promise<Account | null> {
    return this.call('accountsTouch', {
      file: this.accountsFile,
      accountId,
      ...(prefs ? { skin: prefs.skin, color: prefs.color } : {}),
    });
  }

  // ── Servers ──────────────────────────────────────────────────────────────────

  create(serverId: string, args: CheckpointArgs): Promise<{ tick: number }> {
    return this.call('create', { file: this.fileFor(serverId), ...args });
  }

  checkpoint(serverId: string, args: CheckpointArgs): Promise<{ tick: number }> {
    return this.call('checkpoint', { file: this.fileFor(serverId), ...args });
  }

  list(): Promise<ListedGame[]> {
    return this.call('list', { dir: this.serversDir });
  }

  load(file: string): Promise<LoadedGame> {
    return this.call('load', { file });
  }

  delete(serverId: string): Promise<null> {
    return this.call('delete', { file: this.fileFor(serverId) });
  }

  close(serverId: string): Promise<null> {
    return this.call('close', { file: this.fileFor(serverId) });
  }

  /** Waits for every queued write, then closes all files and stops the worker. */
  async shutdown(): Promise<void> {
    if (this.closed) return;
    const worker = this.worker;
    try {
      if (worker) await this.call('closeAll', {});
    } finally {
      this.closed = true;
      this.worker = null;
      for (const w of this.waiting.values()) {
        clearTimeout(w.timer);
        w.reject(new Error('save store shut down'));
      }
      this.waiting.clear();
      if (worker) await worker.terminate();
    }
  }

  private call<T>(op: string, args: object): Promise<T> {
    if (this.closed) return Promise.reject(new Error('save store is closed'));
    const worker = this.worker ?? this.spawnWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const w = this.waiting.get(id);
        if (!w) return;
        this.waiting.delete(id);
        const err = new Error(`save worker timed out on "${op}" after ${this.callTimeoutMs}ms`);
        w.reject(err);
        // Terminate the hung worker so the next call respawns a clean one.
        if (this.worker === worker) {
          this.worker = null;
          for (const other of this.waiting.values()) {
            clearTimeout(other.timer);
            other.reject(err);
          }
          this.waiting.clear();
          void worker.terminate().catch(() => null);
        }
      }, this.callTimeoutMs);
      timer.unref?.();
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      worker.postMessage({ id, op, args });
    });
  }
}
