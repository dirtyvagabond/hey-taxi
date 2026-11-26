/**
 * Server review & Server Browser summaries, built from the save files: the list of servers
 * (with per-account summaries for the Server Browser), and for one server an overview of the
 * player's finances, every taxi (living and destroyed) with its accounts and life events, and
 * every ledger entry with a readable description.
 */
import { levelById, personalityArchetype } from '@hey-taxi/sim';
import { decode } from './codec';
import type { LedgerEntry } from './ledger';
import type {
  ReviewDetail,
  ReviewEntry,
  ReviewEvent,
  ReviewGame,
  ReviewOverview,
  ReviewTaxi,
  ServerSummary,
} from '@hey-taxi/sim/protocol';
import type { ServerMetaSummary } from './saver';
import type { GameSave } from './session';
import type { ListedGame, SaveStore } from './store';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const localeName = (id: string | undefined | null) => (id && levelById(id)?.data.name) || id || '';

function parseSummary(raw: string | undefined): ServerMetaSummary {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Partial<ServerMetaSummary>;
    return {
      worldTick: typeof parsed.worldTick === 'number' ? parsed.worldTick : 0,
      players: parsed.players && typeof parsed.players === 'object' ? parsed.players : {},
    };
  } catch {
    return { worldTick: 0, players: {} };
  }
}

export function toServerSummary(g: ListedGame, accountId?: string | null): ServerSummary {
  if (g.error || !g.meta) {
    return {
      serverId: g.file.split('/').pop()!.replace(/\.sqlite$/, ''),
      name: g.file.split('/').pop()!.replace(/\.sqlite$/, ''),
      createdAt: '',
      updatedAt: '',
      status: 'unreadable',
      seconds: 0,
      playerCount: 0,
      error: g.error ?? 'no metadata',
      account: null,
    };
  }
  const sum = parseSummary(g.meta.summary);
  const status = g.meta.status === 'running' ? 'running' : 'suspended';
  const serverId = g.meta.serverId ?? '';
  const ps = accountId ? sum.players[accountId] : undefined;
  return {
    serverId,
    name: g.meta.name || serverId.slice(0, 8),
    createdAt: g.meta.createdAt ?? '',
    updatedAt: g.meta.updatedAt ?? '',
    status,
    seconds: Math.round((sum.worldTick ?? 0) / 60),
    playerCount: Object.keys(sum.players).length,
    account: accountId
      ? ps
        ? {
            joined: true,
            cents: ps.cents,
            levelName: ps.levelId ? localeName(ps.levelId) : null,
            taxisLost: ps.taxisLost,
            destroyed: ps.destroyed,
          }
        : {
            joined: false,
            cents: 0,
            levelName: null,
            taxisLost: 0,
            destroyed: false,
          }
      : null,
  };
}

export async function listServers(store: SaveStore, accountId?: string | null): Promise<ServerSummary[]> {
  const servers = (await store.list()).map((g) => toServerSummary(g, accountId));
  return servers.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
}

function toReviewGame(g: ListedGame, accountId?: string | null): ReviewGame {
  const s = toServerSummary(g, accountId);
  if (s.status === 'unreadable') {
    return {
      gameId: s.serverId,
      name: s.name,
      createdAt: '',
      updatedAt: '',
      status: 'unreadable',
      seconds: 0,
      cents: 0,
      levelName: '',
      taxisLost: 0,
      playerCount: 0,
      error: s.error,
    };
  }
  const sum = parseSummary(g.meta?.summary);
  const ps = (accountId ? sum.players[accountId] : undefined) ?? Object.values(sum.players)[0];
  return {
    gameId: s.serverId,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    status: s.status,
    seconds: s.seconds,
    cents: ps?.cents ?? 0,
    levelName: ps?.levelId ? localeName(ps.levelId) : '',
    taxisLost: ps?.taxisLost ?? 0,
    playerCount: s.playerCount,
  };
}

/** All servers for Review, most recently updated first. */
export async function listGames(store: SaveStore, accountId?: string | null): Promise<ReviewGame[]> {
  const games = (await store.list()).map((g) => toReviewGame(g, accountId));
  return games.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
}

const INCOME = new Set(['fare', 'tip']);
const EXPENSES = new Set(['gas', 'missile', 'flare', 'repair', 'passengerHit']);
const CRASH: Record<string, string> = {
  body: 'hit something',
  gearUp: 'touched down with the gear up',
  hardLanding: 'landed too hard',
  badFooting: 'missed the ledge',
  missile: 'hit by a missile',
  outOfFuel: 'out of fuel',
};

