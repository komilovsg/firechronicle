"""Build the harmonized dataset and the static web data files.

  pipeline/.venv/bin/python pipeline/build.py

Reads data/raw/ (see fetch_firms.py), writes web/public/data/ per DATA_CONTRACT.md
and prints a validation report.
"""
from __future__ import annotations

import calendar
import gzip
import json
import time
from datetime import date, datetime, timezone
from pathlib import Path

import h3
import numpy as np
import polars as pl
import shapely
from shapely.geometry import mapping, shape

from core import deseasonalize_log, harmonize, month_index, month_label, pettitt, regression_metrics, shrunk_ratio

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "public" / "data"

H3_RES = 5
STATIC_RES = 8          # ~0.7 km2 cells for the persistent static-source mask
SHRINK = 30.0           # pseudo-MODIS-detections pulling sparse strata to the global ratio
N_BOOT = 200
RNG = np.random.default_rng(2026)

COUNTRIES = {"Kazakhstan": "KAZ", "Uzbekistan": "UZB", "Turkmenistan": "TKM",
             "Kyrgyzstan": "KGZ", "Tajikistan": "TJK", "Afghanistan": "AFG"}
CIDS = list(COUNTRIES.values())
VIIRS = ["snpp", "n20", "n21"]
SENSORS = ["modis"] + VIIRS

TODAY = date(2026, 11, 14)   # last day with data (API pull date)
COVER = {
    "modis": (date(2000, 11, 1), TODAY),
    "terra": (date(2000, 11, 1), TODAY),
    "aqua": (date(2002, 7, 4), TODAY),
    "snpp": (date(2012, 1, 20), date(2026, 11, 2)),
    "n20": (date(2018, 4, 1), TODAY),
    "n21": (date(2023, 3, 1), TODAY),
}
T_FIRST = int(month_index(2000, 11))
T_LAST = int(month_index(TODAY.year, TODAY.month))
FIT_LAST_T = int(month_index(2025, 12))   # calibrate on science-quality (SP) years only

COUNTRY_DIRS = {"modis": "modis", "viirs-snpp": "snpp", "viirs-jpss1": "n20"}
API_DIRS = {"MODIS_SP": ("modis", "SP"), "MODIS_NRT": ("modis", "NRT"),
            "VIIRS_SNPP_SP": ("snpp", "SP"), "VIIRS_SNPP_NRT": ("snpp", "NRT"),
            "VIIRS_NOAA20_SP": ("n20", "SP"), "VIIRS_NOAA20_NRT": ("n20", "NRT"),
            "VIIRS_NOAA21_SP": ("n21", "SP"), "VIIRS_NOAA21_NRT": ("n21", "NRT")}
KEEP = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "instrument",
        "confidence", "frp", "daynight", "type"]

SOURCES = [
    {"name": "NASA FIRMS (Fire Information for Resource Management System)", "url": "https://www.earthdata.nasa.gov/data/tools/firms"},
    {"name": "MODIS Collection 6.1 active fire / hotspot detections (MCD14ML), distributed by NASA FIRMS", "url": "https://firms.modaps.eosdis.nasa.gov/download/", "doi": "10.5067/FIRMS/MODIS/MCD14ML"},
    {"name": "VIIRS 375 m active fire, Suomi NPP (VNP14IMG v002)", "url": "https://firms.modaps.eosdis.nasa.gov/download/", "doi": "10.5067/VIIRS/VNP14IMG.002"},
    {"name": "VIIRS 375 m active fire, NOAA-20 (VJ114IMG v002)", "url": "https://firms.modaps.eosdis.nasa.gov/download/", "doi": "10.5067/VIIRS/VJ114IMG.002"},
    {"name": "VIIRS 375 m active fire, NOAA-21 (VJ214IMG v002)", "url": "https://firms.modaps.eosdis.nasa.gov/download/", "doi": "10.5067/VIIRS/VJ214IMG.002"},
    {"name": "MODIS C6/C6.1 Active Fire Product User's Guide v1.0", "url": "https://earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf"},
    {"name": "VIIRS Collection 2 375 m Active Fire Product User's Guide v1.2", "url": "https://www.earthdata.nasa.gov/s3fs-public/2025-06/VIIRS_C2_AF-375m_User_Guide_1.2.pdf"},
    {"name": "Suomi NPP observations cease on November 2, 2026 (NASA Earthdata)", "url": "https://www.earthdata.nasa.gov/data/alerts-outages/suomi-npp-data-product-delivery-cease-november-1-2026"},
    {"name": "Transition from MODIS to VIIRS (NASA Earthdata)", "url": "https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs"},
    {"name": "Natural Earth 1:50m admin-0 boundaries (public domain)", "url": "https://www.naturalearthdata.com/"},
]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- load

