/**
 * Translates server simulation events into client feedback: particles, sounds, HUD flashes,
 * camera shake, floating text, and passenger dialogue bubbles.
 */
import {
  DT,
  landingMaxVy,
  personalityArchetype,
  riderOf,
  TAXI,
  type CrashReason,
  type Passenger,
  type SimConfig,
  type SimEvent,
  type SimState,
  type Taxi,
} from '@hey-taxi/sim';
import type { Sound } from './audio';
import type { Camera } from './camera';
import { farewellCategory, isUrgentCategory, pickLine, pickUnusedLine, type CommentCategory } from './dialogue';
import { AMMO_COLORS, HUD_COLORS, type Hud } from './render/hud';
import { RESCUE_RED, RESCUE_WHITE } from './render/service';
import {
  arrival,
  decoyBlast,
  dust,
  explosion,
  flareBurst,
  missileBlast,
  sparks,
  type Particles,
} from './render/particles';
import type { PassengerLayer } from './render/passengers';
import { causeCaps, CRASH_CAUSES } from './ui/theme';

/** Each NPC taxi gets its own color (by its number: npc1, npc2, …), cycling through these. */
const RIVAL_PALETTE = [0xff6fae, 0x4fe0c8, 0xb48cff, 0x7fd36b, 0xff9a52, 0x5fb2ff];
export function rivalColor(id: string | null | undefined): number {
  const n = Number(/(\d+)$/.exec(id ?? '')?.[1] ?? 1);
  return RIVAL_PALETTE[(n - 1) % RIVAL_PALETTE.length]!;
}

export const CRASH_TEXT: Record<CrashReason, string> = Object.fromEntries(
  Object.entries(CRASH_CAUSES).map(([k, v]) => [k, v.toUpperCase()]),
) as Record<CrashReason, string>;

export const causeText = causeCaps;

const RATING: Record<string, [string, number]> = {
  smooth: ['SMOOTH LANDING', HUD_COLORS.good],
  ok: ['GOOD LANDING', HUD_COLORS.warn],
  rough: ['ROUGH LANDING', 0xff9f40],
};

const LOW_FUEL = 0.2;
const REFUEL_TICK_INTERVAL = 0.09;
/** Per-cab cooldown (s) between combat/survival passenger reactions so dogfights don't spam. */
const CHATTER_COOLDOWN_S = 4.0;
/** Minimum distance (u) at which a closing homing missile can trigger an `incoming` callout. */
const MIN_INCOMING_THREAT_RANGE = 420;
const CHANCE_INCOMING = 0.6;
const CHANCE_PLAYER_FIRED = 0.55;
const CHANCE_MISSILE_HIT = 0.8;
const CHANCE_HULL_CRITICAL = 0.85;
const CHANCE_LOW_FUEL = 0.65;
const CHANCE_OUT_OF_FUEL = 0.85;
/** After a bumpy drop-off, the cash sound follows the tip-loss blip by this much. */
const CASH_AFTER_CUT_MS = 180;
/** Let the passenger's parting line start cleanly before the cash chime. */
const CASH_AFTER_SPEECH_MS = 260;

export interface EventContext {
  readonly sim: SimState;
  readonly config: SimConfig;
  readonly localId: string;
  readonly spectatingId: string | null;
  readonly particles: Particles;
  readonly sound: Sound;
  readonly hud: Hud;
  readonly passengers: PassengerLayer;
  readonly camera: Camera;
  nameOf(taxiId: string): string;
  drawnAt(taxiId: string): { x: number; y: number };
  onTaxiArrived(taxi: Taxi): void;
  onPassengerSpawned(passenger: Passenger): void;
  isPassengerOnScreen(passenger: Passenger): boolean;
  speakPassenger(text: string, kind: number, passengerId: number, category: CommentCategory): boolean;
}

export class EventPresenter {
  /** Passengers paying in the tick being handled. */
  private payingNow = new Set<number>();
  /** Passengers whose drop-off landing cut their tip this tick (the cash sound follows the cut's). */
  private cutAtDropoff = new Set<number>();
  /** Taxis that took a missile hit or dropped to 1 HP this tick (suppresses mild `rough` barks). */
  private severeDamageThisTick = new Set<string>();
  /** Dialogue lines already spoken by each passenger in their current trip (so complaints never repeat). */
  private usedLines = new Map<number, Set<string>>();
  /** Last combat/survival reaction timestamp (sim seconds) and urgency per taxi. */
  private lastChatter = new Map<string, { at: number; urgent: boolean }>();
  /** Missile IDs already evaluated for an `incoming` passenger warning. */
  private seenIncomingMissiles = new Set<number>();
  private refuelTimer = 0;

