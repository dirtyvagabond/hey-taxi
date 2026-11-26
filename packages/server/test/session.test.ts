import { Input } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { GameSession, wireSim } from '../src/session';
import { WORLD_LEVELS } from '../src/world';
import { startedSession, TEST_ACCOUNT } from './helpers';

/** Drive a session tick by tick with a scripted input for each tick. */
function play(session: GameSession, ticks: number, input: (tick: number) => number): void {
  for (let i = 0; i < ticks; i++) {
    session.setInput(input(i));
    session.tick();
  }
}

/** A busy but repeatable input pattern: hops, drifts, gear, a missile. */
const script = (i: number) =>
  (i % 240 < 90 ? Input.UP : 0) |
  (i % 400 < 60 ? Input.RIGHT : i % 400 > 300 ? Input.LEFT : 0) |
  (i === 30 || i === 400 ? Input.GEAR : 0) |
  (i === 700 ? Input.FIRE : 0);

describe('GameSession', () => {
  it('starts in the menu with nothing running', () => {
    const s = new GameSession({ seed: 1 });
    expect(s.mode).toBe('menu');
    expect(s.running).toBe(false);
    expect(s.tick()).toEqual([]);
    expect(s.sim.tick).toBe(0);
  });

  it('joining a new server shows the welcome card in the first locale; advancing starts play', () => {
    const s = new GameSession({ seed: 1 });
    s.initServer('Metro One');
    s.joinAccount(TEST_ACCOUNT);
    expect(s.mode).toBe('intro');
    expect(s.card).toMatchObject({
      kind: 'welcome',
      serverName: 'Metro One',
      accountName: TEST_ACCOUNT.name,
      name: 'First Shift',
      fareMultiplier: 1,
      localeCount: 8,
    });
    s.command('advance');
    expect(s.running).toBe(true);
    s.tick();
    expect(s.sim.tick).toBe(1);
  });

  it('same seed + same input history → identical game (reproducible)', () => {
    const a = startedSession(42);
    const b = startedSession(42);
    play(a, 3600, script);
    play(b, 3600, script);
    expect(JSON.stringify(wireSim(a.sim, a.levelId))).toBe(JSON.stringify(wireSim(b.sim, b.levelId)));
    expect(JSON.stringify(a.sim.taxis.map((t) => t.ai))).toBe(JSON.stringify(b.sim.taxis.map((t) => t.ai)));
    expect(a.sim.taxis.some((t) => t.npc && t.status !== 'offstage')).toBe(true);
  });

  it('a different seed gives a different game', () => {
    const a = startedSession(42);
    const b = startedSession(43);
    play(a, 1800, script);
    play(b, 1800, script);
    expect(JSON.stringify(wireSim(a.sim, a.levelId))).not.toBe(JSON.stringify(wireSim(b.sim, b.levelId)));
  });

  it('a tap shorter than a tick still registers (latched until the next tick)', () => {
    const s = startedSession(1);
    play(s, 30, () => Input.UP);
    const gearBefore = s.player!.gearDown;
    s.setInput(Input.GEAR);
    s.setInput(0);
    s.tick();
    expect(s.player!.gearDown).toBe(!gearBefore);
  });

  it('pause freezes the game; a disconnect pauses it', () => {
    const s = startedSession(1);
    s.command('pause');
    expect(s.running).toBe(false);
    s.tick();
    expect(s.sim.tick).toBe(0);
    s.command('pause');
    s.tick();
    expect(s.sim.tick).toBe(1);
    s.setInput(Input.UP);
    s.onDisconnect();
    expect(s.paused).toBe(true);
    s.command('pause');
    s.tick();
    expect(s.player!.thrust).toBe(0);
  });

  it('only accepts known tuning keys of the right type', () => {
    const s = new GameSession({ seed: 1 });
    s.setConfig({ ...s.config, gravity: 300, bogus: 1, thrustUp: 'lots' } as never);
    expect(s.config.gravity).toBe(300);
    expect(s.sim.config.gravity).toBe(300);
    expect((s.config as unknown as Record<string, unknown>).bogus).toBeUndefined();
    expect(s.config.thrustUp).not.toBe('lots');
  });

  it('the wire state carries no AI memory or level geometry', () => {
    const s = startedSession(3);
    play(s, 900, () => 0);
    const w = wireSim(s.sim, s.levelId);
    expect(w.levelId).toBe(WORLD_LEVELS[0]);
    expect('level' in w).toBe(false);
    expect(w.taxis.every((t) => t.ai === null)).toBe(true);
    expect(s.sim.taxis.find((t) => t.npc)!.ai).not.toBeNull();
    expect(s.player!.id).toBe(s.playerId);
  });
});
