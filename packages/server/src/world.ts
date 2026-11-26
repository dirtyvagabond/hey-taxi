/**
 * The world: several locales that all exist and run at once, plus the registry of every taxi
 * in the server. Each locale is its own simulation (physics, passengers, missiles, decoys); the
 * world coordinator advances them together, owns taxi identity (an ID is never reused) and
 * moves taxis between locales.
 *
 * A taxi's physical presence lives in exactly one locale's simulation (unless stashed while its
 * owning player is offline and another player is active); its record here says which.
 */
import { addRivalTo, freshPopulation, newName, pickRivalSkin, Population, type PopulationState } from './population';
import {
  addPlayer,
  admitTaxi,
  aiProfile,
  atTeleport,
  createSim,
  isActive,
  TAXI,
  levelById,
  parseLevel,
  WORLD_LEVELS,
  step,
  type SimConfig,
  type SimEvent,
  type SimState,
  type Taxi,
  type TaxiSkin,
} from '@hey-taxi/sim';

/** The locales, in order (content in levels/world; defined in @hey-taxi/sim). */
export { WORLD_LEVELS };

export interface Locale {
  /** Stable locale ID (its level content ID). */
  id: string;
  /** Content version of its level (saves check it). */
  version: string;
  sim: SimState;
}

export interface TaxiRecord {
  id: string;
  /** Display name (distinct within a server); the ID stays the stable key. */
  name: string;
  npc: boolean;
  /** Owning player account ID (null/undefined for NPCs). */
  accountId?: string | null;
  /** Locale that currently owns the taxi's physical presence. */
  localeId: string;
  /** World tick the taxi was created at. */
  createdTick: number;
}

export interface CreatePlayerTaxiOpts {
  accountId: string;
  name: string;
  taxiNumber: number;
  skin?: TaxiSkin;
  color?: number;
  /** When set, carries this exact balance (cents) into the new taxi instead of minting startMoney. */
  balanceCents?: number;
}

/** Locale state as saved: everything but level geometry and config (rebuilt from content). */
export interface SavedLocale {
  id: string;
  version: string;
  sim: Omit<SimState, 'level' | 'config'>;
}

export interface SavedWorld {
  tick: number;
  playerId: string;
  nextRivalNumber: number;
  population: PopulationState;
  locales: SavedLocale[];
  taxis: Record<string, TaxiRecord>;
}

/** Deterministic per-locale seed from the server seed. */
export function localeSeed(gameSeed: number, localeId: string): number {
  let h = gameSeed >>> 0 || 1;
  for (let i = 0; i < localeId.length; i++) h = Math.imul(h ^ localeId.charCodeAt(i), 0x9e3779b1) >>> 0;
  return h || 1;
}

export class World {
  tick = 0;
  locales: Locale[] = [];
  taxis: Record<string, TaxiRecord> = {};
  /** Rival IDs are npc1, npc2, …: unique across the whole server, never reused. */
  nextRivalNumber = 1;
  /** Currently active player's taxi ID (empty if no player has joined yet). */
  playerId = '';
  /** Demand-driven rival population (names, reservations, cooldowns, decisions). */
  population: PopulationState = freshPopulation(1);
  readonly policy = new Population(this);

  constructor(public config: SimConfig) {}

  nameOf(taxiId: string): string {
    return this.taxis[taxiId]?.name ?? taxiId;
  }

  private takenNames(): Set<string> {
    return new Set(Object.values(this.taxis).map((r) => r.name));
  }

  /**
   * Create a player taxi in `localeId` for the given account.
   * For a player's first taxi on the server, omit `balanceCents` to grant `startMoney`.
   * For a replacement taxi after death, pass `balanceCents` to carry over the account's exact balance.
   */
  createPlayerTaxi(localeId: string, opts: CreatePlayerTaxiOpts): string {
    const locale = this.locale(localeId);
    const id = `p-${opts.accountId}-${opts.taxiNumber}`;
    const taxi = addPlayer(
      locale.sim,
      id,
      opts.balanceCents !== undefined ? { balanceCents: opts.balanceCents } : undefined,
    );
    taxi.skin = opts.skin ?? 'original';
    if (opts.color !== undefined) taxi.color = opts.color;
    const displayName = opts.taxiNumber === 1 ? opts.name : `${opts.name} #${opts.taxiNumber}`;
    this.taxis[id] = {
      id,
      name: displayName,
      npc: false,
      accountId: opts.accountId,
      localeId,
      createdTick: this.tick,
    };
    this.playerId = id;
    return id;
  }

