// Save-file worker: all SQLite I/O happens here, off the simulation thread. Requests arrive
// as messages and are handled strictly one at a time, in order, so saves can't race.
//
// Two kinds of databases:
// 1. accounts.sqlite — global player accounts:
//      accounts(account_id, name, name_lower, created_at, last_seen_at, skin, color)
// 2. servers/<serverId>.sqlite — one database file per persistent server:
//      meta(key, value)                 save version, server ID, name, status, timestamps, summary
//      checkpoint(id=1, tick, …, state) the latest committed snapshot (JSON)
//      ledger(seq, account_id, …)       every ledger entry, in order
// A checkpoint and the ledger entries through its tick are committed in one transaction.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parentPort } from 'node:worker_threads';

const SERVER_SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE checkpoint (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tick INTEGER NOT NULL,
    ledger_seq INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    state TEXT NOT NULL
  );
  CREATE TABLE ledger (
    seq INTEGER PRIMARY KEY,
    account_id TEXT,
    taxi_id TEXT NOT NULL,
    locale TEXT NOT NULL,
    tick INTEGER NOT NULL,
    category TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance INTEGER NOT NULL,
    ref TEXT NOT NULL
  );
  CREATE INDEX ledger_taxi ON ledger (taxi_id, seq);
  CREATE INDEX ledger_account ON ledger (account_id, seq);
`;

const ACCOUNTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_lower TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    skin TEXT,
    color INTEGER
  );
`;

const TAG = '$t';
function encodeNum(n) {
  if (Number.isFinite(n) && !Object.is(n, -0)) return n;
  return { [TAG]: 'num', v: Object.is(n, -0) ? '-0' : String(n) };
}
/** Mirror of codec.ts encode() so snapshots can be serialized off the simulation thread. */
function encodeState(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, function (key) {
    const raw = key === '' ? value : this[key];
    if (ArrayBuffer.isView(raw) && !(raw instanceof DataView)) {
      return { [TAG]: raw.constructor.name, v: Array.from(raw, encodeNum) };
    }
    if (typeof raw === 'number') return encodeNum(raw);
    if (raw instanceof Map || raw instanceof Set) throw new Error(`can't save a ${raw.constructor.name} (at "${key}")`);
    return raw;
  });
}

const SERVER_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;';
const ACCOUNTS_PRAGMAS = 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;';

/** Open databases by file (kept open for active servers and accounts). */
const open = new Map();

function closeDb(d) {
  try {
    d.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Best-effort WAL compaction on close.
  }
  d.close();
}

function db(file) {
  let d = open.get(file);
  if (!d) {
    if (!existsSync(file)) throw new Error(`save file not found: ${file}`);
    d = new DatabaseSync(file);
    d.exec(SERVER_PRAGMAS);
    open.set(file, d);
  }
  return d;
}

function accountsDb(file) {
  let d = open.get(file);
  if (!d) {
    mkdirSync(join(file, '..'), { recursive: true });
    d = new DatabaseSync(file);
    d.exec(ACCOUNTS_PRAGMAS);
    d.exec(ACCOUNTS_SCHEMA);
    open.set(file, d);
  }
  return d;
}

function rowToAccount(r) {
  return {
    accountId: r.account_id,
    name: r.name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    skin: r.skin ?? null,
    color: r.color === null || r.color === undefined ? null : Number(r.color),
  };
}

function inTransaction(d, fn) {
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

function writeMeta(d, meta) {
  const put = d.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(meta)) put.run(k, typeof v === 'string' ? v : JSON.stringify(v));
}

function insertEntries(d, entries) {
  const ins = d.prepare(
    'INSERT OR IGNORE INTO ledger (seq, account_id, taxi_id, locale, tick, category, amount, balance, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const e of entries) {
    ins.run(e.seq, e.accountId ?? null, e.taxiId, e.locale, e.tick, e.category, e.amount, e.balance, e.ref);
  }
}

/** The ledger must end exactly at the snapshot's last entry: nothing missing, nothing extra. */
function checkLedgerEnd(d, ledgerSeq) {
  const { n, last } = d.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS last FROM ledger').get();
  if (last !== ledgerSeq || n !== ledgerSeq) {
    throw new Error(`ledger gap: saved entries end at ${last} (${n} rows) but the checkpoint expects ${ledgerSeq}`);
  }
}