  constructor(
    private readonly ctx: EventContext,
    private readonly random: () => number = Math.random,
  ) {}

  reset(): void {
    this.payingNow.clear();
    this.cutAtDropoff.clear();
    this.severeDamageThisTick.clear();
    this.usedLines.clear();
    this.lastChatter.clear();
    this.seenIncomingMissiles.clear();
    this.refuelTimer = 0;
  }

  private pickUniqueLine(passengerId: number, category: CommentCategory, pad = ''): string | null {
    let used = this.usedLines.get(passengerId);
    if (!used) {
      used = new Set();
      this.usedLines.set(passengerId, used);
    }
    return pickUnusedLine(category, used, pad, this.random);
  }

  /**
   * Probabilistically trigger a combat/survival reaction from the rider aboard `taxiId`
   * (player or spectated cab only), respecting a per-cab cooldown while allowing urgent
   * warnings to preempt casual chatter.
   */
  private tryRiderReaction(taxiId: string, category: CommentCategory, chance: number, life = 1.8): boolean {
    if (!this.isRelevantTaxi(taxiId)) return false;
    const p = riderOf(this.ctx.sim, taxiId);
    if (!p) return false;
    const now = this.ctx.sim.tick * DT;
    const urgent = isUrgentCategory(category);
    const prev = this.lastChatter.get(taxiId);
    if (prev && now - prev.at < CHATTER_COOLDOWN_S) {
      if (!urgent || prev.urgent) return false;
    }
    if (this.random() >= chance) return false;
    const line = this.pickUniqueLine(p.id, category);
    if (!line) return false;
    this.lastChatter.set(taxiId, { at: now, urgent });
    this.ctx.passengers.say(`p${p.id}`, line, p.kind, this.aboveTaxi(taxiId), life);
    this.ctx.speakPassenger(line, p.kind, p.id, category);
    return true;
  }

  /**
   * Check for homing missiles closing in on the player (or spectated) cab and let an
   * aboard passenger shout an `incoming` warning at most once per missile ID.
   */
  checkIncomingMissiles(): void {
    const { sim, config } = this.ctx;
    const threatRange = Math.max(config.copilotThreatRange * 1.5, MIN_INCOMING_THREAT_RANGE);
    for (const m of sim.missiles) {
      if (m.life <= 0 || m.spoofed || !m.targetId) continue;
      if (!this.isRelevantTaxi(m.targetId) || this.seenIncomingMissiles.has(m.id)) continue;
      const t = this.taxiById(m.targetId);
      if (!t) continue;
      const dx = t.x - m.x;
      const dy = t.y - m.y;
      if (Math.hypot(dx, dy) > threatRange || dx * m.vx + dy * m.vy <= 0) continue;
      this.seenIncomingMissiles.add(m.id);
      this.tryRiderReaction(t.id, 'incoming', CHANCE_INCOMING, 1.8);
    }
  }

