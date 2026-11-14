"""Download NASA FIRMS active fire data for Central Asia.

  python pipeline/fetch_firms.py country   # yearly SP country CSVs 2000-2025 (no key)
  python pipeline/fetch_firms.py api       # 2026 SP+NRT and NOAA-21 via Area API (needs FIRMS_MAP_KEY in .env)

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

BBOX = "46,35,88,56"  # west,south,east,north: Central Asia
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


def fetch_api():
    key = os.environ.get("FIRMS_MAP_KEY") or _read_env_key()
    if not key:
        sys.exit("FIRMS_MAP_KEY missing in .env")
    calls = rows = 0
    for source, start, end in API_JOBS:
        d = start
        while d <= end:
            span = min(5, (end - d).days + 1)
            out = RAW / "api" / source / f"{d.isoformat()}_{span}d.csv"
            if not out.exists():
                url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{BBOX}/{span}/{d.isoformat()}"
                status, body = get(url)
                text = body.decode("utf-8", "replace")
                if status != 200 or not text.startswith("latitude"):
                    if "Exceeding allowed transaction limit" in text:
                        print("limit hit, sleeping 10 min")
                        time.sleep(600)
                        continue
                    raise RuntimeError(f"{source} {d}: unexpected response: {text[:200]}")
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(text)
                calls += 1
                time.sleep(0.3)
            rows += max(0, out.read_text().count("\n") - 1)
            d += timedelta(days=span)
        print(f"{source}: done, cumulative rows={rows}", flush=True)
    print(f"api: new calls={calls} total rows={rows}")


def _read_env_key():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("FIRMS_MAP_KEY="):
                return line.split("=", 1)[1].strip()
    return None


if __name__ == "__main__":
    {"country": fetch_country, "api": fetch_api}[sys.argv[1]]()
