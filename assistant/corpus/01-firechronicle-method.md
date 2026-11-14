---
id: method
title: FireChronicle harmonization method
source: FireChronicle documentation
url: https://github.com/komilovsg/firechronicle#method
status: active
---
## What FireChronicle is
FireChronicle is a web app that turns NASA FIRMS active-fire detections from MODIS (Terra, Aqua) and VIIRS (Suomi NPP, NOAA-20, NOAA-21) into one consistent monthly burning-activity record for Central Asia (Kazakhstan, Uzbekistan, Turkmenistan, Kyrgyzstan, Tajikistan, Afghanistan), from November 2000 to the latest available day. The unit is "MODIS-equivalent active fire detections".

## Why harmonization is needed
MODIS pixels are about 1 km at nadir; VIIRS I-band pixels are 375 m, so VIIRS detects smaller fires and reports more detections for the same fire. Across Central Asia VIIRS reports about 3.5 times as many detections as MODIS overall, and 2 to 15 times by country and month. Stitching MODIS (before 2012) to VIIRS (after 2012) without calibration creates a false jump.

## Cleaning
Only vegetation fires are kept (FIRMS type 0). MODIS detections need confidence of at least 30; VIIRS detections need confidence nominal (n) or high (h). Persistent static sources such as gas flares and industry are removed with a mask of small H3 cells (resolution 8) where most standard-processing detections are flagged as non-vegetation.

## Grid
Detections are counted per H3 cell at resolution 5 (about 253 square kilometres) and per month, separately for each sensor.

## Calibration
Every VIIRS satellite overlaps MODIS in time, so each one is calibrated directly against MODIS Terra+Aqua. For each stratum (country by calendar month) the ratio k is the sum of VIIRS detections divided by the sum of MODIS detections over overlapping science-quality (standard processing) years, shrunk toward the overall ratio when a stratum has few detections. A yearly drift term in the ratio is fitted because Terra and Aqua orbits are drifting. Calibration never uses provisional near-real-time (NRT) data.

## Harmonized value
For each cell and month the harmonized value is the pooled minimum-variance estimate (M + sum of V) / (w_MODIS + sum of k), where M is the MODIS count, V the VIIRS counts and each weight is scaled by how much of the month that sensor observed. Before Aqua started (July 2002) only Terra observed, and its weight is its share of the Terra+Aqua total. When a satellite stops delivering data its weight becomes zero, so the record continues on the remaining satellites in the same units.

## Uncertainty
The approximate 90% band combines calibration uncertainty (bootstrap over calibration years, the drift term and the year-level calibration error) with Poisson counting noise.
