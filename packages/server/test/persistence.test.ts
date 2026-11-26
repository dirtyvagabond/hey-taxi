import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Input } from '@hey-taxi/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec';
import { GameHost } from '../src/host';
import { GameSaver } from '../src/saver';
import { GameSession, SaveError, wireSim, type GameSave } from '../src/session';
import { SaveStore } from '../src/store';
import { startedSession, TEST_ACCOUNT } from './helpers';

/** The player stays parked (alive) and fires now and then; rivals keep the world busy. */
const script = (i: number) => (i % 900 === 700 ? Input.FIRE : 0);

function play(s: GameSession, ticks: number, from = 0): void {
  for (let i = from; i < from + ticks && s.running; i++) {
    s.setInput(script(i));
    s.tick();
  }
}

/** Everything that defines the server's state (sim incl. AI memory, flow, ledger). */
function fingerprint(s: GameSession): string {
  return JSON.stringify({
    wire: wireSim(s.sim, s.levelId),
    ai: s.sim.taxis.map((t) => t.ai),
    rng: s.sim.rng,
    mode: s.mode,
    worldTick: s.worldTick,
    ledger: s.ledger.entries,
  });
}

let dir: string;
let stores: SaveStore[] = [];
const newStore = () => {
  const st = new SaveStore(dir);
  stores.push(st);
  return st;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hey-taxi-saves-'));
  stores = [];
});
afterEach(async () => {
  for (const st of stores) await st.shutdown().catch(() => null);
  rmSync(dir, { recursive: true, force: true });
});

/** A host with a started persistent server (initial record committed). */
async function startedHost(seed = 11) {
  const store = newStore();
  const account = await store.createOrSelectAccount(TEST_ACCOUNT.name);
  const session = new GameSession({ seed });
  session.initServer('Main');
  const saver = new GameSaver(store, session);
  await saver.create();
  const host = new GameHost(session, 'test', store);
  host.saver = saver;
  host.activeAccount = account;
  session.joinAccount(account);
  await saver.checkpoint('join');
  host.command('advance');
  return { host, session, store, account };
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('codec', () => {
  it('round-trips typed arrays, non-finite numbers and -0', () => {
    const value = {
      a: new Uint8Array([1, 2, 255]),
      b: new Float32Array([0.5, -1.25]),
      nested: [{ c: new Int16Array([-3]) }],
      inf: Infinity,
      nan: NaN,
      negZero: -0,
      plain: [1, 'x', null],
    };
    const back = decode<typeof value>(encode(value));
    expect(back.a).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.a)).toEqual([1, 2, 255]);
    expect(back.b).toBeInstanceOf(Float32Array);
    expect(Array.from(back.b)).toEqual([0.5, -1.25]);
    expect(back.nested[0]!.c).toBeInstanceOf(Int16Array);
    expect(back.inf).toBe(Infinity);
    expect(back.nan).toBeNaN();
    expect(Object.is(back.negZero, -0)).toBe(true);
    expect(back.plain).toEqual([1, 'x', null]);
  });
});

describe('accounts persistence', () => {
  it('creates, deduplicates case-insensitively, lists, and remembers preferences', async () => {
    const st = newStore();
    const a1 = await st.createOrSelectAccount('  Aaron  ');
    expect(a1.name).toBe('Aaron');
    const a1Again = await st.createOrSelectAccount('aaron');
    expect(a1Again.accountId).toBe(a1.accountId);
    const a2 = await st.createOrSelectAccount('SkyPilot');
    expect(a2.accountId).not.toBe(a1.accountId);
    await st.touchAccount(a1.accountId, { skin: 'softRetro', color: 0x112233 });
    const loaded = await st.getAccount(a1.accountId);
    expect(loaded).toMatchObject({ name: 'Aaron', skin: 'softRetro', color: 0x112233 });
    expect((await st.listAccounts()).map((a) => a.name).sort()).toEqual(['Aaron', 'SkyPilot']);
  });
});

