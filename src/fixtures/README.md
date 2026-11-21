# Test fixtures

Public warning data, saved as the feeds served it, for the parser and the
filters to be tested against the real thing. Only public content.

| File | Source | Saved |
|---|---|---|
| `tsunami-ntwc-info.xml` | https://www.tsunami.gov/events/xml/PAAQCAP.xml (Tsunami Information Statement, signed) | 2026-11-21 |
| `tsunami-ptwc-info.xml` | https://www.tsunami.gov/events/xml/PHEBCAP.xml | 2026-11-21 |
| `tsunami-ntwc-atom.xml` | https://www.tsunami.gov/events/xml/PAAQAtom.xml | 2026-11-21 |
| `tsunami-warning-sample.xml` | https://www.tsunami.gov/cap/v1.1/WEPA41CAP2.xml, the sample Warning/Advisory/Watch of tsunami.gov's CAP page (2012 event) | 2026-11-21 |
| `ncdr-index.xml` | https://alerts.ncdr.nat.gov.tw/RssAtomFeeds.ashx | 2026-11-21 |
| `ncdr-cold.cap`, `ncdr-wind.cap` | The two CWA messages that index linked to | 2026-11-21 |
| `aemet-rss.xml` | https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_wah_RSS.xml, cut to 6 of its 67 items | 2026-11-21 |
| `aemet-cap.xml` | The CAP message of its first item (wind, Litoral norte de Alicante) | 2026-11-21 |
| `meteoalarm-spain.xml` | https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain, cut to 2 of its 91 entries | 2026-11-21 |
| `meteoalarm-cap.xml` | The CAP message of one of them | 2026-11-21 |
| `gdacs.xml` | https://www.gdacs.org/xml/gdacs_cap.xml, cut to 3 of its 265 items (an earthquake, an orange drought, a cyclone) | 2026-11-21 |
| `nws-ak-active.json` | https://api.weather.gov/alerts/active?area=AK, cut to 3 of its 9 alerts | 2026-11-21 |
| `nws-tsunami-warning.json` | **Made by hand** in the shape of the NWS API (there was no tsunami warning to save); the polygon is approximate | 2026-11-21 |

Licences: NOAA/NWS data is in the public domain; CWA's under the Taiwan
Government Open Data Licence 1.0; AEMET's free to reuse citing © AEMET;
Meteoalarm's under terms equivalent to CC BY 4.0; GDACS's under CC BY 4.0.
