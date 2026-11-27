/**
 * Demand-driven rival population, run by the world coordinator.
 *
 * Passenger demand in each locale is fixed by the locale (arrival rate and waiting cap), not
 * by how many taxis are around. Every few seconds the coordinator looks for a shortage: at
 * least `demandShortage` unclaimed passengers who have each waited `demandWaitSeconds`. Then:
 *  1. redirect a living, idle, healthy, fuelled rival from a locale with spare capacity (it
 *     flies to a teleport and is transferred), or else
 *  2. bring in an entirely new rival (new ID, distinct name, fresh resources, opening balance),
 *     within the living-rival limits and at most once per `rivalSpawnCooldownSeconds`.
 * Either response is reserved for `dispatchTimeoutSeconds`, so repeated checks don't dispatch
 * several taxis for the same shortage. Dead rivals stay dead; idle ones are never deleted.
 */
import { addRival, isActive, TAXI_SKINS, type SimState, type Taxi, type TaxiSkin } from '@hey-taxi/sim';
import type { Decision, Diagnostics } from '@hey-taxi/sim/protocol';
import type { Locale, World } from './world';

const TICK_RATE = 60;
/** Keep this many recent decisions for diagnostics (and saves). */
const DECISION_LOG = 12;

export interface Reservation {
  localeId: string;
  taxiId: string;
  kind: 'redirect' | 'spawn';
  /** Created at (world tick), and when it lapses. */
  tick: number;
  untilTick: number;
}

export interface PopulationState {
  /** Seeded RNG state for names and other population choices. */
  rng: number;
  reservations: Reservation[];
  /** World tick of the last demand-driven spawn (null: none yet). */
  lastSpawnTick: number | null;
  nextCheckTick: number;
  decisions: Decision[];
}

export function freshPopulation(seed: number): PopulationState {
  return { rng: seed >>> 0 || 1, reservations: [], lastSpawnTick: null, nextCheckTick: 0, decisions: [] };
}

