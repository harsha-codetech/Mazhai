# Mazhai (மழை)

Flood-safe routes for Chennai, built for IdeaForge 2K26 (theme: Fix My City).

Normal navigation doesn't reliably account for flooded streets. Mazhai estimates which roads go under at a given rain intensity, then routes around them. People can report flooding, and routes update straight away.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the local address it prints. To demo on a phone, connect it to the same network and open the Network address.

```bash
npm test
```

The road data in `public/data` is already built, so you only need the steps under "Rebuilding the data" to change it.

## Demo script (about 2 minutes)

1. **Problem.** "Every monsoon, roads in Chennai flood, and navigation apps still send you straight through them."
2. **Set the scene.** Open the app on Guindy to Tambaram at 60 mm per hour. The usual route runs along GST Road through about 3 km of estimated flooding. Mazhai takes a dry route that's about 2 km longer.
3. **Drag the gauge.** Take it down to 0, then slowly back up. Roads fill with blue and the route moves to avoid them.
4. **Explain the physics.** Tap a road to show when it starts to flood and how high the ground is. Water collects on low ground, so we score every road by its ground height and flood history.
5. **Show people power.** Tap "+ Report flooding", then tap a point on the lime route and add the report. The route changes straight away.
6. **Show the scale.** Zoom out to all of Chennai: about 240,000 road sections, all routed in the browser with no routing API.
7. **Be honest.** "We tested this against reported floods. It finds the low-lying parts of the city, but it can't tell one street from the next, so reports from people on the ground matter most. Next we'd add drain data and official flood records."

Before presenting, run through it once on the venue's network, then clear any test reports.

## How it works

**Risk.** Every road gets a susceptibility score from 0 to 1, based on its ground height: 16 m or higher scores 0, and sea level scores about 1. Roads near places reported as flood-prone get a raised score. Bridges and flyovers are treated as dry, and subways as the first roads to fill.

That score sets the rain intensity at which the road starts to flood, from 8 mm per hour for the wettest roads to 100 for the driest. These numbers are in `src/lib/model.js`.

**Routing.** All routing runs in the browser with A* search on the OpenStreetMap road network. There is no routing API, key or server. Flooded roads cost 61 times their length, so they're used only as a last resort.

**Reports.** A report treats roads within 120 m as flooded, whatever the model says.

## What's in the code

| Path | What it does |
|---|---|
| `src/lib/model.js` | Risk model and routing |
| `src/components/MapView.jsx` | MapLibre map and flood layers |
| `src/App.jsx` | Page state and layout |
| `src/styles.css` | Design system, copied from WayLore |
| `scripts/extract_osm.py` | Pulls Chennai out of the OpenStreetMap file |
| `scripts/build-data.mjs` | Scores roads and writes `public/data` |
| `scripts/validate.mjs` | Accuracy check against reported floods |

## Accuracy check

Run `npm run validate`. It compares 23 places reported as flooded, none of them used in the flood-history boost, with 3,000 random neighbourhoods. A result of 50% means no better than chance.

| Score | Places used | Beats neighbourhoods citywide | Beats neighbourhoods 2 to 6 km away |
|---|---|---|---|
| First version | All 23 | 40% | 35% |
| First version | 11 held-out | 45% | 41% |
| **Current version** | **11 held-out** | **67% (95% range 57% to 77%)** | **48% (95% range 36% to 61%)** |
| Current version | All 23 | 65% | 48% |

**What this means:** the score finds the low-lying parts of Chennai, but it can't pick out which streets flood within an area. The blue roads show where low ground is, not a street-level flood map.

**How it was tuned:** the first version mixed buildings into its height data and leaned on local dips and water distance. We switched to FABDEM, which removes buildings and trees, then compared 10 terrain measures on 12 tuning places plus the 11 flood-history spots. Only absolute ground height beat chance, at 65%. Height above nearest water, ponding depth and flow accumulation did not. The chosen score was then run on the other 11 places.

**Why to stay cautious:**
- The sample is small, and the first version's scores had already been seen for all 23 places before the split.
- Floods get reported where people live, and the city core is lower than its fringe, so the citywide figure may be flattering.
- Inland floods are missed. Mudichur and Varadharajapuram score near 0 because their floods came from the Adyar river and reservoir releases, not low ground.
- At 60 mm per hour about 27% of road sections show as flooded, because the rain thresholds are still assumptions.

## Limits to be honest about

- **It's not a flood forecast, and the flood map isn't validated.** The thresholds are assumptions, and the accuracy check above shows it works only at the level of whole areas.
- **The elevation data is coarse.** FABDEM has about 30 m resolution and is itself an estimate, which is rough for a city as flat as Chennai.
- **Drains, rivers and tides aren't modelled.** Neither are reservoir releases or how long rain has been falling.
- **Reports stay in one browser.** Sharing them between phones needs a small backend. See `src/lib/reports.js`.
- **The base map needs internet.** If it can't load, the app falls back to drawing our own road data. Rain from "Use live rain" also needs internet.

## Rebuilding the data

1. Download `southern-zone-latest.osm.pbf` from [Geofabrik](https://download.geofabrik.de/asia/india/) to `scripts/raw/chennai/southern-zone.osm.pbf`.
2. Download `N10E080-N20E090_FABDEM_V1-2.zip` from [FABDEM](https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn), and extract the `N12E080` and `N13E080` tiles to `scripts/raw/chennai/fabdem/`.
3. Run `pip install osmium`, then `python scripts/extract_osm.py`. This takes more than 10 minutes.
4. Run `npm run build:data`.

## Flood spot sources

- Ram Nagar and AGS Colony: local reporting by [DT Next](https://www.dtnext.in/amp/story/news/chennai/north-east-monsoon-fire-personnel-rescues-trapped-residents-in-boats-amid-flooding-in-velachery-807537) and [The News Minute](https://www.thenewsminute.com/article/chennai-residents-worried-rains-threaten-more-flooding-many-evacuated-157336)
- Pallavaram, Chromepet, Chitlapakkam, Periamet, Manali, Thiruvottiyur, Chintadripet and Perambur: [Citizen Matters](https://citizenmatters.in/chennai-northeast-monsoon-flooding-gcc-vulnerability-list-19969)
- Perungalathur: [Verified.RealEstate](https://community.verified.realestate/article/chennai-avadi-and-tambaram-race-against-monsoon-will-flood-prone-areas-be-ready/?noamp=mobile)

Check these before quoting them to the judges.

The accuracy check's places come from reports on Cyclone Michaung and other floods, including [Deccan Herald](https://www.deccanherald.com/india/tamil-nadu/floating-cars-submerged-localities-chennai-battles-floods-in-the-wake-of-cyclone-michuang-2796547), [The Week](https://www.theweek.in/news/india/2023/12/06/flood-woes-caused-by-cyclone-michaung-continue-in-chennai.html), [Sphere India](https://www.sphereindia.org.in/sites/default/files/2023-12/SitRep3_CycloneMichaung_09-12-23.pdf), [DT Next](https://www.dtnext.in/news/chennai/chennai-fights-waterlogging-again-as-govt-fails-to-take-action) and [The News Minute](https://www.thenewsminute.com/tamil-nadu/chennai-rains-t-nagar-velachery-and-other-areas-face-waterlogging).

## Data credits

Roads, water and places © OpenStreetMap contributors (ODbL). Elevation: FABDEM V1-2, University of Bristol and Fathom, licensed CC BY-NC-SA 4.0 and produced using Copernicus WorldDEM-30 © DLR e.V. Non-commercial use only, so a commercial version would need a different elevation source or a licence. Live rain: Open-Meteo. Base map: OpenFreeMap.
