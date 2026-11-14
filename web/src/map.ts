import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cellToBoundary } from 'h3-js';
import { SEQ } from './theme';
import type { Pt } from './lib/geo';

maplibregl.setWorkerUrl(new URL('./maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
type FC = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: { i: number; n: number; v: number }; geometry: { type: 'Polygon'; coordinates: number[][][] } }[] };
const empty: FC = { type: 'FeatureCollection', features: [] };

export class FireMap {
  map: maplibregl.Map;
  private fc: FC = empty;
  private shape: Pt[] | null = null;
  private draft: Pt[] = [];
  private height = 60000;
  private dark: boolean;
  private pitch3d = true;
  onDrawClick: ((p: Pt) => void) | null = null;
  onDrawFinish: (() => void) | null = null;
  drawing = false;
  ready: Promise<void>;

  constructor(el: HTMLElement, dark: boolean, pitch3d: boolean) {
    this.dark = dark; this.pitch3d = pitch3d;
    this.map = new maplibregl.Map({ container: el, style: dark ? STYLE.dark : STYLE.light, center: [67, 45], zoom: 3, pitch: pitch3d ? 45 : 0, bearing: pitch3d ? -10 : 0, attributionControl: { compact: true }, maxPitch: 70 });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
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
      return { type: 'Feature', properties: { i: c.idx, n: 0, v: 0 }, geometry: { type: 'Polygon', coordinates: [ring] } };
    }) };
    this.src('hex')?.setData(this.fc);
    if (this.map.getLayer('hex-3d')) this.map.setPaintProperty('hex-3d', 'fill-extrusion-height', ['*', ['get', 'n'], heightM]);
  }
  /** values per cellIdx, normalised by vmax with a sqrt stretch. */
  setValues(vals: Float64Array, vmax: number): void {
    for (const f of this.fc.features) {
      const v = vals[f.properties.i] || 0;
      f.properties.v = v; f.properties.n = v > 0 ? Math.sqrt(Math.min(1, v / Math.max(vmax, 1e-9))) * 0.98 + 0.02 : 0;
    }
    this.src('hex')?.setData(this.fc);
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
  fit(b: [number, number, number, number]): void {
    this.map.resize();
    const pad = window.innerWidth < 900 ? 24 : 50;
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700, pitch: this.pitch3d ? 45 : 0, bearing: this.pitch3d ? -10 : 0 });
  }
  set3d(on: boolean): void {
    this.pitch3d = on;
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.map.easeTo({ pitch: on ? 45 : 0, bearing: on ? -10 : 0, duration: rm ? 0 : 600 });
  }
}
