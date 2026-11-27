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
import { SKINS, type SkinDef, type SkinId, type SkinThrusters, type ThrusterNozzle } from './render/skins';
import { loadThrusterOverrides, resolveThrusters, saveThrusterOverride, TaxiView } from './render/taxi';
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

  const views: { skinId: SkinId; view: TaxiView; pose: Pose; x: number; y: number }[] = [];
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
      views.push({ skinId: skin.id, view, pose, x: cx, y: cy });
      if (row === 0) {
        const label = makeText(pose.label, { fontSize: 5, fill: 0x8a93b8 });
        label.anchor.set(0.5, 0);
        label.position.set(cx, 16);
        stage.addChild(label);
      }
    });
  });

  // Live thruster editor overlay.
  let forcedThrust: number | null = null;
  let forcedFacing: 1 | -1 | null = null;
  mountThrusterEditor(
    SKINS,
    (skinId, thrusters) => {
      for (const v of views) {
        if (v.skinId === skinId) v.view.setThrusters(thrusters);
      }
    },
    (thrust, facing) => {
      forcedThrust = thrust;
      forcedFacing = facing;
    },
  );

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

  // Vertical scrolling so tall skin rosters stay reachable on any viewport height.
  const contentH = (actualY + 46) * ZOOM;
  let scrollY = 0;
  const clampScroll = () => {
    const maxScroll = Math.max(0, contentH - window.innerHeight);
    scrollY = Math.max(0, Math.min(maxScroll, scrollY));
    stage.y = -scrollY;
  };
  window.addEventListener(
    'wheel',
    (e) => {
      scrollY += e.deltaY;
      clampScroll();
    },
    { passive: true },
  );
  window.addEventListener('resize', clampScroll);

  let time = 0;
  app.ticker.add((tk) => {
    if (!still) time += tk.deltaMS / 1000;
    const t = still ? 0.9 : time;
    for (const { view, pose, x, y } of views) {
      const val = <T,>(v: T | ((t: number) => T) | undefined, d: T) => (v === undefined ? d : typeof v === 'function' ? (v as (t: number) => T)(t) : v);
      const thrust = forcedThrust !== null ? forcedThrust : val(pose.thrust, 0);
      const side = thrust & (Input.LEFT | Input.RIGHT);
      const taxi = fakeTaxi({
        gear: val(pose.gear, 0),
        thrust,
        facing: forcedFacing ?? pose.facing ?? (side === Input.LEFT ? -1 : 1),
        hp: pose.hp ?? DEFAULT_CONFIG.taxiMaxHp,
        vx: pose.vx ?? 0,
      });
      view.update(taxi, x, y, t, DEFAULT_CONFIG.taxiMaxHp, DEFAULT_CONFIG.fuelMax);
      view.setRider(pose.rider ? 1 : null);
    }
  });
}

type NozzleGroup = 'tail' | 'nose' | 'top' | 'bottom';
const GROUPS: readonly NozzleGroup[] = ['tail', 'nose', 'top', 'bottom'];

interface MutableThrusters {
  tail: ThrusterNozzle[];
  nose: ThrusterNozzle[];
  top: ThrusterNozzle[];
  bottom: ThrusterNozzle[];
}

function cloneThrusters(def: SkinDef, override?: SkinThrusters): MutableThrusters {
  const r = resolveThrusters(override ?? def.thrusters);
  return {
    tail: r.tail.map((n) => ({ ...n })),
    nose: r.nose.map((n) => ({ ...n })),
    top: r.top.map((n) => ({ ...n })),
    bottom: r.bottom.map((n) => ({ ...n })),
  };
}

function formatNozzle(n: ThrusterNozzle): string {
  const s = n.scale !== undefined && n.scale !== 1 ? `, scale: ${n.scale}` : '';
  return `{ x: ${n.x}, y: ${n.y}${s} }`;
}

function formatThrustersTS(t: MutableThrusters): string {
  const lines = GROUPS.map((g) => {
    const arr = t[g];
    if (arr.length === 1) return `    ${g}: ${formatNozzle(arr[0]!)},`;
    return `    ${g}: [\n${arr.map((n) => `      ${formatNozzle(n)},`).join('\n')}\n    ],`;
  });
  return `  thrusters: {\n${lines.join('\n')}\n  },`;
}

