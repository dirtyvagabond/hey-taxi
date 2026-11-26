import { Input } from '@hey-taxi/sim';

const BINDINGS: Record<string, number> = {
  ArrowUp: Input.UP,
  KeyW: Input.UP,
  ArrowDown: Input.DOWN,
  KeyS: Input.DOWN,
  ArrowLeft: Input.LEFT,
  KeyA: Input.LEFT,
  ArrowRight: Input.RIGHT,
  KeyD: Input.RIGHT,
  Space: Input.GEAR,
  KeyF: Input.FIRE,
  KeyC: Input.FLARE,
  Digit1: Input.BUY_MISSILE,
  Numpad1: Input.BUY_MISSILE,
  Digit2: Input.BUY_FLARE,
  Numpad2: Input.BUY_FLARE,
  Digit3: Input.BUY_REPAIR,
  Numpad3: Input.BUY_REPAIR,
  Digit4: Input.BUY_GAS,
  Numpad4: Input.BUY_GAS,
  Digit5: Input.BUY_FILL,
  Numpad5: Input.BUY_FILL,
  KeyR: Input.SUMMON_SERVICE,
};

/**
 * Keyboard → sim Input bitfield. Presses are latched until the next sample so a tap
 * shorter than one tick is never lost.
 */
export class Keyboard {
  private held = 0;
  private latched = 0;
  private commands = new Map<string, () => void>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const bit = BINDINGS[e.code];
      if (bit !== undefined) {
        e.preventDefault();
        this.held |= bit;
        this.latched |= bit;
        return;
      }
      const cmd = this.commands.get(e.code);
      if (cmd && !e.repeat) {
        e.preventDefault();
        cmd();
      }
    });
    window.addEventListener('keyup', (e) => {
      const bit = BINDINGS[e.code];
      if (bit !== undefined) this.held &= ~bit;
    });
    window.addEventListener('blur', () => this.clear());
  }

  /** Register a one-shot command key (e.g. "KeyR"). */
  onKey(code: string, fn: () => void): void {
    this.commands.set(code, fn);
  }

  /** Press-and-release a button for one tick (e.g. a clicked shop item). */
  pulse(bits: number): void {
    this.latched |= bits;
  }

  /** Input bits for the next sim tick. */
  sample(): number {
    const bits = this.held | this.latched;
    this.latched = 0;
    return bits;
  }

  clear(): void {
    this.held = 0;
    this.latched = 0;
  }
}

/**
 * Only a field you're actually typing into keeps the keyboard. Anything else that grabbed
 * focus (a dropdown, checkbox or button in the tuning panel) gives it back to the game, so
 * the taxi never goes deaf after you touch the panel.
 */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const textLike = ['text', 'number', 'search', 'email', 'password', 'url', 'tel'].includes(el.type);
    if (textLike) return true;
  }
  if (el instanceof HTMLElement && el !== document.body && !(el instanceof HTMLCanvasElement)) el.blur();
  return false;
}
