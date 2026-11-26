import { TAXI, type SimState, type Taxi, type TaxiSkin } from '@hey-taxi/sim';
import { expect } from 'vitest';
import type { Account } from '@hey-taxi/sim/protocol';
import { GameSession } from '../src/session';

export const TEST_ACCOUNT: Account = {
  accountId: 'acct-test-1',
  name: 'TestPilot',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

export const TEST_ACCOUNT_2: Account = {
  accountId: 'acct-test-2',
  name: 'SecondPilot',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
};

/** Create a named server, join TEST_ACCOUNT, and advance past the welcome card. */
export function startedSession(
  seed = 1,
  opts?: { account?: Account; serverName?: string; skin?: TaxiSkin; color?: number },
): GameSession {
  const s = new GameSession({ seed });
  s.initServer(opts?.serverName ?? 'Test Server');
  s.joinAccount(opts?.account ?? TEST_ACCOUNT, opts?.skin, opts?.color);
  s.command('advance');
  return s;
}

/** Park a taxi on its locale's teleport pad (as if it had landed there). */
export function parkOnTeleport(sim: SimState, t: Taxi, offset = 0): void {
  const pad = sim.level.pads.find((p) => p.kind === 'teleport')!;
  Object.assign(t, {
    status: 'landed',
    padIndex: pad.index,
    x: pad.x + pad.w / 2 + offset,
    y: pad.y - TAXI.gearLength - TAXI.halfH,
    vx: 0,
    vy: 0,
    gearDown: true,
    gear: 1,
  });
}

/** The player teleports to another locale (dropping any rider first, for the test). */
export function teleportTo(s: GameSession, localeId: string): void {
  const me = s.player!;
  s.sim.passengers = s.sim.passengers.filter((p) => p.taxiId !== me.id || p.state === 'leaving');
  me.passengerId = -1;
  parkOnTeleport(s.sim, me);
  expect(s.teleport(localeId)).toBe('ok');
}