describe('save and resume', () => {
  it('a saved and reloaded server continues exactly like the uninterrupted one', () => {
    const a = startedSession(21);
    play(a, 60 * 45);
    const save = decode<GameSave>(encode(a.toSave()));
    const entries = structuredClone(a.ledger.entries);

    const b = new GameSession({ seed: 999 });
    b.restore(save, entries);
    expect(b.mode).toBe('menu');
    b.joinAccount(TEST_ACCOUNT);
    expect(b.paused).toBe(true); // resumes paused, mid-flight
    b.command('pause');
    expect(fingerprint(b)).toBe(fingerprint(a));

    play(a, 60 * 45, 60 * 45);
    play(b, 60 * 45, 60 * 45);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('restarting the host restores the committed server and ledger', async () => {
    const { host, session, account } = await startedHost();
    play(session, 60 * 30);
    await host.stop();
    const expected = fingerprint(session);

    const st2 = newStore();
    const loaded = await st2.load(st2.fileFor(session.serverId));
    const session2 = new GameSession({ seed: 1 });
    session2.restore(decode<GameSave>(loaded.state), loaded.entries);
    const saver2 = new GameSaver(st2, session2, loaded.ledgerSeq);
    session2.joinAccount(account);
    session2.command('pause');
    session.command('pause');
    expect(fingerprint(session2)).toBe(expected);
    play(session2, 600);
    expect(await saver2.checkpoint('test')).toBe(true);
  });

  it('checkpoints and their ledger entries commit together; queued saves never go backwards', async () => {
    const { host, session, store } = await startedHost(5);
    const saver = host.saver!;
    const queued: Promise<boolean>[] = [];
    for (let i = 0; i < 20; i++) {
      play(session, 90, i * 90);
      queued.push(saver.checkpoint('periodic'));
    }
    expect(await Promise.all(queued)).toEqual(Array(20).fill(true));
    const loaded = await store.load(store.fileFor(session.serverId));
    expect(loaded.tick).toBe(session.worldTick);
    expect(loaded.entries).toEqual(session.ledger.entries);
    const saved = decode<GameSave>(loaded.state);
    expect(saved.ledgerSeq).toBe(session.ledger.entries.at(-1)!.seq);
  });

  it('a stale checkpoint cannot overwrite a newer one', async () => {
    const { host, session, store } = await startedHost(6);
    play(session, 300);
    await host.saver!.checkpoint('newer');
    const file = store.fileFor(session.serverId);
    const newer = await store.load(file);
    await expect(
      store.checkpoint(session.serverId, {
        meta: {},
        tick: newer.tick - 100,
        ledgerSeq: newer.ledgerSeq,
        reason: 'stale',
        state: encode({ stale: true }),
        entries: [],
      }),
    ).rejects.toThrow(/stale/);
    expect((await store.load(file)).state).toBe(newer.state);
  });

  it('a checkpoint whose ledger would have a gap is rejected, then retried in full', async () => {
    const { host, session, store } = await startedHost(7);
    const saver = host.saver!;
    play(session, 60 * 20);
    const original = store.checkpoint.bind(store);
    let failures = 1;
    store.checkpoint = (id, args) =>
      failures-- > 0 ? original(id, { ...args, entries: args.entries.slice(1) }) : original(id, args);
    expect(await saver.checkpoint('broken')).toBe(false);
    expect(session.save).toMatchObject({ state: 'error' });
    expect((await store.load(store.fileFor(session.serverId))).entries.length).toBeLessThan(session.ledger.entries.length);
    play(session, 600);
    expect(await saver.checkpoint('retry')).toBe(true);
    expect(session.save).toMatchObject({ state: 'saved' });
    expect((await store.load(store.fileFor(session.serverId))).entries).toEqual(session.ledger.entries);
  });

  it('damaged saves and unsupported versions throw SaveError on restore', async () => {
    const { host, session, store } = await startedHost(9);
    play(session, 60 * 20);
    await host.stop();
    await store.shutdown();
    const file = store.fileFor(session.serverId);

    // Unsupported version
    const db = new DatabaseSync(file);
    const row = db.prepare('SELECT state FROM checkpoint WHERE id = 1').get() as { state: string };
    const save = decode<GameSave>(row.state);
    db.close();
    expect(() => new GameSession({ seed: 1 }).restore({ ...save, saveVersion: 99 }, session.ledger.entries)).toThrow(SaveError);

    // Tampered ledger
    const badEntries = structuredClone(session.ledger.entries);
    badEntries[0]!.amount += 1;
    badEntries[0]!.balance += 1;
    expect(() => new GameSession({ seed: 1 }).restore(save, badEntries)).toThrow(/damaged/);
    expect(statSync(file).size).toBeGreaterThan(0);
  });

  it('pause, leave and disconnect each save right away', async () => {
    const { host, session, store, account } = await startedHost(12);
    const file = store.fileFor(session.serverId);
    const savedTick = async () => (await store.load(file)).tick;

    play(session, 120);
    host.command('pause');
    await waitFor(() => session.save.state === 'saved');
    expect(await savedTick()).toBe(session.worldTick);

    host.command('pause');
    play(session, 120, 120);
    session.leaveAccount();
    (host as unknown as { processSaves(): void }).processSaves();
    await waitFor(() => session.save.state === 'saved');
    expect(await savedTick()).toBe(session.worldTick);
    const listed = (await store.list()).find((g) => g.meta?.serverId === session.serverId)!;
    expect(listed.meta?.status).toBe('suspended');

    session.joinAccount(account);
    host.command('pause');
    play(session, 120, 240);
    session.onDisconnect();
    (host as unknown as { processSaves(): void }).processSaves();
    await waitFor(() => session.save.state === 'saved');
    expect(await savedTick()).toBe(session.worldTick);
  });

  it('save writes happen off the simulation thread', async () => {
    const { host, session } = await startedHost(14);
    play(session, 60 * 60);
    const t0 = performance.now();
    const pending = host.saver!.checkpoint('timing');
    const queuedIn = performance.now() - t0;
    expect(await pending).toBe(true);
    expect(queuedIn).toBeLessThan(50);
  });
});

describe('GameSaver', () => {
  it('reports save state to the player', async () => {
    const { session, host } = await startedHost(15);
    const saver: GameSaver = host.saver!;
    play(session, 60);
    const p = saver.checkpoint('x');
    expect(session.save.state).toBe('saving');
    await p;
    expect(session.save).toEqual({ state: 'saved', tick: session.worldTick });
  });
});
