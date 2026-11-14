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