def read_csvs(paths, extra: dict) -> pl.DataFrame:
    frames = []
    for p in paths:
        df = pl.read_csv(p, infer_schema=False)
        if df.height == 0:
            continue
        if "type" not in df.columns:
            df = df.with_columns(pl.lit(None, pl.String).alias("type"))
        frames.append(df.select(KEEP).with_columns(**{k: pl.lit(v) for k, v in extra.items()}))
    return pl.concat(frames) if frames else pl.DataFrame()


def load() -> pl.DataFrame:
    parts = []
    for d, sensor in COUNTRY_DIRS.items():
        for name, cid in COUNTRIES.items():
            paths = sorted((RAW / "country" / d).glob(f"{d}_*_{name}.csv"))
            parts.append(read_csvs(paths, {"sensor": sensor, "processing": "SP", "country": cid}))
    log(f"country CSV rows: {sum(p.height for p in parts):,}")
    api = []
    for d, (sensor, proc) in API_DIRS.items():
        api.append(read_csvs(sorted((RAW / "api" / d).glob("*.csv")), {"sensor": sensor, "processing": proc}))
    api = pl.concat([a for a in api if a.height])
    log(f"API rows (bbox): {api.height:,}")
    api = assign_country(api)
    log(f"API rows inside the 6 countries: {api.height:,}")
    return pl.concat(parts + [api], how="vertical_relaxed")


def country_shapes():
    gj = json.loads((RAW / "ne" / "ne_50m_admin_0_countries.geojson").read_text())
    return {f["properties"]["ADM0_A3"]: shape(f["geometry"]) for f in gj["features"]
            if f["properties"]["ADM0_A3"] in CIDS}


def assign_country(df: pl.DataFrame) -> pl.DataFrame:
    x = df["longitude"].cast(pl.Float64).to_numpy()
    y = df["latitude"].cast(pl.Float64).to_numpy()
    cid = np.full(len(x), None, dtype=object)
    for c, geom in country_shapes().items():
        shapely.prepare(geom)
        cid[shapely.contains_xy(geom, x, y)] = c
    return df.with_columns(pl.Series("country", cid.tolist(), dtype=pl.String)).filter(pl.col("country").is_not_null())


# ---------------------------------------------------------------- clean

def clean(df: pl.DataFrame) -> pl.DataFrame:
    n0 = df.height
    df = df.with_columns(
        pl.col("latitude").cast(pl.Float64), pl.col("longitude").cast(pl.Float64),
        pl.col("frp").cast(pl.Float64, strict=False),
        pl.col("acq_date").str.to_date(),
        pl.col("type").cast(pl.Int8, strict=False),
    )
    is_modis = pl.col("sensor") == "modis"
    conf_ok = pl.when(is_modis).then(pl.col("confidence").cast(pl.Int32, strict=False) >= 30) \
        .otherwise(pl.col("confidence").is_in(["n", "h"]))
    df = df.filter(conf_ok)
    n_conf = df.height

    # persistent static sources (gas flares, industry): learn from SP `type`, apply to NRT rows too
    lat, lon = df["latitude"].to_numpy(), df["longitude"].to_numpy()
    df = df.with_columns(pl.Series("cell8", [h3.latlng_to_cell(a, b, STATIC_RES) for a, b in zip(lat, lon)]))
    sp = df.filter(pl.col("type").is_not_null())
    static = (sp.group_by("cell8").agg(n=pl.len(), n_static=(pl.col("type") != 0).sum())
              .filter((pl.col("n_static") >= 3) & (pl.col("n_static") / pl.col("n") >= 0.5))["cell8"])
    df = df.filter(((pl.col("type") == 0) | pl.col("type").is_null()) & ~pl.col("cell8").is_in(static.implode()))
    log(f"clean: {n0:,} -> confidence {n_conf:,} -> vegetation, no static sources {df.height:,} "
        f"(static cells: {static.len():,})")

    lat, lon = df["latitude"].to_numpy(), df["longitude"].to_numpy()
    sat = pl.col("satellite").str.to_lowercase()
    df = df.with_columns(
        pl.Series("cell", [h3.latlng_to_cell(a, b, H3_RES) for a, b in zip(lat, lon)]),
        t=((pl.col("acq_date").dt.year() - 2000) * 12 + pl.col("acq_date").dt.month() - 1).cast(pl.Int32),
        modis_sat=pl.when(is_modis & sat.str.starts_with("t")).then(pl.lit("terra"))
        .when(is_modis).then(pl.lit("aqua")).otherwise(None),
    ).drop("cell8")
    return df


