import { post, toCents } from './accounts';
/**
 * Heat-seeking missiles. A taxi fires one (Input.FIRE); it launches upward/toward the nearest
 * other taxi, accelerates, and steers toward its target with a limited turn rate, so a nimble
 * pilot can dodge. Its motor has a limited burn (range): once it's out the missile falls and
 * explodes on the first thing it hits. It explodes on walls and on any taxi except its owner.
 * A hit taxi crashes (reason "missile"). Passengers are never harmed.
 */
import { DT, TAXI, TICK_RATE } from './constants';
import { envForceAt, pointHitsLaser, pointInGravityCore, windAt } from './env';
import { isSolid } from './level';
import { nextRandom } from './rng';
import { atService } from './service';
import { atStore, atTeleport, crash, isActive, type SimEvent, type SimState, type Taxi } from './sim';

export interface Missile {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Taxi it's homing on, or null (flies straight until something comes into range). */
  targetId: string | null;
  /**
   * Ticks of motor left (limited range). When it reaches 0 the motor is out: no more thrust
   * or steering, the missile falls under gravity and explodes on the first thing it hits.
   */
  life: number;
  /** Ticks spent falling with the motor out (a safety cap, in case it never hits anything). */
  fallTicks: number;
  /** Flare it was fooled into chasing (null if none, or once that flare burns out). */
  decoyId: number | null;
  /** Fooled by flares: it never re-acquires a taxi and can't hit one. */
  spoofed: boolean;
  /** Co-pilot decisions about this missile, by taxi: reacted in time (true) or too late. */
  reactions: Record<string, boolean>;
}

/** Missile nose radius used for hits. */
export const MISSILE_RADIUS = 4;
/** Collision sub-step length (units). */
const SUBSTEP = 4;

export function fireMissile(s: SimState, t: Taxi, ev: SimEvent[]): void {
  const c = s.config;
  if (!isActive(t) || t.fireCooldownTicks > 0) return;
  if (!c.missilesUnlimited && t.missiles <= 0) return;
  // If this taxi has an active vendetta target in the same locale that is targetable, lock onto them.
  const preferred = t.vendettaTargetId ? s.taxis.find((o) => o.id === t.vendettaTargetId && o !== t && targetable(s, o)) : undefined;
  const target = preferred ?? nearestTarget(s, t.id, t.x, t.y);
  // Launch from just above the cab (never into the ground when landed).
  const x = t.x;
  const y = t.y - TAXI.halfH - 6;
  let angle = -Math.PI / 2; // straight up by default
  if (target) {
    const a = Math.atan2(target.y - y, target.x - x);
    // Start somewhere between "up" and "at the target" so missiles arc out of the launcher.
    angle = -Math.PI / 2 + wrap(a + Math.PI / 2) * 0.5;
  }
  const m: Missile = {
    id: s.nextMissileId++,
    ownerId: t.id,
    x,
    y,
    vx: Math.cos(angle) * c.missileLaunchSpeed + t.vx * 0.5,
    vy: Math.sin(angle) * c.missileLaunchSpeed + t.vy * 0.5,
    targetId: target?.id ?? null,
    life: Math.round(c.missileLife * TICK_RATE),
    fallTicks: 0,
    decoyId: null,
    spoofed: false,
    reactions: {},
  };
  s.missiles.push(m);
  t.fireCooldownTicks = Math.round(c.missileCooldown * TICK_RATE);
  if (!c.missilesUnlimited) {
    t.missiles--;
    if (c.missileReload > 0 && t.missileReloadTicks <= 0) t.missileReloadTicks = Math.round(c.missileReload * TICK_RATE);
  }
  ev.push({ type: 'missileFired', missileId: m.id, ownerId: t.id, x, y });
}

/**
 * Pop a burst of flares: every missile chasing this taxi within flareRange independently has a
 * flareSuccess chance (seeded RNG) of being decoyed — it veers into the flares and explodes.
 */