  handle(events: SimEvent[]): void {
    const { sim, config, particles, sound, hud, passengers, camera } = this.ctx;
    // Passengers paying this tick (a tip cut on that same landing is a drop-off cut).
    this.payingNow = new Set(events.flatMap((e) => (e.type === 'fareCompleted' ? [e.passengerId] : [])));
    this.severeDamageThisTick = new Set(
      events.flatMap((e) => (e.type === 'taxiDamaged' && (e.cause === 'missile' || e.hp === 1) ? [e.taxiId] : [])),
    );
    for (const e of events) {
      switch (e.type) {
        case 'landed': {
          const t = this.taxiById(e.taxiId);
          if (!t) break;
          dust(particles, t.x, t.y + TAXI.halfH + TAXI.gearLength * t.gear, e.vy / config.landMaxVy);
          if (!this.isPlayer(e.taxiId)) break;
          const [label, color] = RATING[e.rating]!;
          const pad = sim.level.pads[e.padIndex];
          const where = pad ? (pad.kind === 'fuel' ? 'STORE' : pad.kind === 'teleport' ? 'TELEPORT' : `PAD ${pad.label}`) : 'LEDGE';
          hud.flash(label, color, `${where} · touchdown ${Math.round(e.vy)} u/s`);
          sound.land(e.vy / config.landMaxVy, e.rating);
          this.explainNoBoarding(e.padIndex);
          break;
        }
        case 'crashed': {
          explosion(particles, e.x, e.y, e.vx, e.vy);
          sound.explosion();
          if (e.reason === 'outOfFuel' && this.isPlayer(e.taxiId)) sound.fuelEmpty();
          if (!this.isPlayer(e.taxiId)) {
            const who = this.ctx.nameOf(e.taxiId).toUpperCase();
            const shooter =
              e.reason === 'missile' && e.byTaxiId
                ? this.isPlayer(e.byTaxiId)
                  ? 'YOU'
                  : this.ctx.nameOf(e.byTaxiId).toUpperCase()
                : '';
            const text =
              e.reason === 'missile'
                ? shooter
                  ? `${who} SHOT DOWN BY ${shooter}!`
                  : `${who} SHOT DOWN!`
                : e.reason === 'outOfFuel'
                  ? `${who} RAN DRY!`
                  : `${who} CRASHED!`;
            passengers.float(e.x, e.y - 30, text, e.reason === 'missile' ? HUD_COLORS.warn : rivalColor(e.taxiId));
            if (e.taxiId === this.ctx.spectatingId) {
              const detail =
                e.reason === 'missile' && e.byTaxiId
                  ? `Hit by ${this.ctx.nameOf(e.byTaxiId)}'s missile`
                  : CRASH_TEXT[e.reason];
              hud.flash(`${who} DESTROYED`, HUD_COLORS.bad, detail);
              camera.addShake(0.6);
            }
            break;
          }
          const speed = Math.round(Math.hypot(e.vx, e.vy));
          const detail =
            e.reason === 'missile' && e.byTaxiId
              ? `${this.ctx.nameOf(e.byTaxiId)}'s missile`
              : e.reason === 'hardLanding'
                ? `↓ ${Math.round(e.vy)} / → ${Math.abs(Math.round(e.vx))} u/s  (limit ↓ ${landingMaxVy(config, e.vx)} / → ${config.landMaxVx})`
                : `${speed} u/s`;
          hud.flash(`CRASH · ${CRASH_TEXT[e.reason]}`, HUD_COLORS.bad, detail);
          camera.addShake(0.8);
          break;
        }
        case 'arrived': {
          const t = this.taxiById(e.taxiId);
          if (!t) break;
          this.ctx.onTaxiArrived(t);
          if (!this.isPlayer(e.taxiId)) {
            arrival(particles, t.x, t.y, rivalColor(t.id));
            sound.rivalArrives();
            const arch = personalityArchetype(t.personality).toUpperCase();
            const onDuty = sim.taxis.filter((r) => r.npc && (r.status === 'flying' || r.status === 'landed')).length;
            const sub = onDuty > 1 ? `${arch} · ${onDuty} other taxis here now.` : `${arch} · Beat them to the passengers!`;
            hud.flash(`${this.ctx.nameOf(t.id).toUpperCase()} ARRIVES`, rivalColor(t.id), sub);
          }
          break;
        }
        case 'gear':
          if (this.isPlayer(e.taxiId)) sound.gearMotor(e.down, config.gearTime);
          break;
        case 'gearLocked':
          if (this.isPlayer(e.taxiId)) sound.gearLock(e.down);
          break;
        case 'taxiBump': {
          const mine = e.taxiIds.includes(this.ctx.localId);
          sparks(particles, e.x, e.y, Math.min(1, e.speed / 150));
          sound.taxiBump(Math.min(1, e.speed / 150) * (mine ? 1 : 0.4));
          if (mine) camera.addShake(Math.min(0.5, e.speed / 300));
          break;
        }
        case 'fuelEmpty': {
          const at = this.ctx.drawnAt(e.taxiId);
          if (this.isPlayer(e.taxiId)) {
            sound.fuelEmpty();
            hud.flash('OUT OF FUEL', HUD_COLORS.bad, 'Engines dead · glide to a landing (R for rescue)');
          } else {
            passengers.float(at.x, at.y - 34, 'OUT OF FUEL!', rivalColor(e.taxiId));
          }
          this.tryRiderReaction(e.taxiId, 'outOfFuel', CHANCE_OUT_OF_FUEL, 2.0);
          break;
        }
        case 'serviceSummoned': {
          if (this.isPlayer(e.taxiId)) {
            sound.rescueSummoned();
            hud.flash('+ RESCUE DISPATCHED', RESCUE_WHITE, 'Rescue ambulance en route · 2× store prices');
          } else {
            const at = this.ctx.drawnAt(e.taxiId);
            passengers.float(at.x, at.y - 38, '+ CALLING RESCUE', RESCUE_WHITE);
          }
          break;
        }
        case 'serviceArrived': {
          arrival(particles, e.x, e.y, RESCUE_RED, RESCUE_WHITE);
          if (this.isPlayer(e.taxiId)) {
            sound.rescueArrived();
            hud.flash('+ RESCUE SERVICE READY', RESCUE_WHITE, 'Press 1–5 or click to buy · take off to dismiss');
          }
          break;
        }
        case 'serviceDeparted': {
          break;
        }
        case 'vendettaStarted': {
          const at = this.ctx.drawnAt(e.taxiId);
          const who = this.ctx.nameOf(e.taxiId).toUpperCase();
          const targetingYou = this.isPlayer(e.targetId);
          const target = targetingYou ? 'YOU' : this.ctx.nameOf(e.targetId).toUpperCase();
          passengers.float(at.x, at.y - 44, `VENDETTA → ${target}!`, targetingYou ? HUD_COLORS.bad : HUD_COLORS.warn);
          if (targetingYou) {
            hud.flash('VENDETTA!', HUD_COLORS.bad, `${who} is hunting you!`);
          } else {
            hud.flash('RIVALRY', HUD_COLORS.warn, `${who} has a vendetta against ${target}`);
          }
          break;
        }
        case 'vendettaEnded': {
          if (e.reason === 'cooledOff') {
            const at = this.ctx.drawnAt(e.taxiId);
            passengers.float(at.x, at.y - 40, 'COOLED OFF', 0x8a93b8);
          }
          break;
        }
        case 'npcFleeing': {
          const at = this.ctx.drawnAt(e.taxiId);
          passengers.float(at.x, at.y - 42, 'FLEEING!', 0x8cc8ff);
          break;
        }
        case 'missileBurnout':
          sparks(particles, e.x, e.y, 0.3);
          break;
        case 'missileFired':
          sound.missileLaunch();
          this.tryRiderReaction(e.ownerId, 'playerFired', CHANCE_PLAYER_FIRED, 1.8);
          break;
        case 'flaresDeployed': {
          const t = this.taxiById(e.taxiId);
          flareBurst(particles, e.x, e.y, t?.vx ?? 0, t?.vy ?? 0);
          sound.flares();
          // The outcome shows later, where a fooled missile blows up on a flare.
          const label = this.isPlayer(e.taxiId)
            ? e.auto
              ? 'CO-PILOT: FLARES!'
              : 'FLARES!'
            : `${this.ctx.nameOf(e.taxiId).split(' ')[0]!.toUpperCase()} FLARES!`;
          passengers.float(e.x, e.y - 34, label, this.isPlayer(e.taxiId) ? AMMO_COLORS.flare : rivalColor(e.taxiId));
          break;
        }
        case 'copilotReaction':
          if (this.isPlayer(e.taxiId) && !e.timely) {
            const me = this.taxiById(this.ctx.localId);
            if (!me) break;
            hud.flash(
              'CO-PILOT TOO SLOW',
              HUD_COLORS.bad,
              me.flares > 0 ? 'Missile closing in: press C for flares!' : 'No flares: dodge, or get to a store or teleport!',
            );
          }
          break;
        case 'copilotUnable':
          if (this.isPlayer(e.taxiId)) {
            hud.flash(
              e.reason === 'noFlares' ? 'CO-PILOT: NO FLARES LEFT' : 'CO-PILOT: FLARES COOLING DOWN',
              HUD_COLORS.bad,
              e.reason === 'noFlares' ? 'Dodge, or get to a store or teleport!' : 'Dodge!',
            );
          }
          break;
        case 'taxiDamaged': {
          const missile = e.cause === 'missile';
          if (missile) missileBlast(particles, e.x, e.y);
          sparks(particles, e.x, e.y, missile ? 1 : 0.6);
          sound.taxiBump(missile ? 1 : 0.7);
          const max = config.taxiMaxHp;
          const at = this.ctx.drawnAt(e.taxiId);
          if (this.isPlayer(e.taxiId)) {
            camera.addShake(missile ? 0.5 : 0.3);
            passengers.float(at.x, at.y - 34, `HULL ${e.hp}/${max}`, HUD_COLORS.bad);
            if (e.hp <= config.missileDamage) {
              const left = e.hp === 1 ? 'One more collision will destroy your taxi' : 'One more missile hit will destroy your taxi';
              hud.flash('HULL CRITICAL', HUD_COLORS.bad, `${left} · repair at a store (3)`);
            }
          } else if (missile || e.byTaxiId === this.ctx.localId) {
            passengers.float(
              at.x,
              at.y - 34,
              `${this.ctx.nameOf(e.taxiId).split(' ')[0]!.toUpperCase()} HIT ${e.hp}/${max}`,
              e.byTaxiId === this.ctx.localId ? HUD_COLORS.good : rivalColor(e.taxiId),
            );
          }
          if (e.hp === 1) {
            this.severeDamageThisTick.add(e.taxiId);
            this.tryRiderReaction(e.taxiId, 'hullCritical', CHANCE_HULL_CRITICAL, 1.8);
          } else if (missile) {
            this.severeDamageThisTick.add(e.taxiId);
            this.tryRiderReaction(e.taxiId, 'missileHit', CHANCE_MISSILE_HIT, 1.8);
          }
          break;
        }
        case 'purchase':
          if (this.isPlayer(e.taxiId)) {
            const at = this.ctx.drawnAt(e.taxiId);
            sound.purchase();
            const what = e.item === 'gas' ? `${e.gallons ?? 0} gal` : e.item;
            passengers.float(at.x, at.y - 34, `-$${e.price.toFixed(2)} ${what}`, AMMO_COLORS[e.item]);
          }
          break;
        case 'missileExploded':
          if (e.decoyed) {
            decoyBlast(particles, e.x, e.y);
            const mine = e.flareOwnerId === this.ctx.localId;
            passengers.float(e.x, e.y - 24, 'DECOYED!', mine ? HUD_COLORS.good : rivalColor(e.flareOwnerId));
          }
          // A hit on a taxi already gets the big crash explosion.
          if (!e.hitTaxiId && !e.decoyed) missileBlast(particles, e.x, e.y);
          sound.missileBlast(e.hitTaxiId !== null);
          if (e.hitTaxiId) camera.addShake(0.3);
          break;
        case 'tookOff':
          break;
        default:
          this.handlePassengerEvent(e);
      }
    }
  }

