import { createEmber, type EmberState } from './ember';
/** Dev-only story page (?ember-demo): every Ember state side by side. Not part of production builds. */
export function showEmberDemo(): void {
  const root = document.createElement('div'); root.className = 'demo-ember';
  const states: EmberState[] = ['idle', 'thinking', 'answered', 'refused', 'error'];
  const embers = states.map((s) => { const f = document.createElement('figure'); const e = createEmber(96); const c = document.createElement('figcaption'); c.textContent = s; f.append(e.el, c); root.append(f); return { e, s }; });
  const small = document.createElement('figure'); const e28 = createEmber(28), e20 = createEmber(20, true); const cap = document.createElement('figcaption'); cap.textContent = '28 px / 20 px static'; const row = document.createElement('div'); row.style.display = 'flex'; row.style.gap = '12px'; row.append(e28.el, e20.el); small.append(row, cap); root.append(small);
  embers.forEach(({ e, s }) => { e.el.dataset.state = s; }); // held, so a still frame shows every pose
  document.body.append(root);
}