export function deployFlares(s: SimState, t: Taxi, ev: SimEvent[], auto = false): void {
  const c = s.config;
  if (!isActive(t) || t.flares <= 0 || t.flareCooldownTicks > 0) return;
  t.flares--;
  t.flareCooldownTicks = Math.round(c.flareCooldown * TICK_RATE);

  // Eject burning flares from under the cab: one straight down, two fanning out to the sides.
  const burst: Decoy[] = FLARE_PATTERN.map(([angle, speed]) => ({
    id: s.nextMissileId++,
    ownerId: t.id,
    x: t.x,
    y: t.y + TAXI.halfH,
    vx: Math.cos(angle) * speed + t.vx * 0.5,
    vy: Math.sin(angle) * speed + t.vy * 0.5,
    life: Math.round(c.flareBurnTime * TICK_RATE),
  }));
  s.decoys.push(...burst);

  // Each missile closing in on this taxi within range rolls once: decoyed ones switch to
  // chasing the nearest flare. Missiles still far off, or flying away, aren't fooled.
  let threats = 0;
  let decoyed = 0;
  for (const m of s.missiles) {
    if (m.targetId !== t.id) continue;
    const dx = t.x - m.x;
    const dy = t.y - m.y;
    if (Math.hypot(dx, dy) > c.flareRange || dx * m.vx + dy * m.vy <= 0) continue;
    threats++;
    if (nextRandom(s) < c.flareSuccess) {
      decoyed++;
      const lure = burst.reduce((a, b) => (Math.hypot(b.x - m.x, b.y - m.y) < Math.hypot(a.x - m.x, a.y - m.y) ? b : a));
      m.decoyId = lure.id;
      m.targetId = null;
      m.spoofed = true;
    }
  }
  ev.push({ type: 'flaresDeployed', taxiId: t.id, x: t.x, y: t.y, decoyed, threats, auto });
}

/** A burning countermeasure flare: falls, bounces to rest on surfaces, burns out. */
export interface Decoy {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks of burn left. */
  life: number;
}

/** [angle, speed] for each flare in a burst: down-left, straight down, down-right. */
const FLARE_PATTERN: [number, number][] = [
  [Math.PI / 2 + 0.9, 170],
  [Math.PI / 2, 120],
  [Math.PI / 2 - 0.9, 170],
];
const FLARE_GRAVITY = 160;
const FLARE_DRAG = 1.2;
/** Distance at which a missile chasing a flare detonates on it. */
const FLARE_FUSE = 10;

function stepDecoys(s: SimState): void {
  if (!s.decoys.length) return;
  const ts = s.level.tileSize;
  for (const d of s.decoys) {
    d.life--;
    if (s.level.wind) d.vx += windAt(s.level, s.tick, d.x, d.y).ax * 0.9 * DT;
    d.vy += FLARE_GRAVITY * DT;
    const k = Math.max(0, 1 - FLARE_DRAG * DT);
    d.vx *= k;
    d.vy *= k;
    const nx = d.x + d.vx * DT;
    const ny = d.y + d.vy * DT;
    if (isSolid(s.level, Math.floor(nx / ts), Math.floor(ny / ts))) {
      // Hit a surface: stop and keep burning where it landed.
      d.vx = 0;
      d.vy = 0;
    } else {
      d.x = nx;
      d.y = ny;
    }
  }
  s.decoys = s.decoys.filter((d) => d.life > 0);
}

/** Price multiplier for shopping where the taxi is parked: 1 at a store, servicePriceMultiplier at a service craft, 0 elsewhere. */
export function shopMultiplier(s: SimState, t: Taxi): number {
  if (atStore(s, t)) return 1;
  if (atService(s, t)) return s.config.servicePriceMultiplier;
  return 0;
}

