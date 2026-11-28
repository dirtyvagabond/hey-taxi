import { TAXI } from './constants';
import { levelById } from './content';
import { boxHitsSolid, isSolid, platformSolidBoxes, wrapDelta } from './level';
import type { Passenger, Resident, SimState, Taxi } from './sim';

const FIRST = ['Ada', 'Cleo', 'Robin', 'Jules', 'Sam', 'Pia', 'Alex', 'Sol', 'Morgan', 'Iris', 'Ari', 'Felix', 'Bea', 'Nico', 'Tess', 'June'];
const LAST = ['Vega', 'Park', 'Reed', 'Silva', 'Bell', 'Fox', 'Chen', 'West', 'Patel', 'Wells', 'Kim', 'Cole', 'Rivera', 'Brooks', 'Lin', 'Lane'];

export function newResident(locale: string, serial: number, kind: number): Resident {
  const id = locale + ':' + serial;
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return { id, name: FIRST[hash % FIRST.length] + ' ' + LAST[(hash >>> 16) % LAST.length], originLocale: locale, kind, voiceSeed: hash, rides: 0 };
}

export function canTravel(t: Taxi, localeId: string): boolean {
  return !t.qualifiedLocales || t.qualifiedLocales.includes(localeId);
}

export function needsTransfer(s: SimState, p: Passenger): boolean {
  return !p.temporaryStop && !!p.destination && p.destination.localeId !== (s.localeId ?? s.level.name);
}

export function acceptsDriver(s: SimState, p: Passenger, t: Taxi): boolean {
  return !p.refusedDrivers.includes(t.driverId ?? t.id) && (!needsTransfer(s, p) || canTravel(t, p.destination.localeId));
}

export function localeName(id: string): string {
  return levelById(id)?.data.name ?? id;
}

export function setJourneyTarget(s: SimState, p: Passenger): void {
  p.temporaryStop = false;
  p.destPadIndex = p.destination.padIndex;
  if (!needsTransfer(s, p)) return;
  let distance = Infinity;
  for (const pad of s.level.pads) {
    if (pad.kind !== 'teleport') continue;
    const d = Math.hypot(p.x - pad.x - pad.w / 2, p.y - pad.y);
    if (d < distance) {
      distance = d;
      p.destPadIndex = pad.index;
    }
  }
}

/** A passenger can walk only along an uninterrupted floor with headroom. */
export function walkable(s: SimState, fromX: number, toX: number, surface: number): boolean {
  const level = s.level;
  const minX = Math.min(fromX, toX);
  const maxX = Math.max(fromX, toX);
  if (boxHitsSolid(level, minX - 5, surface - 22, maxX + 5, surface - 0.5)) return false;
  // Moving platform top surface (including cave floor): uninterrupted span within [sx0, sx1].
  for (let i = 0; i < level.movingPlatforms.length; i++) {
    const p = level.movingPlatforms[i]!;
    const pose = level.platformPoses[i]!;
    for (const [sx0, sy0, sx1] of platformSolidBoxes(p, pose)) {
      const dy = level.wrap ? Math.abs(wrapDelta(sy0, surface, level.height)) : Math.abs(sy0 - surface);
      if (dy < 1.5) {
        const cx = (sx0 + sx1) * 0.5;
        const hw = (sx1 - sx0) * 0.5 - 2;
        const d0 = level.wrap ? Math.abs(wrapDelta(cx, minX, level.width)) : Math.abs(minX - cx);
        const d1 = level.wrap ? Math.abs(wrapDelta(cx, maxX, level.width)) : Math.abs(maxX - cx);
        if (d0 <= hw && d1 <= hw) return true;
      }
    }
  }
  const row = Math.floor(surface / level.tileSize);
  for (let col = Math.floor(minX / level.tileSize); col <= Math.floor(maxX / level.tileSize); col++) {
    if (!isSolid(level, col, row)) return false;
  }
  return true;
}

export function canBoardHere(s: SimState, p: Passenger, t: Taxi): boolean {
  if (t.status !== 'landed' || t.passengerId >= 0) return false;
  if (p.padIndex >= 0 && t.padIndex === p.padIndex) return true;
  if (p.padIndex >= 0) return false;
  return Math.abs(t.y + TAXI.halfH + TAXI.gearLength - p.y) < 1 &&
    Math.abs(t.x - p.x) <= 130 && walkable(s, p.x, t.x, p.y);
}
