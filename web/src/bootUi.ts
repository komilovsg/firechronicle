import type { Steps } from './lib/boot';
import { retryControl } from './ui/retryUi';

const reduce = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
export interface BootUi { error(): void; hide(): void }

/** Full-screen first-load overlay (markup and critical CSS live in index.html). */
export function initBootUi(steps: Steps): BootUi {
  const root = document.getElementById('boot'), fill = document.getElementById('b-fill'), live = document.getElementById('live'), panel = document.getElementById('panel');
  if (!root || !fill) return { error() { /* no overlay */ }, hide() { /* no overlay */ } };
  panel?.setAttribute('aria-busy', 'true'); if (live) live.textContent = 'Loading';
  steps.onChange(() => { fill.style.width = `${Math.round(steps.fraction() * 100)}%`; });
  const retry = document.getElementById('b-retry') as HTMLButtonElement;
  const KEY = 'fc-boot-attempts'; let startAt = 0; try { startAt = Number(sessionStorage.getItem(KEY) ?? 0) || 0; } catch { /* private mode */ }
  let rc: ReturnType<typeof retryControl> | null = null;
  let closed = false;
  return {
    error() {
      if (closed) return; root.dataset.state = 'error';
      document.getElementById('b-line')!.textContent = 'EMBER · SIGNAL LOST';
      document.getElementById('b-err')!.hidden = false; retry.hidden = true;
      rc ??= retryControl(retry.parentElement!, { attempts: startAt, run: () => { try { sessionStorage.setItem(KEY, String(rc!.ctl.attempts())); } catch { /* private mode */ } location.reload(); return new Promise<boolean>(() => undefined); } });
      rc.root.querySelector<HTMLElement>('.retry-btn')?.focus();
      if (live) live.textContent = "Couldn't reach the data";
    },
    hide() {
      if (closed) return; closed = true; try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
      panel?.removeAttribute('aria-busy'); if (live) live.textContent = 'Loaded';
      const em = document.getElementById('b-ember'), fab = document.getElementById('ask-btn');
      if (em && fab && !reduce()) {
        const a = em.getBoundingClientRect(), b = fab.getBoundingClientRect();
        em.style.animation = 'none'; em.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1)';
        em.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.width / a.width})`;
      }
      root.classList.add('out'); setTimeout(() => root.remove(), reduce() ? 250 : 520);
    },
  };
}