/**
 * How a taxi was destroyed, from its ledger ref: "crash:<reason>", or "crash:<reason>:<taxi>"
 * (whose missile it was, or who it collided with).
 */
export function howDestroyed(ref: string, nameOf: (taxiId: string) => string = (id) => id): string {
  const [, reason = '', by] = ref.split(':');
  const text = CRASH[reason] ?? (reason || 'cause unknown');
  if (!by) return text;
  return reason === 'missile' ? `hit by ${nameOf(by)}'s missile` : `${text} (collided with ${nameOf(by)})`;
}

/** A readable line for a ledger entry (its category plus what triggered it). `nameOf` names taxis. */
export function describe(e: LedgerEntry, nameOf: (taxiId: string) => string = (id) => id): string {
  const [kind, rest = ''] = e.ref.split(':', 2) as [string, string?];
  switch (e.category) {
    case 'opening':
      return 'Starting funds (joined server)';
    case 'spawn':
      return 'Replacement taxi issued (account balance carried over)';
    case 'fare':
      return `Fare, passenger #${rest}`;
    case 'tip':
      return `Tip, passenger #${rest}`;
    case 'gas':
      return kind === 'service' ? 'Gas (mobile service)' : 'Gas';
    case 'missile':
      return kind === 'service' ? 'Missile (mobile service)' : 'Missile';
    case 'flare':
      return kind === 'service' ? 'Flare burst (mobile service)' : 'Flare burst';
    case 'repair':
      return kind === 'service' ? 'Hull repair (1 point, mobile service)' : 'Hull repair (1 point)';
    case 'passengerHit':
      return `Penalty: knocked over passenger #${rest}`;
    case 'destroyed':
      return `Destroyed: ${howDestroyed(e.ref, nameOf)}`;
    case 'transfer': {
      const [from, to] = rest.split('->');
      return `Teleported ${localeName(from)} → ${localeName(to)}`;
    }
    case 'adjustment':
      return kind === 'debug' ? 'Adjustment (development tool)' : `Adjustment (${kind})`;
    default:
      return e.category;
  }
}

