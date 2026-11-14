import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cellToBoundary } from 'h3-js';
import { SEQ } from './theme';
import type { Pt } from './lib/geo';
import { hasDrifted, type View } from './lib/viewDrift';

maplibregl.setWorkerUrl(new URL('./maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
type FC = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: { i: number; n: number; v: number; ac: string; an: number }; geometry: { type: 'Polygon'; coordinates: number[][][] } }[] };
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
  private def: View | null = null;
  onDrift: ((d: boolean) => void) | null = null;
  onResetClick: (() => void) | null = null;
  onDrawClick: ((p: Pt) => void) | null = null;
  onDrawFinish: (() => void) | null = null;
  drawing = false;
  ready: Promise<void>;

  constructor(el: HTMLElement, dark: boolean, pitch3d: boolean) {
    this.dark = dark; this.pitch3d = pitch3d;
    this.map = new maplibregl.Map({ container: el, style: dark ? STYLE.dark : STYLE.light, center: [67, 45], zoom: 3, pitch: pitch3d ? 45 : 0, bearing: pitch3d ? -10 : 0, attributionControl: { compact: true }, maxPitch: 70 });
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
    this.map.on('move', () => this.checkDrift());
    this.map.on('style.load', () => this.addLayers());
    this.map.on('click', (e) => { if (this.drawing) this.onDrawClick?.([e.lngLat.lng, e.lngLat.lat]); });
    this.map.on('dblclick', (e) => { if (this.drawing) { e.preventDefault(); this.onDrawFinish?.(); } });
    this.ready = new Promise((res) => this.map.once('load', () => res()));
  }
  private src(id: string): maplibregl.GeoJSONSource | undefined { return this.map.getSource(id) as maplibregl.GeoJSONSource | undefined; }
  private addLayers(): void {
    const m = this.map, d = this.dark;
    const ink = d ? '#c9d4e2' : '#2a3441';
    m.addSource('hex', { type: 'geojson', data: this.fc });
    m.addSource('shape', { type: 'geojson', data: this.shapeData() });
    m.addSource('draft', { type: 'geojson', data: this.draftData() });
    const stops: unknown[] = [];
    SEQ.forEach((c, i) => stops.push(i / (SEQ.length - 1), c));
    m.addLayer({ id: 'hex-base', type: 'line', source: 'hex', paint: { 'line-color': ink, 'line-opacity': 0.14, 'line-width': 0.5 } });
    m.addLayer({ id: 'hex-3d', type: 'fill-extrusion', source: 'hex', filter: ['>', ['get', 'n'], 0], paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'n'], ...stops] as never,
      'fill-extrusion-height': ['*', ['get', 'n'], this.height] as never, 'fill-extrusion-opacity': d ? 0.92 : 0.88, 'fill-extrusion-vertical-gradient': true } });
    m.addLayer({ id: 'hex-anom', type: 'fill-extrusion', source: 'hex', filter: ['>', ['get', 'an'], 0], paint: {
      'fill-extrusion-color': ['get', 'ac'] as never, 'fill-extrusion-height': ['*', ['get', 'an'], this.height] as never, 'fill-extrusion-opacity': d ? 0.92 : 0.9, 'fill-extrusion-vertical-gradient': true } });
    this.applyMode();
    m.addLayer({ id: 'shape-line', type: 'line', source: 'shape', paint: { 'line-color': d ? '#ff7d33' : '#b94a07', 'line-width': 2 } });
    m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#ff7d33', 'line-width': 2, 'line-dasharray': [2, 1] } });
    m.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#ff7d33', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } });
  }
  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    this.map.setStyle(dark ? STYLE.dark : STYLE.light);
  }
  setHexes(cells: { idx: number; id: string }[], heightM: number): void {
    this.height = heightM;
    this.fc = { type: 'FeatureCollection', features: cells.map((c) => {
      const ring = cellToBoundary(c.id, true) as number[][];
      ring.push(ring[0]);
      return { type: 'Feature', properties: { i: c.idx, n: 0, v: 0, ac: '#888888', an: 0 }, geometry: { type: 'Polygon', coordinates: [ring] } };
    }) };
    this.src('hex')?.setData(this.fc);
    if (this.map.getLayer('hex-3d')) this.map.setPaintProperty('hex-3d', 'fill-extrusion-height', ['*', ['get', 'n'], heightM]);
    if (this.map.getLayer('hex-anom')) this.map.setPaintProperty('hex-anom', 'fill-extrusion-height', ['*', ['get', 'an'], heightM]);
  }
  /** values per cellIdx, normalised by vmax with a sqrt stretch. */
  setValues(vals: Float64Array, vmax: number): void {
    for (const f of this.fc.features) {
      const v = vals[f.properties.i] || 0;
      f.properties.v = v; f.properties.n = v > 0 ? Math.sqrt(Math.min(1, v / Math.max(vmax, 1e-9))) * 0.98 + 0.02 : 0;
    }
    this.src('hex')?.setData(this.fc);
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
