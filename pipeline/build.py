"""Build the harmonized dataset and the static web data files.

  pipeline/.venv/bin/python pipeline/build.py            # full rebuild from data/raw (country CSVs + API)
  pipeline/.venv/bin/python pipeline/build.py --points   # daily update: cleaned history in web/public/data/points
                                                         # + data/raw/recent (fetch_firms.py recent)

Writes web/public/data/ per DATA_CONTRACT.md and prints a validation report.
"""
from __future__ import annotations

import calendar
import gzip
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
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
STATIC_CELLS = Path(__file__).resolve().parent / "static_cells.json"

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
STARTS = {"modis": date(2000, 11, 1), "terra": date(2000, 11, 1), "aqua": date(2002, 7, 4),
          "snpp": date(2012, 1, 20), "n20": date(2018, 4, 1), "n21": date(2023, 3, 1)}
AV_SOURCES = {"modis": ("MODIS_SP", "MODIS_NRT"), "snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
              "n20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"), "n21": ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT")}
AUTO_UPDATE_UNTIL = "2027-05-15"   # daily refresh job stops after this date (keep in sync with data.yml)
T_FIRST = int(month_index(2000, 11))
FIT_LAST_T = int(month_index(2025, 12))   # calibrate on science-quality (SP) years only

# set in main() from the data / FIRMS availability
TODAY: date = date(2000, 1, 1)
T_LAST = 0
COVER: dict = {}

COUNTRY_DIRS = {"modis": "modis", "viirs-snpp": "snpp", "viirs-jpss1": "n20"}
API_DIRS = {"MODIS_SP": ("modis", "SP"), "MODIS_NRT": ("modis", "NRT"),
            "VIIRS_SNPP_SP": ("snpp", "SP"), "VIIRS_SNPP_NRT": ("snpp", "NRT"),
            "VIIRS_NOAA20_SP": ("n20", "SP"), "VIIRS_NOAA20_NRT": ("n20", "NRT"),
            "VIIRS_NOAA21_SP": ("n21", "SP"), "VIIRS_NOAA21_NRT": ("n21", "NRT")}
SAT_SENSOR = {"terra": "modis", "aqua": "modis", "t": "modis", "a": "modis",
              "n": "snpp", "n20": "n20", "n21": "n21"}
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


def read_api_dir(base: Path) -> pl.DataFrame:
    parts = [read_csvs(sorted((base / d).glob("*.csv")), {"sensor": s, "processing": p})
             for d, (s, p) in API_DIRS.items()]
    parts = [p for p in parts if p.height]
    return assign_country(pl.concat(parts)) if parts else pl.DataFrame()


def load_raw() -> tuple[pl.DataFrame, dict]:
    parts = []
    for d, sensor in COUNTRY_DIRS.items():
        for name, cid in COUNTRIES.items():
            paths = sorted((RAW / "country" / d).glob(f"{d}_*_{name}.csv"))
            parts.append(read_csvs(paths, {"sensor": sensor, "processing": "SP", "country": cid}))
    log(f"country CSV rows: {sum(p.height for p in parts):,}")
    api = read_api_dir(RAW / "api")
    log(f"API rows inside the 6 countries: {api.height:,}")
    return pl.concat(parts + [api], how="vertical_relaxed"), {}


def load_points() -> tuple[pl.DataFrame, dict]:
    """Cleaned history from the published points files + freshly fetched recent window."""
    window = date.fromisoformat((RAW / "recent" / "WINDOW").read_text().strip())
    hist = pl.concat([pl.read_csv(p, infer_schema=False) for p in sorted((OUT / "points").glob("*.csv.gz"))])
    hist = hist.rename({"date": "acq_date", "time": "acq_time", "lat": "latitude", "lon": "longitude"})
    hist = hist.filter(pl.col("acq_date") < window.isoformat()).with_columns(
        sensor=pl.col("satellite").str.to_lowercase().replace_strict(SAT_SENSOR, default=None))
    hist = assign_country(hist.select(KEEP + ["sensor", "processing"]))
    recent = read_api_dir(RAW / "recent")
    log(f"history rows before {window}: {hist.height:,}; recent rows: {recent.height:,}")
    prev = json.loads((OUT / "meta.json").read_text()) if (OUT / "meta.json").exists() else {}
    return pl.concat([hist, recent], how="vertical_relaxed"), prev.get("cleaning", {})


