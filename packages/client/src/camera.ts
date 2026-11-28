import { wrapCoord, wrapDelta } from '@hey-taxi/sim';

/** Playfield (camera viewport) size in virtual units. */
export const VIEW_W = 1280;
export const VIEW_H = 720;
/** Status bar above the playfield, so the HUD never covers the level. */
export const HUD_H = 64;
/** Whole virtual screen: status bar + playfield. Scaled to fit the window. */
export const SCREEN_W = VIEW_W;
export const SCREEN_H = VIEW_H + HUD_H;

export type CameraZoomId = 'classic' | 'comfort' | 'close' | 'dynamic';

export interface CameraZoomPreset {
  id: CameraZoomId;
  label: string;
  zoom: number;
  /** When true, zoom eases smoothly between close (landed/slow) and wide (high speed). */
  dynamic?: boolean;
}

export const CAMERA_ZOOM_PRESETS: readonly CameraZoomPreset[] = [
  { id: 'classic', label: 'Classic', zoom: 1.0 },
  { id: 'comfort', label: 'Comfort', zoom: 1.25 },
  { id: 'close', label: 'Close', zoom: 1.4 },
  { id: 'dynamic', label: 'Dynamic', zoom: 1.38, dynamic: true },
];

export const DEFAULT_CAMERA_ZOOM: CameraZoomId = 'comfort';
export const MAX_CAMERA_ZOOM = Math.max(...CAMERA_ZOOM_PRESETS.map((p) => p.zoom));

/** Target zoom for a preset given current taxi speed (u/s). */
export function targetCameraZoom(preset: CameraZoomPreset, speed = 0): number {
  if (!preset.dynamic) return preset.zoom;
  const lo = 50;
  const hi = 340;
  const t = Math.max(0, Math.min(1, (speed - lo) / (hi - lo)));
  const ease = t * t * (3 - 2 * t);
  return 1.38 - ease * (1.38 - 1.08);
}

export function cameraZoomTag(preset: CameraZoomPreset): string {
  return preset.dynamic ? '1.08×–1.38×' : `${preset.zoom}×`;
}

export function cameraZoomPreset(id: unknown): CameraZoomPreset {
  return CAMERA_ZOOM_PRESETS.find((p) => p.id === id) ?? CAMERA_ZOOM_PRESETS[1]!;
}

export function nextCameraZoom(id: CameraZoomId): CameraZoomPreset {
  const i = CAMERA_ZOOM_PRESETS.findIndex((p) => p.id === id);
  return CAMERA_ZOOM_PRESETS[(i + 1) % CAMERA_ZOOM_PRESETS.length]!;
}

/** Follows a target with a little velocity look-ahead; clamps to level edges, locks if the level fits. */
export class Camera {
  x = 0;
  y = 0;
  private trauma = 0;

  follow(
    tx: number,
    ty: number,
    vx: number,
    vy: number,
    levelW: number,
    levelH: number,
    dt: number,
    zoom = 1,
    vpW = VIEW_W,
    vpH = VIEW_H,
    wrap = false,
  ): void {
    const viewW = vpW / zoom;
    const viewH = vpH / zoom;
    const k = 1 - Math.exp(-dt * 6);
    if (wrap) {
      const goalX = wrapCoord(tx + vx * 0.35 - viewW / 2, levelW);
      const goalY = wrapCoord(ty + vy * 0.25 - viewH / 2, levelH);
      this.x = wrapCoord(this.x + wrapDelta(this.x, goalX, levelW) * k, levelW);
      this.y = wrapCoord(this.y + wrapDelta(this.y, goalY, levelH) * k, levelH);
      return;
    }
    const goalX = clamp(tx + vx * 0.35 - viewW / 2, levelW, viewW);
    const goalY = clamp(ty + vy * 0.25 - viewH / 2, levelH, viewH);
    this.x += (goalX - this.x) * k;
    this.y += (goalY - this.y) * k;
  }

  snap(
    tx: number,
    ty: number,
    levelW: number,
    levelH: number,
    zoom = 1,
    vpW = VIEW_W,
    vpH = VIEW_H,
    wrap = false,
  ): void {
    const viewW = vpW / zoom;
    const viewH = vpH / zoom;
    if (wrap) {
      this.x = wrapCoord(tx - viewW / 2, levelW);
      this.y = wrapCoord(ty - viewH / 2, levelH);
    } else {
      this.x = clamp(tx - viewW / 2, levelW, viewW);
      this.y = clamp(ty - viewH / 2, levelH, viewH);
    }
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
