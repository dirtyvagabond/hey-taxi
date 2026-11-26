import { Text, type TextStyleOptions } from 'pixi.js';
import { FONT_STACK } from '../ui/theme';

export const FONT = FONT_STACK;

const live = new Set<Text>();
let resolution = 2;

/** Create a Text that stays crisp when the view is scaled (see setTextResolution). */
export function makeText(text: string, style: TextStyleOptions): Text {
  const t = new Text({ text, style: { fontFamily: FONT, fontWeight: 'bold', ...style }, resolution });
  live.add(t);
  t.on('destroyed', () => live.delete(t));
  return t;
}

export function setTextResolution(r: number): void {
  resolution = r;
  for (const t of live) t.resolution = r;
}
