import { describe, expect, it } from 'vitest';
import {
  admitTaxi,
  createSim,
  DT,
  Input,
  parseLevel,
  platformPose,
  spawnPoint,
  step,
  TAXI,
  type LevelData,
} from '../src/index';
import { spawnPassenger } from '../src/passengers';

const MOVING_TEST_LEVEL: LevelData = {
  name: 'Moving Test',
  theme: 'asteroid',
  tileSize: 40,
  gravityScale: 0.45,
  tiles: [
    '########################',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#......................#',
    '#..S...................#',
    '#.1111........TTTTTT...#',
    '########################',
  ],
  movingPlatforms: [
    { cx: 10, cy: 6, w: 4, h: 2, ampX: 3, ampY: 0, period: 10, phase: 0, pad: { label: '2' } },
    { cx: 17, cy: 5, w: 4, h: 2, ampX: 0, ampY: 2, period: 8, phase: 0, pad: { label: 'F' } },
  ],
};

describe('moving platforms', () => {
  it('syncs moving pads deterministically and carries landed taxis and waiting passengers', () => {
    const level = parseLevel(MOVING_TEST_LEVEL);
    const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const movingPad = level.pads.find((p) => p.label === '2')!;
    expect(movingPad.platformIndex).toBe(0);

    // Park taxi (already occupied so passenger stays waiting) on moving pad 2 and spawn a passenger on it.
    const t = s.taxis[0]!;
    t.status = 'landed';
    t.padIndex = movingPad.index;
    t.passengerId = 999;
    t.x = movingPad.x + movingPad.w / 2;
    t.y = movingPad.y - TAXI.gearLength - TAXI.halfH;
    const pax = spawnPassenger(s, { padIndex: movingPad.index, destPadIndex: 0, x: movingPad.x + 12 });

    const startX = t.x;
    const paxStartX = pax.x;
    for (let i = 0; i < 60; i++) step(s, {});

    const expectedPose = platformPose(level.movingPlatforms[0]!, s.tick);
    expect(movingPad.x).toBeCloseTo(expectedPose.x, 5);
    expect(t.x - startX).toBeCloseTo(expectedPose.x - level.movingPlatforms[0]!.cx, 4);
    expect(t.y).toBeCloseTo(expectedPose.y - TAXI.gearLength - TAXI.halfH, 4);
    expect(pax.x - paxStartX).toBeCloseTo(expectedPose.x - level.movingPlatforms[0]!.cx, 4);
  });

  it('evaluates landing relative to the moving platform velocity', () => {
    const level = parseLevel(MOVING_TEST_LEVEL);
    const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const movingPad = level.pads.find((p) => p.label === '2')!;
    const pose = platformPose(level.movingPlatforms[0]!, 0);

    // Place taxi just above moving pad matching its horizontal velocity and descending gently.
    const t = s.taxis[0]!;
    t.status = 'flying';
    t.padIndex = -1;
    t.gearDown = true;
    t.gear = 1;
    t.x = pose.x + movingPad.w / 2;
    t.y = pose.y - TAXI.gearLength - TAXI.halfH - 4;
    t.vx = pose.vx;
    t.vy = 25;

    let landed = false;
    for (let i = 0; i < 30 && !landed; i++) {
      const ev = step(s, {});
      const e = ev.find((x) => x.type === 'landed');
      if (e && e.type === 'landed') {
        landed = true;
        expect(e.padIndex).toBe(movingPad.index);
        expect(e.rating).toBe('smooth');
      }
    }
    expect(landed).toBe(true);
    expect(t.hp).toBe(s.config.taxiMaxHp);
  });

  it('imparts platform velocity on takeoff and blocks missiles', () => {
    const level = parseLevel(MOVING_TEST_LEVEL);
    const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const movingPad = level.pads.find((p) => p.label === '2')!;
    const t = s.taxis[0]!;
    t.status = 'landed';
    t.padIndex = movingPad.index;
    t.x = movingPad.x + movingPad.w / 2;
    t.y = movingPad.y - TAXI.gearLength - TAXI.halfH;

    const ev = step(s, { p1: Input.UP });
    expect(ev.some((e) => e.type === 'tookOff')).toBe(true);
    expect(t.status).toBe('flying');
    expect(t.vx).toBeGreaterThan(20); // inherited positive horizontal drift
    expect(DT).toBeGreaterThan(0);
  });

  it('wraps taxis seamlessly across X and Y boundaries when level.wrap is true', () => {
    const wrapData: LevelData = {
      name: 'Wrap Test',
      theme: 'asteroid',
      tileSize: 40,
      wrap: true,
      gravityScale: 0,
      tiles: [
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '....S...................',
        '..1111........TTTTTT....',
        '........................',
      ],
    };
    const level = parseLevel(wrapData);
    const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;
    t.status = 'flying';
    t.padIndex = -1;
    t.gearDown = false;
    t.gear = 0;
    t.x = 5;
    t.y = 5;
    t.vx = -120;
    t.vy = -120;
    for (let i = 0; i < 10; i++) step(s, {});
    expect(t.status).toBe('flying');
    expect(t.hp).toBe(s.config.taxiMaxHp);
    expect(t.x).toBeGreaterThan(level.width - 60);
    expect(t.y).toBeGreaterThan(level.height - 60);
  });

  it('bounces free-drifting asteroids elastically when they collide', () => {
    const bounceData: LevelData = {
      name: 'Bounce Test',
      theme: 'asteroid',
      tileSize: 40,
      wrap: true,
      gravityScale: 0.45,
      tiles: Array.from({ length: 16 }, (_, r) => (r === 1 ? '....S...................' : '........................')),
      movingPlatforms: [
        { cx: 2, cy: 2, w: 4, h: 2, ampX: 0, ampY: 0, period: 1, vx: 35, vy: 0, pad: { label: '1' } },
        { cx: 9, cy: 2, w: 4, h: 2, ampX: 0, ampY: 0, period: 1, vx: -35, vy: 0, pad: { label: '2' } },
      ],
    };
    const level = parseLevel(bounceData);
    const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    for (let i = 0; i < 120; i++) step(s, {});
    expect(s.platforms![0]!.vx).toBeLessThan(0);
    expect(s.platforms![1]!.vx).toBeGreaterThan(0);
  });

  it('spawns and admits teleporting taxis even after asteroids drift away from S', () => {
    const driftData: LevelData = {
      name: 'Drift Spawn Test',
      theme: 'asteroid',
      tileSize: 40,
      wrap: true,
      gravityScale: 0.45,
      tiles: Array.from({ length: 16 }, (_, r) => (r === 1 ? '....S...................' : '........................')),
      movingPlatforms: [
        { cx: 2, cy: 2, w: 5, h: 2, ampX: 0, ampY: 0, period: 1, vx: 30, vy: 15, pad: { label: '1' } },
        { cx: 12, cy: 8, w: 5, h: 2, ampX: 0, ampY: 0, period: 1, vx: -25, vy: 10, pad: { label: 'T', kind: 'teleport' } },
      ],
    };
    const level = parseLevel(driftData);
    const s = createSim(level, { seed: 1, config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    // Advance until asteroid 1 has drifted far away from S
    for (let i = 0; i < 300; i++) step(s, {});
    const sp = spawnPoint(level);
    expect(sp.padIndex).toBe(0);
    const tp = level.pads.find((p) => p.kind === 'teleport')!;
    const guest = { ...s.taxis[0]!, id: 'guest' };
    admitTaxi(s, guest, { padIndex: tp.index, x: tp.x + tp.w / 2 });
    expect(guest.status).toBe('landed');
    expect(guest.padIndex).toBe(tp.index);
  });
});
