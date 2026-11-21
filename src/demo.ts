/**
 * Sample data for the gallery, the editor and the tests (study §4.14): an
 * orange weather warning, an M4.3 earthquake report from 12 minutes ago and
 * a feed that is down, in the preview's language. No network, no alerts
 * (Kiosko asks none in demo mode).
 */
import type { Localized } from '@kiosko/sdk';
import { awayText } from './texts.ts';
import type { HazardsData, Item } from './view.ts';

interface Scene {
  place: string;
  weather: { title: Localized; area?: Localized; source: Localized; icon: string };
  quake: { place: string };
  feeds: [ok: Localized, down: Localized];
}

const SCENES: Record<string, Scene> = {
  es: {
    place: 'Valencia',
    weather: { title: 'Aviso de lluvias de nivel naranja. Litoral sur de Valencia', source: 'AEMET', icon: 'droplet' },
    quake: { place: 'Golfo de Valencia' },
    feeds: ['AEMET', 'GDACS'],
  },
  'zh-Hant': {
    place: '臺北市',
    weather: { title: '豪雨特報(橙色燈號)', area: '臺北市信義區, 新北市汐止區 +6', source: '中央氣象署', icon: 'droplet' },
    quake: { place: '花蓮縣近海' },
    feeds: ['民生示警', 'GDACS'],
  },
  'zh-Hans': {
    place: '臺北市',
    weather: { title: '豪雨特報(橙色燈號)', area: '臺北市信義區, 新北市汐止區 +6', source: '中央氣象署', icon: 'droplet' },
    quake: { place: '花蓮縣近海' },
    feeds: ['民生示警', 'GDACS'],
  },
  de: {
    place: 'Hamburg',
    weather: { title: 'Amtliche Warnung vor Sturmböen · Hamburg', source: 'Meteoalarm', icon: 'wind' },
    quake: { place: 'North Sea' },
    feeds: ['Meteoalarm', 'GDACS'],
  },
  en: {
    place: 'Seattle',
    weather: { title: 'Wind Advisory · Seattle and Vicinity', source: 'NWS', icon: 'wind' },
    quake: { place: 'Puget Sound region' },
    feeds: ['NWS', 'PTWC'],
  },
};

export function demoData(now: number, locale: string): HazardsData {
  const lang = Object.keys(SCENES).find((k) => locale === k || locale.startsWith(`${k}-`)) ?? (locale.startsWith('zh') ? 'zh-Hans' : locale.startsWith('ja') ? 'en' : 'en');
  const s = SCENES[lang]!;
  const weather: Item = {
    id: 'demo-weather:warn',
    root: 'demo-weather',
    feed: 'demo',
    kind: 'weather',
    level: 'warn',
    maxLevel: 'warn',
    source: s.weather.source,
    title: s.weather.title,
    ...(s.weather.area ? { area: s.weather.area } : {}),
    sent: now - 3 * 3600_000,
    onset: now - 3600_000,
    expires: now + 8 * 3600_000,
    icon: s.weather.icon,
  };
  const quake: Item = {
    id: 'demo-quake:warn',
    root: 'demo-quake',
    feed: 'demo',
    kind: 'earthquake',
    level: 'warn',
    maxLevel: 'warn',
    source: 'GDACS',
    title: { en: 'Earthquake M4.3', es: 'Terremoto M4.3', de: 'Erdbeben M4.3', 'zh-Hant': '地震 M4.3', 'zh-Hans': '地震 M4.3', ja: '地震 M4.3' },
    area: awayText(35, 225),
    place: s.quake.place,
    sent: now - 9 * 60_000,
    eventTime: now - 12 * 60_000,
    expires: now + 18 * 60_000,
    magnitude: 4.3,
    icon: 'activity',
  };
  return {
    items: [weather, quake],
    feeds: [
      { id: 'a', source: s.feeds[0], lastOk: now - 60_000, since: now - 86_400_000 },
      { id: 'b', source: s.feeds[1], lastOk: now - 52 * 60_000, lastError: 'HTTP 503', since: now - 86_400_000 },
    ],
    place: s.place,
    unplaced: 0,
    staleMs: 15 * 60_000,
    hour12: false,
    zones: [],
    events: [],
    updated: now,
  };
}
