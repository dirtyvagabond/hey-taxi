import { Text, type TextStyleOptions } from 'pixi.js';
import { C64_FONT_STACK, FONT_STACK } from '../ui/theme';

export const FONT = FONT_STACK;
export const C64_FONT = C64_FONT_STACK;

const live = new Set<Text>();
const c64Live = new Set<Text>();
let resolution = 2;
let c64FontReady = false;

if (typeof document !== 'undefined' && document.fonts) {
  void document.fonts.load('16px "PetMe64"').then(() => {
    c64FontReady = true;
    for (const t of c64Live) {
      t.style.update();
    }
  });
}

/** Create a Text that stays crisp when the view is scaled (see setTextResolution). */
export function makeText(text: string, style: TextStyleOptions): Text {
  const t = new Text({ text, style: { fontFamily: FONT, fontWeight: 'bold', ...style }, resolution });
  live.add(t);
  t.on('destroyed', () => live.delete(t));
  return t;
}

/** Create a C64-styled pixel Text (normal weight so 8x8 strokes stay razor-sharp). */
export function makeC64Text(text: string, style: TextStyleOptions): Text {
  const t = new Text({ text, style: { fontFamily: C64_FONT, fontWeight: 'normal', ...style }, resolution });
  live.add(t);
  if (!c64FontReady) {
    c64Live.add(t);
    t.on('destroyed', () => c64Live.delete(t));
  }
  t.on('destroyed', () => live.delete(t));
  return t;
}

export function setTextResolution(r: number): void {
  resolution = r;
  for (const t of live) t.resolution = r;
}
