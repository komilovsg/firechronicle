// Generates SYNTHETIC sample data in public/data/ following DATA_CONTRACT.md.
// The real pipeline overwrites these files; the app needs no code change for that.
import { latLngToCell, cellToLatLng } from 'h3-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
mkdirSync(join(OUT, 'points'), { recursive: true });

let seed = 20261114;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const poisson = (l) => { if (l <= 0) return 0; if (l > 40) return Math.max(0, Math.round(l + Math.sqrt(l) * gauss())); const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };

const BBOX = [46, 35, 88, 56];
const T_FIRST = 10, T_LAST = 322, T_NRT = 320, PARTIAL_DAYS = 14;
const T_SNPP0 = 144, T_N20_0 = 18 * 12 + 3, T_N21_0 = 23 * 12 + 2;

// Placeholder country boxes (rough, overlapping allowed; first match wins).
const COUNTRIES = [
  ['TJK', 'Tajikistan', 67, 36.6, 75.2, 39.6],
  ['KGZ', 'Kyrgyzstan', 69.5, 39.2, 80.2, 43.2],
  ['TKM', 'Turkmenistan', 52.5, 35.2, 66.5, 42.6],
  ['UZB', 'Uzbekistan', 56, 37.2, 73, 45.5],
  ['AFG', 'Afghanistan', 60.5, 35, 75, 38.5],
  ['KAZ', 'Kazakhstan', 47, 40.6, 87.3, 55.4],
];
const countryOf = (lat, lon) => (COUNTRIES.find(([, , x0, y0, x1, y1]) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) || [null])[0];

// cells
const cellSet = new Set();
while (cellSet.size < 1500) {
  const lat = BBOX[1] + rnd() * (BBOX[3] - BBOX[1]), lon = BBOX[0] + rnd() * (BBOX[2] - BBOX[0]);
  if (!countryOf(lat, lon)) { if (rnd() < 0.85) continue; }
  cellSet.add(latLngToCell(lat, lon, 5));
}
const cells = [...cellSet];
const info = cells.map((id) => { const [lat, lon] = cellToLatLng(id); return { id, lat, lon, cc: countryOf(lat, lon), w: Math.min(8, Math.exp(-0.5 + 0.9 * gauss())) }; });

