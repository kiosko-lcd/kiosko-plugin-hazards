/**
 * The feeds the plugin knows (presets), with each provider's interval and
 * terms (study §3, §4.3), and which ones a place gets by default.
 */
import { filterPatterns, matchFilter, type Localized } from '@kiosko/sdk';
import { COUNTRIES, countryOf, countryOfLocale } from './tables.ts';

export interface Preset {
  id: string;
  /** Who publishes it, as the alert and the tile name it: "NWS", "AEMET", "中央氣象署". */
  source: Localized;
  /** In the editor's list. */
  name: Localized;
  /** The country it covers (ISO 3166), or none for worldwide ones. */
  country?: string;
  /** What to fetch; `null` when it can't run for this place (the NWS needs a point in the US). */
  url: (pt: [number, number] | undefined) => string | null;
  intervalMs: number;
  /** `active`: it lists every warning in force, so one that is gone is over. `latest`: only the last message. */
  mode: 'active' | 'latest';
  format: 'xml' | 'nws';
  /** Least time between two requests to its host (NCDR answers 429 under 3 s). */
  gapMs: number;
  /** The CAP messages its index links to are fetched (with `gapMs` between them). */
  fetchCaps?: 'all' | 'zones' | 'aemet';
}

const MIN = 60_000;

export const PRESETS: Preset[] = [
  {
    id: 'nws',
    source: 'NWS',
    name: { en: 'NWS: US weather and tsunami warnings for your point', es: 'NWS: avisos de tiempo y tsunami de EE. UU. para tu punto', de: 'NWS: Wetter- und Tsunamiwarnungen der USA für deinen Ort', 'zh-Hant': 'NWS：美國天氣與海嘯警報（依你的位置）', 'zh-Hans': 'NWS：美国天气与海啸预警（按你的位置）', ja: 'NWS：米国の気象・津波警報（現在地）' },
    country: 'US',
    url: (pt) => (pt && countryOf(pt) === 'US' ? `https://api.weather.gov/alerts/active?point=${pt[0].toFixed(4)},${pt[1].toFixed(4)}` : null),
    intervalMs: MIN,
    mode: 'active',
    format: 'nws',
    gapMs: 1000,
  },
  {
    id: 'tsunami-ntwc',
    source: 'NTWC',
    name: { en: 'tsunami.gov NTWC (Alaska): US and Canada coasts', es: 'tsunami.gov NTWC (Alaska): costas de EE. UU. y Canadá', de: 'tsunami.gov NTWC (Alaska): Küsten der USA und Kanadas', 'zh-Hant': 'tsunami.gov NTWC（阿拉斯加）：美加沿岸', 'zh-Hans': 'tsunami.gov NTWC（阿拉斯加）：美加沿岸', ja: 'tsunami.gov NTWC（アラスカ）：米国・カナダ沿岸' },
    country: 'US',
    url: () => 'https://www.tsunami.gov/events/xml/PAAQCAP.xml',
    intervalMs: MIN,
    mode: 'latest',
    format: 'xml',
    gapMs: 1000,
  },
  {
    id: 'tsunami-ptwc',
    source: 'PTWC',
    name: { en: 'tsunami.gov PTWC (Hawaii): Pacific and Caribbean', es: 'tsunami.gov PTWC (Hawái): Pacífico y Caribe', de: 'tsunami.gov PTWC (Hawaii): Pazifik und Karibik', 'zh-Hant': 'tsunami.gov PTWC（夏威夷）：太平洋與加勒比海', 'zh-Hans': 'tsunami.gov PTWC（夏威夷）：太平洋与加勒比海', ja: 'tsunami.gov PTWC（ハワイ）：太平洋・カリブ海' },
    country: 'US',
    url: () => 'https://www.tsunami.gov/events/xml/PHEBCAP.xml',
    intervalMs: MIN,
    mode: 'latest',
    format: 'xml',
    gapMs: 1000,
  },
  {
    id: 'ncdr',
    source: { en: 'CWA via NCDR', es: 'CWA vía NCDR', de: 'CWA über NCDR', 'zh-Hant': '民生示警', 'zh-Hans': '民生示警', ja: 'CWA（NCDR経由）' },
    name: { en: 'NCDR: Taiwan warnings (CWA and other agencies)', es: 'NCDR: avisos de Taiwán (CWA y otras agencias)', de: 'NCDR: Warnungen für Taiwan (CWA und andere Behörden)', 'zh-Hant': '民生示警（NCDR）：中央氣象署等機關的警特報', 'zh-Hans': '民生示警（NCDR）：台湾地区气象等部门发布的预警', ja: 'NCDR：台湾の警報（CWAほか）' },
    country: 'TW',
    url: () => 'https://alerts.ncdr.nat.gov.tw/RssAtomFeeds.ashx',
    intervalMs: MIN,
    mode: 'active',
    format: 'xml',
    gapMs: 3500,
    fetchCaps: 'all',
  },
  {
    id: 'aemet',
    source: 'AEMET',
    name: { en: 'AEMET: Spain weather warnings (Meteoalerta)', es: 'AEMET: avisos meteorológicos de España (Meteoalerta)', de: 'AEMET: Wetterwarnungen für Spanien (Meteoalerta)', 'zh-Hant': 'AEMET：西班牙天氣警報', 'zh-Hans': 'AEMET：西班牙天气预警', ja: 'AEMET：スペインの気象警報' },
    country: 'ES',
    url: () => 'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_wah_RSS.xml',
    intervalMs: 10 * MIN,
    mode: 'active',
    format: 'xml',
    gapMs: 1500,
    fetchCaps: 'aemet',
  },
  ...COUNTRIES.filter((c) => c.meteoalarm).map<Preset>((c) => ({
    id: `meteoalarm-${c.meteoalarm}`,
    source: 'Meteoalarm',
    name: { en: `Meteoalarm: ${c.code} weather warnings`, es: `Meteoalarm: avisos meteorológicos (${c.code})`, de: `Meteoalarm: Wetterwarnungen (${c.code})`, 'zh-Hant': `Meteoalarm：天氣警報（${c.code}）`, 'zh-Hans': `Meteoalarm：天气预警（${c.code}）`, ja: `Meteoalarm：気象警報（${c.code}）` },
    country: c.code,
    url: () => `https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${c.meteoalarm}`,
    intervalMs: 10 * MIN,
    mode: 'active',
    format: 'xml',
    gapMs: 1500,
    fetchCaps: 'zones',
  })),
  {
    id: 'gdacs',
    source: 'GDACS',
    name: { en: 'GDACS: earthquakes, cyclones and floods worldwide', es: 'GDACS: terremotos, ciclones e inundaciones en el mundo', de: 'GDACS: Erdbeben, Wirbelstürme und Überschwemmungen weltweit', 'zh-Hant': 'GDACS：全球地震、氣旋與洪水', 'zh-Hans': 'GDACS：全球地震、气旋与洪水', ja: 'GDACS：世界の地震・サイクロン・洪水' },
    url: () => 'https://www.gdacs.org/xml/gdacs_cap.xml',
    intervalMs: 15 * MIN,
    mode: 'active',
    format: 'xml',
    gapMs: 1000,
  },
  {
    id: 'test',
    source: { en: 'Kiosko drill', es: 'Simulacro de Kiosko', de: 'Kiosko-Probe', 'zh-Hant': 'Kiosko 演練', 'zh-Hans': 'Kiosko 演练', ja: 'Kiosko 訓練' },
    name: { en: 'Drill: a sample tsunami TEST in your area, once, for 60 s', es: 'Simulacro: una PRUEBA de tsunami en tu zona, una vez, 60 s', de: 'Probe: ein Tsunami-TEST in deiner Gegend, einmal, 60 s', 'zh-Hant': '演練：在你所在地區顯示一次海嘯「測試」，60 秒', 'zh-Hans': '演练：在你所在地区显示一次海啸“测试”，60 秒', ja: '訓練：お住まいの地域で津波の「テスト」を1回、60秒' },
    url: () => null,
    intervalMs: 0,
    mode: 'latest',
    format: 'xml',
    gapMs: 0,
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

/** A user's own CAP feed (Atom, RSS or one CAP message; `file://` for a drill of their own). */
export function customPreset(url: string): Preset {
  let host = url;
  try {
    host = new URL(url).host || 'file';
  } catch {
    /* kept whole */
  }
  return { id: `cap:${url}`, source: host, name: url, url: () => url, intervalMs: 2 * MIN, mode: 'active', format: 'xml', gapMs: 1000, fetchCaps: 'all' };
}

/** The presets a place gets with no choice of feeds (§3.2; the non-CAP feeds of F2 come later). */
export function defaultFeeds(pt: [number, number] | undefined, locale: string): string[] {
  const country = countryOf(pt) ?? (pt ? undefined : countryOfLocale(locale));
  switch (country) {
    case 'US':
      return ['nws', 'tsunami-ntwc', 'tsunami-ptwc'];
    case 'TW':
      return ['ncdr'];
    case 'ES':
      return ['aemet'];
    default: {
      const ma = COUNTRIES.find((c) => c.code === country)?.meteoalarm;
      return ma ? [`meteoalarm-${ma}`, 'gdacs'] : ['gdacs'];
    }
  }
}

/**
 * The feeds to read: the defaults when the user chose none (or only left
 * some out, `!gdacs`), else the presets their patterns name.
 */
export function chosenFeeds(patterns: readonly string[], pt: [number, number] | undefined, locale: string): string[] {
  const list = filterPatterns(patterns);
  const positive = list.filter((p) => !p.startsWith('!'));
  const base = positive.length ? PRESETS.map((p) => p.id).filter((id) => matchFilter(id, positive)) : defaultFeeds(pt, locale);
  const negative = list.filter((p) => p.startsWith('!'));
  return negative.length ? base.filter((id) => matchFilter(id, negative)) : base;
}
