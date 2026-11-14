"""Download NASA FIRMS active fire data for Central Asia.

  python pipeline/fetch_firms.py country   # yearly SP country CSVs 2000-2025 (no key)
  python pipeline/fetch_firms.py api       # 2026 SP+NRT and NOAA-21 via Area API (needs FIRMS_MAP_KEY in .env)
  python pipeline/fetch_firms.py recent    # daily update: last 6 months, SP where available else NRT

Files land in data/raw/. Existing files are skipped, so reruns resume.
"""
import os
import sys
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
UA = {"User-Agent": "firechronicle-pipeline"}

COUNTRIES = ["Kazakhstan", "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Tajikistan", "Afghanistan"]
COUNTRY_PRODUCTS = {"modis": 2000, "viirs-snpp": 2012, "viirs-jpss1": 2018}
LAST_COUNTRY_YEAR = 2025

BBOX = "46,29,88,56"  # west,south,east,north: Central Asia incl. southern Afghanistan
TODAY = date.today()
# (source, start, end) from /api/data_availability on 2026-11-14
API_JOBS = [
    ("MODIS_SP", date(2026, 1, 1), date(2026, 8, 31)),
    ("MODIS_NRT", date(2026, 9, 1), TODAY),
    ("VIIRS_NOAA20_SP", date(2026, 1, 1), date(2026, 7, 31)),
    ("VIIRS_NOAA20_NRT", date(2026, 8, 1), TODAY),
    ("VIIRS_SNPP_SP", date(2026, 1, 1), date(2026, 7, 31)),
    ("VIIRS_SNPP_NRT", date(2026, 8, 1), date(2026, 11, 2)),
    ("VIIRS_NOAA21_SP", date(2023, 3, 1), date(2026, 7, 31)),
    ("VIIRS_NOAA21_NRT", date(2026, 8, 1), TODAY),
]


def get(url, retries=4):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 404, b""
            err = e
        except Exception as e:  # network hiccup
            err = e
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"failed {url}: {err}")


def fetch_country():
    ok = missing = 0
    for product, first in COUNTRY_PRODUCTS.items():
        for year in range(first, LAST_COUNTRY_YEAR + 1):
            for c in COUNTRIES:
                out = RAW / "country" / product / f"{product}_{year}_{c}.csv"
                if out.exists():
                    ok += 1
                    continue
                url = f"https://firms.modaps.eosdis.nasa.gov/data/country/{product}/{year}/{product}_{year}_{c}.csv"
                status, body = get(url)
                if status == 404:  # no detections that year for that country
                    missing += 1
                    continue
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(body)
                ok += 1
    print(f"country: files={ok} missing(404)={missing}")


def _key():
    key = os.environ.get("FIRMS_MAP_KEY") or _read_env_key()
    if not key:
        sys.exit("FIRMS_MAP_KEY missing (env or .env)")
    return key


def fetch_range(key, source, start, end, outdir):
    """Fetch [start, end] for one source in 5-day chunks into outdir; returns (new_calls, rows)."""
    calls = rows = 0
    d = start
    while d <= end:
        span = min(5, (end - d).days + 1)
        out = outdir / source / f"{d.isoformat()}_{span}d.csv"
        if not out.exists():
            url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{BBOX}/{span}/{d.isoformat()}"
            try:
                status, body = get(url)
            except RuntimeError as e:  # never leak the key into logs
                raise RuntimeError(str(e).replace(key, "***")) from None
            text = body.decode("utf-8", "replace")
            if status != 200 or not text.startswith("latitude"):
                if "Exceeding allowed transaction limit" in text:
                    print("limit hit, sleeping 10 min", flush=True)
                    time.sleep(600)
                    continue
                raise RuntimeError(f"{source} {d}: unexpected response: {text[:200].replace(key, '***')}")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text)
            calls += 1
            time.sleep(0.3)
        rows += max(0, out.read_text().count("\n") - 1)
        d += timedelta(days=span)
    return calls, rows