/** Buy one item (gas: one gallon). Works while parked at a store or docked with a service craft. */
export function buy(s: SimState, t: Taxi, item: StoreItem, ev: SimEvent[]): void {
  const c = s.config;
  const mult = shopMultiplier(s, t);
  if (mult <= 0) return;
  const service = !atStore(s, t);
  if (item === 'gas') {
    pumpGas(s, t, 1, mult, service, ev);
    return;
  }
  const { price, have, cap } = storeItem(s, t, item, mult);
  const cost = toCents(price);
  if (t.cents < cost || have >= cap) return; // rejected: no debit
  if (item === 'missile') t.missiles++;
  else if (item === 'flare') t.flares++;
  else t.hp = Math.min(c.taxiMaxHp, t.hp + 1);
  ev.push({ type: 'purchase', taxiId: t.id, item, price: cost / 100, ...(service ? { service: true } : {}) });
  post(s, t, item, -cost, `${service ? 'service' : 'store'}:${item}`, ev);
}

/** Fill the tank at a store or service craft, or as much of it as this taxi can afford. One purchase. */
export function fillUp(s: SimState, t: Taxi, ev: SimEvent[]): void {
  const mult = shopMultiplier(s, t);
  if (mult <= 0) return;
  pumpGas(s, t, Infinity, mult, !atStore(s, t), ev);
}

/**
 * Pump up to `maxGallons` into the tank, limited by tank space and cash. Priced in whole
 * cents, rounded up, so rounding can never give fuel away; a purchase that fills the tank
 * pays for the space it filled (up to a cent over), a cash-limited one gets exactly what
 * its cents buy. Never on credit.
 */
function pumpGas(s: SimState, t: Taxi, maxGallons: number, mult: number, service: boolean, ev: SimEvent[]): void {
  const c = s.config;
  const perGallon = toCents(c.gallonPrice * mult);
  if (perGallon <= 0) return;
  const space = Math.max(0, (c.fuelMax - t.fuel) / c.fuelPerGallon);
  const wanted = Math.min(maxGallons, space);
  const cost = Math.min(Math.ceil(wanted * perGallon - 1e-9), Math.max(0, t.cents));
  if (cost <= 0) return; // tank full, or broke
  const gallons = Math.min(wanted, cost / perGallon);
  t.fuel = Math.min(c.fuelMax, t.fuel + gallons * c.fuelPerGallon);
  ev.push({
    type: 'purchase',
    taxiId: t.id,
    item: 'gas',
    price: cost / 100,
    gallons: Math.round(gallons * 100) / 100,
    ...(service ? { service: true } : {}),
  });
  post(s, t, 'gas', -cost, `${service ? 'service' : 'store'}:gas`, ev);
}

export type StoreItem = 'missile' | 'flare' | 'repair' | 'gas';

/**
 * Price, how many this taxi has, and the most it can have, for a store item. Gas is counted
 * in gallons (price per gallon). `priceMultiplier` scales the unit price (2 for mobile service).
 */
export function storeItem(
  s: SimState,
  t: Taxi,
  item: StoreItem,
  priceMultiplier = 1,
): { price: number; have: number; cap: number } {
  const c = s.config;
  if (item === 'missile') return { price: c.missilePrice * priceMultiplier, have: t.missiles, cap: c.missileMax };
  if (item === 'flare') return { price: c.flarePrice * priceMultiplier, have: t.flares, cap: c.flareMax };
  if (item === 'gas') {
    return { price: c.gallonPrice * priceMultiplier, have: t.fuel / c.fuelPerGallon, cap: c.fuelMax / c.fuelPerGallon };
  }
  return { price: c.repairPrice * priceMultiplier, have: t.hp, cap: c.taxiMaxHp };
}

/** Can a missile see/hit this taxi? Not if it's gone, or parked safe at a store or teleport. */
export function targetable(s: SimState, t: Taxi): boolean {
  return isActive(t) && !atStore(s, t) && !atTeleport(s, t);
}