  fuelSounds(before: number, after: number): void {
    const max = this.ctx.config.fuelMax;
    if (after < before && before > max * LOW_FUEL && after <= max * LOW_FUEL && after > 0) {
      this.ctx.sound.lowFuel();
      this.ctx.hud.flash('LOW FUEL', HUD_COLORS.warn, 'Buy gas at a store (4 / 5) · an empty tank explodes');
      this.tryRiderReaction(this.ctx.localId, 'lowFuel', CHANCE_LOW_FUEL, 2.0);
    }
    if (after > before) {
      this.refuelTimer -= DT;
      if (this.refuelTimer <= 0) {
        this.refuelTimer = REFUEL_TICK_INTERVAL;
        this.ctx.sound.refuelTick(after / max);
      }
    } else {
      this.refuelTimer = 0;
    }
  }

  private isPlayer(taxiId: string): boolean {
    return taxiId === this.ctx.localId;
  }

  private taxiById(id: string): Taxi | undefined {
    return this.ctx.sim.taxis.find((t) => t.id === id);
  }

  private passenger(id: number): Passenger | undefined {
    return this.ctx.sim.passengers.find((p) => p.id === id);
  }

  /** Bubble anchor above a taxi (riders talk from inside the cab). */
  private aboveTaxi = (taxiId: string) => () => {
    const at = this.ctx.drawnAt(taxiId);
    const tagRoom = this.isPlayer(taxiId) ? 0 : 6; // clear the NPC taxi's cash/hull/fuel readout
    return { x: at.x, y: at.y - TAXI.halfH - 4 - tagRoom };
  };