# ---------------------------------------------------------------- coverage weights

def coverage_fraction(sensor: str, t: np.ndarray) -> np.ndarray:
    """Share of each month's window observed by the sensor (current month window ends TODAY)."""
    start, end = COVER[sensor]
    out = np.zeros(len(t))
    for i, tt in enumerate(t):
        y, m = 2000 + tt // 12, tt % 12 + 1
        m0 = date(y, m, 1)
        m1 = date(y, m, calendar.monthrange(y, m)[1])
        if (y, m) == (TODAY.year, TODAY.month):
            m1 = TODAY
        a, b = max(m0, start), min(m1, end)
        out[i] = max(0, (b - a).days + 1) / ((m1 - m0).days + 1)
    return out


# ---------------------------------------------------------------- harmonization

def monthly_table(df: pl.DataFrame) -> pl.DataFrame:
    cell_country = (df.group_by("cell", "country").agg(n=pl.len()).sort("n", descending=True)
                    .unique("cell", keep="first").select("cell", "country"))
    counts = df.group_by("cell", "t").agg(
        modis=(pl.col("sensor") == "modis").sum(),
        terra=(pl.col("modis_sat") == "terra").sum(),
        **{s: (pl.col("sensor") == s).sum() for s in VIIRS},
    )
    return counts.join(cell_country, on="cell").sort("cell", "t")


