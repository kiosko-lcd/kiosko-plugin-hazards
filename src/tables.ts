/**
 * Rough geography, enough to pick feeds and to place warnings that come with
 * a code and no shape. Rectangles and centres by hand, a few km out at
 * worst: it only decides which feeds to offer by default (the user can
 * choose others) and which coast a tsunami bulletin's UGC codes name.
 */

/** `[latMin, latMax, lonMin, lonMax]`. */
export type Box = readonly [number, number, number, number];

/** Inside a rectangle, or within `marginKm` of it. */
export function inBox(pt: readonly [number, number], b: Box, marginKm = 0): boolean {
  const dLat = marginKm / 111;
  const dLon = marginKm / (111 * Math.max(0.1, Math.cos((pt[0] * Math.PI) / 180)));
  return pt[0] >= b[0] - dLat && pt[0] <= b[1] + dLat && pt[1] >= b[2] - dLon && pt[1] <= b[3] + dLon;
}

/** US states and territories with a coast, by the two letters UGC codes start with. */
export const US_STATES: Record<string, Box[]> = {
  AK: [[51.2, 71.5, -180, -129.9], [51.2, 55.5, 172, 180]],
  HI: [[18.9, 22.3, -160.3, -154.8]],
  WA: [[45.5, 49.0, -124.8, -116.9]],
  OR: [[41.99, 46.3, -124.6, -116.4]],
  CA: [[32.5, 42.0, -124.5, -114.1]],
  TX: [[25.8, 36.5, -106.7, -93.5]],
  LA: [[28.9, 33.0, -94.1, -88.8]],
  MS: [[30.1, 35.0, -91.7, -88.1]],
  AL: [[30.1, 35.0, -88.5, -84.9]],
  FL: [[24.4, 31.0, -87.7, -80.0]],
  GA: [[30.3, 35.0, -85.6, -80.8]],
  SC: [[32.0, 35.2, -83.4, -78.5]],
  NC: [[33.8, 36.6, -84.4, -75.4]],
  VA: [[36.5, 39.5, -83.7, -75.2]],
  MD: [[37.9, 39.8, -79.5, -75.0]],
  DE: [[38.4, 39.9, -75.8, -75.0]],
  DC: [[38.8, 39.0, -77.1, -76.9]],
  PA: [[39.7, 42.3, -80.5, -74.7]],
  NJ: [[38.9, 41.4, -75.6, -73.9]],
  NY: [[40.5, 45.0, -79.8, -71.8]],
  CT: [[40.9, 42.1, -73.7, -71.8]],
  RI: [[41.1, 42.0, -71.9, -71.1]],
  MA: [[41.2, 42.9, -73.5, -69.9]],
  NH: [[42.7, 45.3, -72.6, -70.6]],
  ME: [[43.0, 47.5, -71.1, -66.9]],
  PR: [[17.8, 18.6, -67.3, -65.2]],
  VI: [[17.6, 18.5, -65.1, -64.5]],
  GU: [[13.2, 13.7, 144.6, 145.0]],
  AS: [[-14.4, -11.0, -171.1, -168.1]],
  MP: [[14.1, 20.6, 144.8, 146.1]],
};

/** Taiwan's counties and cities, by the name NCDR's areas start with, and a point near their middle. */
export const TW_COUNTIES: { name: string; at: [number, number] }[] = [
  { name: '臺北市', at: [25.06, 121.56] },
  { name: '新北市', at: [25.01, 121.47] },
  { name: '基隆市', at: [25.13, 121.74] },
  { name: '桃園市', at: [24.93, 121.22] },
  { name: '新竹市', at: [24.80, 120.97] },
  { name: '新竹縣', at: [24.70, 121.12] },
  { name: '苗栗縣', at: [24.49, 120.94] },
  { name: '臺中市', at: [24.18, 120.68] },
  { name: '彰化縣', at: [24.00, 120.47] },
  { name: '南投縣', at: [23.84, 120.98] },
  { name: '雲林縣', at: [23.71, 120.39] },
  { name: '嘉義市', at: [23.48, 120.45] },
  { name: '嘉義縣', at: [23.45, 120.57] },
  { name: '臺南市', at: [23.10, 120.25] },
  { name: '高雄市', at: [22.70, 120.40] },
  { name: '屏東縣', at: [22.55, 120.62] },
  { name: '宜蘭縣', at: [24.60, 121.65] },
  { name: '花蓮縣', at: [23.75, 121.40] },
  { name: '臺東縣', at: [22.90, 121.10] },
  { name: '澎湖縣', at: [23.57, 119.60] },
  { name: '金門縣', at: [24.44, 118.37] },
  { name: '連江縣', at: [26.16, 119.95] },
];

