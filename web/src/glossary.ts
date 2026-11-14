export const TERMS: Record<string, { title: string; text: string }> = {
  hotspot: { title: 'Hotspot', text: 'A satellite pixel flagged as containing an active fire when the satellite passed over. It is not a burned area and not a fire size.' },
  MODIS: { title: 'MODIS', text: 'A pair of NASA instruments (on the Terra and Aqua satellites) that have watched Earth for fires since 2000. Their roughly 1 km pixels are coarse; they are beginning to retire.' },
  VIIRS: { title: 'VIIRS', text: 'A newer fire sensor on S-NPP, NOAA-20 and NOAA-21. Its pixels are about 375 m, so it records many more detections for the same fire.' },
  NRT: { title: 'NRT (near real time)', text: 'Data published within hours of the overpass, before final quality checks. Recent months are provisional and can change slightly.' },
  harmonized: { title: 'Harmonized', text: 'Counts from every sensor converted to one common scale, so a 2005 month and a 2025 month can be compared fairly.' },
  'MODIS-equivalent': { title: 'MODIS-equivalent', text: 'The number of detections MODIS would have recorded. We use it as the common unit because MODIS has the longest record.' },
  percentile: { title: 'Percentile', text: 'Where a value ranks in history. The 90th percentile means that only 10% of comparable past months were busier.' },
  'robust z': { title: 'Robust z-score', text: 'How far a month is from the usual level for that calendar month, in units of typical spread, using the median so a few extreme years do not distort it. Beyond +-2 is unusual.' },
  'H3 cell': { title: 'H3 cell', text: 'A hexagon of about 250 km2 on a fixed global grid. Areas are made of these cells, and detections are counted per cell.' },
};

let pop: HTMLElement | null = null, openBtn: HTMLElement | null = null;
function close(): void { if (pop) pop.hidden = true; openBtn?.setAttribute('aria-expanded', 'false'); openBtn = null; }
function ensurePop(): HTMLElement {
  if (pop) return pop;
  pop = document.createElement('div'); pop.className = 'gloss-pop'; pop.id = 'gloss-pop'; pop.setAttribute('role', 'dialog'); pop.hidden = true;
  document.body.append(pop);
  document.addEventListener('click', (e) => { if (openBtn && !(e.target as Element).closest('.gloss-pop, .gl-i')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openBtn) { const b = openBtn; close(); b.focus(); } });
  addEventListener('scroll', close, { passive: true }); addEventListener('resize', close);
  return pop;
}
function show(btn: HTMLElement, term: string): void {
  const p = ensurePop(), t = TERMS[term]; if (!t) return;
  if (openBtn === btn) { close(); return; }
  close();
  p.textContent = '';
  const h = document.createElement('b'); h.textContent = t.title;
  const d = document.createElement('p'); d.textContent = t.text;
  p.append(h, d); p.setAttribute('aria-label', t.title); p.hidden = false;
  const r = btn.getBoundingClientRect(), w = Math.min(280, innerWidth - 16);
  p.style.width = `${w}px`;
  p.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  const below = r.bottom + 8, ph = p.offsetHeight;
  p.style.top = `${below + ph > innerHeight ? Math.max(8, r.top - ph - 8) : below}px`;
  openBtn = btn; btn.setAttribute('aria-expanded', 'true');
}
/** Insert an info button after `anchor` (idempotent per anchor+term). label = visible chip text. */
export function addInfo(anchor: Element | null, term: string, label?: string): void {
  if (!anchor || !TERMS[term]) return;
  if (anchor.parentElement?.querySelector(`.gl-i[data-term="${term}"]`)) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'gl-i' + (label ? ' chip' : ''); b.dataset.term = term;
  b.setAttribute('aria-label', `What is ${TERMS[term].title}?`); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'gloss-pop');
  b.textContent = label ? `${label} ⓘ` : 'ⓘ';
  b.addEventListener('click', (e) => { e.stopPropagation(); show(b, term); });
  anchor.after(b);
}