def strata_sums(m: pl.DataFrame, num: str, den: str, t_lo: int, t_hi: int) -> np.ndarray:
    """Sums of num/den per (country, calendar month, year) over full-coverage months in [t_lo, t_hi]."""
    sub = m.filter((pl.col("t") >= t_lo) & (pl.col("t") <= t_hi))
    g = sub.group_by("country", "t").agg(pl.col(num).sum().alias("a"), pl.col(den).sum().alias("b"))
    years = np.arange(t_lo // 12, t_hi // 12 + 1)
    arr = np.zeros((2, len(CIDS), 12, len(years)))
    for c, t, a, b in g.iter_rows():
        arr[0, CIDS.index(c), t % 12, t // 12 - years[0]] += a
        arr[1, CIDS.index(c), t % 12, t // 12 - years[0]] += b
    return arr, years


def fit_k(arr: np.ndarray, year_weights: np.ndarray | None = None):
    """Shrunk ratio per (country, calendar month). arr[0]=num, arr[1]=den per year."""
    w = np.ones(arr.shape[-1]) if year_weights is None else year_weights
    num = (arr[0] * w).sum(-1)
    den = (arr[1] * w).sum(-1)
    prior = num.sum() / den.sum()
    return shrunk_ratio(num, den, prior, SHRINK), prior


def full_months(sensor_list, t_lo, t_hi):
    """Months in [t_lo, t_hi] where every listed sensor observed the whole month."""
    ts = np.arange(t_lo, t_hi + 1)
    ok = np.ones(len(ts), bool)
    for s in sensor_list:
        ok &= coverage_fraction(s, ts) >= 0.999
    return ts[ok]


def calibrate(m: pl.DataFrame):
    """k per VIIRS sensor and Terra->Terra+Aqua factor, each as (country, moy) arrays + bootstrap draws."""
    res = {}
    for s in VIIRS:
        ts = full_months(["modis", s], T_FIRST, FIT_LAST_T)
        arr, years = strata_sums(m.filter(pl.col("t").is_in(ts.tolist())), s, "modis", int(ts[0]), int(ts[-1]))
        k, prior = fit_k(arr)
        boots = [fit_k(arr, RNG.multinomial(len(years), np.ones(len(years)) / len(years)).astype(float))[0]
                 for _ in range(N_BOOT)]
        res[s] = {"k": k, "prior": prior, "boot": np.stack(boots), "years": years, "arr": arr}
        log(f"k[{s}] global={prior:.2f} fit {month_label(int(ts[0]))}..{month_label(int(ts[-1]))} "
            f"strata range {k.min():.2f}..{k.max():.2f}")
    # Terra-only months (before Aqua): scale Terra to Terra+Aqua level, fit 2003-2011
    arr, years = strata_sums(m, "modis", "terra", int(month_index(2003, 1)), int(month_index(2011, 12)))
    f, prior = fit_k(arr)
    res["terra"] = {"k": f, "prior": prior}
    log(f"Terra->Terra+Aqua factor global={prior:.2f}")
    return res


def harmonize_rows(m: pl.DataFrame, cal: dict, k_override: dict | None = None):
    t = m["t"].to_numpy()
    ci = np.array([CIDS.index(c) for c in m["country"].to_list()])
    moy = t % 12
    ut = np.unique(t)
    frac = {s: dict(zip(ut, coverage_fraction(s, ut))) for s in ["modis", "aqua"] + VIIRS}
    on = {s: np.array([frac[s][x] for x in t]) for s in frac}

    modis = m["modis"].to_numpy().astype(float)
    terra_only = on["aqua"] == 0
    modis = np.where(terra_only, m["terra"].to_numpy() * cal["terra"]["k"][ci, moy], modis)

    ks = k_override or {s: cal[s]["k"] for s in VIIRS}
    k_rows = {s: ks[s][ci, moy] for s in VIIRS}
    viirs = {s: m[s].to_numpy() for s in VIIRS}
    harm, info = harmonize(modis, viirs, k_rows, on["modis"], {s: on[s] for s in VIIRS})
    return harm, info, modis, ci


# ---------------------------------------------------------------- validation

def loyo(m: pl.DataFrame, cal: dict, sensor: str):
    """Leave-one-year-out: predict MODIS country-month sums from one VIIRS sensor alone."""
    arr, years = cal[sensor]["arr"], cal[sensor]["years"]
    pred, act, reg_pred, reg_act = [], [], {}, {}
    for yi, y in enumerate(years):
        w = np.ones(len(years)); w[yi] = 0
        if arr[1][..., yi].sum() == 0:
            continue
        k, _ = fit_k(arr, w)
        v, mo = arr[0][..., yi], arr[1][..., yi]
        p = v / k
        sel = (v + mo) > 0
        pred += list(p[sel]); act += list(mo[sel])
        for mm in range(12):
            key = (y, mm)
            reg_pred[key] = p[:, mm].sum(); reg_act[key] = mo[:, mm].sum()
    keys = sorted(reg_act)
    return {
        "country_month": regression_metrics(pred, act),
        "region_month": regression_metrics([reg_pred[x] for x in keys], [reg_act[x] for x in keys]),
        "years": f"{int(years[0]) + 2000}-{int(years[-1]) + 2000}",
    }


def series_by(m: pl.DataFrame, values: dict, group: np.ndarray | None):
    """Dense per-month sums from T_FIRST..T_LAST for each value column; group mask optional."""
    t = m["t"].to_numpy()
    sel = np.ones(len(t), bool) if group is None else group
    n = T_LAST - T_FIRST + 1
    return {k: np.bincount(t[sel] - T_FIRST, weights=v[sel], minlength=n) for k, v in values.items()}


def naive_series(s):
    t = np.arange(T_FIRST, T_LAST + 1)
    snpp_end_t = int(month_index(COVER["snpp"][1].year, COVER["snpp"][1].month))
    return np.where(t < 144, s["modis"], np.where(t <= snpp_end_t, s["snpp"], s["n20"]))


def break_tests(region):
    t = np.arange(T_FIRST, T_LAST + 1)
    sel = (t >= month_index(2001, 1)) & (t <= FIT_LAST_T)
    out = {}
    for name in ["naive", "harm", "modis"]:
        x = region[name][sel]
        idx, p = pettitt(deseasonalize_log(x, t[sel]))
        yrs = (t[sel] // 12) + 2000
        before = x[(yrs >= 2001) & (yrs <= 2011)].sum() / 11
        after = x[(yrs >= 2012) & (yrs <= 2025)].sum() / 14
        out[name] = {"test": "Pettitt (deseasonalized log monthly, 2001-2025)", "p": float(f"{p:.3g}"),
                     "change_point": month_label(int(t[sel][idx])), "jump_ratio": round(after / before, 2)}
    return out


# ---------------------------------------------------------------- outputs

def write_outputs(df, m, harm, lo, hi, region_series, validation, cal):
    OUT.mkdir(parents=True, exist_ok=True)
    cells = sorted(m["cell"].unique().to_list())
    cidx = {c: i for i, c in enumerate(cells)}
    (OUT / "cells.json").write_text(json.dumps({"cells": cells}, separators=(",", ":")))

    keep = (m.select(pl.sum_horizontal(SENSORS + ["terra"])).to_series().to_numpy() > 0) | (harm > 0)
    mm = m.filter(pl.Series(keep))
    monthly = {"c": [cidx[c] for c in mm["cell"].to_list()], "t": mm["t"].to_list()}
    for s in SENSORS:
        monthly[s] = mm[s].to_list()
    monthly["harm"] = np.round(harm[keep], 2).tolist()
    monthly["lo"] = np.round(lo[keep], 2).tolist()
    monthly["hi"] = np.round(hi[keep], 2).tolist()
    (OUT / "monthly.json").write_text(json.dumps(monthly, separators=(",", ":")))

    tt = list(range(T_FIRST, T_LAST + 1))
    regions = []
    names = {"central-asia": "Central Asia", **{v: k for k, v in COUNTRIES.items()}}
    for rid, s in region_series.items():
        regions.append({"id": rid, "name": names[rid], "t": tt,
                        **{k: np.round(v, 2).tolist() for k, v in s.items()}})
    (OUT / "regions.json").write_text(json.dumps({"regions": regions}, separators=(",", ":")))

    feats = []
    for cid, geom in country_shapes().items():
        g = shapely.set_precision(geom.simplify(0.02, preserve_topology=True), 0.001)
        feats.append({"type": "Feature", "properties": {"id": cid, "name": names[cid]}, "geometry": mapping(g)})
    (OUT / "countries.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

    pts = OUT / "points"
    pts.mkdir(exist_ok=True)
    for old in pts.glob("*.csv.gz"):
        old.unlink()
    out = df.select(
        pl.col("acq_date").dt.strftime("%Y-%m-%d").alias("date"), pl.col("acq_time").alias("time"),
        pl.col("latitude").round(4).alias("lat"), pl.col("longitude").round(4).alias("lon"),
        "satellite", "instrument", "confidence", "frp", "daynight", "type", "processing",
        pl.col("acq_date").dt.year().alias("year"),
    ).sort("date", "time")
    for (year,), part in out.partition_by("year", as_dict=True).items():
        with gzip.open(pts / f"{year}.csv.gz", "wb", compresslevel=9) as f:
            part.drop("year").write_csv(f)

    nrt_t = df.filter(pl.col("processing") == "NRT")["t"]
    meta = {
        "version": 1, "sample": False,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_through": TODAY.isoformat(),
        "region": {"name": "Central Asia", "bbox": [46, 35, 88, 56],
                   "countries": [{"id": v, "name": k} for k, v in COUNTRIES.items()]},
        "h3_res": H3_RES, "t_first": T_FIRST, "t_last": T_LAST,
        "t_nrt_from": int(nrt_t.min()) if nrt_t.len() else T_LAST + 1,
        "current_month_partial_days": TODAY.day,
        "units": "MODIS-equivalent active fire detections",
        "sensors": {
            "modis": {"label": "MODIS (Terra+Aqua)", "start": "2000-11-01", "end": TODAY.isoformat()},
            "snpp": {"label": "VIIRS S-NPP", "start": "2012-01-20", "end": "2026-11-02"},
            "n20": {"label": "VIIRS NOAA-20", "start": "2018-04-01", "end": TODAY.isoformat()},
            "n21": {"label": "VIIRS NOAA-21", "start": "2023-03-01", "end": TODAY.isoformat()},
        },
        "calibration": {s: {"global_ratio": round(float(cal[s]["prior"]), 3),
                            "fit_years": f"{int(cal[s]['years'][0]) + 2000}-{int(cal[s]['years'][-1]) + 2000}"} for s in VIIRS}
        | {"terra_to_terra_aqua": round(float(cal["terra"]["prior"]), 3)},
        "sources": SOURCES,
        "validation": validation,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    return len(cells), int(keep.sum())


def main():
    df = clean(load())
    log("sensor x processing: " + ", ".join(f"{r[0]}/{r[1]}={r[2]:,}" for r in
        df.group_by("sensor", "processing").len().sort("sensor", "processing").iter_rows()))
    m = monthly_table(df)
    log(f"cell-months: {m.height:,}, cells: {m['cell'].n_unique():,}")
    cal = calibrate(m)
    harm, info, modis_adj, ci = harmonize_rows(m, cal)

    # uncertainty: bootstrap over calibration years + Poisson counting noise
    t = m["t"].to_numpy()
    groups = {"central-asia": None, **{c: ci == i for i, c in enumerate(CIDS)}}
    n_t = T_LAST - T_FIRST + 1
    boot_cells = np.zeros((N_BOOT, m.height), dtype=np.float32)
    boot_reg = {g: np.zeros((N_BOOT, n_t)) for g in groups}
    for b in range(N_BOOT):
        hb, _, _, _ = harmonize_rows(m, cal, {s: cal[s]["boot"][b] for s in VIIRS})
        boot_cells[b] = hb
        for g, sel in groups.items():
            sel = np.ones(len(t), bool) if sel is None else sel
            boot_reg[g][b] = np.bincount(t[sel] - T_FIRST, weights=hb[sel], minlength=n_t)
    var_cell = boot_cells.var(0) + np.divide(harm, info, out=np.zeros_like(harm), where=info > 0)
    sd = np.sqrt(var_cell)
    lo, hi = np.clip(harm - 1.645 * sd, 0, None), harm + 1.645 * sd

    vals = {"modis": modis_adj, "snpp": m["snpp"].to_numpy().astype(float),
            "n20": m["n20"].to_numpy().astype(float), "n21": m["n21"].to_numpy().astype(float), "harm": harm}
    pois = np.divide(harm, info, out=np.zeros_like(harm), where=info > 0)
    region_series = {}
    for g, sel in groups.items():
        s = series_by(m, vals | {"pois": pois}, sel)
        sd_r = np.sqrt(boot_reg[g].var(0) + s.pop("pois"))
        s["lo"] = np.clip(s["harm"] - 1.645 * sd_r, 0, None)
        s["hi"] = s["harm"] + 1.645 * sd_r
        s["naive"] = naive_series(s)
        region_series[g] = s

    ca = region_series["central-asia"]
    breaks = break_tests(ca)
    cv = {s: loyo(m, cal, s) for s in VIIRS}
    k_chain = cal["snpp"]["prior"] * (m.filter((pl.col("t") >= month_index(2018, 4)) & (pl.col("t") <= FIT_LAST_T))["n20"].sum()
                                      / m.filter((pl.col("t") >= month_index(2018, 4)) & (pl.col("t") <= FIT_LAST_T))["snpp"].sum())
    kaz = region_series["KAZ"]["harm"]
    junes = {2000 + (T_FIRST + i) // 12: v for i, v in enumerate(kaz) if (T_FIRST + i) % 12 == 5}
    rank_2023 = sorted(junes, key=junes.get, reverse=True).index(2023) + 1
    top_ca = np.argsort(ca["harm"][:-1])[::-1][:5]
    validation = {
        "naive_break_2012": breaks["naive"],
        "harmonized_break_2012": breaks["harm"],
        "modis_only_reference": breaks["modis"],
        "cv": cv,
        "chain_check_noaa20": {"direct": round(float(cal["n20"]["prior"]), 3), "via_snpp": round(float(k_chain), 3)},
        "known_event": {"name": "Abai region steppe fire, Kazakhstan, June 2023",
                        "rank_of_june_2023_among_junes": rank_2023, "of": len(junes)},
        "top_months_central_asia": [month_label(T_FIRST + int(i)) for i in top_ca],
        "notes": [
            "Calibration on standard-processing (SP) years only; NRT months are provisional.",
            "Uncertainty band: bootstrap over calibration years plus Poisson counting noise, approximate 90%.",
            "Hotspot counts are not burned area and not fire size.",
        ],
    }
    n_cells, n_rows = write_outputs(df, m, harm, lo, hi, region_series, validation, cal)
    log(f"wrote {OUT}: cells={n_cells:,} monthly rows={n_rows:,}")
    print(json.dumps(validation, indent=1))


if __name__ == "__main__":
    main()