/** Cooldowns and (optional) free regeneration, then fly, steer and collide every missile. */
export function stepMissiles(s: SimState, ev: SimEvent[]): void {
  const c = s.config;
  for (const t of s.taxis) {
    if (t.fireCooldownTicks > 0) t.fireCooldownTicks--;
    if (t.flareCooldownTicks > 0) t.flareCooldownTicks--;
    if (c.missileReload > 0 && t.missiles < c.missileMax && --t.missileReloadTicks <= 0) {
      t.missiles++;
      t.missileReloadTicks = t.missiles < c.missileMax ? Math.round(c.missileReload * TICK_RATE) : 0;
    }
  }
  stepDecoys(s);
  if (!s.missiles.length) return;

  const done = new Set<Missile>();
  for (const m of s.missiles) {
    // Motor out: a dead missile falls (no thrust or steering) under local gravity/wind until it hits something.
    if (m.life <= 0) {
      const f = envForceAt(s.level, c, s.tick, m.x, m.y);
      m.vx += f.ax * DT;
      m.vy += f.ay * DT;
      m.fallTicks++;
      const hit = moveMissile(s, m, null, false);
      if (hit.taxi) {
        done.add(m);
        ev.push({ type: 'missileExploded', missileId: m.id, x: m.x, y: m.y, hitTaxiId: hit.taxi.id });
        damage(s, hit.taxi, m, ev);
      } else if (hit.wall || m.fallTicks > MAX_FALL_TICKS) {
        done.add(m);
        ev.push({ type: 'missileExploded', missileId: m.id, x: m.x, y: m.y, hitTaxiId: null });
      }
      continue;
    }
    // A fooled missile chases its flare; if the flare burns out it has lost lock for good.
    let lure = m.decoyId === null ? undefined : s.decoys.find((d) => d.id === m.decoyId);
    if (m.decoyId !== null && !lure) m.decoyId = null;
    let target: Taxi | undefined;
    if (!m.spoofed) {
      target = m.targetId === null ? undefined : s.taxis.find((t) => t.id === m.targetId);
      if (!target || !targetable(s, target)) {
        target = nearestTarget(s, m.ownerId, m.x, m.y);
        m.targetId = target?.id ?? null;
      }
    }

    // Steer: rotate velocity toward the flare or target (or, if a wall is in the way, toward
    // the nearest clear direction), limited by the turn rate; speed up.
    let speed = Math.hypot(m.vx, m.vy);
    let heading = Math.atan2(m.vy, m.vx);
    const lookahead = Math.max(48, speed * 0.3);
    let want = heading;
    let turnRate = c.missileTurnRate;
    if (lure) {
      want = Math.atan2(lure.y - m.y, lure.x - m.x);
      turnRate *= 1.6; // the seeker snaps onto the much hotter flare
    } else if (target) {
      // Straight at the target if there's a clear line; otherwise chase the farthest visible
      // point on a tile-grid route to it (so it can find its way around buildings).
      const [ax, ay] = aimPoint(s, m, target);
      want = Math.atan2(ay - m.y, ax - m.x);
    }
    if (!clearRay(s, m.x, m.y, want, lookahead)) {
      const dodge = AVOID_OFFSETS.map((o) => want + o).find((a) => clearRay(s, m.x, m.y, a, lookahead));
      if (dodge !== undefined) {
        want = dodge;
        turnRate *= 2; // swerving around an obstacle is sharper than tracking
      }
    }
    if (lure || target || want !== heading) {
      const maxTurn = turnRate * DT;
      heading += Math.max(-maxTurn, Math.min(maxTurn, wrap(want - heading)));
    }
    speed = Math.min(c.missileSpeed, speed + c.missileAccel * DT);
    m.vx = Math.cos(heading) * speed;
    m.vy = Math.sin(heading) * speed;
    // Environmental forces (wind gusts, radial gravity wells) visibly curve powered missiles.
    if (s.level.wind || s.level.gravityWells.length) {
      const f = envForceAt(s.level, c, s.tick, m.x, m.y);
      // Subtract base downward gravity so powered missiles only bend to wind and radial wells.
      const baseG = c.gravity * s.level.gravityScale;
      m.vx += f.ax * 0.65 * DT;
      m.vy += (f.ay - baseG) * 0.65 * DT;
    }

    const { taxi: hitTaxi, wall: hitWall, flare: hitFlare } = moveMissile(s, m, lure ?? null, m.spoofed);

    if (hitFlare && lure) {
      done.add(m);
      ev.push({
        type: 'missileExploded',
        missileId: m.id,
        x: m.x,
        y: m.y,
        hitTaxiId: null,
        decoyed: true,
        flareOwnerId: lure.ownerId,
      });
      lure = undefined;
    } else if (hitTaxi) {
      done.add(m);
      ev.push({ type: 'missileExploded', missileId: m.id, x: m.x, y: m.y, hitTaxiId: hitTaxi.id });
      damage(s, hitTaxi, m, ev);
    } else if (hitWall) {
      done.add(m);
      ev.push({ type: 'missileExploded', missileId: m.id, x: m.x, y: m.y, hitTaxiId: null });
    } else if (--m.life <= 0) {
      // Out of range: the motor quits and it drops (falls from next tick on).
      m.targetId = null;
      m.decoyId = null;
      ev.push({ type: 'missileBurnout', missileId: m.id, x: m.x, y: m.y });
    }
  }
  if (done.size) s.missiles = s.missiles.filter((m) => !done.has(m));
}

