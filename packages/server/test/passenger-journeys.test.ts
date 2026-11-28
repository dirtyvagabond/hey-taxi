import { DEFAULT_CONFIG, Input, riderOf, setJourneyTarget, spawnPassenger, type Pad, type Taxi } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { decode, encode } from '../src/codec';
import { World, WORLD_LEVELS, type SavedWorld } from '../src/world';
import { parkOnTeleport, startedSession } from './helpers';
import { GameSession } from '../src/session';

const [home, detour, other] = WORLD_LEVELS;

function setup() {
  const w = World.create({ ...DEFAULT_CONFIG }, 123);
  w.population.nextCheckTick = 100000;
  for (const { sim } of w.locales) {
    sim.passengerSpawnTicks = 100000;
    for (const t of sim.taxis) t.respawnTicks = 100000;
  }
  const id = w.createPlayerTaxi(home, { accountId: 'alice', name: 'Alice', taxiNumber: 1 });
  const t = w.taxi(id)!;
  const sim = w.locale(home).sim;
  const from = sim.level.pads[t.padIndex]!;
  const to = sim.level.pads.find(p => p.kind === 'pad' && p !== from)!;
  const p = spawnPassenger(sim, { padIndex: from.index, destPadIndex: to.index, x: t.x + 42 });
  for (let i = 0; i < 45; i++) w.step({});
  expect(riderOf(sim, t.id)).toBe(p);
  return { w, sim, t, p, to };
}

function park(t: Taxi, pad: Pad, x = pad.x + pad.w / 2) {
  Object.assign(t, { status: 'landed', padIndex: pad.index, x, y: pad.y - 24, gear: 1, gearDown: true, vx: 0, vy: 0 });
}

