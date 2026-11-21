# kiosko-plugin-hazards

Official warnings published by the NWS, tsunami.gov, Taiwan's CWA (via
NCDR), AEMET, Meteoalarm and GDACS, on your panels: a tsunami warning for
your coast or a red weather warning for your area takes every screen over
as a Kiosko alert, with who published it and their instruction as they
wrote it. A tile lists the latest ones and when each feed last answered.

A plugin for [Kiosko](https://github.com/kiosko-lcd/kiosko), the widget mosaic
for small USB LCD panels. **Optional:** Kiosko doesn't install it.

> **Informational. It does not replace official alerts** (your phone's
> emergency alerts, ES-Alert, WEA, radio and TV). The warnings can reach your
> panel **minutes after** they are published: Kiosko asks each feed every
> 1–15 minutes, and your computer has to be on and Kiosko running. This is
> not an early-warning system: no open feed carries the alerts sent seconds
> before an earthquake shakes (ShakeAlert, 強震即時警報, 緊急地震速報 and
> ES-Alert go to phones only). If the ground shakes hard near the coast, go
> to high ground without waiting for any warning. The plugin is MIT
> licensed, without warranty; GDACS calls its data "indicative", AEMET is not
> liable for the use of its data, and naming an authority does not mean it
> endorses Kiosko.

## Needs

Kiosko **0.2.7 or later** for full use: the switch that keeps the source
running with no tile, and the alert's source and instruction lines. On
0.2.0–0.2.6 it loads, but its alerts only run while a tile of it is on some
page, and show only a title and a line.

## Install

```sh
npm install --prefix ~/.config/kiosko/plugins kiosko-plugin-hazards
```

(macOS: `~/Library/Application Support/Kiosko/plugins`, Windows: `%APPDATA%\Kiosko\plugins`.)

Then, in the editor:

1. **Settings → Place**: your place. The feeds and the area filter use it.
2. **Settings → Data sources → Official warnings**: turn on **Watch for
   alerts without a widget**. No tile is needed for the full-screen alerts.
3. Optionally, a **Latest warnings** tile on some page.
4. Optionally, a drill (below), to see it work end to end.

## What reaches your panel

| Feed (`feeds`) | Published by | What | Asked every | Typical delay | Terms |
|---|---|---|---|---|---|
| `nws` | US National Weather Service (api.weather.gov, filtered for your point by the NWS) | Every NWS warning for your point, tsunami ones included | 1 min | not published | Public domain |
| `tsunami-ntwc` | NOAA National Tsunami Warning Center (tsunami.gov) | Tsunami warnings, advisories, watches and information statements for the US and Canada | 1 min | minutes after the earthquake | Public domain |
| `tsunami-ptwc` | NOAA Pacific Tsunami Warning Center (tsunami.gov) | The same for Hawaii, the Pacific and the Caribbean | 1 min | minutes | Public domain |
| `ncdr` | Taiwan's Central Weather Administration and other agencies, via NCDR (民生示警) | Typhoon, rain, wind, cold, earthquake, tsunami… | 1 min (and 3.5 s between requests) | report 5–10 min, tsunami ≈ 20 min | Open Government Data Licence 1.0 (attribution) |
| `aemet` | AEMET (Meteoalerta) | Spanish weather warnings | 10 min | hours ahead (forecasts) | Free reuse citing © AEMET |
| `meteoalarm-<country>` | Meteoalarm (the national weather services of Europe) | Weather warnings; no earthquakes or tsunamis | 10 min | as the national service | Terms equivalent to CC BY 4.0, with extra terms for redistribution |
| `gdacs` | GDACS (UN and European Commission) | Earthquakes, cyclones and floods worldwide, green/orange/red by people exposed | 15 min | tens of minutes | CC BY 4.0; "indicative" |
| `test` | This plugin | A drill (below) | once | — | — |

With `feeds` empty, it picks by your place: **US** `nws`, `tsunami-ntwc`,
`tsunami-ptwc`; **Taiwan** `ncdr`; **Spain** `aemet`; **Portugal, France,
Italy, Germany, the UK, Ireland, the Netherlands, Belgium, Austria and
Switzerland** their Meteoalarm feed and `gdacs`; **elsewhere** `gdacs`.
`!gdacs` leaves one out; `aemet, gdacs` names them.

`customFeeds` takes the Atom, RSS or single-message CAP feed of any other
alerting authority: the [WMO Register of Alerting Authorities](https://alertingauthority.wmo.int/)
lists them by country.

Each alert and each row names its source. Their licences ask for it, and you
must know where a warning comes from.

## How a warning becomes an alert

The first rule that applies decides:

| Warning | Level |
|---|---|
| A test or an exercise (`status` Test, Exercise) | Nothing; with `includeTests`, info with **TEST** / **EXERCISE** in front. Never as real. |
| Cancelled, or "all clear" | The alert goes; "Warning over" (info) for 2 minutes |
| Tsunami **Warning** for your coast | **critical** |
| Tsunami Advisory or Watch | warn |
| Tsunami information statement ("no threat") | The tile only |
| A colour from the authority (AEMET, Meteoalarm, CWA): red / orange / yellow | `maxWeatherLevel` (warn) / warn / info |
| Extreme, immediate or expected, observed or likely | **critical** |
| Severe, immediate or expected, observed or likely | warn (critical if `maxWeatherLevel` is critical) |
| Extreme or Severe, later or less certain | warn |
| Moderate | info |
| Minor, unknown, or already past | The tile only |
| Earthquake report within `radiusKm` and at least `minMagnitude` | `maxQuakeLevel` (warn) |
| Earthquake report farther away, orange or red for GDACS | info |

Why earthquake reports stay at warn: they say what has already happened. In
quiet hours only critical goes through, and a report at 3 a.m. should not
wake the panel to tell you about something that is over. A tsunami warning
is critical because it is the one thing here that can arrive before the
danger.

A warning is yours when your place is inside its polygon or circle (plus
`marginKm`), in a zone you chose (`zones`), in the US state of its UGC zone
codes (tsunami.gov), or in the Taiwan county of its NCDR towns. A warning
whose area can't be told never takes the screen: the tile counts them and
asks you to choose zones (Meteoalarm gives only zone codes).

Updates replace what they update (same level: same alert, so **Seen** holds;
a higher level: a new alert); a warning ends when it is cancelled, when it
expires (when it doesn't say: 30 min for a report, 6 h for a tsunami, 12 h
for weather) or, in feeds that list what is in force, after two reads in a
row without it. What the plugin knows is kept in its data folder, so a
restart neither repeats old warnings nor loses current ones.

## When a feed is down

The tile says it in amber ("AEMET: no data since 14:05") and keeps its
place; it never takes the screen. Without fresh data it doesn't say "no
warnings", it says "no warnings data". Warnings already open stay until they
expire.

## Drill

Add `test` to `feeds`: once, a tsunami warning marked **TEST** in your area
goes through the parser, the area filter and the levels like a real one,
shows critical for 60 seconds and expires. It doesn't come back on a
restart; take `test` out and put it back for another. To try a CAP file of
your own, put its `file://` path in `customFeeds`. To see how an alert of
each level looks on a screen, Kiosko has **Screens → Test alert**.

## Source

### Official warnings — `hazards/alerts`

Settings → Data sources.

| Option | Type | Default | |
|---|---|---|---|
| `feeds` | filter | `[]` | Empty: the ones for your place (above). |
| `customFeeds` | list of URLs | `[]` | Your own CAP feeds (Atom, RSS, a CAP message, or `file://`). Contacts those hosts or reads those files. |
| `kinds` | filter | `earthquake, tsunami, weather` | Also `other`. |
| `events` | filter | `[]` | By the authority's event name (`*Wind*`, `!*Frost*`). |
| `zones` | filter | `[]` | Zone codes or names for warnings without a shape (`ES239`, `CAZ043`, `桃園市*`). |
| `marginKm` | km | `0` | Also warnings for areas this close. |
| `radiusKm` | km | `300` | Earthquake reports nearer than this… |
| `minMagnitude` | number | `4` | …and at least this big take the screen. |
| `maxQuakeLevel` | `info` \| `warn` \| `critical` | `warn` | Level of a near earthquake report. |
| `maxWeatherLevel` | `info` \| `warn` \| `critical` | `warn` | Highest level of a red or a Severe weather warning. |
| `includeTests` | boolean | `false` | Tests and exercises, as info and marked. |
| `staleMs` | duration | 15 min | A feed silent this long is shown as down. |
| `latitude`, `longitude`, `placeName` | advanced | 0, 0, `""` | Another place than Settings'. |

## Widget

### Latest warnings — `hazards/latest`

The warnings in force for you and the earthquake reports of the last day,
the gravest first, each with where, until when (or how long ago) and who
published it; what is over stays greyed for a day. Below: the feeds that
are down, the data's age, and the note "Informational · not a substitute for
official warnings". Preferred 640×462, at least 320×154.

| Option | Type | Default | |
|---|---|---|---|
| `kinds` | filter | `[]` | Only some kinds (`earthquake` for a tile of earthquakes). |
| `rows`, `layout` | list options | `0`, `auto` | As in every Kiosko list. |

## What it does on your machine

- **Contacts** only the feeds it reads: `api.weather.gov`,
  `www.tsunami.gov`, `alerts.ncdr.nat.gov.tw`, `www.aemet.es`,
  `feeds.meteoalarm.org`, `www.gdacs.org`, and the hosts of your
  `customFeeds`. Conditional requests (ETag, Last-Modified), one request at a
  time per host, waiting when a server asks to (`Retry-After`), and a
  User-Agent that names the plugin and Kiosko, never you. Your place goes to
  the NWS only (its `point=` filter), and only for a place in the US.
- **Reads** the `file://` paths in `customFeeds`, if any.
- **Writes** its state (open warnings, messages seen, AEMET's zone shapes)
  in its data folder.
- No programs, no devices. Sound for alerts, when it comes, will be Kiosko's.

The XML reader is its own and small: it refuses any document with a DTD or
an entity declaration (no XXE, no "billion laughs"), and documents over
10 MB (1 MB for one CAP message), 64 levels deep or with 200 000 elements.
tsunami.gov's XML signatures are not checked yet.

## Testing

`npm test` runs against real messages saved from each feed
(`src/fixtures/`, see its README), plus attacks on the XML reader.

## Licence

MIT. The warnings belong to their authorities, under their terms (above).