def fetch_api():
    key = _key()
    calls = rows = 0
    for source, start, end in API_JOBS:
        c, r = fetch_range(key, source, start, end, RAW / "api")
        calls += c
        rows += r
        print(f"{source}: done, cumulative rows={rows}", flush=True)
    print(f"api: new calls={calls} total rows={rows}")


def availability(key=None):
    """Official date coverage per FIRMS source -> {source: (min_date, max_date)}; also saved to data/raw/."""
    key = key or _key()
    status, body = get(f"https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{key}/ALL")
    text = body.decode()
    if status != 200 or not text.startswith("data_id"):
        raise RuntimeError("data_availability failed: " + text[:200].replace(key, "***"))
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "availability.csv").write_text(text)
    out = {}
    for line in text.strip().splitlines()[1:]:
        sid, a, b = line.split(",")[:3]
        out[sid] = (date.fromisoformat(a), date.fromisoformat(b))
    return out


RECENT_MONTHS = 6  # SP lags NRT by 2-5 months; refresh this rolling window every run
SENSOR_SOURCES = {"MODIS": ("MODIS_SP", "MODIS_NRT"), "SNPP": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
                  "NOAA20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"), "NOAA21": ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT")}


def recent_start(today: date) -> date:
    m = today.month - RECENT_MONTHS
    y = today.year + (m - 1) // 12
    return date(y, (m - 1) % 12 + 1, 1)


def fetch_recent():
    """Daily update: re-fetch the last RECENT_MONTHS: SP where available, NRT after it."""
    import shutil
    key = _key()
    av = availability(key)
    today = max(b for _, b in av.values())
    start = recent_start(today)
    outdir = RAW / "recent"
    shutil.rmtree(outdir, ignore_errors=True)
    total = 0
    for name, (sp, nrt) in SENSOR_SOURCES.items():
        sp_end = av[sp][1] if sp in av else start - timedelta(days=1)
        if sp_end >= start:
            total += fetch_range(key, sp, start, sp_end, outdir)[1]
        if nrt in av:
            a = max(start, sp_end + timedelta(days=1), av[nrt][0])
            if a <= av[nrt][1]:
                total += fetch_range(key, nrt, a, av[nrt][1], outdir)[1]
        print(f"{name}: ok, cumulative rows={total}", flush=True)
    (outdir / "WINDOW").write_text(start.isoformat())
    print(f"recent window from {start}: rows={total}")


def _read_env_key():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("FIRMS_MAP_KEY="):
                return line.split("=", 1)[1].strip()
    return None


SATS = {"terra": (25994, "Terra", "MODIS", 2330), "aqua": (27424, "Aqua", "MODIS", 2330),
        "snpp": (37849, "Suomi NPP", "VIIRS", 3060), "n20": (43013, "NOAA-20", "VIIRS", 3060),
        "n21": (54234, "NOAA-21", "VIIRS", 3060)}


def fetch_tle():
    """Current orbital elements (TLE) from CelesTrak for the fire satellites -> web/public/data/tle.json."""
    import json
    from datetime import datetime, timezone
    out = {"source": "CelesTrak GP data (https://celestrak.org)", "fetched_at":
           datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "satellites": []}
    for key, (cat, name, instrument, swath_km) in SATS.items():
        status, body = get(f"https://celestrak.org/NORAD/elements/gp.php?CATNR={cat}&FORMAT=TLE")
        lines = [x.strip() for x in body.decode("utf-8", "replace").splitlines() if x.strip()]
        if status != 200 or len(lines) < 3 or not lines[1].startswith("1 ") or not lines[2].startswith("2 "):
            print(f"tle {key}: unavailable, skipped")
            continue
        out["satellites"].append({"id": key, "name": name, "norad": cat, "instrument": instrument,
                                  "swath_km": swath_km, "tle1": lines[1], "tle2": lines[2]})
    dest = ROOT / "web" / "public" / "data" / "tle.json"
    dest.write_text(json.dumps(out, indent=1))
    print(f"tle: {len(out['satellites'])} satellites -> {dest}")


if __name__ == "__main__":
    {"country": fetch_country, "api": fetch_api, "recent": fetch_recent, "tle": fetch_tle,
     "availability": lambda: print(availability())}[sys.argv[1]]()
