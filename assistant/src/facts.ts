// Data-derived knowledge chunks (validation + regions). Pure and deterministic: the same code
// runs at index build time (Node) and inside the Worker, so identical data gives identical text.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SITE = "https://komilovsg.github.io/firechronicle/";

interface Sec { section: string; content: string }
interface Doc { id: string; title: string; source: string; url: string; sections: Sec[] }
export interface FactChunk { docId: string; title: string; section: string; url: string; text: string }

function validationDoc(meta: any): Doc {
  const v = meta.validation ?? {}, cal = meta.calibration ?? {};
  const has = (x: any) => x !== undefined && x !== null;
  const names = { snpp: "Suomi NPP", n20: "NOAA-20", n21: "NOAA-21" };
  const sections: Sec[] = [];

  const cvLines = [];
  for (const [k, name] of Object.entries(names)) {
    const cv = v.cv?.[k];
    if (!cv) continue;
    for (const [lvl, label] of [["country_month", "country-month"], ["region_month", "region-month"]]) {
      const c = cv[lvl];
      if (!c) continue;
      const parts = [];
      if (has(c.r2)) parts.push(`r2 ${c.r2}`);
      if (has(c.bias_pct)) parts.push(`bias ${c.bias_pct} percent`);
      if (has(c.mae)) parts.push(`mean absolute error ${c.mae} detections`);
      if (has(c.n)) parts.push(`n = ${c.n}`);
      if (parts.length) cvLines.push(`Cross-validation of ${name} against its prediction from MODIS (${label}${cv.years ? `, years ${cv.years}` : ""}): ${parts.join(", ")}.`);
    }
  }
  if (cvLines.length) sections.push({ section: "Cross-validation", content: cvLines.join("\n") });

  const jl = [];
  const nb = v.naive_break_2012, hb = v.harmonized_break_2012, mo = v.modis_only_reference;
  if (nb && has(nb.jump_ratio)) jl.push(`The naive MODIS-to-VIIRS splice shows a jump ratio of ${nb.jump_ratio} at the 2012 change point${nb.change_point ? ` (${nb.change_point})` : ""}${has(nb.p) ? `, Pettitt test p = ${nb.p}` : ""}.`);
  if (hb && has(hb.jump_ratio)) jl.push(`The harmonized record shows a jump ratio of ${hb.jump_ratio}${hb.change_point ? ` at change point ${hb.change_point}` : ""}${has(hb.p) ? `, Pettitt test p = ${hb.p}` : ""}.`);
  if (mo && has(mo.jump_ratio)) jl.push(`The MODIS-only reference shows a jump ratio of ${mo.jump_ratio}${mo.change_point ? ` at change point ${mo.change_point}` : ""}.`);
  if (jl.length) sections.push({ section: "Naive splice vs harmonized jump", content: jl.join("\n") });

  const cl = [];
  for (const [k, name] of Object.entries(names)) {
    const c = cal[k];
    if (c && has(c.global_ratio)) cl.push(`Overall calibration ratio of ${name} to MODIS: ${c.global_ratio}${c.fit_years ? ` (fit years ${c.fit_years})` : ""}.`);
  }
  if (has(cal.terra_to_terra_aqua)) cl.push(`Terra-only to Terra+Aqua ratio: ${cal.terra_to_terra_aqua}.`);
  const ch = v.chain_check_noaa20;
  if (ch && has(ch.direct) && has(ch.via_snpp)) cl.push(`Chain check for NOAA-20: the ratio calibrated directly against MODIS is ${ch.direct}, via Suomi NPP it is ${ch.via_snpp}.`);
  if (cl.length) sections.push({ section: "Calibration ratios and chain check", content: cl.join("\n") });

  const extra = [];
  for (const [k, name] of Object.entries(names)) {
    const cv = v.cv?.[k];
    if (!cv) continue;
    if (has(cv.climatology_r2)) extra.push(`Climatology r2 for ${name}: ${cv.climatology_r2}.`);
    if (has(cv.drift_pct_per_year)) extra.push(`Fitted yearly drift of the ${name} to MODIS ratio: ${cv.drift_pct_per_year} percent per year.`);
    if (cv.per_year_bias_pct && Object.keys(cv.per_year_bias_pct).length) {
      extra.push(`Per-year bias of ${name} cross-validation (percent): ${Object.entries(cv.per_year_bias_pct).map(([y, b]) => `${y} ${b}`).join(", ")}.`);
    }
  }
  for (const [k, name] of Object.entries(names)) {
    const c = cal[k];
    if (!c) continue;
    if (has(c.ratio_at_last_fit_year)) extra.push(`Calibration ratio of ${name} at the last fit year: ${c.ratio_at_last_fit_year}.`);
    if (has(c.drift_pct_per_year)) extra.push(`Calibration drift of ${name}: ${c.drift_pct_per_year} percent per year.`);
  }
  if (has(cal.terra_share)) extra.push(`Terra share of the Terra+Aqua total: ${cal.terra_share}.`);
  if (has(v.year_level_calibration_error_pct)) extra.push(`Year-level calibration error: ${v.year_level_calibration_error_pct} percent.`);
  const ts = v.trend_theil_sen_per_year;
  if (ts) {
    const parts = [["naive", "naive splice"], ["harm", "harmonized"], ["modis", "MODIS-only"]].filter(([k]) => has(ts[k])).map(([k, l]) => `${l} ${ts[k]}`);
    if (parts.length) extra.push(`Theil-Sen trend per year: ${parts.join(", ")}.`);
  }
  if (extra.length) sections.push({ section: "Drift, trend and calibration details", content: extra.join("\n") });

  const cov = [];
  if (meta.cleaning) {
    if (has(meta.cleaning.type0_removed_pct)) cov.push(`Detections removed because FIRMS type is not 0 (not presumed vegetation fire): ${meta.cleaning.type0_removed_pct} percent.`);
    if (has(meta.cleaning.nrt_removed_pct)) cov.push(`Near-real-time detections removed by cleaning: ${meta.cleaning.nrt_removed_pct} percent.`);
  }
  if (meta.refresh) {
    const r = meta.refresh;
    if (r.cadence) cov.push(`The data refresh cadence is ${r.cadence}${r.schedule_utc ? ` at ${r.schedule_utc} UTC` : ""}${r.auto_update_until ? `, with automatic updates until ${r.auto_update_until}` : ""}.`);
  }
  if (has(meta.data_through)) cov.push(`Data through ${meta.data_through}.`);
  if (cov.length) sections.push({ section: "Cleaning, refresh and data coverage", content: cov.join("\n") });

  return { id: "validation", title: "FireChronicle validation results", source: "FireChronicle pipeline output (meta.json)", url: SITE, sections };
}

