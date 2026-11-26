/** Playfield (camera viewport) size in virtual units. */
export const VIEW_W = 1280;
export const VIEW_H = 720;
/** Status bar above the playfield, so the HUD never covers the level. */
export const HUD_H = 64;
/** Whole virtual screen: status bar + playfield. Scaled to fit the window. */
export const SCREEN_W = VIEW_W;
export const SCREEN_H = VIEW_H + HUD_H;

/** Follows a target with a little velocity look-ahead; clamps to level edges, locks if the level fits. */
export class Camera {
  x = 0;
  y = 0;
  private trauma = 0;

  follow(tx: number, ty: number, vx: number, vy: number, levelW: number, levelH: number, dt: number): void {
    const goalX = clamp(tx + vx * 0.35 - VIEW_W / 2, levelW, VIEW_W);
    const goalY = clamp(ty + vy * 0.25 - VIEW_H / 2, levelH, VIEW_H);
    const k = 1 - Math.exp(-dt * 6);
    this.x += (goalX - this.x) * k;
    this.y += (goalY - this.y) * k;
  }

  snap(tx: number, ty: number, levelW: number, levelH: number): void {
    this.x = clamp(tx - VIEW_W / 2, levelW, VIEW_W);
    this.y = clamp(ty - VIEW_H / 2, levelH, VIEW_H);
    this.trauma = 0;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Screen-shake offset for this frame; decays over time. */
  shakeOffset(dt: number): { x: number; y: number } {
    const mag = this.trauma * this.trauma * 14;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    return { x: (Math.random() * 2 - 1) * mag, y: (Math.random() * 2 - 1) * mag };
  }
}

function clamp(pos: number, levelSize: number, viewSize: number): number {
  if (levelSize <= viewSize) return (levelSize - viewSize) / 2;
  return Math.min(Math.max(pos, 0), levelSize - viewSize);
}