  /**
   * The player just landed on `padIndex`. If someone there won't board, say why, instead of
   * leaving them standing silently (which looks like a bug).
   */
  private explainNoBoarding(padIndex: number): void {
    if (padIndex < 0) return;
    const { sim, localId, passengers, hud } = this.ctx;
    const here = sim.passengers.filter((p) => p.padIndex === padIndex);
    const head = (p: Passenger) => () => passengers.headOf(p);
    const waiting = here.find((p) => p.state === 'waiting');
    if (waiting && riderOf(sim, localId)) {
      const line = this.pickUniqueLine(waiting.id, 'full');
      if (line) {
        passengers.say(`p${waiting.id}`, line, waiting.kind, head(waiting), 2.2);
        this.ctx.speakPassenger(line, waiting.kind, waiting.id, 'full');
      }
      hud.flash('TAXI FULL', HUD_COLORS.warn, 'Drop off your passenger first, then come back');
      return;
    }
    const takenByRival = here.find((p) => p.state === 'walking' && p.taxiId !== localId);
    if (takenByRival) {
      const line = this.pickUniqueLine(takenByRival.id, 'otherCab');
      if (line) {
        passengers.say(`p${takenByRival.id}`, line, takenByRival.kind, head(takenByRival), 2.2);
        this.ctx.speakPassenger(line, takenByRival.kind, takenByRival.id, 'otherCab');
      }
      hud.flash('TOO SLOW!', rivalColor(takenByRival.taxiId), 'This passenger already hailed a rival');
    }
  }

