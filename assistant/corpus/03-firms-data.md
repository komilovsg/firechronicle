---
id: firms
title: NASA FIRMS data: processing levels and fields
source: NASA FIRMS FAQ and attribute documentation
url: https://www.earthdata.nasa.gov/data/tools/firms/faq
status: active
---
## Standard vs near-real-time data
Standard (science-quality) data deliver an internally consistent, well-calibrated record designed for long-term research. FIRMS distributes them as monthly "ML" files, usually available with a 2-3 month lag; the FIRMS archive page mentions about a 5 month lag before NRT data are replaced. Ultra Real-Time (URT), Real-Time (RT) and Near Real-Time (NRT) data are produced faster for emergency response using modified processing. In FireChronicle, months that still contain NRT data are marked provisional.

## Geolocation of NRT data
Most of the time the extra location error of MODIS and VIIRS NRT detections is very small (under 100 metres). After spacecraft maneuvers or severe space weather, NRT positioning errors can reach several kilometres; for MODIS Aqua the degraded period can last up to 12 hours.

## Fields
latitude, longitude: centre of the detection pixel. acq_date, acq_time: acquisition date and time in UTC. satellite: Terra, Aqua (MODIS) or N (Suomi NPP), N20 (NOAA-20), N21 (NOAA-21). confidence: MODIS 0-100; VIIRS low (l), nominal (n), high (h). frp: fire radiative power in megawatts. daynight: D or N. type (standard processing only): 0 presumed vegetation fire, 1 active volcano, 2 other static land source, 3 offshore. version: collection and processing level, for example 6.1 for MODIS standard processing and 6.1NRT for near-real-time.

## Access
FIRMS archive downloads (CSV, SHP, JSON) need Earthdata login or an email code. Country yearly summaries are downloadable as CSV. The FIRMS Area API needs a free MAP_KEY and allows 5000 transactions per 10 minutes.