/** A falling missile gives up after this long (only if it somehow never hits anything). */
const MAX_FALL_TICKS = 15 * TICK_RATE;

/**
 * Move a missile one tick in small steps (so it can't tunnel through thin walls or taxis),
 * stopping at the first wall, taxi (not its owner, not one safe at a store) or flare it
 * touches. A spoofed seeker is locked onto a flare, not a taxi: it doesn't detonate on taxis.
 */
function moveMissile(
  s: SimState,
  m: Missile,
  lure: Decoy | null,
  ignoreTaxis: boolean,
): { taxi: Taxi | null; wall: boolean; flare: boolean } {
  const dx = m.vx * DT;
  const dy = m.vy * DT;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SUBSTEP));
  let taxi: Taxi | null = null;
  let wall = false;
  let flare = false;
  const ts = s.level.tileSize;
  for (let i = 0; i < n && !taxi && !wall && !flare; i++) {
    m.x += dx / n;
    m.y += dy / n;
    wall =
      isSolid(s.level, Math.floor(m.x / ts), Math.floor(m.y / ts)) ||
      (s.level.laserGates.length > 0 && pointHitsLaser(s.level, s.tick, m.x, m.y, MISSILE_RADIUS + 2)) ||
      (s.level.gravityWells.length > 0 && pointInGravityCore(s.level, m.x, m.y, MISSILE_RADIUS)) ||
      (s.meteors.length > 0 &&
        s.meteors.some((mt) => mt.warnTicks === 0 && Math.hypot(mt.x - m.x, mt.y - m.y) <= mt.radius + MISSILE_RADIUS));
    flare = !!lure && Math.hypot(lure.x - m.x, lure.y - m.y) < FLARE_FUSE;
    if (!ignoreTaxis) taxi = s.taxis.find((t) => t.id !== m.ownerId && targetable(s, t) && touches(t, m)) ?? null;
  }
  return { taxi, wall, flare };
}

/**
 * A missile hit costs one hull point. The last one destroys the taxi (crash, reason
 * "missile"); otherwise a flying taxi is knocked along the missile's path.
 */
function damage(s: SimState, t: Taxi, m: Missile, ev: SimEvent[]): void {
  t.hp = Math.max(0, t.hp - s.config.missileDamage);
  if (t.hp === 0) {
    crash(s, t, 'missile', ev, m.ownerId);
    return;
  }
  if (t.status === 'flying') {
    const speed = Math.hypot(m.vx, m.vy) || 1;
    t.vx += (m.vx / speed) * s.config.missileKnockback;
    t.vy += (m.vy / speed) * s.config.missileKnockback;
  }
  ev.push({ type: 'taxiDamaged', taxiId: t.id, byTaxiId: m.ownerId, cause: 'missile', hp: t.hp, x: m.x, y: m.y });
}