const ops = {
  // ── Accounts ─────────────────────────────────────────────────────────────────

  accountsList({ file }) {
    const d = accountsDb(file);
    return d.prepare('SELECT account_id, name, created_at, last_seen_at, skin, color FROM accounts ORDER BY last_seen_at DESC').all().map(rowToAccount);
  },

  accountsGet({ file, accountId }) {
    const d = accountsDb(file);
    const row = d.prepare('SELECT account_id, name, created_at, last_seen_at, skin, color FROM accounts WHERE account_id = ?').get(accountId);
    return row ? rowToAccount(row) : null;
  },

  accountsCreateOrSelect({ file, accountId, name }) {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (clean.length < 1 || clean.length > 24) {
      throw new Error('Account name must be 1–24 characters');
    }
    const lower = clean.toLowerCase();
    const now = new Date().toISOString();
    const d = accountsDb(file);
    return inTransaction(d, () => {
      const existing = d
        .prepare('SELECT account_id, name, created_at, last_seen_at, skin, color FROM accounts WHERE name_lower = ?')
        .get(lower);
      if (existing) {
        d.prepare('UPDATE accounts SET last_seen_at = ? WHERE account_id = ?').run(now, existing.account_id);
        return rowToAccount({ ...existing, last_seen_at: now });
      }
      d.prepare(
        'INSERT INTO accounts (account_id, name, name_lower, created_at, last_seen_at, skin, color) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
      ).run(accountId, clean, lower, now, now);
      return { accountId, name: clean, createdAt: now, lastSeenAt: now, skin: null, color: null };
    });
  },

  accountsTouch({ file, accountId, skin, color }) {
    const d = accountsDb(file);
    const now = new Date().toISOString();
    if (skin !== undefined || color !== undefined) {
      d.prepare('UPDATE accounts SET last_seen_at = ?, skin = COALESCE(?, skin), color = ? WHERE account_id = ?').run(
        now,
        skin ?? null,
        color === undefined ? null : color,
        accountId,
      );
    } else {
      d.prepare('UPDATE accounts SET last_seen_at = ? WHERE account_id = ?').run(now, accountId);
    }
    const row = d.prepare('SELECT account_id, name, created_at, last_seen_at, skin, color FROM accounts WHERE account_id = ?').get(accountId);
    return row ? rowToAccount(row) : null;
  },

  // ── Servers ──────────────────────────────────────────────────────────────────

  /** New server: create its file and commit the initial record. */
  create({ file, meta, tick, ledgerSeq, reason, state, entries }) {
    if (existsSync(file)) throw new Error(`server save file already exists: ${file}`);
    const encoded = encodeState(state);
    mkdirSync(join(file, '..'), { recursive: true });
    const d = new DatabaseSync(file);
    d.exec(SERVER_PRAGMAS);
    open.set(file, d);
    inTransaction(d, () => {
      d.exec(SERVER_SCHEMA);
      writeMeta(d, meta);
      insertEntries(d, entries);
      checkLedgerEnd(d, ledgerSeq);
      d.prepare('INSERT INTO checkpoint (id, tick, ledger_seq, saved_at, reason, state) VALUES (1, ?, ?, ?, ?, ?)').run(
        tick,
        ledgerSeq,
        new Date().toISOString(),
        reason,
        encoded,
      );
    });
    return { tick };
  },

  /** Commit a snapshot and the ledger entries since the last one, together. */
  checkpoint({ file, meta, tick, ledgerSeq, reason, state, entries }) {
    const encoded = encodeState(state);
    const d = db(file);
    inTransaction(d, () => {
      const prev = d.prepare('SELECT tick FROM checkpoint WHERE id = 1').get();
      if (prev && prev.tick > tick) throw new Error(`stale checkpoint (tick ${tick} < saved ${prev.tick})`);
      insertEntries(d, entries);
      checkLedgerEnd(d, ledgerSeq);
      d.prepare('UPDATE checkpoint SET tick = ?, ledger_seq = ?, saved_at = ?, reason = ?, state = ? WHERE id = 1').run(
        tick,
        ledgerSeq,
        new Date().toISOString(),
        reason,
        encoded,
      );
      writeMeta(d, meta);
    });
    return { tick };
  },

  /** Every server in the folder: its metadata, or why it can't be read. */
  list({ dir }) {
    if (!existsSync(dir)) return [];
    const games = [];
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sqlite'))) {
      const file = join(dir, name);
      try {
        const d = open.get(file) ?? new DatabaseSync(file, { readOnly: true });
        try {
          const meta = Object.fromEntries(d.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
          const cp = d.prepare('SELECT tick, saved_at FROM checkpoint WHERE id = 1').get();
          games.push({ file, meta, tick: cp?.tick ?? null, savedAt: cp?.saved_at ?? null });
        } finally {
          if (!open.has(file)) d.close();
        }
      } catch (err) {
        games.push({ file, error: String(err?.message ?? err) });
      }
    }
    return games;
  },

  /** A server's latest checkpoint and its full ledger. */
  load({ file }) {
    const d = db(file);
    const meta = Object.fromEntries(d.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
    const cp = d.prepare('SELECT tick, ledger_seq, state FROM checkpoint WHERE id = 1').get();
    if (!cp) throw new Error('no checkpoint in save file');
    const entries = d
      .prepare('SELECT seq, account_id, taxi_id, locale, tick, category, amount, balance, ref FROM ledger WHERE seq <= ? ORDER BY seq')
      .all(cp.ledger_seq)
      .map((r) => ({
        seq: r.seq,
        gameId: meta.serverId,
        accountId: r.account_id ?? null,
        taxiId: r.taxi_id,
        locale: r.locale,
        tick: r.tick,
        category: r.category,
        amount: r.amount,
        balance: r.balance,
        ref: r.ref,
      }));
    return { meta, tick: cp.tick, ledgerSeq: cp.ledger_seq, state: cp.state, entries };
  },

  /** Delete a server's SQLite files (main, WAL, SHM). */
  delete({ file }) {
    open.get(file)?.close();
    open.delete(file);
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${file}${suffix}`;
      if (existsSync(p)) rmSync(p, { force: true });
    }
    return null;
  },

  close({ file }) {
    const d = open.get(file);
    open.delete(file);
    if (d) closeDb(d);
    return null;
  },

  closeAll() {
    const dbs = [...open.values()];
    open.clear();
    for (const d of dbs) closeDb(d);
    return null;
  },
};

parentPort.on('message', ({ id, op, args }) => {
  try {
    const fn = ops[op];
    if (!fn) throw new Error(`unknown save operation "${op}"`);
    parentPort.postMessage({ id, ok: true, result: fn(args) });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
});
