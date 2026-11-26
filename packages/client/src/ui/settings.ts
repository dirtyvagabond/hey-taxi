/**
 * Global utility bar (always-accessible Mute + Settings buttons) and Player Settings modal.
 * Separates everyday player preferences (Volume, Mute, Passenger voice, Screen shake,
 * Flight controls bar) from the developer lil-gui Tuning panel.
 */
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
  background: rgba(5, 7, 15, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font: 14px/1.45 var(--tx-font);
  color: var(--tx-text);
  user-select: none;
}
.tx-settings-panel {
  width: 100%;
  max-width: 440px;
  background: var(--tx-surface);
  border: 1px solid var(--tx-border);
  border-radius: 12px;
  padding: 20px 24px;
  box-shadow: 0 14px 48px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tx-settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--tx-border-subtle);
  padding-bottom: 10px;
}
.tx-settings-head h2 {
  margin: 0;
  font-size: 18px;
  color: var(--tx-info);
  letter-spacing: 2px;
}
.tx-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.tx-settings-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tx-settings-label small {
  color: var(--tx-dim);
  font-size: 11px;
}
.tx-settings-slider {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tx-settings-slider input[type="range"] {
  width: 140px;
  accent-color: var(--tx-info);
  cursor: pointer;
}
.tx-settings-val {
  min-width: 38px;
  text-align: right;
  color: var(--tx-info);
  font-weight: 700;
}
.tx-toggle {
  min-width: 68px;
  text-align: center;
}
.tx-toggle.on {
  background: rgba(57, 208, 255, 0.16);
  border-color: var(--tx-info);
  color: var(--tx-info);
  font-weight: 700;
}
.tx-settings-div {
  border-top: 1px solid var(--tx-border-subtle);
  padding-top: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.tx-settings-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--tx-border-subtle);
  padding-top: 12px;
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
    const backdrop = el('div.tx-settings-backdrop', { role: 'dialog', 'aria-label': 'Settings' });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) this.close();
    });
    this.modal = backdrop;
    document.body.append(backdrop);
    this.renderModal();
    this.sync();
  }

  close(): void {
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

    const closeBtn = el('button.tx-btn', { type: 'button' }, 'Done [Esc]');
    closeBtn.addEventListener('click', () => this.close());

    const volPct = el('span.tx-settings-val', {}, `${Math.round(o.volume * 100)}%`);
    const volRange = el('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: String(o.volume),
      'aria-label': 'Master volume',
    });
    volRange.addEventListener('input', () => {
      const v = Number(volRange.value);
      volPct.textContent = `${Math.round(v * 100)}%`;
      this.hooks.onVolumeChange(v);
    });

    const toggle = (on: boolean, onClick: () => void) => {
      const b = el(on ? 'button.tx-btn.tx-toggle.on' : 'button.tx-btn.tx-toggle', { type: 'button' }, on ? 'ON' : 'OFF');
      b.addEventListener('click', onClick);
      return b;
    };

    const muteToggle = toggle(o.muted, () => this.hooks.onToggleMute());
    const voiceToggle = toggle(o.passengerVoice, () => {
      o.passengerVoice = !o.passengerVoice;
      this.hooks.onOptionChanged();
      this.renderModal();
    });
    const shakeToggle = toggle(o.screenShake, () => {
      o.screenShake = !o.screenShake;
      this.hooks.onOptionChanged();
      this.renderModal();
    });
    const controlsToggle = toggle(o.showControls, () => {
      o.showControls = !o.showControls;
      this.hooks.onOptionChanged();
      this.renderModal();
    });

    const tuningOn = this.hooks.isTuningVisible();
    const tuningBtn = el(
      tuningOn ? 'button.tx-btn.tx-toggle.on' : 'button.tx-btn',
      { type: 'button' },
      tuningOn ? 'Hide Tuning [`]' : 'Show Tuning [`]',
    );
    tuningBtn.addEventListener('click', () => {
      this.hooks.onToggleTuning();
      this.renderModal();
    });

    const panel = el(
      'div.tx-settings-panel',
      {},
      el('div.tx-settings-head', {}, el('h2', {}, 'SETTINGS')),
      el(
        'div.tx-settings-row',
        {},
        el('div.tx-settings-label', {}, el('span', {}, 'Master Volume'), el('small', {}, 'Sound effects and passenger audio')),
        el('div.tx-settings-slider', {}, volRange, volPct),
      ),
      el(
        'div.tx-settings-row',
        {},
        el('div.tx-settings-label', {}, el('span', {}, 'Mute Audio'), el('small', {}, 'Shortcut: M')),
        muteToggle,
      ),
      el(
        'div.tx-settings-row',
        {},
        el('div.tx-settings-label', {}, el('span', {}, 'Passenger Voice'), el('small', {}, 'Retro C64 synthesized passenger speech')),
        voiceToggle,
      ),
      el(
        'div.tx-settings-row',
        {},
        el('div.tx-settings-label', {}, el('span', {}, 'Screen Shake'), el('small', {}, 'Camera trauma on bumps and explosions')),
        shakeToggle,
      ),
      el(
        'div.tx-settings-row',
        {},
        el('div.tx-settings-label', {}, el('span', {}, 'Flight Controls Bar'), el('small', {}, 'Show key hints at bottom of playfield')),
        controlsToggle,
      ),
      el(
        'div.tx-settings-div',
        {},
        el('div.tx-settings-label', {}, el('span', {}, 'Developer Tuning'), el('small', {}, 'Physics, fuel, rivals & hitboxes')),
        tuningBtn,
      ),
      el('div.tx-settings-foot', {}, closeBtn),
    );

    this.modal.replaceChildren(panel);
  }
}
