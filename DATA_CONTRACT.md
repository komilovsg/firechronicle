# Data contract: pipeline → web

The pipeline (`pipeline/`) writes static files to `web/public/data/`. The web app reads only these files. There is no server and no API key in the browser.

All times are UTC. Months are indexed `t = (year - 2000) * 12 + (month - 1)`, so `t = 0` is 2000-01.

## `meta.json`
```json
{
  "version": 1,
  "generated_at": "2026-11-15T03:00:00Z",
  "region": {"name": "Central Asia", "bbox": [46, 35, 88, 56]},
  "h3_res": 5,
  "t_first": 10,            // 2000-11
  "t_last": 322,            // 2026-11 (current month, partial)
  "t_nrt_from": 320,        // months >= this contain provisional NRT data
  "current_month_partial_days": 14,
  "units": "MODIS-equivalent active fire detections",
  "sensors": {
    "modis": {"label": "MODIS (Terra+Aqua)", "start": "2000-11-01", "end": "2026-11-14"},
    "snpp":  {"label": "VIIRS S-NPP",  "start": "2012-01-20", "end": "2026-11-02"},
    "n20":   {"label": "VIIRS NOAA-20", "start": "2018-04-01", "end": "2026-11-14"},
    "n21":   {"label": "VIIRS NOAA-21", "start": "2023-03-01", "end": "2026-11-14"}
  },
  "sources": [{"name": "...", "url": "https://...", "doi": "10.5067/..."}],
  "data_through": "2026-11-14",
  "calibration": {"snpp": {"global_ratio": 3.45, "fit_years": "2012-2025"}, "n20": {...}, "n21": {...}, "terra_to_terra_aqua": 2.06},
  "validation": {
    "naive_break_2012":      {"test": "Pettitt (...)", "p": 1.7e-12, "change_point": "2012-03", "jump_ratio": 1.6},
    "harmonized_break_2012": {"test": "Pettitt (...)", "p": 2.9e-10, "change_point": "2011-01", "jump_ratio": 0.46},
    "modis_only_reference":  {"test": "Pettitt (...)", "p": 2.0e-10, "change_point": "2011-01", "jump_ratio": 0.46},
    "cv": {
      "snpp": {"country_month": {"bias_pct": -0.13, "mae": 47.9, "r2": 0.985, "n": 995},
               "region_month":  {"bias_pct": -0.13, "mae": 238.6, "r2": 0.978, "n": 168}, "years": "2012-2025"},
      "n20":  {...same shape...},
      "n21":  {...same shape...}
    },
    "chain_check_noaa20": {"direct": 3.507, "via_snpp": 3.406},
    "known_event": {"name": "...", "rank_of_june_2023_among_junes": 17, "of": 26},
    "top_months_central_asia": ["2002-09", "..."],
    "notes": ["..."]
  }
}
```
`jump_ratio` = mean annual total 2012–2025 / mean annual total 2001–2011 for the whole region.
How to read it: naive 1.6 means "stitching says +60 % after 2012". The MODIS-only reference and the harmonized series both say 0.46, i.e. −54 %. **The naive record reverses the sign of the trend.** The harmonized break is real (it sits at 2011-01, exactly where MODIS alone puts it, not at the 2012 sensor switch). It is a real decline, not a sensor artefact.
`cv.<sensor>`: leave-one-year-out test. Monthly MODIS totals are predicted from that VIIRS sensor alone, on years left out of calibration.

## `cells.json`
H3 resolution 5 cells that have at least one detection, from any sensor and any time.
```json
{"cells": ["8521...ffff", "..."]}
```
A cell's position in this array is its `cellIdx`.

## `monthly.json`
Sparse, columnar. One row per (cell, month) where any value is > 0. All arrays have the same length.
```json
{
  "c":     [cellIdx...],
  "t":     [monthIdx...],
  "modis": [raw MODIS detections, Terra+Aqua, cleaned],
  "snpp":  [raw VIIRS S-NPP detections, cleaned],
  "n20":   [raw VIIRS NOAA-20 detections, cleaned],
  "n21":   [raw VIIRS NOAA-21 detections, cleaned],
  "harm":  [harmonized value, MODIS-eq, float, 2 decimals],
  "lo":    [harmonized 5th percentile],
  "hi":    [harmonized 95th percentile]
}
```
Cleaning applied to all raw counts: `type == 0`; MODIS `confidence >= 30`; VIIRS `confidence in {n, h}`; persistent static sources removed.

**Aggregation over an area (AOI):** sum the rows of every cell whose centroid is inside the AOI polygon. For `lo` and `hi`, summing is an approximation; label it "approx. 90% band".

**Naive splice** (for the before/after view): for month `t`, use `modis` if t < 144 (before 2012-01), otherwise `snpp`, or `n20` after S-NPP ended (t > 322). This is the "what you get if you just stitch sensors" series.

## `regions.json`
Pre-aggregated series for the whole region and for each country. The web uses it for the before/after proof chart and as the default view.
```json
{
  "regions": [
    {"id": "central-asia", "name": "Central Asia", "t": [...], "modis": [...], "snpp": [...], "n20": [...], "n21": [...], "harm": [...], "lo": [...], "hi": [...], "naive": [...]}
  ]
}
```
Region ids: `central-asia`, `KAZ`, `UZB`, `TKM`, `KGZ`, `TJK`, `AFG`.

## `countries.geojson`
Simplified boundaries of the 6 countries as a FeatureCollection. Properties: `{"id": "TJK", "name": "Tajikistan"}`.

## `points/{year}.csv.gz`
Raw cleaned detections for one year, all sensors, gzip-compressed CSV, loaded only when the user exports. Header:
```
date,time,lat,lon,satellite,instrument,confidence,frp,daynight,type,processing
```
`processing` is `SP` (standard, science quality) or `NRT` (provisional). The browser decompresses with the native `DecompressionStream('gzip')`.
