import { createEmber } from './ember';
import { retryControl } from './retryUi';

export type PhMode = 'full' | 'light';
export interface MapStatus { show(mode: PhMode): void; hide(): void; error(): void; isError(): boolean; recovered(): void }

/** Placeholder over the map: full (first open, nothing drawn yet) or light (old map stays visible). Slow after 8 s, error state with a way out. */
let placed: ReturnType<typeof createEmber> | null = null;
/** The 40 px thinking Ember in the placeholder; created once, at boot, so it is there from the first paint of the Map section. */
export function placeEmber(): ReturnType<typeof createEmber> {
  if (placed) return placed;
  placed = createEmber(40); placed.setState('thinking'); document.getElementById('mp-ember')?.append(placed.el); return placed;
}
export function createMapStatus(onMono: () => void, onRetry: () => Promise<boolean>): MapStatus {
  const ph = document.getElementById('map-ph')!, cap = document.getElementById('mp-cap')!, err = document.getElementById('mp-err')!, btn = document.getElementById('mp-btn') as HTMLButtonElement;
  const em = placeEmber();
  let slow = 0, lightT = 0, isErr = false, rc: ReturnType<typeof retryControl> | null = null;
  btn.addEventListener('click', () => { isErr = false; rc?.destroy(); rc = null; onMono(); });
  const reset = (): void => { clearTimeout(slow); clearTimeout(lightT); };
  const apply = (mode: PhMode): void => {
    ph.hidden = false; ph.dataset.mode = mode; ph.classList.remove('hide');
    rc?.destroy(); rc = null; err.hidden = true; btn.hidden = true; cap.hidden = false; cap.textContent = 'LOADING MAP · NASA FIRMS'; em.setState('thinking');
  };
  return {
    show(mode) {
      isErr = false; reset(); apply(mode);
      slow = window.setTimeout(() => { if (!isErr) { ph.dataset.mode = 'light'; cap.textContent = 'Map tiles are slow — data is ready'; } }, 8000);
      if (mode === 'light') lightT = window.setTimeout(() => { if (!isErr) ph.classList.add('hide'); }, 2500);
    },
    hide() { if (isErr) return; reset(); ph.classList.add('hide'); setTimeout(() => { if (ph.classList.contains('hide')) ph.hidden = true; }, 220); },
    error() { reset(); isErr = true; rc?.destroy(); rc = retryControl(btn.parentElement!, { run: async () => { em.setState('thinking'); const ok = await onRetry(); if (!ok) em.setState('error'); return ok; } }); ph.hidden = false; ph.classList.remove('hide'); ph.dataset.mode = 'full'; cap.hidden = true; err.hidden = false; btn.hidden = false; em.setState('error'); },
    isError: () => isErr,
    recovered() { isErr = false; rc?.destroy(); rc = null; ph.classList.add('hide'); setTimeout(() => { ph.hidden = true; }, 220); },
  };
}
