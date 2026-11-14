# FireChronicle web app

One fire history, before and after MODIS. A static site (Vite + TypeScript, MapLibre GL, h3-js, Apache ECharts) that reads harmonized MODIS and VIIRS hotspot data from `public/data/`. Data: NASA FIRMS. Not an official NASA product.

## Run

```bash
npm ci
npm run sample    # writes synthetic sample data into public/data/ (meta.json has "sample": true)
npm run dev       # http://localhost:5173
npm test          # vitest, pure logic in src/lib
npm run build     # type check + static site in dist/
npm run preview   # serve dist/ on :4173
```

`dev`, `build` and `preview` first copy the MapLibre worker files from `node_modules` into `public/maplibre/` (git-ignored). This keeps the strict CSP (`script-src 'self'`, no blob scripts).

## Data

The app reads only the static files described in `../DATA_CONTRACT.md` (`meta.json`, `cells.json`, `monthly.json`, `regions.json`, `countries.geojson`, `points/{year}.csv.gz`). The pipeline overwrites the sample files with real data; no code change is needed. When `meta.json` has `"sample": true` the UI shows a "Sample data" badge.

Country areas use `regions.json` for the series and `countries.geojson` for the map cells. Custom polygons and circles are aggregated in the browser from `monthly.json` (cells whose centre lies inside the shape). The hotspot CSV export streams `points/{year}.csv.gz` on demand and keeps rows whose H3 cell is in the area.

## Deploy to GitHub Pages

`base` is `./`, so `dist/` works under any sub-path. Publish the `dist/` folder (for example with a Pages workflow that runs `npm ci && npm run build` and uploads `dist`). Serve `.csv.gz` as plain files; if a host adds `Content-Encoding: gzip`, the export detects it and skips its own decompression.

## Acknowledgement

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/data/tools/firms), part of NASA's Earth Science Data and Information System (ESDIS).

Parts of this project's code and text were written with SI (AI) coding assistance.

Basemap: OpenFreeMap, data from OpenStreetMap contributors.
