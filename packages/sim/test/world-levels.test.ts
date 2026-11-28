import { describe, expect, it } from 'vitest';
import {
  createSim,
  DEFAULT_CONFIG,
  DT,
  parseLevel,
  step,
  TAXI,
  WORLD,
  type SimEvent,
  type SimState,
} from '../src/index';
import { spawnPassenger } from '../src/passengers';

const levels = WORLD.map((w) => ({ id: w.id, level: parseLevel(w.data) }));

function run(s: SimState, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push(...step(s, {}));
  return out;
}

describe('the world locales', () => {
  it('have the expected sizes and fare multipliers across all nine locales', () => {
    const area = levels.map(({ level }) => level.cols * level.rows);
    const firstShiftArea = area[1]!;
    expect(area.map((a) => Math.round((a / firstShiftArea) * 100) / 100)).toEqual([0.32, 1, 2, 4, 2, 2.5, 2, 3, 3]);
    expect(levels.map(({ level }) => level.fareMultiplier)).toEqual([0.5, 1, 1.33, 2, 1.6, 2.5, 1.75, 2.6, 3]);
    expect(levels[0]!.level).toMatchObject({ cols: 26, rows: 14, rivals: 0, noRivals: true, firstFareLocalOnly: true });
    expect(levels[1]!.level).toMatchObject({ cols: 64, rows: 18 });
  });

  it.each(levels)('$id: no exit gate or quota; passenger pads, a store and a teleport', ({ level }) => {
    expect(level.exit).toBeNull();
    expect(level.fareQuota).toBe(0);
    const kinds = level.pads.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'pad').length).toBeGreaterThanOrEqual(level.noRivals ? 3 : 5);
    expect(kinds).toContain('fuel');
    expect(kinds).toContain('teleport');
  });

  it('the locale multiplier applies to the fare, and so to the tip (a percentage of it)', () => {
    for (const { level } of levels) {
      const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
      const t = s.taxis[0]!;
      const from = level.pads.find((p) => p.kind === 'pad' && p.index === t.padIndex)!;
      const to = level.pads.find((p) => p.kind === 'pad' && p !== from)!;
      spawnPassenger(s, { padIndex: from.index, destPadIndex: to.index, x: t.x + 60 });
      const boarded = run(s, 6).find((e) => e.type === 'passengerBoarded');
      expect(boarded).toBeDefined();
      const p = s.passengers[0]!;
      const d = Math.hypot(to.x + to.w / 2 - (from.x + from.w / 2), to.y - from.y);
      const base = DEFAULT_CONFIG.baseFare + DEFAULT_CONFIG.farePerDistance * d;
      expect(p.fare).toBeCloseTo(Math.round(base * level.fareMultiplier * 100) / 100, 1);
      expect(p.tip).toBeCloseTo((p.fare * DEFAULT_CONFIG.tipPercent) / 100, 6);
    }
  });

  // Rivals must be able to work every locale under the gear rule, safely. Three of them (the
  // per-locale limit) on one map, all hostile: non-combat crashes must be rare (measured over
  // 30 four-minute rival-runs per locale: 2-5; this samples 9 three-minute ones).
  // For noRivals sanctuaries (Santa Monica), run a single autopilot rival to verify navigability.
  it.each(levels)('$id: autopilot rivals work it for minutes with hardly any accidents', ({ level }) => {
    const npcIds = level.noRivals ? ['npc1'] : ['npc1', 'npc2', 'npc3'];
    let accidents = 0;
    for (const seed of [1, 2, 3]) {
      const s = createSim(level, { npcIds, playerIds: level.noRivals ? [] : undefined, seed });
      const ev = run(s, 180);
      accidents += ev.filter((e) => e.type === 'crashed' && e.reason !== 'missile').length;
      expect(s.taxis.filter((t) => t.npc).reduce((n, t) => n + t.fares, 0)).toBeGreaterThanOrEqual(2);
      expect(ev.filter((e) => e.type === 'passengerHit')).toEqual([]);
    }
    expect(accidents).toBeLessThanOrEqual(3);
  });

  it.each(levels)('$id: a rival sent elsewhere reaches the teleport and parks on it', ({ level }) => {
    const s = createSim(level, { npcIds: ['npc1'], seed: 4 });
    run(s, DEFAULT_CONFIG.npcArrivalDelay + 1);
    const npc = s.taxis[1]!;
    npc.relocateTo = 'somewhere-else';
    let parked = false;
    for (let i = 0; i < Math.round(120 / DT) && !parked; i++) {
      step(s, {});
      parked = npc.status === 'landed' && level.pads[npc.padIndex]?.kind === 'teleport';
    }
    expect(parked).toBe(true);
    expect(npc.y).toBeCloseTo(level.pads[npc.padIndex]!.y - TAXI.gearLength - TAXI.halfH, 0);
  });
});