// year factors
const yearF = {}; const ccYear = {};
for (let y = 2000; y <= 2026; y++) { yearF[y] = Math.exp(0.3 * gauss()); for (const c of ['KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'AFG', null]) ccYear[y + '|' + c] = Math.exp(0.2 * gauss()); }
Object.assign(yearF, { 2023: 1.9, 2008: 1.55, 2015: 1.5, 2002: 0.7, 2019: 1.35 });
const seas = (m, lat) => { const peak = 7.2 + (lat - 45) * 0.04; const g = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2); return 0.04 + 1.0 * g(m, peak, 1.3) + 0.22 * g(m, 3.1, 0.7); };

const cols = { c: [], t: [], modis: [], snpp: [], n20: [], n21: [], harm: [], lo: [], hi: [] };
const r2 = (x) => Math.round(x * 100) / 100;
for (let t = T_FIRST; t <= T_LAST; t++) {
  const y = 2000 + Math.floor(t / 12), m = t % 12; // m 0-based
  const frac = t === T_LAST ? PARTIAL_DAYS / 30 : 1;
  for (let ci = 0; ci < info.length; ci++) {
    const q = info[ci];
    const A = q.w * seas(m + 0.5, q.lat) * yearF[y] * ccYear[y + '|' + q.cc] * frac * 0.7;
    const mod = poisson(A * Math.exp(0.15 * gauss()));
    const snppFrac = t === T_LAST ? 2 / 14 : 1;
    const sn = t >= T_SNPP0 ? poisson(A * 7 * snppFrac * Math.exp(0.15 * gauss())) : 0;
    const n20 = t >= T_N20_0 ? poisson(A * 6.6 * Math.exp(0.15 * gauss())) : 0;
    const n21 = t >= T_N21_0 ? poisson(A * 7.2 * Math.exp(0.15 * gauss())) : 0;
    const harm = A * (1 + 0.05 * gauss());
    if (!(mod || sn || n20 || n21)) continue;
    const band = t < 24 ? 0.3 : t < T_SNPP0 ? 0.12 : 0.18;
    cols.c.push(ci); cols.t.push(t); cols.modis.push(mod); cols.snpp.push(sn); cols.n20.push(n20); cols.n21.push(n21);
    cols.harm.push(r2(harm)); cols.lo.push(r2(harm * (1 - band))); cols.hi.push(r2(harm * (1 + band)));
  }
}
writeFileSync(join(OUT, 'cells.json'), JSON.stringify({ cells }));
writeFileSync(join(OUT, 'monthly.json'), JSON.stringify(cols));

// regions
const naiveAt = (t, o) => (t < 144 ? o.modis : t > 322 ? o.n20 : o.snpp);
const ids = ['central-asia', 'KAZ', 'UZB', 'TKM', 'KGZ', 'TJK', 'AFG'];
const names = { 'central-asia': 'Central Asia', ...Object.fromEntries(COUNTRIES.map((c) => [c[0], c[1]])) };
const regions = ids.map((id) => {
  const nT = T_LAST - T_FIRST + 1;
  const S = Object.fromEntries(['modis', 'snpp', 'n20', 'n21', 'harm', 'lo', 'hi'].map((k) => [k, new Array(nT).fill(0)]));
  for (let i = 0; i < cols.c.length; i++) {
    if (id !== 'central-asia' && info[cols.c[i]].cc !== id) continue;
    const j = cols.t[i] - T_FIRST;
    for (const k of Object.keys(S)) S[k][j] += cols[k][i];
  }
  const t = Array.from({ length: nT }, (_, j) => j + T_FIRST);
  const naive = t.map((tt, j) => naiveAt(tt, { modis: S.modis[j], snpp: S.snpp[j], n20: S.n20[j] }));
  for (const k of ['harm', 'lo', 'hi']) S[k] = S[k].map(r2);
  return { id, name: names[id], t, ...S, naive };
});
writeFileSync(join(OUT, 'regions.json'), JSON.stringify({ regions }));

// countries.geojson (PLACEHOLDER polygons: rough boxes with chamfered corners, not real borders)
const feat = COUNTRIES.map(([id, name, x0, y0, x1, y1]) => ({
  type: 'Feature', properties: { id, name },
  geometry: { type: 'Polygon', coordinates: [[[x0 + 1, y0], [x1 - 1, y0], [x1, y0 + 1], [x1, y1 - 1], [x1 - 1, y1], [x0 + 1, y1], [x0, y1 - 1], [x0, y0 + 1], [x0 + 1, y0]]] },
}));
writeFileSync(join(OUT, 'countries.geojson'), JSON.stringify({ type: 'FeatureCollection', features: feat }));

// points
for (const year of [2025, 2026]) {
  const rows = ['date,time,lat,lon,satellite,instrument,confidence,frp,daynight,type,processing'];
  for (let i = 0; i < cols.c.length; i++) {
    const t = cols.t[i]; if (2000 + Math.floor(t / 12) !== year) continue;
    const mo = (t % 12) + 1; const maxD = t === T_LAST ? PARTIAL_DAYS : new Date(Date.UTC(year, mo, 0)).getUTCDate();
    const q = info[cols.c[i]];
    for (const [k, sat, ins] of [['modis', 'Aqua', 'MODIS'], ['snpp', 'N', 'VIIRS'], ['n20', 'N20', 'VIIRS'], ['n21', 'N21', 'VIIRS']]) {
      const n = Math.min(cols[k][i], 1 + (rnd() < 0.3 ? 1 : 0)); if (rnd() > 0.35) continue;
      for (let j = 0; j < n; j++) {
        const d = 1 + Math.floor(rnd() * maxD);
        const day = rnd() < 0.7;
        const conf = ins === 'MODIS' ? 30 + Math.floor(rnd() * 70) : rnd() < 0.7 ? 'n' : 'h';
        rows.push([`${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day ? `0${6 + Math.floor(rnd() * 8)}${String(Math.floor(rnd() * 60)).padStart(2, '0')}`.slice(-4).padStart(4, '0') : '2130',
          (q.lat + (rnd() - 0.5) * 0.3).toFixed(4), (q.lon + (rnd() - 0.5) * 0.3).toFixed(4), sat, ins, conf, (1 + rnd() * rnd() * 80).toFixed(1), day ? 'D' : 'N', 0, t >= T_NRT ? 'NRT' : 'SP'].join(','));
      }
    }
  }
  writeFileSync(join(OUT, 'points', `${year}.csv.gz`), gzipSync(rows.join('\n') + '\n'));
  console.log(`points/${year}: ${rows.length - 1} rows`);
}

const meta = {
  version: 1, sample: true, generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  region: { name: 'Central Asia', bbox: BBOX }, h3_res: 5, t_first: T_FIRST, t_last: T_LAST, t_nrt_from: T_NRT,
  current_month_partial_days: PARTIAL_DAYS, units: 'MODIS-equivalent active fire detections',
  sensors: {
    modis: { label: 'MODIS (Terra+Aqua)', start: '2000-11-01', end: '2026-11-14' },
    snpp: { label: 'VIIRS S-NPP', start: '2012-01-20', end: '2026-11-02' },
    n20: { label: 'VIIRS NOAA-20', start: '2018-04-01', end: '2026-11-14' },
    n21: { label: 'VIIRS NOAA-21', start: '2023-03-01', end: '2026-11-14' },
  },
  sources: [
    { name: 'MODIS Collection 6.1 NRT/SP active fire (MCD14DL)', url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', doi: '10.5067/FIRMS/MODIS/MCD14DL.NRT.0061' },
    { name: 'VIIRS S-NPP 375 m active fire (VNP14IMGTDL)', url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', doi: '10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002' },
    { name: 'VIIRS NOAA-20 375 m active fire', url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', doi: '10.5067/FIRMS/VIIRS/VJ114IMGT_NRT.002' },
    { name: 'VIIRS NOAA-21 375 m active fire', url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', doi: '10.5067/FIRMS/VIIRS/VJ214IMGT_NRT.002' },
  ],
  validation: {
    naive_break_2012: { test: 'Pettitt', p: 0.001, jump_ratio: 6.8 },
    harmonized_break_2012: { test: 'Pettitt', p: 0.42, jump_ratio: 1.05 },
    cv: { scheme: 'leave-one-year-out', bias_pct: -3.1, mae: 12.4, r2_monthly: 0.91 },
    notes: ['SAMPLE numbers: placeholders until the pipeline output replaces them.'],
  },
};
writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log('cells', cells.length, 'rows', cols.c.length);