  private isRelevantTaxi(taxiId: string): boolean {
    return this.isPlayer(taxiId) || taxiId === this.ctx.spectatingId;
  }

  private handlePassengerEvent(e: SimEvent): void {
    const { sim, config, sound, hud, passengers } = this.ctx;
    const pads = sim.level.pads;
    switch (e.type) {
      case 'passengerSpawned': {
        const p = this.passenger(e.passengerId);
        if (p) this.ctx.onPassengerSpawned(p);
        break;
      }
      case 'passengerBoarded': {
        const p = this.passenger(e.passengerId);
        const destPad = pads[e.destPadIndex];
        if (!p || !destPad) break;
        const mine = this.isPlayer(e.taxiId);
        if (mine) sound.board();
        const line = pickLine('board', destPad.label);
        passengers.say(`p${p.id}`, line, p.kind, this.aboveTaxi(e.taxiId));
        if (this.isRelevantTaxi(e.taxiId)) this.ctx.speakPassenger(line, p.kind, p.id, 'board');
        break;
      }
      case 'passengerAnnoyed': {
        const p = this.passenger(e.passengerId);
        if (!p) break;
        const line = this.pickUniqueLine(p.id, 'annoyed');
        if (line) {
          passengers.say(`p${p.id}`, line, p.kind, () => passengers.headOf(p));
          if (this.ctx.isPassengerOnScreen(p)) this.ctx.speakPassenger(line, p.kind, p.id, 'annoyed');
        }
        break;
      }
      case 'tipLost': {
        if (!this.isPlayer(e.taxiId)) break;
        const p = this.passenger(e.passengerId);
        const at = this.ctx.drawnAt(e.taxiId);
        const dropOff = this.payingNow.has(e.passengerId);
        if (dropOff) this.cutAtDropoff.add(e.passengerId);
        sound.tipLost();
        // Always in the same place: just beside the cab at cab height, to its right (or left
        // at drop-off if the passenger steps out to the right).
        const left = dropOff && p?.dir === 1;
        const edge = TAXI.halfW + 8;
        passengers.float(left ? at.x - edge : at.x + edge, at.y, `TIP -$${e.amount.toFixed(2)}`, HUD_COLORS.bad, {
          anchorX: left ? 1 : 0,
          placed: true,
        });
        // The rider complains mid-ride; at drop-off their parting line says it instead.
        // Skip mild `rough` barks when a missile hit or critical hull already handled the reaction.
        if (
          p &&
          e.reason !== 'okLanding' &&
          e.reason !== 'wrongLanding' &&
          !dropOff &&
          !this.severeDamageThisTick.has(e.taxiId)
        ) {
          const line = this.pickUniqueLine(p.id, 'rough');
          if (line) {
            passengers.say(`p${p.id}`, line, p.kind, this.aboveTaxi(e.taxiId), 1.4);
            this.ctx.speakPassenger(line, p.kind, p.id, 'rough');
          }
        }
        break;
      }
      case 'wrongLanding': {
        const p = this.passenger(e.passengerId);
        if (p) {
          const destLabel = pads[p.destPadIndex]?.label ?? '';
          const line = this.pickUniqueLine(p.id, 'wrongPad', destLabel);
          if (line) {
            passengers.say(`p${p.id}`, line, p.kind, this.aboveTaxi(e.taxiId), 1.8);
            if (this.isRelevantTaxi(e.taxiId)) this.ctx.speakPassenger(line, p.kind, p.id, 'wrongPad');
          }
        }
        break;
      }
      case 'rideLate': {
        if (!this.isPlayer(e.taxiId)) break;
        const p = this.passenger(e.passengerId);
        if (p) {
          const line = this.pickUniqueLine(p.id, 'late');
          if (line) {
            passengers.say(`p${p.id}`, line, p.kind, this.aboveTaxi(e.taxiId), 1.8);
            this.ctx.speakPassenger(line, p.kind, p.id, 'late');
          }
        }
        break;
      }
      case 'fareCompleted': {
        this.usedLines.delete(e.passengerId);
        const p = this.passenger(e.passengerId);
        const mine = this.isPlayer(e.taxiId);
        const at = this.ctx.drawnAt(e.taxiId);
        const tipFrac = e.tipPercent / Math.max(1, config.tipPercentMax);
        const category = farewellCategory(e);
        const line = pickLine(category);
        let spoke = false;
        if (p) {
          passengers.say(`p${p.id}`, line, p.kind, () => passengers.headOf(p), 1.8);
          if (this.isRelevantTaxi(e.taxiId)) spoke = this.ctx.speakPassenger(line, p.kind, p.id, category);
        }
        // Never a negative tip: it bottoms out at $0.00.
        const tip = Math.max(0, e.tip);
        const total = e.fare + tip;
        if (!mine) {
          passengers.float(
            at.x,
            at.y - 30,
            `${this.ctx.nameOf(e.taxiId).split(' ')[0]!.toUpperCase()} +$${total.toFixed(2)}`,
            rivalColor(e.taxiId),
          );
          break;
        }
        const pct = `${Math.floor(e.tipPercent)}%`;
        passengers.float(at.x, at.y - TAXI.halfH - 40, `FARE $${e.fare.toFixed(2)} + TIP $${tip.toFixed(2)} (${pct})`, HUD_COLORS.text, {
          size: 13,
          life: 2.6,
          placed: true,
        });
        passengers.float(at.x, at.y - TAXI.halfH - 62, `+$${total.toFixed(2)}`, HUD_COLORS.good, { size: 22, life: 2.6, placed: true });
        const early = e.earlyBonus >= 0.5 ? `, early +${Math.floor(e.earlyBonus)}%` : '';
        hud.flash(`PAID $${total.toFixed(2)}`, HUD_COLORS.good, `Fare $${e.fare.toFixed(2)} + tip $${tip.toFixed(2)} (${pct}${early})`);
        const cut = this.cutAtDropoff.delete(e.passengerId);
        const cashDelay = spoke ? CASH_AFTER_SPEECH_MS : cut ? CASH_AFTER_CUT_MS : 0;
        if (cashDelay > 0) setTimeout(() => sound.cash(tipFrac), cashDelay);
        else sound.cash(tipFrac);
        break;
      }
      case 'passengerLost': {
        this.usedLines.delete(e.passengerId);
        const at = this.ctx.drawnAt(e.taxiId);
        passengers.float(at.x, at.y - 30, 'PASSENGER LOST', this.isPlayer(e.taxiId) ? HUD_COLORS.bad : rivalColor(e.taxiId));
        break;
      }
      case 'passengerHit': {
        this.usedLines.delete(e.passengerId);
        const at = { x: e.x, y: e.y - 26 };
        const line = pickLine('hit');
        passengers.say(`hit${e.passengerId}`, line, 0, () => at, 1.5);
        sound.bonk();
        if (this.isRelevantTaxi(e.taxiId)) {
          this.ctx.speakPassenger(line, e.passengerId % 4, e.passengerId, 'hit');
        }
        if (!this.isPlayer(e.taxiId)) break;
        passengers.float(e.x, e.y - 48, `-$${e.penalty.toFixed(2)}`, HUD_COLORS.bad);
        hud.flash('YOU HIT A PASSENGER', HUD_COLORS.bad, 'Land beside them, not on them');
        break;
      }
      default:
        break;
    }
  }
}