describe('persistent passenger journeys', () => {
  it('lets a rival fly both legs of a requested trip and deliver on the intended pad', () => {
    const { w, t, sim } = setup();
    const rival = sim.taxis.find(cab => cab.npc)!;
    const origin = sim.level.pads.find(pad => pad.label === '3')!;
    const target = w.locale(detour).sim.level.pads.find(pad => pad.label === '1')!;
    const p = spawnPassenger(sim, { padIndex: origin.index, destPadIndex: 0, x: origin.x + 12 });
    p.destination = { localeId: detour, padIndex: target.index, arrivalDistance: 600 };
    setJourneyTarget(sim, p);
    park(rival, origin, p.x + 40);
    // Let the walking passenger board before the rival starts its route.
    p.state = 'walking';
    p.taxiId = rival.id;
    t.status = 'offstage';
    t.respawnTicks = 100000;
    let transfers = 0;
    for (let i = 0; i < 60 * 150 && rival.fares === 0; i++) {
      w.step({});
      transfers += w.processRelocations().filter(m => m.taxiId === rival.id).length;
    }
    expect(transfers).toBe(1);
    expect(rival.fares).toBe(1);
    expect(w.localeOf(rival.id).id).toBe(detour);
    expect(p.padIndex).toBe(target.index);
  });

  it('upgrades active riders in a v9 checkpoint and preserves their existing quote', () => {
    const old = startedSession(7);
    const sim = old.sim;
    const passenger = spawnPassenger(sim, { padIndex: old.player!.padIndex, destPadIndex: 1, x: old.player!.x + 42 });
    for (let i = 0; i < 45; i++) old.tick();
    expect(passenger.state).toBe('riding');
    const save = old.toSave();
    save.saveVersion = 9;
    const local = save.world.locales.find(l => l.id === home)!.sim;
    const legacy = local.passengers.find(p => p.id === passenger.id)!;
    for (const key of ['person', 'destination', 'refusedDrivers', 'refusalHeard', 'temporaryStop', 'vx', 'vy']) Reflect.deleteProperty(legacy, key);
    delete local.localeId;
    const restored = new GameSession({ seed: 9 });
    restored.restore(save, structuredClone(old.ledger.entries));
    const rider = riderOf(restored.world.locale(home).sim, old.playerId)!;
    expect(rider).toMatchObject({ fare: passenger.fare, destination: { localeId: home, padIndex: 1 }, person: { originLocale: home } });
    expect(rider.person.name).toBeTruthy();
  });

  it('keeps the original quote and pad through repeated detours, permanently forfeiting the tip', () => {
    const { w, sim, t, p, to } = setup();
    const quote = p.fare;
    parkOnTeleport(sim, t);
    for (const city of [detour, other, home]) {
      expect(w.teleport(t.id, city)).toBe('ok');
      expect(riderOf(w.locale(city).sim, t.id)?.person.id).toBe(p.person.id);
      expect(w.locales.flatMap(l => l.sim.passengers).filter(q => q.person.id === p.person.id)).toHaveLength(1);
    }
    expect(p.destPadIndex).toBe(to.index);
    park(t, to);
    const events = w.step({}).flatMap(r => r.events);
    expect(events).toContainEqual(expect.objectContaining({ type: 'fareCompleted', fare: quote, tip: 0 }));
    for (let i = 0; i < 80; i++) w.step({});
    expect(sim.resting?.[0]?.person).toEqual(p.person);
    expect(spawnPassenger(sim, { padIndex: to.index, destPadIndex: 0, x: to.x + 10 }).person).toEqual(p.person);
  });

  it('restores a displaced parachutist, refuses the ejecting account, and pays a different pilot once', () => {
    const { w, sim, t, p, to } = setup();
    parkOnTeleport(sim, t);
    expect(w.teleport(t.id, detour)).toBe('ok');
    const local = w.locale(detour).sim;
    const landing = local.level.pads.find(pad => pad.label === '4')!;
    Object.assign(t, { status: 'flying', padIndex: -1, x: landing.x + landing.w / 2, y: landing.y - 100 });
    w.step({ [t.id]: Input.EJECT });
    expect(p.state).toBe('parachuting');
    const restored = World.restore(decode<SavedWorld>(encode(w.save())), w.config);
    const city = restored.locale(detour).sim;
    const survivor = city.passengers.find(q => q.person.id === p.person.id)!;
    const offender = restored.taxi(t.id)!;
    parkOnTeleport(city, offender);
    for (let i = 0; i < 240 && survivor.state === 'parachuting'; i++) restored.step({});
    expect(survivor).toMatchObject({ state: 'waiting', padIndex: landing.index, refusedDrivers: ['alice'] });
    const repeat = restored.createPlayerTaxi(detour, { name: 'Alice', accountId: 'alice', taxiNumber: 2 });
    park(restored.taxi(repeat)!, landing, survivor.x + 40);
    expect(restored.step({}).flatMap(r => r.events)).toContainEqual(expect.objectContaining({ reason: 'refused' }));
    expect(survivor.state).toBe('waiting');
    parkOnTeleport(city, restored.taxi(repeat)!);
    const rescueId = restored.createPlayerTaxi(detour, { name: 'Bob', accountId: 'bob', taxiNumber: 1 });
    const rescuer = restored.taxi(rescueId)!;
    park(rescuer, landing, survivor.x + 40);
    for (let i = 0; i < 60; i++) restored.step({});
    expect(survivor).toMatchObject({ taxiId: rescueId, state: 'riding', tipForfeited: false });
    const remainingFare = survivor.fare;
    expect(remainingFare).toBeGreaterThan(0);
    parkOnTeleport(city, rescuer);
    expect(restored.teleport(rescueId, home)).toBe('ok');
    expect(survivor.destPadIndex).toBe(to.index);
    park(rescuer, to);
    const events = Array.from({ length: 10 }, () => restored.step({})).flat(2).flatMap(r => r.events);
    const payments = events.filter(e => e.type === 'fareCompleted');
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ taxiId: rescueId, fare: remainingFare });
    expect(payments[0]!.tip).toBeGreaterThan(0);
    expect(offender.fares).toBe(0);
  });

  it('waits for a qualified driver and carries a requested interlocale fare with its tip intact', () => {
    const { w, t, sim } = setup();
    w.config.interlocaleChance = 1;
    sim.passengerSpawnTicks = 0;
    w.step({});
    const p = sim.passengers.find(p => p.state === 'waiting')!;
    expect(p.destination.localeId).not.toBe(home);
    const pilot = w.createPlayerTaxi(home, { accountId: 'bob', taxiNumber: 1, name: 'Bob' });
    const cab = w.taxi(pilot)!;
    parkOnTeleport(sim, t);
    park(cab, sim.level.pads[p.padIndex]!, p.x + 45);
    cab.qualifiedLocales = [home];
    w.step({});
    expect(p.state).toBe('waiting');
    parkOnTeleport(sim, cab);
    expect(w.teleport(pilot, p.destination.localeId)).toBe('unqualified');
    cab.qualifiedLocales.push(p.destination.localeId);
    park(cab, sim.level.pads[p.padIndex]!, p.x + 45);
    for (let i = 0; i < 45; i++) w.step({});
    expect(p.taxiId).toBe(pilot);
    parkOnTeleport(sim, cab);
    w.step({});
    expect(cab.fares).toBe(0);
    expect(w.teleport(pilot, p.destination.localeId)).toBe('ok');
    expect(p.destPadIndex).toBe(p.destination.padIndex);
    expect(p.tipForfeited).toBe(false);
  });

  it('exempts fare-carrying rivals from rivalsMaxPerLocale while still blocking empty ones', () => {
    const { w, sim } = setup();
    const rival = sim.taxis.find(cab => cab.npc)!;
    const targetSim = w.locale(detour).sim;
    w.config.rivalsMaxPerLocale = targetSim.taxis.filter(c => c.npc && c.status !== 'destroyed').length;
    parkOnTeleport(sim, rival);
    // Empty rival is blocked when the destination is already at rivalsMaxPerLocale.
    expect(w.teleport(rival.id, detour)).toBe('blocked');
    // With an interlocale rider heading to that locale, the transfer is allowed.
    const pad = targetSim.level.pads.find(p => p.kind === 'pad')!;
    const p = spawnPassenger(sim, { padIndex: rival.padIndex, destPadIndex: 0, x: rival.x });
    Object.assign(p, { state: 'riding', taxiId: rival.id, destination: { localeId: detour, padIndex: pad.index, arrivalDistance: 300 } });
    setJourneyTarget(sim, p);
    rival.passengerId = p.id;
    expect(w.teleport(rival.id, detour)).toBe('ok');
    expect(w.localeOf(rival.id).id).toBe(detour);
  });

  it('borrows a resting resident from a fuller locale when residentLimit is reached so no city starves', () => {
    const { w, sim } = setup();
    const donor = w.locale(detour).sim;
    const total = w.locales.reduce((n, l) => n + l.sim.passengers.length + (l.sim.resting?.length ?? 0), 0);
    donor.resting = [{ person: { id: 'home:999', name: 'Ada Vega', originLocale: home, kind: 0, voiceSeed: 1, rides: 1 }, padIndex: 0 }];
    sim.resting = [];
    w.config.residentLimit = total + 1;
    sim.passengerSpawnTicks = 0;
    w.step({});
    expect(donor.resting).toHaveLength(0);
    expect(sim.passengers.some(p => p.person.id === 'home:999')).toBe(true);
  });

  it('does not immediately clobber the stranded remark with refused on temporary-stop drop-off', () => {
    const { w, sim, t, p } = setup();
    parkOnTeleport(sim, t);
    expect(w.teleport(t.id, detour)).toBe('ok');
    const local = w.locale(detour).sim;
    const tempPad = local.level.pads[p.destPadIndex]!;
    park(t, tempPad);
    const events = Array.from({ length: 30 }, () => w.step({})).flat(2).flatMap(r => r.events);
    expect(events).toContainEqual(expect.objectContaining({ type: 'passengerRemark', reason: 'stranded' }));
    expect(events.filter(e => e.type === 'passengerRemark' && e.reason === 'refused')).toHaveLength(0);
    expect(p.refusedDrivers).toContain('alice');
  });
});