/** Where to steer: the target itself if visible, else the farthest visible tile on a route to it. */
function aimPoint(s: SimState, m: Missile, target: Taxi): [number, number] {
  if (clearLine(s, m.x, m.y, target.x, target.y)) return [target.x, target.y];
  const level = s.level;
  const ts = level.tileSize;
  const route = tileRoute(s, Math.floor(m.x / ts), Math.floor(m.y / ts), Math.floor(target.x / ts), Math.floor(target.y / ts));
  if (!route) return [target.x, target.y];
  // Walk back from the far end; take the first route point we can see.
  for (let k = route.length - 1; k > 0; k--) {
    const [c, r] = route[k]!;
    const px = (c + 0.5) * ts;
    const py = (r + 0.5) * ts;
    if (clearLine(s, m.x, m.y, px, py)) return [px, py];
  }
  const [c, r] = route[Math.min(1, route.length - 1)]!;
  return [(c + 0.5) * ts, (r + 0.5) * ts];
}

/** Breadth-first route over empty tiles (8-connected, no corner cutting). Null if unreachable. */
function tileRoute(s: SimState, c0: number, r0: number, c1: number, r1: number): [number, number][] | null {
  const level = s.level;
  const { cols, rows } = level;
  const empty = (c: number, r: number) => !isSolid(level, c, r);
  if (!empty(c0, r0)) return null;
  const prev = new Int32Array(cols * rows).fill(-2);
  const start = r0 * cols + c0;
  const goal = r1 * cols + c1;
  prev[start] = -1;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    if (i === goal) break;
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!empty(nc, nr) || (dc && dr && (!empty(c + dc, r) || !empty(c, r + dr)))) continue;
      const ni = nr * cols + nc;
      if (prev[ni] !== -2) continue;
      prev[ni] = i;
      queue.push(ni);
    }
  }
  if (prev[goal] === -2) return null;
  const out: [number, number][] = [];
  for (let i = goal; i !== -1; i = prev[i]!) out.push([i % cols, Math.floor(i / cols)]);
  return out.reverse();
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Clear straight line between two points (with the missile's side margin)? */
function clearLine(s: SimState, x0: number, y0: number, x1: number, y1: number): boolean {
  return clearRay(s, x0, y0, Math.atan2(y1 - y0, x1 - x0), Math.hypot(x1 - x0, y1 - y0));
}

/** Could a missile fly straight from (x0, y0) to (x1, y1)? Used by the rival to pick shots. */
export function hasLineOfFire(s: SimState, x0: number, y0: number, x1: number, y1: number): boolean {
  return clearLine(s, x0, y0, x1, y1);
}

/** Headings tried, nearest first, when the way toward the target is blocked. */
const AVOID_OFFSETS = [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75];

/** Is the path `dist` units ahead along `angle` free of walls (with a small margin)? */
function clearRay(s: SimState, x: number, y: number, angle: number, dist: number): boolean {
  const ts = s.level.tileSize;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const margin = 7;
  for (let d = 8; d <= dist; d += 8) {
    const px = x + cos * d;
    const py = y + sin * d;
    // Check the centerline and both sides of the missile's path.
    for (const side of [-margin, 0, margin]) {
      const qx = px - sin * side;
      const qy = py + cos * side;
      if (isSolid(s.level, Math.floor(qx / ts), Math.floor(qy / ts))) return false;
    }
  }
  return true;
}

/** The closest active taxi that isn't the shooter. */
function nearestTarget(s: SimState, ownerId: string, x: number, y: number): Taxi | undefined {
  let best: Taxi | undefined;
  let bestD = Infinity;
  for (const t of s.taxis) {
    if (t.id === ownerId || !targetable(s, t)) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

function touches(t: Taxi, m: Missile): boolean {
  const r = MISSILE_RADIUS;
  return (
    m.x + r > t.x - TAXI.halfW &&
    m.x - r < t.x + TAXI.halfW &&
    m.y + r > t.y - TAXI.halfH &&
    m.y - r < t.y + TAXI.halfH + TAXI.gearLength * t.gear
  );
}

/** Wrap an angle to (-π, π]. */
function wrap(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const twoPi = 2 * Math.PI;
  const r = (((a + Math.PI) % twoPi) + twoPi) % twoPi - Math.PI;
  return r <= -Math.PI ? Math.PI : r;
}