  /**
   * Temporarily remove a living player taxi from its locale (e.g. when another account takes
   * over this server) so it cannot crash or take fire while offline.
   */
  stashTaxi(taxiId: string): { localeId: string; taxi: Taxi } | null {
    const rec = this.taxis[taxiId];
    if (!rec) return null;
    const locale = this.locale(rec.localeId);
    const idx = locale.sim.taxis.findIndex((t) => t.id === taxiId);
    if (idx < 0) return null;
    const taxi = locale.sim.taxis[idx]!;
    if (!isActive(taxi)) return null;
    locale.sim.taxis.splice(idx, 1);
    for (const p of locale.sim.passengers) {
      if (p.taxiId === taxiId) {
        if (p.state === 'riding' || p.state === 'walking') {
          p.taxiId = null;
          p.state = 'waiting';
          const pad = locale.sim.level.pads[p.padIndex];
          if (pad) {
            p.x = pad.x + pad.w / 2;
            p.y = pad.y;
          }
        }
      }
    }
    for (const m of locale.sim.missiles) if (m.targetId === taxiId) m.targetId = null;
    taxi.passengerId = -1;
    return { localeId: rec.localeId, taxi: structuredClone(taxi) };
  }

  /** Restore a previously stashed player taxi back into its locale. */
  restoreTaxi(localeId: string, taxi: Taxi): void {
    const locale = this.locale(localeId);
    if (!locale.sim.taxis.some((t) => t.id === taxi.id)) {
      locale.sim.taxis.push(structuredClone(taxi));
    }
    if (this.taxis[taxi.id]) this.taxis[taxi.id]!.localeId = localeId;
  }

  /** An entirely new rival in a locale: new ID and name, fresh supplies, opening balance. */
  createRival(localeId: string): string {
    const locale = this.locale(localeId);
    const id = `npc${this.nextRivalNumber++}`;
    addRivalTo(locale.sim, id, pickRivalSkin(this.population));
    this.taxis[id] = { id, name: newName(this.population, this.takenNames()), npc: true, localeId, createdTick: this.tick };
    return id;
  }

  /** A new world: every locale with its starting rivals; optional initial player IDs in locale 0. */
  static create(config: SimConfig, gameSeed: number, playerIds: string[] = []): World {
    const w = new World(config);
    w.population = freshPopulation(Math.imul(gameSeed, 0x2545f491) >>> 0);
    w.playerId = playerIds[0] ?? '';
    for (const [i, levelId] of WORLD_LEVELS.entries()) {
      const content = levelById(levelId)!;
      const level = parseLevel(content.data);
      const npcIds = Array.from({ length: level.rivals }, () => `npc${w.nextRivalNumber++}`);
      const sim = createSim(level, {
        config,
        playerIds: i === 0 ? playerIds : [],
        npcIds,
        seed: localeSeed(gameSeed, levelId),
      });
      sim.config = config;
      w.locales.push({ id: levelId, version: content.version, sim });
      for (const t of sim.taxis) {
        const name = t.npc ? newName(w.population, w.takenNames()) : 'You';
        if (t.npc) t.skin = pickRivalSkin(w.population);
        w.taxis[t.id] = { id: t.id, name, npc: t.npc, localeId: levelId, createdTick: 0 };
      }
    }
    return w;
  }

  locale(id: string): Locale {
    const l = this.locales.find((x) => x.id === id);
    if (!l) throw new Error(`no locale "${id}"`);
    return l;
  }

  /** The locale a taxi is in now. */
  localeOf(taxiId: string): Locale {
    const rec = this.taxis[taxiId];
    if (!rec) throw new Error(`no taxi "${taxiId}"`);
    return this.locale(rec.localeId);
  }

  taxi(taxiId: string): Taxi | undefined {
    const rec = this.taxis[taxiId];
    return rec ? this.locale(rec.localeId).sim.taxis.find((t) => t.id === taxiId) : undefined;
  }

