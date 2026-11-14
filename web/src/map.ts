import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cellToBoundary } from 'h3-js';
import { SEQ } from './theme';
import type { Pt } from './lib/geo';
import { hasDrifted, type View } from './lib/viewDrift';
import { gibsProduct, tileUrl, RELIEF, NIGHT, type BmId, type Product } from './lib/gibs';

maplibregl.setWorkerUrl(new URL('./maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const STYLE = { color: 'https://tiles.openfreemap.org/styles/liberty', light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
type FC = { type: 'FeatureCollection'; features: { type: 'Feature'; id: number; properties: { i: number; n: number; v: number; ac: string; an: number }; geometry: { type: 'Polygon'; coordinates: number[][][] } }[] };
export interface SatFrame {
  sats: { id: string; name: string; lon: number; lat: number; color: string; ended: boolean }[];
  swaths: { id: string; color: string; rings: [number, number][][] }[];
  tracks: { id: string; color: string; lines: [number, number][][] }[];
}
const emptyGj = { type: 'FeatureCollection', features: [] as unknown[] };
const empty: FC = { type: 'FeatureCollection', features: [] };

export class FireMap {
  map: maplibregl.Map;
  private fc: FC = empty;
  private shape: Pt[] | null = null;
  private draft: Pt[] = [];
  private height = 60000;
  private dark: boolean;
  private pitch3d = true;
  private mode: 'activity' | 'anomaly' = 'activity';
  bm: BmId = 'mono';
  private imgDate = '';
  private product: Product | null = null;
  private borders: unknown = { type: 'FeatureCollection', features: [] };
  private labels: unknown = { type: 'FeatureCollection', features: [] };
  onStyleChange: (() => void) | null = null;
  onSatClick: ((anchor: HTMLElement) => void) | null = null;
  private satGj: { swath: unknown; track: unknown } = { swath: emptyGj, track: emptyGj };
  private satMarkers = new Map<string, maplibregl.Marker>();
  private def: View | null = null;
  onDrift: ((d: boolean) => void) | null = null;
  onResetClick: (() => void) | null = null;
  onStyleClick: ((anchor: HTMLElement) => void) | null = null;
  onDrawClick: ((p: Pt) => void) | null = null;
  onDrawFinish: (() => void) | null = null;
  drawing = false;
  ready: Promise<void>;

  constructor(el: HTMLElement, dark: boolean, pitch3d: boolean) {
    this.dark = dark; this.pitch3d = pitch3d;
    this.map = new maplibregl.Map({ container: el, style: dark ? STYLE.dark : STYLE.light, transformStyle: ((_p: unknown, n: unknown) => this.merge(n as never)) as never, center: [67, 45], fadeDuration: 0, zoom: 3, pitch: pitch3d ? 45 : 0, bearing: pitch3d ? -10 : 0, attributionControl: { compact: true }, maxPitch: 70 });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    const self = this;
    this.map.addControl({
      onAdd() {
        const c = document.createElement('div'); c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ctrl-reset'; b.dataset.reset = '1';
        b.setAttribute('aria-label', 'Reset view'); b.title = 'Reset view (R)';
        b.addEventListener('click', () => self.onResetClick?.());
        c.append(b); return c;
      },
      onRemove() { /* control lives as long as the map */ },
    }, 'top-right');
    this.map.addControl({
      onAdd() {
        const c = document.createElement('div'); c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ctrl-style'; b.setAttribute('aria-label', 'Map style'); b.title = 'Map style';
        b.setAttribute('aria-haspopup', 'dialog'); b.addEventListener('click', () => self.onStyleClick?.(b));
        c.append(b); return c;
      },
      onRemove() { /* lives with the map */ },
    }, 'top-right');
    this.map.addControl({
      onAdd() {
        const c = document.createElement('div'); c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ctrl-sat'; b.setAttribute('aria-label', 'Satellites layer'); b.title = 'Satellites: orbits, swaths and next passes';
        b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => self.onSatClick?.(b));
        c.append(b); return c;
      },
      onRemove() { /* lives with the map */ },
    }, 'top-right');
    this.map.on('move', () => this.checkDrift());
    this.map.on('click', (e) => { if (this.drawing) this.onDrawClick?.([e.lngLat.lng, e.lngLat.lat]); });
    this.map.on('dblclick', (e) => { if (this.drawing) { e.preventDefault(); this.onDrawFinish?.(); } });
    // style.load: sources and layers exist; waiting for 'load' would also wait for every basemap tile
    this.ready = new Promise((res) => { this.map.once('style.load', () => res()); this.map.once('load', () => res()); });
  }
  private src(id: string): maplibregl.GeoJSONSource | undefined { return this.map.getSource(id) as maplibregl.GeoJSONSource | undefined; }
  private bright(): boolean { return this.bm === 'mono' ? this.dark : this.bm !== 'color'; }
  /** Our sources and layers, rebuilt from class state so every basemap switch keeps them (and keeps them on top). */
  private merge(next: { sources?: Record<string, unknown>; layers?: unknown[] }): never {
    const d = this.dark, bright = this.bright(), sat = this.bm === 'sat';
    const stops: unknown[] = []; SEQ.forEach((c, i) => stops.push(i / (SEQ.length - 1), c));
    const vis = (m: 'activity' | 'anomaly') => ({ visibility: this.mode === m ? 'visible' : 'none' });
    const op = sat ? 0.85 : d ? 0.92 : 0.88;
    const layers: unknown[] = [
      { id: 'hex-base', type: 'line', source: 'hex', paint: { 'line-color': bright ? '#ffffff' : '#2a3441', 'line-opacity': this.bm === 'sat' || this.bm === 'relief' || this.bm === 'night' ? 0.07 : 0.14, 'line-width': 0.5 } },
      { id: 'hex-3d', type: 'fill-extrusion', source: 'hex', layout: vis('activity'), filter: ['>', ['get', 'n'], 0], paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'n'], ...stops], 'fill-extrusion-height': ['*', ['get', 'n'], this.height], 'fill-extrusion-opacity': op, 'fill-extrusion-vertical-gradient': true } },
      { id: 'hex-anom', type: 'fill-extrusion', source: 'hex', layout: vis('anomaly'), filter: ['>', ['get', 'an'], 0], paint: { 'fill-extrusion-color': ['get', 'ac'], 'fill-extrusion-height': ['*', ['get', 'an'], this.height], 'fill-extrusion-opacity': op, 'fill-extrusion-vertical-gradient': true } },
      { id: 'sat-swath-fill', type: 'fill', source: 'sat-swath', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.16 } },
      { id: 'sat-track-line', type: 'line', source: 'sat-track', paint: { 'line-color': ['get', 'c'], 'line-width': 1.5, 'line-opacity': 0.9 } },
      { id: 'shape-line', type: 'line', source: 'shape', paint: { 'line-color': bright || d ? '#ff7d33' : '#b94a07', 'line-width': 2.5 } },
      { id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ff7d33', 'line-width': 2, 'line-dasharray': [2, 1] } },
      { id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#ff7d33', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff' } },
    ];
    return { ...next, sources: { ...(next.sources ?? {}), hex: { type: 'geojson', data: this.fc }, shape: { type: 'geojson', data: this.shapeData() }, 'sat-swath': { type: 'geojson', data: this.satGj.swath }, 'sat-track': { type: 'geojson', data: this.satGj.track }, draft: { type: 'geojson', data: this.draftData() } }, layers: [...(next.layers ?? []), ...layers] } as never;
  }
  /** Raster basemaps (satellite, relief, night) are plain style objects with our country borders and labels. */
  private rasterStyle(prod: Product, attribution: string, night: boolean): unknown {
    return {
      version: 8, glyphs: GLYPHS,
      sources: { bm: { type: 'raster', tiles: [tileUrl(prod)], tileSize: 256, maxzoom: prod.maxzoom, attribution }, borders: { type: 'geojson', data: this.borders }, clabels: { type: 'geojson', data: this.labels } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': night ? '#000000' : '#0b0f14' } },
        { id: 'bm-raster', type: 'raster', source: 'bm' },
        { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': 0.9 } },
        { id: 'country-labels', type: 'symbol', source: 'clabels', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-letter-spacing': 0.06, 'text-transform': 'uppercase' }, paint: { 'text-color': '#ffffff', 'text-opacity': 0.85, 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 } },
      ],
    };
  }
  setSatPressed(on: boolean): void { document.querySelector('.ctrl-sat')?.setAttribute('aria-pressed', String(on)); }
  /** Satellite overlay: swath bands, ground tracks and one marker per satellite; null removes everything. */
  setSatellites(f: SatFrame | null): void {
    const swath = { type: 'FeatureCollection', features: (f?.swaths ?? []).flatMap((w) => w.rings.map((r) => ({ type: 'Feature', properties: { c: w.color }, geometry: { type: 'Polygon', coordinates: [r] } }))) };
    const track = { type: 'FeatureCollection', features: (f?.tracks ?? []).map((t) => ({ type: 'Feature', properties: { c: t.color }, geometry: { type: 'MultiLineString', coordinates: t.lines } })) };
    this.satGj = { swath, track };
    (this.map.getSource('sat-swath') as maplibregl.GeoJSONSource | undefined)?.setData(swath as never);
    (this.map.getSource('sat-track') as maplibregl.GeoJSONSource | undefined)?.setData(track as never);
    const keep = new Set((f?.sats ?? []).map((x) => x.id));
    for (const [id, m] of this.satMarkers) if (!keep.has(id)) { m.remove(); this.satMarkers.delete(id); }
    for (const s of f?.sats ?? []) {
      let m = this.satMarkers.get(s.id);
      if (!m) {
        const el = document.createElement('div'); el.className = 'sat-mk';
        el.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="1" y="9" width="7" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="16" y="9" width="7" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="6" width="8" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg><span></span>';
        m = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(this.map); this.satMarkers.set(s.id, m);
      }
      const el = m.getElement(); el.style.color = s.color; el.classList.toggle('ended', s.ended);
      (el.querySelector('span') as HTMLElement).textContent = s.ended ? `${s.name} \u00b7 ended` : s.name;
      m.setLngLat([s.lon, s.lat]);
    }
  }
  setCountries(borders: unknown, labels: unknown): void { this.borders = borders; this.labels = labels; if (this.bm === 'sat' || this.bm === 'relief' || this.bm === 'night') this.applyBasemap(); }
  /** Switch the basemap; camera, pitch, hex layer, outline and anomaly mode all stay. */
  setBasemap(id: BmId, imageryDate?: string): void {
    this.bm = id; if (imageryDate) this.imgDate = imageryDate;
    this.applyBasemap();
  }
  private applyBasemap(): void {
    let style: unknown;
    this.product = null;
    if (this.bm === 'mono') style = this.dark ? STYLE.dark : STYLE.light;
    else if (this.bm === 'color') style = STYLE.color;
    else if (this.bm === 'relief') style = this.rasterStyle(RELIEF, 'Relief: NASA GIBS / EOSDIS \u00b7 ASTER GDEM', false);
    else if (this.bm === 'night') style = this.rasterStyle(NIGHT, 'Night lights: NASA GIBS / EOSDIS \u00b7 VIIRS Black Marble', true);
    else { this.product = gibsProduct(this.imgDate); style = this.rasterStyle(this.product, `Imagery: NASA GIBS / EOSDIS \u00b7 ${this.product.label} true colour, ${this.imgDate}`, false); }
    this.map.setStyle(style as never, { diff: false, transformStyle: ((_p: unknown, n: unknown) => this.merge(n as never)) } as never);
    this.map.once('style.load', () => this.onStyleChange?.());
  }
  /** Change the satellite day. Same product: swap tiles in place; different product: rebuild the basemap. */
  setImageryDate(date: string): void {
    if (this.bm !== 'sat' || date === this.imgDate) return;
    this.imgDate = date;
    const prod = gibsProduct(date);
    const srcObj = this.map.getSource('bm') as unknown as { setTiles?: (t: string[]) => void } | undefined;
    if (this.product && prod.layer === this.product.layer && srcObj?.setTiles) { this.product = prod; srcObj.setTiles([tileUrl(prod)]); }
    else this.applyBasemap();
  }
  imagery(): { date: string; label: string } | null { return this.bm === 'sat' ? { date: this.imgDate, label: gibsProduct(this.imgDate).label } : null; }
  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    if (this.bm === 'mono') this.applyBasemap();
  }
  setHexes(cells: { idx: number; id: string }[], heightM: number): void {
    this.height = heightM;
    this.fc = { type: 'FeatureCollection', features: cells.map((c) => {
      const ring = cellToBoundary(c.id, true) as number[][];
      ring.push(ring[0]);
      return { type: 'Feature', id: c.idx, properties: { i: c.idx, n: 0, v: 0, ac: '#888888', an: 0 }, geometry: { type: 'Polygon', coordinates: [ring] } };
    }) };
    this.src('hex')?.setData(this.fc);
    if (this.map.getLayer('hex-3d')) this.map.setPaintProperty('hex-3d', 'fill-extrusion-height', ['*', ['get', 'n'], heightM]);
    if (this.map.getLayer('hex-anom')) this.map.setPaintProperty('hex-anom', 'fill-extrusion-height', ['*', ['get', 'an'], heightM]);
  }
  /** values per cellIdx, normalised by vmax with a sqrt stretch. */
  setValues(vals: Float64Array, vmax: number): void {
    const diff: { id: number; addOrUpdateProperties: { key: string; value: number }[] }[] = [];
    for (const f of this.fc.features) {
      const v = vals[f.properties.i] || 0, n = v > 0 ? Math.sqrt(Math.min(1, v / Math.max(vmax, 1e-9))) * 0.98 + 0.02 : 0;
      if (f.properties.n === n && f.properties.v === v) continue;
      f.properties.v = v; f.properties.n = n;
      diff.push({ id: f.id, addOrUpdateProperties: [{ key: 'v', value: v }, { key: 'n', value: n }] });
    }
    const src = this.src('hex');
    if (!src || !diff.length) return;
    // only the cells that changed (a replay frame touches a fraction of them); a full reload is cheaper when most changed
    if (diff.length > this.fc.features.length * 0.5) src.setData(this.fc as never);
    else (src as unknown as { updateData(d: unknown): Promise<void> }).updateData({ update: diff }).catch(() => src.setData(this.fc as never));
  }
  private applyMode(): void {
    if (this.map.getLayer('hex-3d')) this.map.setLayoutProperty('hex-3d', 'visibility', this.mode === 'activity' ? 'visible' : 'none');
    if (this.map.getLayer('hex-anom')) this.map.setLayoutProperty('hex-anom', 'visibility', this.mode === 'anomaly' ? 'visible' : 'none');
  }
  setMode(m: 'activity' | 'anomaly'): void { this.mode = m; this.applyMode(); }
  /** colour and relative height (0..1) per cellIdx for the anomaly layer; height 0 hides the cell. */
  setAnomaly(colors: string[], heights: Float64Array): void {
    for (const f of this.fc.features) { f.properties.ac = colors[f.properties.i] ?? '#888888'; f.properties.an = heights[f.properties.i] || 0; }
    this.src('hex')?.setData(this.fc);
  }
  flyTo(lon: number, lat: number, zoom = 7): void {
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), zoom), duration: rm ? 0 : 1200, essential: false });
  }
  private shapeData() { return { type: 'FeatureCollection' as const, features: this.shape ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [...this.shape, this.shape[0]] } }] : [] }; }
  setShape(ring: Pt[] | null): void { this.shape = ring; this.src('shape')?.setData(this.shapeData()); }
  private draftData() {
    const f: unknown[] = [];
    if (this.draft.length > 1) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: this.draft } });
    for (const p of this.draft) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } });
    return { type: 'FeatureCollection' as const, features: f as never[] };
  }
  setDraft(pts: Pt[]): void { this.draft = pts; this.src('draft')?.setData(this.draftData()); }
  setDrawing(on: boolean): void {
    this.drawing = on;
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    if (on) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
  }
  private checkDrift(): void {
    if (!this.def) return;
    const c = this.map.getCenter(), cv = this.map.getCanvas();
    this.onDrift?.(hasDrifted({ center: [c.lng, c.lat], zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing() }, this.def, cv.clientWidth, cv.clientHeight));
  }
  /** The one place that frames an area: initial load, area change and the Reset view button. */
  resetTo(b: [number, number, number, number], animate = true): void {
    this.map.resize();
    const pad = window.innerWidth < 900 ? 24 : 50, pitch = this.pitch3d ? 45 : 0;
    const cam = this.map.cameraForBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad });
    if (!cam || !cam.center) return;
    const ctr = maplibregl.LngLat.convert(cam.center as never);
    this.def = { center: [ctr.lng, ctr.lat], zoom: cam.zoom ?? this.map.getZoom(), pitch, bearing: 0 };
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.easeTo({ center: this.def.center, zoom: this.def.zoom, pitch, bearing: 0, duration: rm || !animate ? 0 : 600 });
    this.onDrift?.(false);
  }
  set3d(on: boolean): void {
    this.pitch3d = on; if (this.def) this.def.pitch = on ? 45 : 0;
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.easeTo({ pitch: on ? 45 : 0, bearing: on ? -10 : 0, duration: rm ? 0 : 600 });
  }
}