def country_shapes():
    ne = RAW / "ne" / "ne_50m_admin_0_countries.geojson"
    if ne.exists():
        gj = json.loads(ne.read_text())
        return {f["properties"]["ADM0_A3"]: shape(f["geometry"]) for f in gj["features"]
                if f["properties"]["ADM0_A3"] in CIDS}
    gj = json.loads((OUT / "countries.geojson").read_text())   # simplified copy shipped with the site
    return {f["properties"]["id"]: shape(f["geometry"]) for f in gj["features"]}


def assign_country(df: pl.DataFrame) -> pl.DataFrame:
    x = df["longitude"].cast(pl.Float64).to_numpy()
    y = df["latitude"].cast(pl.Float64).to_numpy()
    cid = np.full(len(x), None, dtype=object)
    for c, geom in country_shapes().items():
        shapely.prepare(geom)
        cid[shapely.contains_xy(geom, x, y)] = c
    return df.with_columns(pl.Series("country", cid.tolist(), dtype=pl.String)).filter(pl.col("country").is_not_null())


# ---------------------------------------------------------------- clean

def clean(df: pl.DataFrame) -> tuple[pl.DataFrame, dict]:
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

    # persistent static sources (gas flares, industry): learned from SP `type` on a full rebuild,
    # stored in static_cells.json, applied to every row (NRT rows have no `type`)
    lat, lon = df["latitude"].to_numpy(), df["longitude"].to_numpy()
    df = df.with_columns(pl.Series("cell8", [h3.latlng_to_cell(a, b, STATIC_RES) for a, b in zip(lat, lon)]))
    sp = df.filter(pl.col("type").is_not_null())
    if (sp["type"] != 0).sum() > 0:
        static = (sp.group_by("cell8").agg(n=pl.len(), n_static=(pl.col("type") != 0).sum())
                  .filter((pl.col("n_static") >= 3) & (pl.col("n_static") / pl.col("n") >= 0.5))["cell8"])
        STATIC_CELLS.write_text(json.dumps(sorted(static.to_list())))
    else:
        static = pl.Series(json.loads(STATIC_CELLS.read_text()))
    in_static = pl.col("cell8").is_in(static.implode())
    stats = {}
    t0 = df.filter(pl.col("type") == 0)
    if t0.height:
        stats["type0_removed_pct"] = round(100 * t0.filter(in_static).height / t0.height, 1)
    nrt = df.filter(pl.col("processing") == "NRT")
    if nrt.height:
        stats["nrt_removed_pct"] = round(100 * nrt.filter(in_static).height / nrt.height, 1)
    df = df.filter(((pl.col("type") == 0) | pl.col("type").is_null()) & ~in_static)
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
    return df, stats


# ---------------------------------------------------------------- coverage

def set_coverage(df: pl.DataFrame):
    """Sensor end dates from official FIRMS availability (fallback: last detection), window end = TODAY."""
    global TODAY, T_LAST, COVER
    av = {}
    f = RAW / "availability.csv"
    if f.exists():
        for line in f.read_text().strip().splitlines()[1:]:
            sid, a, b = line.split(",")[:3]
            av[sid] = date.fromisoformat(b)
    last = {r[0]: r[1] for r in df.group_by("sensor").agg(pl.col("acq_date").max()).iter_rows()}
    last_sat = {r[0]: r[1] for r in df.filter(pl.col("modis_sat").is_not_null())
                .group_by("modis_sat").agg(pl.col("acq_date").max()).iter_rows()}
    TODAY = df["acq_date"].max()
    ends = {}
    for s, (sp, nrt) in AV_SOURCES.items():
        cand = [av[x] for x in (sp, nrt) if x in av]
        ends[s] = min(max(cand), TODAY) if cand else last.get(s, TODAY)
    # a MODIS platform that stopped reporting for > 7 days is treated as off from its last detection
    for p in ("terra", "aqua"):
        lp = last_sat.get(p, TODAY)
        ends[p] = lp if (ends["modis"] - lp).days > 7 else ends["modis"]
    COVER = {s: (STARTS[s], ends[s]) for s in STARTS}
    T_LAST = int(month_index(TODAY.year, TODAY.month))
    log("coverage: " + ", ".join(f"{s} {a}..{b}" for s, (a, b) in COVER.items()) + f"; data through {TODAY}")


