export const SEQ = ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a69d75', '#c4b56a', '#e4cf5b', '#fdea45']; // cividis
export interface Theme { dark: boolean; bg: string; surface: string; ink: string; ink2: string; ink3: string; line: string; ember: string; modis: string; viirs: string; div: string[]; empty: string }
const css = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export type ThemeMode = 'system' | 'light' | 'dark';
const TKEY = 'fc-theme';
export function themeMode(): ThemeMode { try { const v = localStorage.getItem(TKEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; } }
export function applyThemeMode(m: ThemeMode, persist = true): void {
  if (m === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m);
  if (persist) { try { if (m === 'system') localStorage.removeItem(TKEY); else localStorage.setItem(TKEY, m); } catch { /* private mode */ } }
  window.dispatchEvent(new Event('fc-theme'));
}
export const prefersDark = (): boolean => { const a = document.documentElement.getAttribute('data-theme'); return a === 'dark' ? true : a === 'light' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches; };
export function theme(): Theme {
  const dark = prefersDark();
  return {
    dark, bg: css('--bg'), surface: css('--surface'), ink: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), line: css('--line'),
    ember: css('--ember'), modis: css('--modis'), viirs: css('--viirs'),
    div: dark ? ['#4a90e2', '#2f5f9e', '#262e3a', '#b8651f', '#ff9a4d'] : ['#1f5fae', '#8fb4e0', '#f1f1ee', '#f0b074', '#b94a07'],
    empty: dark ? '#1b222c' : '#e3e7ec',
  };
}
export function onThemeChange(cb: () => void): void {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
  window.addEventListener('fc-theme', cb);
}
export function gradientCss(colors: string[]): string { return `linear-gradient(90deg, ${colors.join(',')})`; }
