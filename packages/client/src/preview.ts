/**
 * Development only: every taxi skin side by side, drawn by the real in-game renderer
 * (TaxiView), on a pad like the game's. Open the dev client with `?skins`
 * (http://localhost:5174/?skins). `?skins&still` freezes the animated columns for screenshots.
 *
 * Columns: gear up · gear down · gear cycling · thrusters · passenger aboard · facing left ·
 * two rival colors · battered (stage 2) · critical (3) · last point (4, glowing). A last row
 * repeats the skins at the game's own scale.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { DEFAULT_CONFIG, Input, TAXI, type Taxi } from '@hey-taxi/sim';
import { SKINS } from './render/skins';
import { TaxiView } from './render/taxi';
import { makeText, setTextResolution } from './render/text';
import { COLORS } from './render/world';

const RIVALS = [0xff6fae, 0x4fe0c8];
const ZOOM = 3;
const CELL_W = 64;
const CELL_H = 62;

interface Pose {
  label: string;
  color?: number;
  gear?: number | ((t: number) => number);
  thrust?: number | ((t: number) => number);
  hp?: number;
  rider?: boolean;
  /** Which way it faces (else: the way a lone side thrust points, or right). */
  facing?: 1 | -1;
  /** Sideways drift (to show that motion doesn't turn it). */
  vx?: number;
}

const cycle = (t: number) => {
  // 0 → 1 → hold → 0 → hold, every 3 s.
  const k = (t % 3) / 3;
  return k < 0.25 ? k / 0.25 : k < 0.5 ? 1 : k < 0.75 ? 1 - (k - 0.5) / 0.25 : 0;
};
const THRUSTS = [Input.UP, Input.LEFT, Input.RIGHT, Input.DOWN, Input.UP | Input.LEFT];

const POSES: Pose[] = [
  { label: 'GEAR UP', gear: 0 },
  { label: 'GEAR DOWN', gear: 1 },
  { label: 'GEAR MOVING', gear: cycle },
  { label: 'THRUST', gear: 0, thrust: (t) => THRUSTS[Math.floor(t / 0.8) % THRUSTS.length]! },
  // Side thrust against the drift: the taxi turns to face the push, flame at the tail.
  { label: 'THRUST →', gear: 0, thrust: Input.RIGHT, vx: -40 },
  { label: 'THRUST ←', gear: 0, thrust: Input.LEFT, vx: 40 },
  { label: 'PASSENGER', gear: 1, rider: true },
  { label: 'FACING LEFT', gear: 0, facing: -1, vx: 60, rider: true },
  { label: 'RIVAL', gear: 1, color: RIVALS[0] },
  { label: 'RIVAL', gear: 0, color: RIVALS[1], facing: -1 },
  { label: 'BATTERED', gear: 1, hp: 3 },
  { label: 'CRITICAL', gear: 1, hp: 2 },
  { label: 'LAST POINT', gear: 1, hp: 1, thrust: Input.UP },
];

function fakeTaxi(o: Partial<Taxi>): Taxi {
  return {
    status: 'flying',
    gear: 0,
    hp: DEFAULT_CONFIG.taxiMaxHp,
    thrust: 0,
    vx: 0,
    vy: 0,
    fuel: DEFAULT_CONFIG.fuelMax,
    cents: 10000,
    ...o,
  } as Taxi;
}

export async function startSkinPreview(): Promise<void> {
  const still = new URLSearchParams(location.search).has('still');
  const app = new Application();
  await app.init({ resizeTo: window, background: COLORS.sky, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
  document.body.appendChild(app.canvas);
  setTextResolution(ZOOM * app.renderer.resolution);

  const stage = new Container();
  app.stage.addChild(stage);
  const title = makeText('TAXI SKINS · in-game renderer · gear, thrust, passenger, facing, rival colors, damage', { fontSize: 7, fill: 0x8a93b8 });
  title.position.set(8, 6);
  stage.addChild(title);

  const views: { view: TaxiView; pose: Pose; x: number; y: number }[] = [];
  const top = 26;
  const left = 70;
  SKINS.forEach((skin, row) => {
    const name = makeText(skin.name.toUpperCase(), { fontSize: 7, fill: 0xe6ebff, wordWrap: true, wordWrapWidth: 58 });
    name.position.set(6, top + row * CELL_H + 22);
    stage.addChild(name);
    POSES.forEach((pose, col) => {
      const cx = left + col * CELL_W + CELL_W / 2;
      const cy = top + row * CELL_H + 22;
      // The pad it would land on: the ground line is the bottom of the feet box.
      const ground = cy + TAXI.halfH + TAXI.gearLength;
      stage.addChild(new Graphics().rect(cx - 28, ground, 56, 4).fill(0x1c2244).rect(cx - 28, ground, 56, 1).fill(0x6170c4));
      // The physics boxes, faintly: body and feet.
      stage.addChild(
        new Graphics()
          .rect(cx - TAXI.halfW, cy - TAXI.halfH, TAXI.halfW * 2, TAXI.halfH * 2)
          .stroke({ width: 0.3, color: 0x39d0ff, alpha: 0.35 })
          .rect(cx - TAXI.feetHalfW, cy + TAXI.halfH, TAXI.feetHalfW * 2, TAXI.gearLength)
          .stroke({ width: 0.3, color: 0x3dff9e, alpha: 0.25 }),
      );
      const view = new TaxiView(pose.color ?? skin.playerColor, false, skin.id);
      stage.addChild(view.root);
      views.push({ view, pose, x: cx, y: cy });
      if (row === 0) {
        const label = makeText(pose.label, { fontSize: 5, fill: 0x8a93b8 });
        label.anchor.set(0.5, 0);
        label.position.set(cx, 16);
        stage.addChild(label);
      }
    });
  });

  // Actual size: the game draws the world at about this scale on a typical window.
  const actualY = top + SKINS.length * CELL_H + 10;
  const actual = makeText('AT GAME SCALE', { fontSize: 7, fill: 0x8a93b8 });
  actual.position.set(6, actualY);
  stage.addChild(actual);
  const small = new Container();
  small.scale.set(1 / ZOOM * 1.6);
  small.position.set(left, actualY + 6);
  stage.addChild(small);
  SKINS.forEach((skin, i) => {
    [0, 1].forEach((g, j) => {
      const v = new TaxiView(skin.playerColor, false, skin.id);
      v.update(fakeTaxi({ gear: g }), (i * 2 + j) * 70 + 30, 20, 0, DEFAULT_CONFIG.taxiMaxHp, DEFAULT_CONFIG.fuelMax);
      small.addChild(v.root);
    });
  });

  stage.scale.set(ZOOM);
  let time = 0;
  app.ticker.add((tk) => {
    if (!still) time += tk.deltaMS / 1000;
    const t = still ? 0.9 : time;
    for (const { view, pose, x, y } of views) {
      const val = <T,>(v: T | ((t: number) => T) | undefined, d: T) => (v === undefined ? d : typeof v === 'function' ? (v as (t: number) => T)(t) : v);
      const thrust = val(pose.thrust, 0);
      const side = thrust & (Input.LEFT | Input.RIGHT);
      const taxi = fakeTaxi({
        gear: val(pose.gear, 0),
        thrust,
        facing: pose.facing ?? (side === Input.LEFT ? -1 : 1),
        hp: pose.hp ?? DEFAULT_CONFIG.taxiMaxHp,
        vx: pose.vx ?? 0,
      });
      view.update(taxi, x, y, t, DEFAULT_CONFIG.taxiMaxHp, DEFAULT_CONFIG.fuelMax);
      view.setRider(pose.rider ? 1 : null);
    }
  });
}