  /** Advance every locale one tick, together. Inputs are keyed by taxi ID. */
  step(inputs: Readonly<Record<string, number>>): { locale: Locale; events: SimEvent[] }[] {
    this.tick++;
    const results = this.locales.map((locale) => ({ locale, events: step(locale.sim, inputs) }));
    if (this.tick % 30 === 0) this.syncPersonalityRelocations();
    this.policy.step(); // demand-driven rival population
    return results;
  }

  /**
   * Cross-locale vendetta pursuit and timid locale escape:
   *  - An extreme-Vengeance rival follows their vendetta target through teleports to other locales.
   *  - A lower-Vengeance rival drops the vendetta if their target escapes to another locale.
   *  - A very timid rival repeatedly harassed in a locale teleports away to a quieter city.
   */
  private syncPersonalityRelocations(): void {
    for (const locale of this.locales) {
      for (const t of locale.sim.taxis) {
        if (!t.npc || !isActive(t)) continue;
        if (t.vendettaTargetId) {
          const target = this.taxi(t.vendettaTargetId);
          const targetRec = this.taxis[t.vendettaTargetId];
          if (!target || target.status === 'destroyed' || !targetRec) {
            t.vendettaTargetId = null;
          } else if (targetRec.localeId !== locale.id) {
            const prof = aiProfile(t.personality);
            if (prof.pursueAcrossLocales) {
              if (t.relocateTo !== targetRec.localeId) t.relocateTo = targetRec.localeId;
            } else {
              t.vendettaTargetId = null;
            }
          }
        } else if (t.fleeFromId && t.ai?.wantEscapeLocale && !t.relocateTo) {
          const threatLoc = this.taxis[t.fleeFromId]?.localeId;
          const candidates = this.locales
            .filter((l) => l.id !== locale.id && l.id !== threatLoc)
            .sort((a, b) => a.sim.taxis.filter(isActive).length - b.sim.taxis.filter(isActive).length);
          const dest = candidates[0];
          if (dest) {
            t.relocateTo = dest.id;
            t.ai.wantEscapeLocale = false;
          }
        }
      }
    }
  }

  setConfig(config: SimConfig): void {
    this.config = config;
    for (const l of this.locales) l.sim.config = config;
  }

  /**
   * Teleport: a taxi parked on a teleport pad travels to another locale, free, landing on a
   * clear spot of a teleport pad there. Needs an empty cab. If every arrival spot is taken,
   * nothing happens (the taxi stays put, safe, and can try again).
   */
  teleport(taxiId: string, toLocaleId: string): TeleportResult {
    const rec = this.taxis[taxiId];
    const to = this.locales.find((l) => l.id === toLocaleId);
    if (!rec || !to) return 'unknown';
    const from = this.locale(rec.localeId);
    if (from === to) return 'same';
    const t = from.sim.taxis.find((x) => x.id === taxiId);
    if (!t || !atTeleport(from.sim, t)) return 'notAtTeleport';
    if (from.sim.passengers.some((p) => p.taxiId === taxiId && (p.state === 'riding' || p.state === 'walking'))) {
      return 'occupied';
    }
    const spot = this.arrivalSpot(to);
    if (!spot) return 'blocked';
    this.transfer(taxiId, to.id, spot);
    return 'ok';
  }

