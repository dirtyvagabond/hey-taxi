import { Input, isActive } from '@hey-taxi/sim';
import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/session';
import { WORLD_LEVELS } from '../src/world';
import { startedSession } from './helpers';

function started(seed = 7): GameSession {
  return startedSession(seed);
}

function crashPlayer(s: GameSession): void {
  const pad = s.sim.level.pads[0]!;
  Object.assign(s.player!, {
    status: 'flying',
    padIndex: -1,
    hp: 1,
    gearDown: true,
    gear: 1,
    x: pad.x + pad.w / 2,
    y: pad.y - 30,
    vx: 0,
    vy: 400,
  });
  for (let i = 0; i < 10 && s.running; i++) s.tick();
  expect(s.player!.status).toBe('destroyed');
}

describe('World Overview & Follow Mode', () => {
  it('allows opening World Overview when landed, and rejects it while flying', () => {
    const s = started();
    expect(s.player!.status).toBe('landed');
    expect(s.setOverview(true)).toBe(true);
    expect(s.overviewOpen).toBe(true);

    const ov = s.worldOverview();
    expect(ov.locales).toHaveLength(WORLD_LEVELS.length);
    expect(ov.taxis.some((t) => t.player && t.activity === 'Parked')).toBe(true);

    // Close overview and take off.
    expect(s.setOverview(false)).toBe(true);
    expect(s.overviewOpen).toBe(false);
    s.setInput(Input.UP);
    for (let i = 0; i < 15; i++) s.tick();
    expect(s.player!.status).toBe('flying');

    // Cannot open overview or spectate mid-flight.
    expect(s.setOverview(true)).toBe(false);
    expect(s.overviewOpen).toBe(false);
    const rival = s.world.locales.flatMap((l) => l.sim.taxis).find((t) => t.npc && isActive(t));
    if (rival) expect(s.setSpectate(rival.id)).toBe(false);
  });

  it('follows a rival in another locale, streams its locale frames, and suppresses player flight input', () => {
    const s = started(11);
    // Let rivals enter the world across locales.
    for (let i = 0; i < 600; i++) s.tick();

    const otherLocale = s.world.locales.find((l) => l.id !== s.levelId && l.sim.taxis.some((t) => t.npc && isActive(t)));
    expect(otherLocale).toBeDefined();
    const rival = otherLocale!.sim.taxis.find((t) => t.npc && isActive(t))!;

    expect(s.setSpectate(rival.id)).toBe(true);
    expect(s.spectatingId).toBe(rival.id);
    expect(s.viewLocaleId).toBe(otherLocale!.id);
    expect(s.frame().sim.levelId).toBe(otherLocale!.id);
    expect(s.status().spectatingActivity).toBeTruthy();

    // Holding UP while spectating must not lift the player's own taxi.
    const playerYBefore = s.player!.y;
    s.setInput(Input.UP);
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.player!.status).toBe('landed');
    expect(s.player!.y).toBe(playerYBefore);

    // Returning to player restores the player's locale.
    expect(s.setSpectate(null)).toBe(true);
    expect(s.spectatingId).toBeNull();
    expect(s.viewLocaleId).toBe(s.levelId);
    expect(s.frame().sim.levelId).toBe(s.levelId);
  });

  it('surfaces a player threat alert when a missile targets the parked player while spectating, and snaps back on death', () => {
    const s = started(19);
    for (let i = 0; i < 600; i++) s.tick();

    const otherLocale = s.world.locales.find((l) => l.id !== s.levelId && l.sim.taxis.some((t) => t.npc && isActive(t)))!;
    const rival = otherLocale.sim.taxis.find((t) => t.npc && isActive(t))!;
    expect(s.setSpectate(rival.id)).toBe(true);

    // Inject an incoming missile in open air just above the player's cab (no flares so co-pilot can't immediately decoy it).
    const me = s.player!;
    me.flares = 0;
    s.sim.missiles.push({
      id: 9999,
      ownerId: 'npc1',
      targetId: me.id,
      x: me.x,
      y: me.y - 60,
      vx: 0,
      vy: 40,
      life: 120,
      fallTicks: 0,
      decoyId: null,
      spoofed: false,
      reactions: {},
    });
    s.tick();
    const st = s.status();
    expect(st.playerAlert).not.toBeNull();
    expect(st.playerAlert?.kind).toBe('missile');

    // Destroy the player's taxi → immediately snaps back to player locale.
    crashPlayer(s);
    expect(s.spectatingId).toBeNull();
    expect(s.overviewOpen).toBe(false);
    expect(s.viewLocaleId).toBe(s.levelId);
    expect(s.dying).not.toBeNull();
  });

  it('allows opening World Overview and Follow Mode from the destroyed card and runs the world only while examining', () => {
    const s = started(23);
    for (let i = 0; i < 600; i++) s.tick();

    // Destroy the player and let the 2-second explosion finish.
    crashPlayer(s);
    for (let i = 0; i < 150 && s.running; i++) s.tick();
    expect(s.mode).toBe('destroyed');
    expect(s.running).toBe(false);

    const tickBefore = s.worldTick;
    s.tick();
    expect(s.worldTick).toBe(tickBefore); // frozen on destroyed card

    // Opening World Overview from the destroyed card resumes the world.
    expect(s.setOverview(true)).toBe(true);
    expect(s.running).toBe(true);
    s.tick();
    expect(s.worldTick).toBe(tickBefore + 1);

    // Following a living rival from the destroyed card keeps the world running.
    const rival = s.world.locales.flatMap((l) => l.sim.taxis).find((t) => t.npc && isActive(t))!;
    expect(s.setSpectate(rival.id)).toBe(true);
    expect(s.running).toBe(true);
    s.tick();
    expect(s.worldTick).toBe(tickBefore + 2);

    // Returning to the destroyed card freezes the world again.
    expect(s.setSpectate(null)).toBe(true);
    expect(s.running).toBe(false);
  });

  it('supports full-level watchLocale mode and sorts Active Taxis with You pinned at top, rivals alphabetical by first then last name', () => {
    const s = started(31);
    for (let i = 0; i < 600; i++) s.tick();

    // Check alphabetical sorting with player pinned at top.
    const ov = s.worldOverview();
    expect(ov.taxis[0]?.player).toBe(true);
    const rivalNames = ov.taxis.filter((t) => !t.player).map((t) => t.name);
    const sorted = [...rivalNames].sort((a, b) => {
      const [af = '', ...ar] = a.split(' ');
      const [bf = '', ...br] = b.split(' ');
      return af.localeCompare(bf, undefined, { sensitivity: 'base' }) || ar.join(' ').localeCompare(br.join(' '), undefined, { sensitivity: 'base' });
    });
    expect(rivalNames).toEqual(sorted);

    // Expand another locale in watchLocale mode.
    const targetLocale = WORLD_LEVELS[2];
    expect(s.setWatchLocale(targetLocale)).toBe(true);
    expect(s.watchingLocaleId).toBe(targetLocale);
    expect(s.viewLocaleId).toBe(targetLocale);
    expect(s.frame().sim.levelId).toBe(targetLocale);
    expect(s.overviewOpen).toBe(false);

    // Flight input is suppressed while watching a full locale.
    const y0 = s.player!.y;
    s.setInput(Input.UP);
    for (let i = 0; i < 15; i++) s.tick();
    expect(s.player!.status).toBe('landed');
    expect(s.player!.y).toBe(y0);

    // Returning to World Overview clears watchLocaleId.
    expect(s.setOverview(true)).toBe(true);
    expect(s.overviewOpen).toBe(true);
    expect(s.watchingLocaleId).toBeNull();
  });

  it('allows pausing in expanded Watch Mode, Follow Mode, and Overview from both playing and destroyed states', () => {
    const s = started(37);
    for (let i = 0; i < 600; i++) s.tick();

    // Pause while watching a full locale during active play.
    expect(s.setWatchLocale(WORLD_LEVELS[1])).toBe(true);
    s.command('pause');
    expect(s.paused).toBe(true);
    expect(s.running).toBe(false);
    // Esc back to World Overview still works while paused.
    expect(s.setOverview(true)).toBe(true);
    expect(s.overviewOpen).toBe(true);
    expect(s.paused).toBe(true);
    // Resume via pause toggle.
    s.command('pause');
    expect(s.paused).toBe(false);
    expect(s.running).toBe(true);

    // Destroy player and test pause while watching a locale from the destroyed card.
    expect(s.setOverview(false)).toBe(true);
    crashPlayer(s);
    for (let i = 0; i < 150 && s.running; i++) s.tick();
    expect(s.mode).toBe('destroyed');

    expect(s.setWatchLocale(WORLD_LEVELS[2])).toBe(true);
    expect(s.running).toBe(true);
    s.command('pause');
    expect(s.paused).toBe(true);
    expect(s.running).toBe(false);

    // Closing back to the destroyed card clears paused.
    expect(s.setWatchLocale(null)).toBe(true);
    expect(s.paused).toBe(false);
  });
});
