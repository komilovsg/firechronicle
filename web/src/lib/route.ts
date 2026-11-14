export const VIEW_IDS = ['overview', 'map', 'calendar', 'outlook', 'anomalies', 'compare', 'data'] as const;
export type ViewId = (typeof VIEW_IDS)[number];
export interface RouteCheck { view: ViewId; viewBad: boolean; messages: string[] }
const param = (hash: string, k: string): string | null => { const m = new RegExp(`[#&]${k}=([^&]*)`).exec(hash); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; };

/** Reads the hash and reports what the app will have to correct. Never throws on malformed input. */
export function routeCheck(hash: string, regionIds: string[], firstYear: number, lastYear: number): RouteCheck {
  const messages: string[] = []; let viewBad = false, view: ViewId = 'overview';
  let v: string | null = null, a: string | null = null, y: string | null = null;
  try { v = param(hash, 'v'); a = param(hash, 'a'); y = param(hash, 'y'); } catch { messages.push('The link is malformed — showing the defaults'); }
  if (v !== null) { if ((VIEW_IDS as readonly string[]).includes(v)) view = v as ViewId; else { viewBad = true; messages.push("That view doesn't exist — showing Overview"); } }
  if (a !== null && !regionIds.includes(a)) messages.push('Unknown area — showing Central Asia');
  if (y !== null) {
    const m = /^(\d{4})-(\d{4})$/.exec(y);
    if (!m || +m[1] < firstYear || +m[2] > lastYear || +m[1] > +m[2]) messages.push(`Years out of range — showing ${firstYear}–${lastYear}`);
  }
  return { view, viewBad, messages };
}
