---
id: app
title: How to use FireChronicle
source: FireChronicle documentation
url: https://komilovsg.github.io/firechronicle/
status: active
---
## Choosing an area
Pick a country or "Central Asia" from the Area list, draw a polygon on the map (click points, double-click to finish), or enter latitude, longitude and a radius in kilometres. An area is the set of H3 cells whose centres fall inside it.

## Burning activity calendar
Rows are years, columns are months. Brighter colour means more harmonized fire detections. Hatched cells are provisional (near-real-time data). Modes: Harmonized, Raw MODIS, Raw VIIRS, Naive splice, and Swipe compare, which shows the naive splice and the harmonized record side by side.

## This month vs history
Compares the current month so far with the same days of the same month in every past year, and reports the percentile and the change against the median.

## High-activity months ahead
For each of the next 12 calendar months, the share of the last 10 years in which that month was above the area's recent 75th percentile, Laplace-smoothed. Months at 50% or more are marked high-activity. This is climatology, not a forecast.

## Anomaly now
A map mode that colours each cell by the percentile of the latest complete month against that cell's own history for the same calendar month. Cells with fewer than 5 years of history are grey.

## Downloads
Hotspot CSV for the selected area and years, monthly series CSV, harmonized dataset CSV for all regions, chart PNGs, and a briefing card PNG. The Cite button copies a citation.
