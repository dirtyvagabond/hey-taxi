/**
 * Global utility bar (always-accessible Mute + Settings buttons) and Player Settings modal.
 * Separates everyday player preferences (Volume, Mute, Passenger voice, Screen shake,
 * Flight controls bar) from the developer lil-gui Tuning panel.
 */
import { CAMERA_ZOOM_PRESETS, cameraZoomTag } from '../camera';
import type { DebugOptions } from '../debug';
import { el, ensureTheme } from './theme';

const STYLE = `
.tx-util {
  position: fixed;
  right: 14px;
  bottom: 10px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 6px;
  font: 700 12px/1.3 var(--tx-font);
  user-select: none;
}
.tx-util-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--tx-border);
  background: rgba(11, 15, 36, 0.88);
  color: var(--tx-dim);
  font: inherit;
  letter-spacing: 0.6px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.tx-util-btn:hover {
  border-color: var(--tx-info);
  color: var(--tx-text);
}
.tx-util-btn.muted {
  border-color: var(--tx-bad);
  background: rgba(31, 16, 26, 0.94);
  color: #ffb3b3;
}
.tx-util-btn.muted:hover {
  border-color: #ff8c8c;
  color: #ffffff;
}
.tx-util-btn.active {
  border-color: var(--tx-info);
  color: var(--tx-info);
}

.tx-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(5, 7, 15, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font: 11px/1.6 var(--c64-font);
  -webkit-font-smoothing: none;
  color: var(--c64-text);
  user-select: none;
}
.tx-settings-panel {
  width: 100%;
  max-width: 600px;
  background: var(--c64-screen);
  border: 12px solid var(--c64-bezel);
  border-radius: 0;
  padding: 20px 24px;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.78);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tx-settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid var(--c64-bezel);
  padding-bottom: 10px;
}
.tx-settings-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: normal;
  color: var(--c64-accent);
  letter-spacing: 2px;
}
.tx-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0;
  cursor: pointer;
}
.tx-settings-row.selected .tx-settings-label > span,
.tx-settings-div.selected .tx-settings-label > span {
  color: var(--c64-accent);
}
.tx-settings-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tx-settings-label > span {
  text-transform: uppercase;
}
.tx-settings-label small {
  color: var(--c64-dim);
  font-size: 9px;
  line-height: 1.5;
}
@keyframes c64-blink {
  0%, 49% {
    background: var(--c64-accent);
    color: var(--c64-screen);
  }
  50%, 100% {
    background: transparent;
    color: var(--c64-accent);
  }
}
.c64-cursor {
  display: inline-block;
  animation: c64-blink 660ms steps(1) infinite;
}
.tx-settings-hint {
  color: var(--c64-dim);
  font-size: 9px;
  text-transform: uppercase;
}
.tx-settings-slider {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tx-settings-slider input[type="range"] {
  width: 132px;
  accent-color: var(--c64-accent);
  cursor: pointer;
}
.tx-settings-val {
  min-width: 44px;
  text-align: right;
  color: var(--c64-accent);
}
.tx-settings-panel .tx-btn {
  border-radius: 0;
  background: var(--c64-screen-alt);
  border: 2px solid var(--c64-bezel);
  color: var(--c64-text);
  text-transform: uppercase;
  font-size: 10px;
  padding: 6px 10px;
  transition: none;
}
.tx-settings-panel .tx-btn:hover:not(:disabled) {
  background: var(--c64-bezel);
  border-color: var(--c64-bezel);
  color: var(--c64-screen);
}
.tx-toggle {
  min-width: 64px;
  text-align: center;
}
.tx-settings-panel .tx-toggle.on {
  background: var(--c64-accent);
  border-color: var(--c64-accent);
  color: var(--c64-screen);
  font-weight: normal;
}
.tx-settings-panel .tx-toggle.on:hover:not(:disabled) {
  background: var(--c64-text);
  border-color: var(--c64-text);
  color: var(--c64-screen);
}
.tx-seg {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.tx-seg .tx-btn {
  padding: 6px 8px;
  font-size: 9px;
  min-width: 0;
}
.tx-settings-div {
  border-top: 2px solid var(--c64-bezel);
  padding-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tx-settings-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 2px solid var(--c64-bezel);
  padding-top: 12px;
}
.tx-settings-done {
  cursor: pointer;
  color: var(--c64-text);
  text-transform: uppercase;
  font-size: 11px;
  padding: 4px 6px;
}
.tx-settings-done.selected {
  color: var(--c64-accent);
}
`;

export interface SettingsHooks {
  onToggleMute(): void;
  onVolumeChange(volume: number): void;
  onOptionChanged(): void;
  onToggleTuning(): void;
  isTuningVisible(): boolean;
}