/**
 * Countries the presets know, smallest first where rectangles overlap
 * (Switzerland before Germany, Portugal before Spain). ISO 3166 codes; the
 * Meteoalarm feed slug when it has one.
 */
export const COUNTRIES: { code: string; boxes: Box[]; meteoalarm?: string }[] = [
  { code: 'TW', boxes: [[21.8, 25.4, 119.3, 122.1], [24.3, 24.6, 118.1, 118.5], [25.9, 26.4, 119.8, 120.6]] },
  { code: 'US', boxes: [[24.4, 49.4, -125.0, -66.9], [51.2, 71.5, -180, -129.9], [18.9, 22.3, -160.3, -154.8], [17.6, 18.6, -67.3, -64.5], [13.2, 13.7, 144.6, 145.0]] },
  { code: 'CH', boxes: [[45.8, 47.8, 5.95, 10.5]], meteoalarm: 'switzerland' },
  { code: 'BE', boxes: [[49.5, 51.5, 2.55, 6.4]], meteoalarm: 'belgium' },
  { code: 'NL', boxes: [[50.75, 53.6, 3.3, 7.2]], meteoalarm: 'netherlands' },
  { code: 'AT', boxes: [[46.4, 49.0, 9.5, 17.2]], meteoalarm: 'austria' },
  { code: 'PT', boxes: [[36.9, 42.15, -9.6, -7.4], [32.4, 33.2, -17.3, -16.2], [36.9, 39.8, -31.3, -25.0]], meteoalarm: 'portugal' },
  { code: 'IE', boxes: [[51.4, 55.4, -10.6, -6.0]], meteoalarm: 'ireland' },
  { code: 'GB', boxes: [[49.9, 58.7, -8.2, 1.8]], meteoalarm: 'united-kingdom' },
  { code: 'ES', boxes: [[35.9, 43.8, -9.3, 3.35], [38.6, 40.1, 1.1, 4.4], [27.6, 29.5, -18.2, -13.3], [35.85, 35.92, -5.4, -5.27], [35.26, 35.32, -2.97, -2.92]], meteoalarm: 'spain' },
  { code: 'FR', boxes: [[42.3, 51.1, -4.8, 8.2], [41.3, 43.1, 8.5, 9.6]], meteoalarm: 'france' },
  { code: 'DE', boxes: [[47.3, 55.1, 5.9, 15.0]], meteoalarm: 'germany' },
  { code: 'IT', boxes: [[36.6, 47.1, 6.6, 18.6]], meteoalarm: 'italy' },
  { code: 'JP', boxes: [[24.0, 45.6, 122.9, 146.0]] },
];

/** The country a point is in, roughly, or undefined. */
export function countryOf(pt: readonly [number, number] | undefined): string | undefined {
  if (!pt) return undefined;
  return COUNTRIES.find((c) => c.boxes.some((b) => inBox(pt, b)))?.code;
}

/** The region of a language tag (`es-ES` → ES, `zh-Hant` → TW), as a hint when there is no place. */
export function countryOfLocale(locale: string): string | undefined {
  try {
    const l = new Intl.Locale(locale).maximize();
    if (l.language === 'zh' && l.script === 'Hant' && (!l.region || l.region === 'TW')) return 'TW';
    return l.region;
  } catch {
    return undefined;
  }
}