def coverage_fraction(sensor: str, t: np.ndarray, window_days: int | None = None) -> np.ndarray:
    """Share of each month's window observed by the sensor.

    The window is the whole month, except the current month (ends TODAY) or, when window_days is
    given, days 1..window_days of every month (used for "same days of past years").
    """
    start, end = COVER[sensor]
    out = np.zeros(len(t))
    for i, tt in enumerate(t):
        y, m = 2000 + int(tt) // 12, int(tt) % 12 + 1
        m0 = date(y, m, 1)
        m1 = date(y, m, calendar.monthrange(y, m)[1])
        if window_days:
            m1 = date(y, m, min(window_days, m1.day))
        if (y, m) == (TODAY.year, TODAY.month):
            m1 = min(m1, TODAY)
        a, b = max(m0, start), min(m1, end)
        out[i] = max(0, (b - a).days + 1) / ((m1 - m0).days + 1)
    return out


# ---------------------------------------------------------------- harmonization

def monthly_table(df: pl.DataFrame, cell_country: pl.DataFrame | None = None) -> pl.DataFrame:
    if cell_country is None:
        cell_country = (df.group_by("cell", "country").agg(n=pl.len()).sort("n", descending=True)
                        .unique("cell", keep="first").select("cell", "country"))
    counts = df.group_by("cell", "t").agg(
        modis=(pl.col("sensor") == "modis").sum(),
        terra=(pl.col("modis_sat") == "terra").sum(),
        **{s: (pl.col("sensor") == s).sum() for s in VIIRS},
    )
    return counts.join(cell_country, on="cell").sort("cell", "t")