/** mulberry32 on the population's own RNG state (kept apart from each locale's RNG). */
function random(p: PopulationState): number {
  p.rng = (p.rng + 0x6d2b79f5) >>> 0;
  let t = p.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const FIRST = [
  'Abe', 'Ada', 'Alma', 'Arlo', 'Bea', 'Benny', 'Cass', 'Cleo', 'Dash', 'Dee', 'Eddie', 'Esme', 'Fitz', 'Flo',
  'Gus', 'Hattie', 'Ike', 'Ines', 'Jojo', 'June', 'Kit', 'Lenny', 'Lou', 'Mabel', 'Milo', 'Nell', 'Otis', 'Pearl',
  'Quinn', 'Ray', 'Rosie', 'Sal', 'Sunny', 'Tess', 'Ugo', 'Vera', 'Walt', 'Wren', 'Xavi', 'Yara', 'Zed', 'Zuzu',
];
const LAST = [
  'Abernathy', 'Bellweather', 'Castellano', 'Dunmore', 'Ellery', 'Fairbanks', 'Gallagher', 'Halloran', 'Ignatius',
  'Jablonski', 'Kettering', 'Lindqvist', 'Marchetti', 'Nakamura', "O'Rourke", 'Pemberton', 'Quill', 'Ramirez',
  'Sokolov', 'Thibodeaux', 'Ulrich', 'Valdez', 'Whitlock', 'Xiong', 'Yardley', 'Zielinski',
];

/** A display name not yet used in this game (seeded). */
export function newName(p: PopulationState, taken: ReadonlySet<string>): string {
  for (let i = 0; i < 200; i++) {
    const name = `${FIRST[Math.floor(random(p) * FIRST.length)]} ${LAST[Math.floor(random(p) * LAST.length)]}`;
    if (!taken.has(name)) return name;
  }
  let n = 2;
  while (taken.has(`Cab ${n}`)) n++;
  return `Cab ${n}`;
}

const living = (t: Taxi) => t.status !== 'destroyed';

/** Passengers waiting long enough to count toward a shortage, with nobody heading for them. */
export function longWaiting(sim: SimState, waitTicks: number): number {
  const claimed = new Set(sim.taxis.filter((t) => t.npc && isActive(t)).map((t) => t.ai?.goal ?? ''));
  return sim.passengers.filter((p) => p.state === 'waiting' && p.waitTicks >= waitTicks && !claimed.has(`pick:${p.id}`)).length;
}

export class Population {
  constructor(private readonly world: World) {}

  private get state(): PopulationState {
    return this.world.population;
  }

  private log(text: string): void {
    const p = this.state;
    p.decisions.push({ tick: this.world.tick, text });
    if (p.decisions.length > DECISION_LOG) p.decisions.splice(0, p.decisions.length - DECISION_LOG);
  }

  private rivals(locale: Locale): Taxi[] {
    return locale.sim.taxis.filter((t) => t.npc);
  }

  private reservedFor(localeId: string): Reservation[] {
    return this.state.reservations.filter((r) => r.localeId === localeId);
  }

  /** Inbound reservations for `locale` whose taxi has not yet arrived there. */
  private inboundFor(locale: Locale): Reservation[] {
    const here = new Set(this.rivals(locale).filter(living).map((t) => t.id));
    return this.reservedFor(locale.id).filter((r) => !here.has(r.taxiId));
  }

  /** Clear any pending reservation for a taxi (e.g. once it arrives by teleport). */
  clearReservation(taxiId: string): void {
    this.state.reservations = this.state.reservations.filter((r) => r.taxiId !== taxiId);
  }

  /** Run once per tick: expire or complete reservations; every few seconds, look for shortages. */
  step(): void {
    const w = this.world;
    const c = w.config;
    const p = this.state;
    // Expire reservations, and drop any whose taxi already arrived or was destroyed.
    const keep: Reservation[] = [];
    for (const r of p.reservations) {
      const t = w.taxi(r.taxiId);
      const rec = w.taxis[r.taxiId];
      if (!t || !living(t) || rec?.localeId === r.localeId) continue;
      if (r.untilTick <= w.tick) {
        if (r.kind === 'redirect' && t.relocateTo === r.localeId) {
          t.relocateTo = null;
          this.log(`${w.nameOf(r.taxiId)} didn't reach ${this.localeName(r.localeId)} in time; dispatch cancelled`);
        }
        continue;
      }
      keep.push(r);
    }
    p.reservations = keep;
    if (w.tick < p.nextCheckTick) return;
    p.nextCheckTick = w.tick + Math.round(c.demandCheckSeconds * TICK_RATE);

    const waitTicks = Math.round(c.demandWaitSeconds * TICK_RATE);
    // Prioritize locales below their baseline rival floor, then largest backlog, then sparsest area density.
    const ranked = w.locales
      .map((locale) => {
        const floor = Math.min(locale.sim.level.rivals, c.rivalsMaxPerLocale);
        const deficit = Math.max(0, floor - this.load(locale));
        const backlog = longWaiting(locale.sim, waitTicks);
        const area = locale.sim.level.cols * locale.sim.level.rows;
        const density = this.rivals(locale).filter(isActive).length / Math.max(1, area);
        return { locale, deficit, backlog, density };
      })
      .sort((a, b) => b.deficit - a.deficit || b.backlog - a.backlog || a.density - b.density);

    for (const { locale, deficit, backlog } of ranked) {
      if (deficit === 0 && backlog < c.demandShortage) continue;
      if (this.inboundFor(locale).length) continue; // a redirected rival is already on its way
      if (this.redirect(locale, deficit > 0) || this.spawn(locale, deficit > 0)) continue;
    }
  }

  private localeName(id: string): string {
    return this.world.locale(id).sim.level.name;
  }

  /** How many living rivals a locale has, plus any redirected rivals still en route. */
  private load(locale: Locale): number {
    return this.rivals(locale).filter(living).length + this.inboundFor(locale).length;
  }

  /** Send an idle rival from a locale that can spare it (staying above its baseline floor). */
  private redirect(target: Locale, forFloor = false): boolean {
    const w = this.world;
    const c = w.config;
    if (this.load(target) >= c.rivalsMaxPerLocale) return false;
    const waitTicks = Math.round(c.demandWaitSeconds * TICK_RATE);
    const reserved = new Set(this.state.reservations.map((r) => r.taxiId));
    let best: { taxi: Taxi; from: Locale; spare: number } | null = null;
    for (const from of w.locales) {
      if (from === target) continue;
      const active = this.rivals(from).filter(isActive);
      const floor = Math.min(from.sim.level.rivals, c.rivalsMaxPerLocale);
      const waiting = from.sim.passengers.filter((q) => q.state === 'waiting').length;
      // Spare capacity: no shortage there, and strictly above its baseline rival floor.
      if (longWaiting(from.sim, waitTicks) >= c.demandShortage) continue;
      if (active.length <= floor) continue;
      for (const t of active) {
        const busy =
          from.sim.passengers.some((q) => q.taxiId === t.id && (q.state === 'riding' || q.state === 'walking')) ||
          !!t.relocateTo ||
          reserved.has(t.id);
        // Never send off a damaged or under-fuelled taxi (it needs a store, not a trip).
        const fit = t.fuel >= c.fuelMax * 0.5 && t.hp > c.taxiMaxHp / 2;
        if (busy || !fit) continue;
        const spare = active.length - floor - waiting;
        if (!best || spare > best.spare) best = { taxi: t, from, spare };
      }
    }
    if (!best) return false;
    best.taxi.relocateTo = target.id;
    this.reserve(target.id, best.taxi.id, 'redirect');
    const reason = forFloor ? 'Low coverage' : 'Shortage';
    this.log(`${reason} in ${target.sim.level.name}: sending ${w.nameOf(best.taxi.id)} over from ${best.from.sim.level.name}`);
    return true;
  }

  /** Bring in a new rival, within the limits and the cooldown. */
  private spawn(target: Locale, forFloor = false): boolean {
    const w = this.world;
    const c = w.config;
    const p = this.state;
    const livingAll = w.locales.reduce((n, l) => n + this.rivals(l).filter(living).length, 0);
    const cooldown = Math.round(c.rivalSpawnCooldownSeconds * TICK_RATE);
    if (livingAll >= c.rivalsMaxWorld) return this.skip(target, 'the world is at its rival limit');
    if (this.load(target) >= c.rivalsMaxPerLocale) return this.skip(target, 'the locale is at its rival limit');
    if (p.lastSpawnTick !== null && w.tick - p.lastSpawnTick < cooldown) return false;
    const id = w.createRival(target.id);
    p.lastSpawnTick = w.tick;
    const reason = forFloor ? `Low coverage in ${target.sim.level.name}` : `Shortage in ${target.sim.level.name}, no taxi to spare`;
    this.log(`${reason}: new rival ${w.nameOf(id)} (${id})`);
    return true;
  }

  /** Note (once in a while) that a shortage couldn't be answered. */
  private skip(target: Locale, why: string): false {
    const text = `Shortage in ${target.sim.level.name}, but ${why}`;
    const recent = this.world.tick - 60 * TICK_RATE;
    if (!this.state.decisions.some((d) => d.text === text && d.tick >= recent)) this.log(text);
    return false;
  }

  private reserve(localeId: string, taxiId: string, kind: Reservation['kind']): void {
    const w = this.world;
    this.state.reservations.push({
      localeId,
      taxiId,
      kind,
      tick: w.tick,
      untilTick: w.tick + Math.round(w.config.dispatchTimeoutSeconds * TICK_RATE),
    });
  }

  diagnostics(): Diagnostics {
    const w = this.world;
    const c = w.config;
    const p = this.state;
    const waitTicks = Math.round(c.demandWaitSeconds * TICK_RATE);
    const cooldown = Math.round(c.rivalSpawnCooldownSeconds * TICK_RATE);
    return {
      locales: w.locales.map((l) => {
        const waiting = l.sim.passengers.filter((q) => q.state === 'waiting');
        return {
          id: l.id,
          name: l.sim.level.name,
          waiting: waiting.length,
          backlog: longWaiting(l.sim, waitTicks),
          oldestWaitSeconds: Math.round(Math.max(0, ...waiting.map((q) => q.waitTicks)) / TICK_RATE),
          rivalsLiving: this.rivals(l).filter(living).length,
          rivalsActive: this.rivals(l).filter(isActive).length,
          reserved: this.inboundFor(l).length,
        };
      }),
      activeRivals: w.locales.reduce((n, l) => n + this.rivals(l).filter(isActive).length, 0),
      livingRivals: w.locales.reduce((n, l) => n + this.rivals(l).filter(living).length, 0),
      maxRivals: c.rivalsMaxWorld,
      spawnCooldownSeconds:
        p.lastSpawnTick === null ? 0 : Math.max(0, Math.ceil((p.lastSpawnTick + cooldown - w.tick) / TICK_RATE)),
      decisions: [...p.decisions],
    };
  }
}

/** A skin for a new rival, at random (from the population's RNG, so a game replays the same). */
export function pickRivalSkin(p: PopulationState): TaxiSkin {
  return TAXI_SKINS[Math.min(TAXI_SKINS.length - 1, Math.floor(random(p) * TAXI_SKINS.length))]!;
}

/** Create a new rival in a locale's simulation (used by the world). */
export function addRivalTo(sim: SimState, id: string, skin: TaxiSkin = 'shortBus'): void {
  addRival(sim, id, 1).skin = skin;
}
