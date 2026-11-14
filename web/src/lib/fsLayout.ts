export type FsLayout = 'wide' | 'mid' | 'mobile';
/** HUD layout for the fullscreen map by viewport width: 4 corners + bottom centre, merged bottom stack, or phone layout. */
export function fsLayout(width: number): FsLayout {
  return width >= 1024 ? 'wide' : width > 640 ? 'mid' : 'mobile';
}
export interface PanelBox { id: string; x: number; y: number; w: number; h: number }
/** First pair of panels whose boxes overlap (by more than `tol` px), or null. */
export function firstOverlap(boxes: PanelBox[], tol = 1): [string, string] | null {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x + a.w - tol > b.x && b.x + b.w - tol > a.x && a.y + a.h - tol > b.y && b.y + b.h - tol > a.y) return [a.id, b.id];
  }
  return null;
}