/** One server in full: overview, taxis (with life events) and every ledger entry. */
export async function gameDetail(store: SaveStore, serverId: string, accountId?: string | null): Promise<ReviewDetail> {
  const listed = (await store.list()).find((g) => g.meta?.serverId === serverId);
  if (!listed) throw new Error('server not found');
  const loaded = await store.load(listed.file);
  const save = decode<GameSave>(loaded.state);
  const registry = save.world.taxis;
  const isPlayer = (id: string) => (registry[id] ? !registry[id]!.npc : false);
  const nameOf = (id: string) => registry[id]?.name ?? id;
  const seconds = (tick: number) => Math.round(tick / 60);

  const entries: ReviewEntry[] = loaded.entries.map((e) => ({
    seq: e.seq,
    seconds: seconds(e.tick),
    accountId: e.accountId ?? null,
    taxiId: e.taxiId,
    taxiName: nameOf(e.taxiId),
    player: isPlayer(e.taxiId),
    locale: e.locale,
    localeName: localeName(e.locale),
    category: e.category,
    amount: e.amount,
    balance: e.balance,
    description: describe(e, nameOf),
  }));

  const byTaxi = new Map<string, LedgerEntry[]>();
  const byAccount = new Map<string, LedgerEntry[]>();
  for (const e of loaded.entries) {
    const list = byTaxi.get(e.taxiId) ?? [];
    list.push(e);
    byTaxi.set(e.taxiId, list);
    if (e.accountId) {
      const alist = byAccount.get(e.accountId) ?? [];
      alist.push(e);
      byAccount.set(e.accountId, alist);
    }
  }
  const live = new Map(save.world.locales.flatMap((l) => l.sim.taxis).map((t) => [t.id, t]));
  for (const ps of Object.values(save.players ?? {})) {
    if (ps.stashedTaxi) live.set(ps.stashedTaxi.taxi.id, ps.stashedTaxi.taxi);
  }
  const ids = new Set([...byTaxi.keys(), ...Object.keys(registry)]);
  const taxis: ReviewTaxi[] = [...ids].map((taxiId) => {
    const own = byTaxi.get(taxiId) ?? [];
    const sum = (pred: (e: LedgerEntry) => boolean) => own.filter(pred).reduce((n, e) => n + e.amount, 0);
    const rec = registry[taxiId];
    const ownerAcct = rec?.accountId ?? own[0]?.accountId ?? null;
    const balance = own.at(-1)?.balance ?? (ownerAcct ? (save.players[ownerAcct]?.cents ?? 0) : 0);
    const t = live.get(taxiId);
    const death = own.find((e) => e.category === 'destroyed');
    const destroyed = !!death || save.deadRivals.includes(taxiId) || t?.status === 'destroyed';
    const events: ReviewEvent[] = [];
    for (const e of own) {
      if (e.category === 'opening' || e.category === 'spawn') {
        events.push({
          seconds: seconds(e.tick),
          kind: 'started',
          text: e.category === 'spawn' ? `Replacement taxi in ${localeName(e.locale)}` : `Started in ${localeName(e.locale)}`,
          localeName: localeName(e.locale),
        });
      } else if (e.category === 'transfer' || e.category === 'destroyed') {
        events.push({
          seconds: seconds(e.tick),
          kind: e.category === 'transfer' ? 'teleported' : 'destroyed',
          text: describe(e, nameOf),
          localeName: localeName(e.locale),
        });
      }
    }
    let reconciled = true;
    if (ownerAcct) {
      const acctEntries = byAccount.get(ownerAcct) ?? [];
      const acctSum = acctEntries.reduce((n, e) => n + e.amount, 0);
      const acctFinal = save.players[ownerAcct]?.cents ?? 0;
      reconciled = acctEntries.length === 0 || acctSum === acctFinal;
    } else {
      reconciled = own.reduce((n, e) => n + e.amount, 0) === balance && (!t || t.cents === balance);
    }
    return {
      taxiId,
      accountId: ownerAcct,
      name: nameOf(taxiId),
      proficiency: t?.copilot.countermeasureProficiency ?? 0,
      ...(t?.npc ? { personality: t.personality ?? null, archetype: personalityArchetype(t.personality) } : {}),
      player: isPlayer(taxiId),
      status: destroyed ? 'destroyed' : t?.status === 'offstage' ? 'not arrived' : 'active',
      ...(death ? { destroyedBy: capitalize(howDestroyed(death.ref, nameOf)) } : {}),
      localeName: localeName(rec?.localeId),
      opening: sum((e) => e.category === 'opening'),
      income: sum((e) => INCOME.has(e.category)),
      expenses: -sum((e) => e.amount < 0 && e.category !== 'adjustment'),
      adjustments: sum((e) => e.category === 'adjustment'),
      balance,
      fares: own.filter((e) => e.category === 'fare').length,
      entries: own.length,
      reconciled,
      events,
    };
  });
  const created = (id: string) => registry[id]?.createdTick ?? 0;
  const order = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  taxis.sort((a, b) =>
    a.player !== b.player ? (a.player ? -1 : 1) : created(a.taxiId) - created(b.taxiId) || order(a.taxiId) - order(b.taxiId),
  );

  // Overview for the requested account (or the first account on the server).
  const targetPlayer =
    (accountId ? save.players[accountId] : undefined) ?? Object.values(save.players ?? {})[0] ?? null;
  const mine = targetPlayer
    ? loaded.entries.filter((e) => e.accountId === targetPlayer.accountId)
    : loaded.entries.filter((e) => isPlayer(e.taxiId));
  const total = (pred: (e: LedgerEntry) => boolean) => mine.filter(pred).reduce((n, e) => n + e.amount, 0);
  const expensesByCategory: Record<string, number> = {};
  for (const e of mine) if (EXPENSES.has(e.category)) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) - e.amount;
  const fareRevenue = total((e) => e.category === 'fare');
  const tips = total((e) => e.category === 'tip');
  const expenses = Object.values(expensesByCategory).reduce((a, b) => a + b, 0);
  const adjustments = total((e) => e.category === 'adjustment');
  const playerTaxis = targetPlayer
    ? taxis.filter((t) => t.accountId === targetPlayer.accountId)
    : taxis.filter((t) => t.player);
  const overview: ReviewOverview = {
    accountName: targetPlayer?.name ?? 'No player yet',
    startingFunds: total((e) => e.category === 'opening'),
    fareRevenue,
    tips,
    earned: fareRevenue + tips,
    expensesByCategory,
    expenses,
    adjustments,
    netProfit: fareRevenue + tips - expenses + adjustments,
    endingCash: targetPlayer?.cents ?? 0,
    fares: mine.filter((e) => e.category === 'fare').length,
    taxisUsed: targetPlayer?.taxiCount ?? playerTaxis.length,
    deaths: targetPlayer?.deaths ?? [],
  };
  return { game: toReviewGame(listed, accountId), overview, taxis, entries };
}