export class SettingsUI {
  private utilRoot: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private gearBtn: HTMLButtonElement;
  private modal: HTMLDivElement | null = null;
  private selectedIndex = 0;
  private rowHandlers: Array<{ activate: () => void; step?: (dir: -1 | 1) => void }> = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private readonly options: DebugOptions,
    private readonly hooks: SettingsHooks,
  ) {
    ensureTheme();
    if (!document.getElementById('tx-settings-style')) {
      document.head.append(el('style', { id: 'tx-settings-style' }, STYLE));
    }

    this.muteBtn = el('button.tx-util-btn', { type: 'button', title: 'Toggle sound [M]' });
    this.muteBtn.addEventListener('click', () => {
      this.hooks.onToggleMute();
      this.muteBtn.blur();
    });

    this.gearBtn = el('button.tx-util-btn', { type: 'button', title: 'Settings' }, '⚙');
    this.gearBtn.addEventListener('click', () => {
      if (this.modal) this.close();
      else this.open();
      this.gearBtn.blur();
    });

    this.utilRoot = el('div.tx-util', {}, this.muteBtn, this.gearBtn);
    document.body.append(this.utilRoot);
    this.sync();
  }

  get isOpen(): boolean {
    return this.modal !== null;
  }

  open(): void {
    if (this.modal) return;
    this.selectedIndex = 0;
    const backdrop = el('div.tx-settings-backdrop', { role: 'dialog', 'aria-label': 'Settings', tabindex: '-1' });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });
    this.modal = backdrop;
    document.body.append(backdrop);
    if (document.activeElement instanceof HTMLElement && document.activeElement !== backdrop) {
      document.activeElement.blur();
    }
    backdrop.focus();
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.modal) return;
      const n = this.rowHandlers.length;
      if (!n) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex - 1 + n) % n;
        this.renderModal();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = (this.selectedIndex + 1) % n;
        this.renderModal();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        e.stopPropagation();
        const h = this.rowHandlers[this.selectedIndex];
        if (h?.step) h.step(-1);
        else h?.activate();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        e.stopPropagation();
        const h = this.rowHandlers[this.selectedIndex];
        if (h?.step) h.step(1);
        else h?.activate();
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        this.rowHandlers[this.selectedIndex]?.activate();
      }
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.renderModal();
    this.sync();
  }

  close(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    this.modal?.remove();
    this.modal = null;
    this.sync();
  }

  /** Sync utility bar badge and modal controls with current options state. */
  sync(): void {
    const muted = this.options.muted;
    this.muteBtn.className = muted ? 'tx-util-btn muted' : 'tx-util-btn';
    this.muteBtn.textContent = muted ? '🔇 MUTED · M' : '🔊';
    this.muteBtn.title = muted ? 'Click or press M to unmute' : 'Click or press M to mute';
    this.gearBtn.className = this.modal ? 'tx-util-btn active' : 'tx-util-btn';
    if (this.modal) this.renderModal();
  }

  private renderModal(): void {
    if (!this.modal) return;
    const o = this.options;
    this.rowHandlers = [];

    const labelSpan = (text: string, selected: boolean) => {
      if (!selected || !text.length) return el('span', {}, text);
      return el('span', {}, el('span.c64-cursor', {}, text.charAt(0)), text.slice(1));
    };

    const bindRow = (
      node: HTMLElement,
      idx: number,
      handler: { activate: () => void; step?: (dir: -1 | 1) => void },
    ) => {
      this.rowHandlers[idx] = handler;
      node.addEventListener('mouseenter', () => {
        if (this.selectedIndex !== idx) {
          this.selectedIndex = idx;
          this.renderModal();
        }
      });
    };

    const stepVolume = (dir: -1 | 1) => {
      const next = Math.max(0, Math.min(1, Math.round((o.volume + dir * 0.05) * 100) / 100));
      this.hooks.onVolumeChange(next);
      this.renderModal();
    };
    const volPct = el('span.tx-settings-val', {}, `${Math.round(o.volume * 100)}%`);
    const volRange = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: String(o.volume),
      'aria-label': 'Master volume',
    });
    volRange.addEventListener('click', (e) => e.stopPropagation());
    volRange.addEventListener('input', () => {
      const v = Number(volRange.value);
      volPct.textContent = `${Math.round(v * 100)}%`;
      this.hooks.onVolumeChange(v);
    });

    const toggle = (on: boolean, onClick: () => void) => {
      const b = el(on ? 'button.tx-btn.tx-toggle.on' : 'button.tx-btn.tx-toggle', { type: 'button' }, on ? 'ON' : 'OFF');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    const toggleMute = () => this.hooks.onToggleMute();
    const toggleVoice = () => {
      o.passengerVoice = !o.passengerVoice;
      this.hooks.onOptionChanged();
      this.renderModal();
    };
    const stepZoom = (dir: -1 | 1) => {
      const cur = CAMERA_ZOOM_PRESETS.findIndex((p) => p.id === o.cameraZoom);
      const next = CAMERA_ZOOM_PRESETS[(Math.max(0, cur) + dir + CAMERA_ZOOM_PRESETS.length) % CAMERA_ZOOM_PRESETS.length]!;
      o.cameraZoom = next.id;
      this.hooks.onOptionChanged();
      this.renderModal();
    };
    const toggleShake = () => {
      o.screenShake = !o.screenShake;
      this.hooks.onOptionChanged();
      this.renderModal();
    };
    const toggleControls = () => {
      o.showControls = !o.showControls;
      this.hooks.onOptionChanged();
      this.renderModal();
    };
    const toggleTuning = () => {
      this.hooks.onToggleTuning();
      this.renderModal();
    };

    const muteToggle = toggle(o.muted, toggleMute);
    const voiceToggle = toggle(o.passengerVoice, toggleVoice);
    const shakeToggle = toggle(o.screenShake, toggleShake);
    const controlsToggle = toggle(o.showControls, toggleControls);

    const zoomBtns = CAMERA_ZOOM_PRESETS.map((p) => {
      const active = o.cameraZoom === p.id;
      const b = el(
        active ? 'button.tx-btn.tx-toggle.on' : 'button.tx-btn',
        { type: 'button', title: `${p.label} (${cameraZoomTag(p)})` },
        p.label,
      );
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (o.cameraZoom === p.id) return;
        o.cameraZoom = p.id;
        this.hooks.onOptionChanged();
        this.renderModal();
      });
      return b;
    });

    const tuningOn = this.hooks.isTuningVisible();
    const tuningBtn = el(
      tuningOn ? 'button.tx-btn.tx-toggle.on' : 'button.tx-btn',
      { type: 'button' },
      tuningOn ? 'Hide' : 'Show',
    );
    tuningBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTuning();
    });

    const makeRow = (
      idx: number,
      cls: string,
      title: string,
      sub: string,
      control: Node,
      handler: { activate: () => void; step?: (dir: -1 | 1) => void },
    ) => {
      const sel = this.selectedIndex === idx;
      const row = el(
        sel ? `div.${cls}.selected` : `div.${cls}`,
        {},
        el('div.tx-settings-label', {}, labelSpan(title, sel), el('small', {}, sub)),
        control,
      );
      row.addEventListener('click', () => {
        this.selectedIndex = idx;
        handler.activate();
      });
      bindRow(row, idx, handler);
      return row;
    };

    const doneSel = this.selectedIndex === 7;
    const doneEl = el(
      doneSel ? 'div.tx-settings-done.selected' : 'div.tx-settings-done',
      {},
      doneSel ? el('span.c64-cursor', {}, 'D') : 'D',
      'ONE',
    );
    doneEl.addEventListener('click', () => this.close());
    bindRow(doneEl, 7, { activate: () => this.close() });

    const panel = el(
      'div.tx-settings-panel',
      {},
      el('div.tx-settings-head', {}, el('h2', {}, 'SETTINGS')),
      makeRow(0, 'tx-settings-row', 'Master Volume', 'Sound effects and passenger audio', el('div.tx-settings-slider', {}, volRange, volPct), {
        activate: () => stepVolume(1),
        step: stepVolume,
      }),
      makeRow(1, 'tx-settings-row', 'Mute Audio', 'Shortcut: M', muteToggle, { activate: toggleMute }),
      makeRow(2, 'tx-settings-row', 'Passenger Voice', 'Retro C64 synthesized speech', voiceToggle, { activate: toggleVoice }),
      makeRow(3, 'tx-settings-row', 'Camera Zoom', 'Shortcut: Z', el('div.tx-seg', {}, ...zoomBtns), {
        activate: () => stepZoom(1),
        step: stepZoom,
      }),
      makeRow(4, 'tx-settings-row', 'Screen Shake', 'Camera trauma on bumps and hits', shakeToggle, { activate: toggleShake }),
      makeRow(5, 'tx-settings-row', 'Flight Controls Bar', 'Show key hints at bottom', controlsToggle, { activate: toggleControls }),
      makeRow(6, 'tx-settings-div', 'Developer Tuning', 'Shortcut: `', tuningBtn, { activate: toggleTuning }),
      el('div.tx-settings-foot', {}, el('span.tx-settings-hint', {}, '↑↓ SELECT · ←→/ENTER CHANGE · ESC CLOSE'), doneEl),
    );

    this.modal.replaceChildren(panel);
  }
}
