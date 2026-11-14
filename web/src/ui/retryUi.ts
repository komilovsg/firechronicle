import { el } from './dom';
import { createRetry, type Retry, type RetryState } from '../lib/retry';

export interface RetryUiOpts { run: () => Promise<boolean> | boolean; label?: string; attempts?: number; autoStart?: boolean }
/** Button with a visible auto-retry countdown ("Retry (5)"), a thin progress bar, Cancel, offline pause and a polite live message. */
export function retryControl(host: HTMLElement, o: RetryUiOpts): { root: HTMLElement; ctl: Retry; destroy: () => void } {
  const label = o.label ?? 'Retry';
  const root = el('div', 'retry');
  const btn = el('button', 'btn primary retry-btn') as HTMLButtonElement; btn.type = 'button';
  const bar = el('span', 'rb-bar'); bar.setAttribute('aria-hidden', 'true'); const txt = el('span', 'rb-t', label); const spin = el('span', 'rb-spin'); spin.setAttribute('aria-hidden', 'true'); spin.hidden = true;
  btn.append(bar, spin, txt);
  const cancel = el('button', 'retry-cancel', 'Cancel') as HTMLButtonElement; cancel.type = 'button'; cancel.hidden = true;
  const msg = el('p', 'retry-msg'); msg.setAttribute('aria-live', 'polite');
  root.append(btn, cancel, msg); host.append(root);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctl = createRetry({
    run: o.run, attempts: o.attempts,
    onTick: (left, total) => { txt.textContent = `${label} (${left})`; bar.style.transition = 'none'; bar.style.transform = `scaleX(${left / total})`; if (!reduce) { void bar.offsetWidth; bar.style.transition = 'transform 1s linear'; bar.style.transform = `scaleX(${(left - 1) / total})`; } },
    onState: (s: RetryState) => {
      spin.hidden = s !== 'retrying'; cancel.hidden = s !== 'counting' && s !== 'offline'; btn.disabled = s === 'retrying';
      if (s !== 'counting') { bar.style.transition = 'none'; bar.style.transform = 'scaleX(0)'; }
      if (s === 'retrying') { txt.textContent = 'Retrying…'; msg.textContent = 'Retrying'; }
      else if (s === 'offline') { txt.textContent = label; msg.textContent = "Offline: will retry when you're back online"; }
      else if (s === 'gaveup') { txt.textContent = label; msg.textContent = "Still can't connect. Check your connection."; }
      else if (s === 'counting') msg.textContent = 'Retrying automatically in a few seconds';
      else { txt.textContent = label; if (s === 'cancelled') msg.textContent = 'Automatic retry stopped'; }
    },
  });
  btn.addEventListener('click', () => ctl.retryNow());
  cancel.addEventListener('click', () => ctl.cancel());
  if (o.autoStart !== false) ctl.fail();
  return { root, ctl, destroy: () => { ctl.cancel(); root.remove(); } };
}