def strata_sums(m: pl.DataFrame, num: str, den: str, ts: np.ndarray):
    """Sums of num/den per (country, calendar month, year) over the months ts."""
    sub = m.filter(pl.col("t").is_in(ts.tolist()))
    g = sub.group_by("country", "t").agg(pl.col(num).sum().alias("a"), pl.col(den).sum().alias("b"))
    years = np.arange(int(ts.min()) // 12, int(ts.max()) // 12 + 1)
    arr = np.zeros((2, len(CIDS), 12, len(years)))
    for c, t, a, b in g.iter_rows():
        arr[0, CIDS.index(c), t % 12, t // 12 - years[0]] += a
        arr[1, CIDS.index(c), t % 12, t // 12 - years[0]] += b
    return arr, years


def fit_trend(arr: np.ndarray, w: np.ndarray) -> float:
    """Slope b of log(VIIRS/MODIS) per year (weighted by MODIS counts). Captures Terra/Aqua orbit drift."""
    v, m = arr[0].sum((0, 1)), arr[1].sum((0, 1))
    ok = (v > 0) & (m > 0) & (w > 0)
    if ok.sum() < 3:
        return 0.0
    x = np.arange(len(v))[ok]
    y = np.log(v[ok] / m[ok])
    ww = (m[ok] * w[ok])
    xm = (ww * x).sum() / ww.sum()
    return float((ww * (x - xm) * (y - (ww * y).sum() / ww.sum())).sum() / (ww * (x - xm) ** 2).sum())


def fit_k(arr: np.ndarray, w: np.ndarray | None = None, trend: bool = True):
    """Shrunk ratio per (country, calendar month) at the level of the LAST fit year, plus trend slope.

    k(stratum, year) = k(stratum) * exp(b * (min(year, last) - last)); no extrapolation past the fit.
    """
    w = np.ones(arr.shape[-1]) if w is None else w
    b = fit_trend(arr, w) if trend else 0.0
    last = arr.shape[-1] - 1
    g = np.exp(b * (np.arange(arr.shape[-1]) - last))
    num = (arr[0] / g * w).sum(-1)
    den = (arr[1] * w).sum(-1)
    prior = num.sum() / den.sum()
    return shrunk_ratio(num, den, prior, SHRINK), prior, b


def full_months(sensor_list, t_lo, t_hi):
    ts = np.arange(t_lo, t_hi + 1)
    ok = np.ones(len(ts), bool)
    for s in sensor_list:
        ok &= coverage_fraction(s, ts) >= 0.999
    return ts[ok]


def calibrate(m: pl.DataFrame):
    res = {}
    for s in VIIRS:
        ts = full_months(["modis", "terra", "aqua", s], T_FIRST, FIT_LAST_T)
        arr, years = strata_sums(m, s, "modis", ts)
        k, prior, b = fit_k(arr)
        boots = []
        for _ in range(N_BOOT):
            w = RNG.multinomial(len(years), np.ones(len(years)) / len(years)).astype(float)
            boots.append(fit_k(arr, w))
        res[s] = {"k": k, "prior": prior, "b": b, "years": years, "arr": arr,
                  "boot_k": np.stack([x[0] for x in boots]), "boot_b": np.array([x[2] for x in boots])}
        log(f"k[{s}] at {2000 + years[-1]} level={prior:.2f}, drift {100 * (np.exp(b) - 1):+.1f}%/yr, "
            f"fit {month_label(int(ts[0]))}..{month_label(int(ts[-1]))}, strata {k.min():.2f}..{k.max():.2f}")
    # Terra share of Terra+Aqua per stratum (2003-2011): weight of a Terra-only month
    ts = np.arange(int(month_index(2003, 1)), int(month_index(2011, 12)) + 1)
    arr, _ = strata_sums(m, "terra", "modis", ts)
    share, prior, _ = fit_k(arr, trend=False)
    res["terra_share"] = {"k": np.clip(share, 0.2, 0.8), "prior": prior}
    log(f"Terra share of MODIS detections={prior:.3f} (Terra->Terra+Aqua factor {1 / prior:.2f})")
    return res


def k_rows(cal, s, ci, moy, year_idx, k=None, b=None):
    """Per-row k for sensor s, applying the drift for the row's year (held flat after the fit)."""
    k = cal[s]["k"] if k is None else k
    b = cal[s]["b"] if b is None else b
    last = cal[s]["years"][-1]
    g = np.exp(b * (np.minimum(year_idx, last) - last))
    return k[ci, moy] * g


def harmonize_rows(m: pl.DataFrame, cal: dict, boot: int | None = None, window_days: int | None = None):
    t = m["t"].to_numpy()
    ci = np.array([CIDS.index(c) for c in m["country"].to_list()])
    moy, yi = t % 12, t // 12
    ut = np.unique(t)
    on = {}
    for s in ["terra", "aqua"] + VIIRS:
        f = dict(zip(ut, coverage_fraction(s, ut, window_days)))
        on[s] = np.array([f[x] for x in t])
    ws = cal["terra_share"]["k"][ci, moy]
    modis_w = ws * on["terra"] + (1 - ws) * on["aqua"]   # expected share of the Terra+Aqua total observed
    kr = {}
    for s in VIIRS:
        if boot is None:
            kr[s] = k_rows(cal, s, ci, moy, yi)
        else:
            kr[s] = k_rows(cal, s, ci, moy, yi, cal[s]["boot_k"][boot], cal[s]["boot_b"][boot])
    viirs = {s: m[s].to_numpy() for s in VIIRS}
    harm, info = harmonize(m["modis"].to_numpy(), viirs, kr, modis_w, {s: on[s] for s in VIIRS})
    viirs_share = np.divide(sum(kr[s] * on[s] for s in VIIRS), info, out=np.zeros_like(harm), where=info > 0)
    return harm, info, ci, viirs_share


# ---------------------------------------------------------------- validation

def loyo(cal: dict, sensor: str):
    """Leave-one-year-out: predict MODIS country-month sums from one VIIRS sensor alone (k and drift refit)."""
    arr, years = cal[sensor]["arr"], cal[sensor]["years"]
    pred, act, clim = [], [], []
    per_year = {}
    for yi, y in enumerate(years):
        if arr[1][..., yi].sum() == 0:
            continue
        w = np.ones(len(years)); w[yi] = 0
        k, _, b = fit_k(arr, w)
        g = np.exp(b * (yi - (len(years) - 1)))
        v, mo = arr[0][..., yi], arr[1][..., yi]
        p = v / (k * g)
        others = (arr[1] * w).sum(-1) / max(w[arr[1].sum((0, 1)) > 0].sum(), 1)  # mean of other years
        sel = (v + mo) > 0
        pred += list(p[sel]); act += list(mo[sel]); clim += list(others[sel])
        per_year[str(2000 + int(y))] = round(100 * (p[sel].sum() - mo[sel].sum()) / mo[sel].sum(), 1)
    cm = regression_metrics(pred, act)
    return {
        "country_month": cm,
        "climatology_r2": regression_metrics(clim, act)["r2"],
        "per_year_bias_pct": per_year,
        "drift_pct_per_year": round(100 * (np.exp(cal[sensor]["b"]) - 1), 2),
        "years": f"{int(years[0]) + 2000}-{int(years[-1]) + 2000}",
    }


def series_by(m: pl.DataFrame, values: dict, group: np.ndarray | None):
    t = m["t"].to_numpy()
    sel = np.ones(len(t), bool) if group is None else group
    n = T_LAST - T_FIRST + 1
    return {k: np.bincount(t[sel] - T_FIRST, weights=v[sel], minlength=n) for k, v in values.items()}


def naive_series(s):
    t = np.arange(T_FIRST, T_LAST + 1)
    snpp_end_t = int(month_index(COVER["snpp"][1].year, COVER["snpp"][1].month))
    # S-NPP's last month is partial (2 days in Nov 2026), so NOAA-20 takes over from that month
    return np.where(t < 144, s["modis"], np.where(t < snpp_end_t, s["snpp"], s["n20"]))


def break_tests(region):
    t = np.arange(T_FIRST, T_LAST + 1)
    sel = (t >= month_index(2001, 1)) & (t <= FIT_LAST_T)
    out = {}
    for name in ["naive", "harm", "modis"]:
        x = region[name][sel]
        y = deseasonalize_log(x, t[sel])
        idx, p = pettitt(y)
        r1 = np.corrcoef(y[:-1], y[1:])[0, 1]
        n_eff = len(y) * (1 - r1) / (1 + r1)
        # effective-sample-size correction for lag-1 autocorrelation: p ~ 2 exp(-6K^2/(n^3+n^2)) with n_eff
        k_stat = np.sqrt(-np.log(max(p, 1e-300) / 2) * (len(y) ** 3 + len(y) ** 2) / 6)
        k_eff = k_stat * (n_eff / len(y)) ** 1.5
        p_adj = min(1.0, 2 * np.exp(-6 * k_eff ** 2 / (n_eff ** 3 + n_eff ** 2)))
        yrs = (t[sel] // 12) + 2000
        before = x[(yrs >= 2001) & (yrs <= 2011)].sum() / 11
        after = x[(yrs >= 2012) & (yrs <= 2025)].sum() / 14
        out[name] = {"test": "Pettitt (deseasonalized log monthly, 2001-2025), p approx., autocorrelation-adjusted",
                     "p": float(f"{p_adj:.2g}"), "change_point": month_label(int(t[sel][idx])),
                     "jump_ratio": round(after / before, 2)}
    return out


def theil_sen(x):
    yrs = np.arange(len(x))
    sl = [(x[j] - x[i]) / (j - i) for i in range(len(x)) for j in range(i + 1, len(x))]
    return float(np.median(sl))


# ---------------------------------------------------------------- outputs

def write_json(name, obj, indent=None):
    (OUT / name).write_text(json.dumps(obj, indent=indent, separators=None if indent else (",", ":")))


def partial_month(df, cell_country, cal):
    """Days 1..D of the current calendar month in every year, for a fair "this month so far" comparison."""
    last_day = calendar.monthrange(TODAY.year, TODAY.month)[1]
    if TODAY.day >= last_day:
        return None
    sub = df.filter((pl.col("acq_date").dt.month() == TODAY.month) & (pl.col("acq_date").dt.day() <= TODAY.day))
    mp = monthly_table(sub, cell_country)
    harm, _, ci, _ = harmonize_rows(mp, cal, window_days=TODAY.day)
    cidx = {c: i for i, c in enumerate(sorted(df["cell"].unique().to_list()))}
    t = mp["t"].to_numpy()
    regions = {}
    for rid, sel in {"central-asia": np.ones(len(t), bool), **{c: ci == i for i, c in enumerate(CIDS)}}.items():
        ts = sorted(set(t.tolist()))
        regions[rid] = {"t": ts, "harm": [round(float(harm[sel & (t == x)].sum()), 2) for x in ts]}
    keep = harm > 0
    return {"t_month": T_LAST, "days": TODAY.day,
            "c": [cidx[c] for c in mp.filter(pl.Series(keep))["cell"].to_list()],
            "t": t[keep].tolist(), "harm": np.round(harm[keep], 2).tolist(), "regions": regions}


def write_outputs(df, m, harm, sdc, pv, region_series, validation, cal, cleaning, partial):
    OUT.mkdir(parents=True, exist_ok=True)
    cells = sorted(m["cell"].unique().to_list())
    cidx = {c: i for i, c in enumerate(cells)}
    write_json("cells.json", {"cells": cells})

    keep = (m.select(pl.sum_horizontal(SENSORS)).to_series().to_numpy() > 0) | (harm > 0)
    mm = m.filter(pl.Series(keep))
    monthly = {"c": [cidx[c] for c in mm["cell"].to_list()], "t": mm["t"].to_list()}
    for s in SENSORS:
        monthly[s] = mm[s].to_list()
    monthly["harm"] = np.round(harm[keep], 2).tolist()
    monthly["sdc"] = np.round(sdc[keep], 2).tolist()
    monthly["pv"] = np.round(pv[keep], 2).tolist()
    write_json("monthly.json", monthly)

    tt = list(range(T_FIRST, T_LAST + 1))
    names = {"central-asia": "Central Asia", **{v: k for k, v in COUNTRIES.items()}}
    write_json("regions.json", {"regions": [{"id": rid, "name": names[rid], "t": tt,
                                             **{k: np.round(v, 2).tolist() for k, v in s.items()}}
                                            for rid, s in region_series.items()]})
    if partial:
        write_json("partial.json", partial)
    elif (OUT / "partial.json").exists():
        (OUT / "partial.json").unlink()

    if (RAW / "ne").exists():
        feats = []
        for cid, geom in country_shapes().items():
            g = shapely.set_precision(geom.simplify(0.02, preserve_topology=True), 0.001)
            feats.append({"type": "Feature", "properties": {"id": cid, "name": names[cid]}, "geometry": mapping(g)})
        write_json("countries.geojson", {"type": "FeatureCollection", "features": feats})

    pts = OUT / "points"
    pts.mkdir(exist_ok=True)
    out = df.select(
        pl.col("acq_date").dt.strftime("%Y-%m-%d").alias("date"), pl.col("acq_time").alias("time"),
        pl.col("latitude").round(4).alias("lat"), pl.col("longitude").round(4).alias("lon"),
        "satellite", "instrument", "confidence", "frp", "daynight", "type", "processing",
        pl.col("acq_date").dt.year().alias("year"),
    ).sort("date", "time")
    years_written = set()
    for (year,), part in out.partition_by("year", as_dict=True).items():
        years_written.add(year)
        # mtime=0 and no embedded file name: identical data -> identical bytes
        with open(pts / f"{year}.csv.gz", "wb") as raw, \
                gzip.GzipFile(filename="", mode="wb", compresslevel=9, fileobj=raw, mtime=0) as f:
            part.drop("year").write_csv(f)
    for old in pts.glob("*.csv.gz"):
        if int(old.name[:4]) not in years_written:
            old.unlink()

    nrt_t = df.filter(pl.col("processing") == "NRT")["t"]
    meta = {
        "version": 2, "sample": False,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_through": TODAY.isoformat(),
        "region": {"name": "Central Asia", "bbox": [46, 29, 88, 56],
                   "countries": [{"id": v, "name": k} for k, v in COUNTRIES.items()]},
        "h3_res": H3_RES, "t_first": T_FIRST, "t_last": T_LAST,
        "t_nrt_from": int(nrt_t.min()) if nrt_t.len() else T_LAST + 1,
        "current_month_partial_days": TODAY.day if partial else None,
        "refresh": {"schedule_utc": "03:00", "cadence": "daily", "auto_update_until": AUTO_UPDATE_UNTIL,
                    "issues_url": "https://github.com/komilovsg/firechronicle/issues"},
        "units": "MODIS-equivalent active fire detections",
        "sensors": {
            "modis": {"label": "MODIS (Terra+Aqua)", "start": "2000-11-01", "end": COVER["modis"][1].isoformat()},
            "snpp": {"label": "VIIRS S-NPP", "start": "2012-01-20", "end": COVER["snpp"][1].isoformat()},
            "n20": {"label": "VIIRS NOAA-20", "start": "2018-04-01", "end": COVER["n20"][1].isoformat()},
            "n21": {"label": "VIIRS NOAA-21", "start": "2023-03-01", "end": COVER["n21"][1].isoformat()},
        },
        "calibration": {s: {"ratio_at_last_fit_year": round(float(cal[s]["prior"]), 3),
                            "drift_pct_per_year": round(100 * (np.exp(cal[s]["b"]) - 1), 2),
                            "fit_years": f"{int(cal[s]['years'][0]) + 2000}-{int(cal[s]['years'][-1]) + 2000}"}
                        for s in VIIRS}
        | {"terra_share": round(float(cal["terra_share"]["prior"]), 3)},
        "cleaning": cleaning,
        "sources": SOURCES,
        "validation": validation,
    }
    write_json("meta.json", meta, indent=1)
    return len(cells), int(keep.sum())


def main():
    from_points = "--points" in sys.argv
    raw, prev_cleaning = load_points() if from_points else load_raw()
    df, cleaning = clean(raw)
    cleaning = cleaning if not from_points else (prev_cleaning or cleaning)
    set_coverage(df)
    log("sensor x processing: " + ", ".join(f"{r[0]}/{r[1]}={r[2]:,}" for r in
        df.group_by("sensor", "processing").len().sort("sensor", "processing").iter_rows()))
    m = monthly_table(df)
    cell_country = m.select("cell", "country").unique("cell")
    log(f"cell-months: {m.height:,}, cells: {m['cell'].n_unique():,}")
    cal = calibrate(m)
    harm, info, ci, vshare = harmonize_rows(m, cal)

    cv = {s: loyo(cal, s) for s in VIIRS}
    yb = np.array(list(cv["snpp"]["per_year_bias_pct"].values())) / 100
    rel_sys = float(np.sqrt(np.mean(yb ** 2)))          # year-level calibration error, after drift
    log(f"year-level relative calibration error (RMS, S-NPP LOYO): {100 * rel_sys:.1f}%")

    # uncertainty: correlated calibration part (bootstrap of k and drift + year-level error) and Poisson part
    t = m["t"].to_numpy()
    groups = {"central-asia": None, **{c: ci == i for i, c in enumerate(CIDS)}}
    n_t = T_LAST - T_FIRST + 1
    boot_cells = np.zeros((N_BOOT, m.height), dtype=np.float32)
    boot_reg = {g: np.zeros((N_BOOT, n_t)) for g in groups}
    for b in range(N_BOOT):
        hb, _, _, _ = harmonize_rows(m, cal, boot=b)
        boot_cells[b] = hb
        for g, sel in groups.items():
            sel = np.ones(len(t), bool) if sel is None else sel
            boot_reg[g][b] = np.bincount(t[sel] - T_FIRST, weights=hb[sel], minlength=n_t)
    sys_cell = rel_sys * harm * vshare
    sdc = np.sqrt(boot_cells.var(0) + sys_cell ** 2)
    pv = np.divide(harm, info, out=np.zeros_like(harm), where=info > 0)

    vals = {"modis": m["modis"].to_numpy().astype(float), "snpp": m["snpp"].to_numpy().astype(float),
            "n20": m["n20"].to_numpy().astype(float), "n21": m["n21"].to_numpy().astype(float), "harm": harm}
    region_series = {}
    for g, sel in groups.items():
        s = series_by(m, vals | {"pv": pv, "sys": sys_cell}, sel)
        sd_r = np.sqrt(boot_reg[g].var(0) + s.pop("sys") ** 2 + s.pop("pv"))
        s["lo"] = np.clip(s["harm"] - 1.645 * sd_r, 0, None)
        s["hi"] = s["harm"] + 1.645 * sd_r
        s["naive"] = naive_series(s)
        region_series[g] = s

    ca = region_series["central-asia"]
    breaks = break_tests(ca)
    sel = slice(int(month_index(2001, 1)) - T_FIRST, FIT_LAST_T - T_FIRST + 1)
    annual = lambda x: x[sel].reshape(-1, 12).sum(1)  # noqa: E731
    k_chain_num = m.filter((pl.col("t") >= month_index(2018, 4)) & (pl.col("t") <= FIT_LAST_T))
    validation = {
        "naive_break_2012": breaks["naive"],
        "harmonized_break_2012": breaks["harm"],
        "modis_only_reference": breaks["modis"],
        "trend_theil_sen_per_year": {k: round(theil_sen(annual(ca[k])), 1) for k in ("naive", "harm", "modis")},
        "cv": cv,
        "year_level_calibration_error_pct": round(100 * rel_sys, 1),
        "chain_check_noaa20": {"direct": round(float(cal["n20"]["prior"]), 3),
                               "via_snpp": round(float(cal["snpp"]["prior"] * k_chain_num["n20"].sum() / k_chain_num["snpp"].sum()), 3)},
        "top_months_central_asia": [month_label(T_FIRST + int(i)) for i in np.argsort(ca["harm"][:-1])[::-1][:5]],
        "notes": [
            "Calibration on standard-processing (SP) years only; NRT months are provisional.",
            "Band: calibration uncertainty (bootstrap of ratios and drift, plus year-level error) and Poisson counting noise, approx. 90%.",
            "Hotspot counts are not burned area and not fire size.",
        ],
    }
    partial = partial_month(df, cell_country, cal)
    n_cells, n_rows = write_outputs(df, m, harm, sdc, pv, region_series, validation, cal, cleaning, partial)
    log(f"wrote {OUT}: cells={n_cells:,} monthly rows={n_rows:,} partial={'yes' if partial else 'no'}")
    print(json.dumps({k: validation[k] for k in ("naive_break_2012", "harmonized_break_2012",
                                                 "trend_theil_sen_per_year", "year_level_calibration_error_pct",
                                                 "chain_check_noaa20")}, indent=1))
    print(json.dumps({s: {k: v for k, v in cv[s].items() if k != "country_month"} | cv[s]["country_month"]
                      for s in VIIRS}, indent=1))


if __name__ == "__main__":
    main()
