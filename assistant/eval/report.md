# FireChronicle assistant eval

Generated 2026-11-14T18:01:49.364Z. Worker: https://firechronicle-assistant.firechronicle-assistant.workers.dev

| mode | hit rate | crash honesty | false refusals | faithfulness | correct (answered facts) | look-alike traps |
|---|---|---|---|---|---|---|
| hybrid | 100% (26/26) | 100% (7/7) | 0 | 100% (27/27) | 96% (25/26) | 3/3 |

## Mode: hybrid

| id | kind | refused | reason | hit | faithful | correct | trap | answered by | judge | maxSim | answer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7881 | Delivery of new science data from the Suomi NPP satellite ceased at 13:00 UTC on 2 November 2026. |
| 2 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7929 | NASA FIRMS recommends NOAA-20 and NOAA-21 VIIRS as replacements for Suomi NPP. They carry an identical VIIRS sensor with the same 375 m reso |
| 3 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7719 | VIIRS NOAA-21 375 m data is available in NASA FIRMS from 1 March 2023 to present. |
| 4 | trap | false |  | true | true | true | true | gemini-3.5-flash-lite | gemini-3.5-flash | 0.6489 | The DOI of VJ114IMG is 10.5067/VIIRS/VJ114IMG.002. |
| 5 | trap | false |  | true | true | true | true | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.6619 | No, VJ214IMG is the NOAA-21 product; the NOAA-20 product is VJ114IMG. |
| 6 | trap | false |  | true | true | true | true | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.6127 | MCD14ML is the monthly MODIS active fire locations product distributed by FIRMS. The near-real-time MODIS product is MCD14DL. |
| 7 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7366 | MODIS pixels are about 1 km at nadir, while VIIRS I-band pixels are 375 m, allowing VIIRS to detect smaller fires and report more detections |
| 8 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7427 | For each cell and month the harmonized value is the pooled minimum-variance estimate (M + sum of V) / (w_MODIS + sum of k), where M is the M |
| 9 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7364 | Detections are removed during cleaning if their FIRMS type is not 0 (not presumed vegetation fire), accounting for 2.9 percent of removals.  |
| 10 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7368 | No, calibration never uses provisional near-real-time data. |
| 11 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7145 | When a satellite stops delivering data its weight becomes zero, so the record continues on the remaining satellites in the same units. |
| 12 | fact | false |  | true |  |  |  | gemini-3.5-flash-lite |  | 0.7302 | Detections are counted per H3 cell at resolution 5, which is about 253 square kilometres. |
| 13 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.6393 | A hatched cell in the calendar means it contains provisional, near-real-time data. |
| 14 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7139 | To draw your own area, draw a polygon on the map by clicking points and double-clicking to finish. Alternatively, you can pick a country or  |
| 15 | trap | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.8039 | This is not in the FireChronicle knowledge base. High-activity months are historical climatology, and FireChronicle does not predict where o |
| 16 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7484 | Standard science-quality data are usually available with a 2-3 month lag, and the FIRMS archive page mentions about a 5 month lag before NRT |
| 17 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.5714 | FRP means fire radiative power in megawatts. |
| 18 | trap | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7651 | Type 2 means other static land source. |
| 19 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7915 | Most of the time the extra location error of MODIS and VIIRS NRT detections is very small, which is under 100 metres. After spacecraft maneu |
| 20 | trap | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7866 | No, a detection count is not burned area and not fire size. Several detections can come from one large fire, and a small or short fire betwe |
| 21 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7679 | MODIS on Terra provides the only morning overpass, about 3 hours before Aqua. |
| 22 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.8393 | FireChronicle is not an official NASA product and is not endorsed by NASA. |
| 23 | crash | true | not_in_base |  |  |  |  | gemini-3.5-flash-lite |  | 0.7146 | This is not in the FireChronicle knowledge base. |
| 24 | crash | false |  |  | true |  |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.6927 | This is not in the FireChronicle knowledge base. High-activity months are historical climatology, and FireChronicle does not predict where o |
| 25 | crash | true | not_in_base |  |  |  |  | gemini-3.5-flash-lite |  | 0.7164 | This is not in the FireChronicle knowledge base. The context does not contain any information about Landsat 10. |
| 26 | crash | true | not_in_base |  |  |  |  | gemini-3.5-flash-lite |  | 0.5697 | This is not in the FireChronicle knowledge base. |
| 27 | crash | true | out_of_scope |  |  |  |  |  |  | 0.5318 | This is not in the FireChronicle knowledge base. |
| 28 | crash | true | not_in_base |  |  |  |  | gemini-3.5-flash-lite |  | 0.7566 | This is not in the FireChronicle knowledge base. The context does not mention GOES-East. |
| 29 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7952 | Typical fire season in Tajikistan: Feb–Mar and Jul–Sep. |
| 30 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7856 | The year with the most detections in Kazakhstan was 2002. |
| 31 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.768 | Yes, the mean annual harmonized total in Uzbekistan was 2 613 in 2001-2011 and 2 083 in 2012-2025, which is a change of -20 percent (lower i |
| 32 | fact | false |  | true | true | true |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.7541 | Detections removed because FIRMS type is not 0 (not presumed vegetation fire): 2.9 percent. |
| 33 | crash | false |  |  | true |  |  | gemini-3.5-flash-lite | gemini-3.1-flash-lite | 0.6738 | This is not in the FireChronicle knowledge base. FireChronicle covers Central Asia (Kazakhstan, Uzbekistan, Turkmenistan, Kyrgyzstan, Tajiki |