function regionsDoc(meta: any, regions: any[], partial: any): Doc {
  const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const tLast = meta.t_last;
  const lastYear = 2000 + Math.floor(tLast / 12), lastMonth = tLast % 12; // 0-based month of t_last
  const latestComplete = lastMonth === 11 ? lastYear : lastYear - 1;
  const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
  const pct = (n: number) => Math.round(n);
  const ranges = (months: number[]) => {
    const out: string[] = []; let i = 0;
    while (i < months.length) {
      let j = i; while (j + 1 < months.length && months[j + 1] === months[j] + 1) j++;
      out.push(j > i ? `${MN[months[i]]}\u2013${MN[months[j]]}` : MN[months[i]]); i = j + 1;
    }
    return out.join(" and ");
  };
  const sections: Sec[] = [];
  for (const reg of regions) {
    const val = (y: number, m: number) => { const i = reg.t.indexOf((y - 2000) * 12 + m); return i < 0 ? null : reg.harm[i]; };
    const years: number[] = []; for (let y = 2001; y <= 2025; y++) years.push(y);
    const annual: Record<number, number> = {}; const monthly: Record<number, number[]> = {};
    for (const y of years) { monthly[y] = []; for (let m = 0; m < 12; m++) monthly[y].push(val(y, m) ?? 0); annual[y] = monthly[y].reduce((a, b) => a + b, 0); }
    const lines: string[] = [];
    // same definition as the web app (web/src/lib/analytics.ts detectSeason): median per calendar month,
    // then each month's share of the sum of those medians; season = share >= 8%, peak = largest median
    // every complete month in the data (t_first .. t_last-1), exactly like the web app's default view
    const monMed = Array.from({ length: 12 }, (_, m) => median(reg.t.map((t: number, i: number) => [t, reg.harm[i]] as [number, number])
      .filter(([t]: [number, number]) => t % 12 === m && t >= meta.t_first && t < meta.t_last).map(([, v]: [number, number]) => v)));
    const medSum = monMed.reduce((a, b) => a + b, 0);
    const season = medSum > 0 ? monMed.map((x, m) => [x / medSum, m]).filter(([x]) => x >= 0.08).map(([, m]) => m) : [];
    const peak = monMed.indexOf(Math.max(...monMed));
    if (season.length) lines.push(`Typical fire season in ${reg.name}: ${ranges(season)} (months whose median monthly total, over all complete months since November 2000, is at least 8 percent of the sum of monthly medians). The peak month is ${FULL[peak]}.`);
    const tot = years.map((y) => [y, annual[y]]);
    const med = median(tot.map((t) => t[1]));
    const top = [...tot].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const low = [...tot].sort((a, b) => a[1] - b[1])[0];
    lines.push(`Median annual harmonized total in ${reg.name} for 2001-2025: ${fmt(med)} MODIS-equivalent detections. The three highest years were ${top.map((t) => `${t[0]} (${fmt(t[1])})`).join(", ")}. The lowest year was ${low[0]} (${fmt(low[1])}). The year with the most detections was ${top[0][0]}.`);
    const recent: number[] = []; for (let y = 2016; y <= 2025; y++) recent.push(y);
    const ms = Array.from({ length: 12 }, (_, m) => recent.reduce((a, y) => a + (val(y, m) ?? 0), 0));
    lines.push(`The most active calendar month in ${reg.name} over the last 10 complete years (2016-2025) is ${FULL[ms.indexOf(Math.max(...ms))]}.`);
    let latest = 0; for (let m = 0; m < 12; m++) latest += val(latestComplete, m) ?? 0;
    const d = ((latest - med) / med) * 100;
    lines.push(`Harmonized detections in ${latestComplete} in ${reg.name}: ${fmt(latest)} MODIS-equivalent detections, which is ${pct(Math.abs(d))} percent ${d >= 0 ? "above" : "below"} the 2001-2025 median.`);
    const early = mean(years.filter((y) => y <= 2011).map((y) => annual[y]));
    const late = mean(years.filter((y) => y >= 2012).map((y) => annual[y]));
    const ch = ((late - early) / early) * 100;
    lines.push(`Mean annual harmonized total in ${reg.name}: ${fmt(early)} in 2001-2011 and ${fmt(late)} in 2012-2025, a change of ${ch >= 0 ? "+" : "-"}${pct(Math.abs(ch))} percent (${ch >= 0 ? "higher" : "lower"} in the later period).`);
    const pr = partial?.regions?.[reg.id];
    if (pr && partial.t_month === tLast) {
      const cur = pr.harm[pr.t.indexOf(partial.t_month)];
      const past = pr.t.map((t: number, i: number) => [t, pr.harm[i]] as [number, number]).filter(([t]: [number, number]) => t < partial.t_month).map(([, h]: [number, number]) => h);
      if (cur !== undefined && past.length) {
        const pm = median(past), dd = pm ? ((cur - pm) / pm) * 100 : null;
        lines.push(`Current partial month in ${reg.name} (${FULL[partial.t_month % 12]} ${2000 + Math.floor(partial.t_month / 12)}, days 1-${partial.days}): ${fmt(cur)} MODIS-equivalent detections${dd === null ? "" : `, which is ${pct(Math.abs(dd))} percent ${dd >= 0 ? "above" : "below"} the median of the same days in past years (${fmt(pm)})`}. This month is provisional.`);
      }
    }
    if (meta.data_through) lines.push(`Data through ${meta.data_through}.`);
    sections.push({ section: `${reg.name} (${reg.id})`, content: lines.join("\n") });
  }
  return { id: "regions", title: "Fire activity by country (computed from FireChronicle data)", source: "FireChronicle harmonized regional series (regions.json)", url: SITE, sections };
}

export function buildFactsDocs(meta: any, regions: any[] | null, partial: any | null): FactChunk[] {
  const docs: Doc[] = [];
  if (meta) docs.push(validationDoc(meta));
  if (meta && regions) docs.push(regionsDoc(meta, regions, partial));
  const out: FactChunk[] = [];
  for (const d of docs) {
    for (const s of d.sections) {
      out.push({ docId: d.id, title: d.title, section: s.section, url: d.url, text: `[${d.title} | ${s.section}]\n${s.content}` });
    }
  }
  return out;
}
