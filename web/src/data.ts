import type { Meta, Monthly, Region } from './lib/series';
const BASE = './data/';
export async function getJson<T>(file: string): Promise<T> {
  const r = await fetch(BASE + file, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return (await r.json()) as T;
}
export interface Countries { type: string; features: { properties: { id: string; name: string }; geometry: { type: string; coordinates: number[][][] } }[] }
export const loadMeta = () => getJson<Meta>('meta.json');
export const loadRegions = async () => (await getJson<{ regions: Region[] }>('regions.json')).regions;
export const loadCountries = () => getJson<Countries>('countries.geojson');
export const loadCells = async () => (await getJson<{ cells: string[] }>('cells.json')).cells;
export const loadMonthly = () => getJson<Monthly>('monthly.json');
export interface Partial { t_month: number; days: number; c: number[]; t: number[]; harm: number[]; regions?: Record<string, { t: number[]; harm: number[] }> }
/** partial.json is optional: same-days history for the current partial month. */
export async function loadPartial(): Promise<Partial | null> {
  try {
    const r = await fetch('./data/partial.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = (await r.json()) as Partial;
    return j && Array.isArray(j.c) && Array.isArray(j.t) && Array.isArray(j.harm) && Number.isFinite(j.t_month) && Number.isFinite(j.days) ? j : null;
  } catch { return null; }
}