/** Floating panel on `?skins` for live-editing nozzle coordinates and copying TS snippets. */
function mountThrusterEditor(
  skins: readonly SkinDef[],
  onChange: (skinId: SkinId, thrusters: SkinThrusters) => void,
  onForceThrust: (thrust: number | null, facing: 1 | -1 | null) => void,
): void {
  const saved = loadThrusterOverrides();
  const state = new Map<SkinId, MutableThrusters>(skins.map((s) => [s.id, cloneThrusters(s, saved[s.id])]));
  let activeSkin: SkinId = skins[0]!.id;
  let collapsed = false;

  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed',
    'top:10px',
    'right:10px',
    'width:280px',
    'max-height:calc(100vh - 20px)',
    'overflow-y:auto',
    'background:rgba(10,14,32,0.94)',
    'color:#e6ebff',
    'border:1px solid #3b4980',
    'border-radius:8px',
    'padding:10px',
    'font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    'z-index:1000',
    'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
  ].join(';');
  panel.addEventListener('wheel', (e) => e.stopPropagation());
  document.body.appendChild(panel);

  const btnStyle = 'background:#1c2448;color:#e6ebff;border:1px solid #3b4980;border-radius:4px;padding:3px 7px;cursor:pointer;font:inherit;';
  const inputStyle = 'width:54px;background:#0a0e20;color:#fff;border:1px solid #3b4980;border-radius:3px;padding:2px 4px;font:inherit;';

  const presets: { label: string; thrust: number | null; facing: 1 | -1 | null }[] = [
    { label: 'Auto', thrust: null, facing: null },
    { label: 'Tail →', thrust: Input.RIGHT, facing: 1 },
    { label: 'Nose ←', thrust: Input.LEFT, facing: 1 },
    { label: 'Up ↑', thrust: Input.UP, facing: 1 },
    { label: 'Down ↓', thrust: Input.DOWN, facing: 1 },
    { label: 'All', thrust: Input.UP | Input.DOWN | Input.LEFT | Input.RIGHT, facing: 1 },
  ];
  let activePreset = 0;

  const render = () => {
    panel.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    const title = document.createElement('strong');
    title.textContent = 'THRUSTER EDITOR';
    title.style.color = '#ffc83d';
    const toggle = document.createElement('button');
    toggle.textContent = collapsed ? '+' : '–';
    toggle.style.cssText = btnStyle;
    toggle.onclick = () => {
      collapsed = !collapsed;
      render();
    };
    header.append(title, toggle);
    panel.appendChild(header);
    if (collapsed) return;

    // Skin selector.
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%;margin-bottom:8px;background:#0a0e20;color:#fff;border:1px solid #3b4980;border-radius:4px;padding:4px;font:inherit;';
    for (const s of skins) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === activeSkin) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      activeSkin = sel.value as SkinId;
      render();
    };
    panel.appendChild(sel);

    // Force-thrust preview buttons.
    const presetRow = document.createElement('div');
    presetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;';
    presets.forEach((p, idx) => {
      const b = document.createElement('button');
      b.textContent = p.label;
      b.style.cssText = btnStyle + (idx === activePreset ? 'border-color:#ffc83d;color:#ffc83d;' : '');
      b.onclick = () => {
        activePreset = idx;
        onForceThrust(p.thrust, p.facing);
        render();
      };
      presetRow.appendChild(b);
    });
    panel.appendChild(presetRow);

    // Nozzle groups.
    const cur = state.get(activeSkin)!;
    const emit = () => {
      saveThrusterOverride(activeSkin, cur);
      onChange(activeSkin, cur);
    };

    for (const group of GROUPS) {
      const sec = document.createElement('div');
      sec.style.cssText = 'margin-bottom:8px;padding-top:6px;border-top:1px solid #222b52;';

      const rowHead = document.createElement('div');
      rowHead.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
      const lbl = document.createElement('span');
      lbl.textContent = group;
      lbl.style.color = '#9aa8d9';
      const addBtn = document.createElement('button');
      addBtn.textContent = '+ nozzle';
      addBtn.style.cssText = btnStyle + 'font-size:11px;padding:1px 5px;';
      addBtn.onclick = () => {
        const last = cur[group][cur[group].length - 1] ?? { x: 0, y: 0 };
        cur[group].push({ x: last.x, y: last.y + 2 });
        emit();
        render();
      };
      rowHead.append(lbl, addBtn);
      sec.appendChild(rowHead);

      cur[group].forEach((n, idx) => {
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:4px;';

        const makeNum = (label: string, val: number, onVal: (v: number) => void, step = 0.5) => {
          const wrap = document.createElement('label');
          wrap.style.cssText = 'display:flex;align-items:center;gap:2px;';
          const span = document.createElement('span');
          span.textContent = label;
          span.style.color = '#8a93b8';
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.step = String(step);
          inp.value = String(val);
          inp.style.cssText = inputStyle;
          inp.oninput = () => {
            const parsed = parseFloat(inp.value);
            if (!Number.isNaN(parsed)) {
              onVal(parsed);
              emit();
            }
          };
          wrap.append(span, inp);
          return wrap;
        };

        r.append(
          makeNum('x', n.x, (v) => (n.x = v)),
          makeNum('y', n.y, (v) => (n.y = v)),
          makeNum('s', n.scale ?? 1, (v) => (n.scale = v === 1 ? undefined : v), 0.05),
        );

        if (cur[group].length > 1) {
          const rm = document.createElement('button');
          rm.textContent = '×';
          rm.style.cssText = btnStyle + 'padding:1px 5px;color:#ff6b6b;';
          rm.onclick = () => {
            cur[group].splice(idx, 1);
            emit();
            render();
          };
          r.appendChild(rm);
        }
        sec.appendChild(r);
      });

      panel.appendChild(sec);
    }

    // Actions: Copy TS / Reset.
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid #222b52;';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy TS';
    copyBtn.style.cssText = btnStyle + 'flex:1;border-color:#ffc83d;color:#ffc83d;';
    copyBtn.onclick = async () => {
      const txt = formatThrustersTS(cur);
      try {
        await navigator.clipboard.writeText(txt);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy TS'), 1200);
      } catch {
        console.log(txt);
        copyBtn.textContent = 'Logged to console';
        setTimeout(() => (copyBtn.textContent = 'Copy TS'), 1500);
      }
    };
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = btnStyle;
    resetBtn.onclick = () => {
      const def = skins.find((s) => s.id === activeSkin)!;
      const fresh = cloneThrusters(def);
      state.set(activeSkin, fresh);
      saveThrusterOverride(activeSkin, null);
      onChange(activeSkin, fresh);
      render();
    };
    actions.append(copyBtn, resetBtn);
    panel.appendChild(actions);
  };

  render();
}