  /**
   * A clear place to land on one of the locale's teleport pads: on the pad (body within its
   * edges) and well clear of any taxi there or hovering just above. Null if none is free.
   */
  arrivalSpot(locale: Locale): { padIndex: number; x: number } | null {
    const { sim } = locale;
    const others = sim.taxis.filter((o) => isActive(o));
    for (const pad of sim.level.pads.filter((p) => p.kind === 'teleport')) {
      const lo = pad.x + TAXI.halfW + 4;
      const hi = pad.x + pad.w - TAXI.halfW - 4;
      const steps = Math.max(1, Math.floor((hi - lo) / 8));
      // Try the middle first, then outward.
      const xs = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps).sort(
        (a, b) => Math.abs(a - (lo + hi) / 2) - Math.abs(b - (lo + hi) / 2),
      );
      const y = pad.y - TAXI.gearLength - TAXI.halfH;
      for (const x of xs) {
        const clear = others.every((o) => Math.abs(o.x - x) > 2 * TAXI.halfW + 12 || Math.abs(o.y - y) > 3 * TAXI.halfH + 40);
        if (clear) return { padIndex: pad.index, x };
      }
    }
    return null;
  }

  /**
   * NPC taxis the coordinator asked to relocate fly to a teleport on their own; once one is
   * parked there (with an empty cab), move it. A blocked arrival just waits for next time.
   */
  processRelocations(): { taxiId: string; from: string; to: string }[] {
    const moved: { taxiId: string; from: string; to: string }[] = [];
    for (const locale of this.locales) {
      for (const t of [...locale.sim.taxis]) {
        if (!t.npc || !t.relocateTo || !isActive(t)) continue;
        if (t.relocateTo === locale.id || !this.locales.some((l) => l.id === t.relocateTo)) {
          t.relocateTo = null; // nothing to do
          continue;
        }
        const to = t.relocateTo;
        if (this.teleport(t.id, to) === 'ok') {
          t.relocateTo = null;
          t.ai = null;
          this.policy.clearReservation(t.id);
          moved.push({ taxiId: t.id, from: locale.id, to });
        }
      }
    }
    return moved;
  }

  /**
   * Move a taxi to another locale, exactly once: out of the old locale's simulation (any
   * rider stays behind and leaves) and into the new one (at `spot`, or its start), carrying
   * everything it has. Neither locale is reset.
   */
  transfer(taxiId: string, toLocaleId: string, spot?: { padIndex: number; x: number }): void {
    const from = this.localeOf(taxiId);
    const to = this.locale(toLocaleId);
    if (from === to) return;
    const t = from.sim.taxis.find((x) => x.id === taxiId);
    if (!t) throw new Error(`taxi "${taxiId}" missing from locale "${from.id}"`);
    from.sim.taxis = from.sim.taxis.filter((x) => x !== t);
    from.sim.passengers = from.sim.passengers.filter((p) => p.taxiId !== taxiId || p.state === 'leaving');
    // Missiles chasing it lose their target (they'll look for another).
    for (const m of from.sim.missiles) if (m.targetId === taxiId) m.targetId = null;
    // Escaping to another locale clears local fear (vendettaTargetId is kept for cross-locale pursuit).
    t.fleeFromId = null;
    admitTaxi(to.sim, t, spot);
    this.taxis[taxiId]!.localeId = to.id;
  }

  /** Shallow view of world state for worker serialization (postMessage clones once off-thread). */
  snapshot(): SavedWorld {
    return {
      tick: this.tick,
      playerId: this.playerId,
      nextRivalNumber: this.nextRivalNumber,
      population: this.population,
      locales: this.locales.map(({ id, version, sim }) => {
        const { level: _level, config: _config, ...rest } = sim;
        return { id, version, sim: rest };
      }),
      taxis: this.taxis,
    };
  }

  save(): SavedWorld {
    return structuredClone(this.snapshot());
  }

  /** Rebuild a saved world. Throws if a locale's content is missing or has changed. */
  static restore(saved: SavedWorld, config: SimConfig, stashedIds?: ReadonlySet<string>): World {
    const w = new World(config);
    w.tick = saved.tick;
    w.nextRivalNumber = saved.nextRivalNumber;
    w.playerId = saved.playerId;
    w.population = saved.population;
    w.taxis = saved.taxis;
    for (const l of saved.locales) {
      const content = levelById(l.id);
      if (!content) throw new WorldContentError(`its locale "${l.id}" no longer exists`);
      if (content.version !== l.version) throw new WorldContentError(`its locale "${content.data.name}" has changed since it was saved`);
      w.locales.push({ id: l.id, version: l.version, sim: { ...l.sim, level: parseLevel(content.data), config } });
    }
    for (const [id, rec] of Object.entries(w.taxis)) {
      if (stashedIds?.has(id)) continue;
      const here = w.locales.find((l) => l.id === rec.localeId)?.sim.taxis.some((t) => t.id === id);
      if (!here) throw new Error(`taxi "${id}" is not where the world says it is`);
    }
    return w;
  }
}

export class WorldContentError extends Error {}

export type TeleportResult = 'ok' | 'notAtTeleport' | 'occupied' | 'blocked' | 'same' | 'unknown';
