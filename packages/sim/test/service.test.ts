import { describe, expect, it } from 'vitest';
import {
  aiProfile,
  atService,
  canSummonService,
  createSim,
  DEFAULT_CONFIG,
  Input,
  parseLevel,
  serviceCraftFor,
  shopMultiplier,
  step,
  toCents,
  type LevelData,
  type SimEvent,
  type SimState,
} from '../src';

const TEST_LEVEL: LevelData = {
  name: 'Service Test',
  tileSize: 32,
  gravityScale: 1,
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
    '#...S..................#',
    '#..111111....FFFFF.....#',
    '########################',
  ],
};

function run(s: SimState, ticks: number, input = 0): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...step(s, { p1: input }));
  return out;
}

describe('flying convenience service', () => {
  it('summons a service craft while parked away from a store, flies in, and docks beside the taxi', () => {
    const s = createSim(parseLevel(TEST_LEVEL), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;
    expect(t.status).toBe('landed');
    expect(canSummonService(s, t)).toBe(true);

    const summonEv = step(s, { p1: Input.SUMMON_SERVICE });
    expect(summonEv.find((e) => e.type === 'serviceSummoned')).toMatchObject({ taxiId: 'p1' });
    expect(serviceCraftFor(s, 'p1')?.status).toBe('arriving');
    expect(canSummonService(s, t)).toBe(false);

    // Let the craft fly in and dock.
    const travelEv = run(s, 300);
    expect(travelEv.find((e) => e.type === 'serviceArrived')).toMatchObject({ taxiId: 'p1' });
    expect(atService(s, t)).toBe(true);
    expect(shopMultiplier(s, t)).toBe(DEFAULT_CONFIG.servicePriceMultiplier);
    const craft = serviceCraftFor(s, 'p1')!;
    expect(craft.status).toBe('docked');
    // Docked right next to the taxi, not on top of it.
    expect(Math.abs(craft.x - t.x)).toBeGreaterThanOrEqual(44);
    expect(Math.abs(craft.x - t.x)).toBeLessThanOrEqual(90);
  });

  it('cannot be summoned while flying or while parked at a store', () => {
    const s = createSim(parseLevel(TEST_LEVEL), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;

    // Flying
    run(s, 10, Input.UP);
    expect(t.status).toBe('flying');
    expect(canSummonService(s, t)).toBe(false);
    step(s, { p1: Input.SUMMON_SERVICE });
    expect(s.serviceCrafts).toHaveLength(0);

    // Parked at the fuel store (pad 1)
    const storePad = s.level.pads.find((p) => p.kind === 'fuel')!;
    Object.assign(t, { status: 'landed', padIndex: storePad.index, x: storePad.x + storePad.w / 2, y: storePad.y - 24, vx: 0, vy: 0 });
    expect(canSummonService(s, t)).toBe(false);
    step(s, { p1: Input.SUMMON_SERVICE });
    expect(s.serviceCrafts).toHaveLength(0);
  });

  it('sells all store items at 2× normal store prices and records service ledger entries', () => {
    const s = createSim(parseLevel(TEST_LEVEL), {
      config: { passengersPerTaxi: 0, extraPassengers: 0, startMoney: 200 },
    });
    const t = s.taxis[0]!;
    t.fuel = 50; // 5 gallons missing
    t.hp = 4; // 2 hull missing
    t.missiles = 1;
    t.flares = 1;

    step(s, { p1: Input.SUMMON_SERVICE });
    run(s, 300);
    expect(atService(s, t)).toBe(true);

    const mult = DEFAULT_CONFIG.servicePriceMultiplier;
    expect(mult).toBe(2);

    // Buy 1 missile ($24)
    const c0 = t.cents;
    const evM = step(s, { p1: Input.BUY_MISSILE });
    expect(t.missiles).toBe(2);
    expect(c0 - t.cents).toBe(toCents(DEFAULT_CONFIG.missilePrice * mult));
    expect(evM.find((e) => e.type === 'ledger')).toMatchObject({ category: 'missile', ref: 'service:missile' });

    // Buy 1 flare burst ($12)
    step(s, { p1: 0 });
    const c1 = t.cents;
    const evF = step(s, { p1: Input.BUY_FLARE });
    expect(t.flares).toBe(2);
    expect(c1 - t.cents).toBe(toCents(DEFAULT_CONFIG.flarePrice * mult));
    expect(evF.find((e) => e.type === 'ledger')).toMatchObject({ category: 'flare', ref: 'service:flare' });

    // Buy 1 hull repair ($40)
    step(s, { p1: 0 });
    const c2 = t.cents;
    const evR = step(s, { p1: Input.BUY_REPAIR });
    expect(t.hp).toBe(5);
    expect(c2 - t.cents).toBe(toCents(DEFAULT_CONFIG.repairPrice * mult));
    expect(evR.find((e) => e.type === 'ledger')).toMatchObject({ category: 'repair', ref: 'service:repair' });

    // Buy 1 gallon of gas ($4)
    step(s, { p1: 0 });
    const c3 = t.cents;
    const evG = step(s, { p1: Input.BUY_GAS });
    expect(t.fuel).toBeCloseTo(60, 5);
    expect(c3 - t.cents).toBe(toCents(DEFAULT_CONFIG.gallonPrice * mult));
    expect(evG.find((e) => e.type === 'ledger')).toMatchObject({ category: 'gas', ref: 'service:gas' });

    // Fill up remaining 4 gallons ($16)
    step(s, { p1: 0 });
    const c4 = t.cents;
    step(s, { p1: Input.BUY_FILL });
    expect(t.fuel).toBeCloseTo(DEFAULT_CONFIG.fuelMax, 5);
    expect(c4 - t.cents).toBe(toCents(4 * DEFAULT_CONFIG.gallonPrice * mult));
  });

  it('rescues a stranded empty-fuel taxi and departs once the taxi takes off', () => {
    const s = createSim(parseLevel(TEST_LEVEL), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;
    t.fuel = 0;

    // Stranded: cannot take off, does not explode.
    run(s, 20, Input.UP);
    expect(t.status).toBe('landed');

    // Summon service, wait for arrival, buy gas, take off!
    step(s, { p1: Input.SUMMON_SERVICE });
    run(s, 300);
    expect(atService(s, t)).toBe(true);

    step(s, { p1: Input.BUY_GAS });
    expect(t.fuel).toBeGreaterThan(0);

    const takeoffEv = step(s, { p1: Input.UP });
    expect(t.status).toBe('flying');
    expect(atService(s, t)).toBe(false);
    expect(takeoffEv.find((e) => e.type === 'serviceDeparted')).toMatchObject({ taxiId: 'p1' });

    // Craft eventually leaves the level.
    run(s, 400);
    expect(s.serviceCrafts).toHaveLength(0);
  });

  it('is non-combat and indestructible: missiles ignore it and never destroy it', () => {
    const s = createSim(parseLevel(TEST_LEVEL), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    step(s, { p1: Input.SUMMON_SERVICE });
    run(s, 300);
    const craft = serviceCraftFor(s, 'p1')!;
    expect(craft.status).toBe('docked');

    // Firing a missile does not lock onto the service craft.
    step(s, { p1: Input.FIRE });
    expect(s.missiles[0]!.targetId).toBeNull();

    // Even a missile flying directly through the service craft leaves it untouched.
    s.missiles.push({
      id: s.nextMissileId++,
      ownerId: 'npc1',
      x: craft.x,
      y: craft.y,
      vx: 0,
      vy: 0,
      targetId: null,
      life: 60,
      fallTicks: 0,
      decoyId: null,
      spoofed: false,
      reactions: {},
    });
    run(s, 10);
    expect(serviceCraftFor(s, 'p1')?.status).toBe('docked');
  });

  it('can be summoned after a gear-up crash landing once the taxi settles on a platform', () => {
    const s = createSim(parseLevel(TEST_LEVEL), { config: { passengersPerTaxi: 0, extraPassengers: 0 } });
    const t = s.taxis[0]!;
    const pad = s.level.pads[0]!;
    Object.assign(t, {
      status: 'flying',
      padIndex: -1,
      gearDown: false,
      gear: 0,
      fuel: 0,
      x: pad.x + pad.w / 2,
      y: pad.y - 14,
      vx: 0,
      vy: 60,
    });
    run(s, 60);
    expect(t.status).toBe('landed');
    expect(t.gear).toBe(0);
    expect(canSummonService(s, t)).toBe(true);

    step(s, { p1: Input.SUMMON_SERVICE });
    run(s, 300);
    expect(atService(s, t)).toBe(true);
    step(s, { p1: Input.BUY_GAS });
    expect(t.fuel).toBeGreaterThan(0);
    step(s, { p1: Input.UP });
    expect(t.status).toBe('flying');
    expect(t.gear).toBe(0);
  });

  it('NPC stranded away from a store summons the service, buys gas, and takes off', () => {
    const s = createSim(parseLevel(TEST_LEVEL), {
      playerIds: [],
      npcIds: ['npc1'],
      config: { passengersPerTaxi: 0, extraPassengers: 0, startMoney: 100 },
    });
    const npc = s.taxis[0]!;
    const pad1 = s.level.pads[0]!;
    Object.assign(npc, {
      status: 'landed',
      padIndex: pad1.index,
      x: pad1.x + pad1.w / 2,
      y: pad1.y - 24,
      vx: 0,
      vy: 0,
      gearDown: true,
      gear: 1,
      fuel: 0,
    });

    const ev = run(s, 420);
    expect(ev.some((e) => e.type === 'serviceSummoned' && e.taxiId === 'npc1')).toBe(true);
    expect(ev.some((e) => e.type === 'serviceArrived' && e.taxiId === 'npc1')).toBe(true);
    expect(ev.some((e) => e.type === 'purchase' && e.taxiId === 'npc1' && e.item === 'gas' && e.service === true)).toBe(true);
    expect(ev.some((e) => e.type === 'tookOff' && e.taxiId === 'npc1')).toBe(true);
    expect(npc.fuel).toBeGreaterThan(0);
  });

  it('personality shapes fuel risk and convenience service summons', () => {
    const timid = aiProfile({ aggression: 4, vengeance: 5, nerve: 3, hustle: 6, skill: 14 });
    const wildcard = aiProfile({ aggression: 12, vengeance: 10, nerve: 17, hustle: 12, skill: 4 });
    const hustler = aiProfile({ aggression: 10, vengeance: 10, nerve: 12, hustle: 17, skill: 12 });

    // Daredevils/Wildcards push fuel much lower and underestimate trip burn when low-Skill.
    expect(wildcard.refuelCritical).toBeLessThan(timid.refuelCritical - 0.2);
    expect(wildcard.fuelBuffer).toBeLessThan(timid.fuelBuffer - 0.1);
    expect(wildcard.fuelEstimateScale).toBeLessThan(timid.fuelEstimateScale);
    // Hustlers splurge on convenience service when wealthy; Timid NPCs only use it in emergencies.
    expect(Number.isFinite(hustler.convenienceServiceCash)).toBe(true);
    expect(timid.convenienceServiceCash).toBe(Infinity);

    // Wide level where pad 1 is ~480u (>360u) from the fuel store, so fuel=30 can reach the store.
    const wideLevel: LevelData = {
      name: 'Wide Service Test',
      tileSize: 32,
      gravityScale: 1,
      tiles: [
        '########################',
        '#......................#',
        '#......................#',
        '#......................#',
        '#......................#',
        '#......................#',
        '#......................#',
        '#...S..................#',
        '#..111111.......FFFFF..#',
        '########################',
      ],
    };

    const runCase = (personality: NonNullable<(typeof s)['taxis'][0]['personality']>) => {
      const sim = createSim(parseLevel(wideLevel), {
        playerIds: [],
        npcIds: ['npc1'],
        config: { passengersPerTaxi: 0, extraPassengers: 0, startMoney: 250 },
      });
      const npc = sim.taxis[0]!;
      npc.personality = personality;
      const pad1 = sim.level.pads[0]!;
      Object.assign(npc, {
        status: 'landed',
        padIndex: pad1.index,
        x: pad1.x + pad1.w / 2,
        y: pad1.y - 24,
        vx: 0,
        vy: 0,
        gearDown: true,
        gear: 1,
        fuel: 30, // enough to reach store, but below refuelBelow
      });
      return run(sim, 30);
    };

    const s = createSim(parseLevel(wideLevel), { playerIds: [], npcIds: ['npc1'] });
    const hustlerEv = runCase({ aggression: 10, vengeance: 10, nerve: 12, hustle: 17, skill: 12 });
    const timidEv = runCase({ aggression: 4, vengeance: 5, nerve: 3, hustle: 6, skill: 14 });
    expect(hustlerEv.some((e) => e.type === 'serviceSummoned' && e.taxiId === 'npc1')).toBe(true);
    expect(timidEv.some((e) => e.type === 'serviceSummoned' && e.taxiId === 'npc1')).toBe(false);
  });
});
