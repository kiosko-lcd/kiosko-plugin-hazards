/**
 * kiosko-plugin-hazards: official warnings (tsunamis, severe weather) and
 * earthquake reports from CAP feeds, as Kiosko full-screen alerts on every
 * panel, and a tile with the latest ones.
 *
 * Informational. The data can arrive minutes late and does not replace the
 * official alerts (the phone's, radio and TV). See README.md.
 */
import { definePlugin } from '@kiosko/sdk';
import { alerts, VERSION } from './source.ts';
import { latest } from './widget.ts';
import { LANGS } from './model.ts';

export default definePlugin({
  id: 'hazards',
  name: { en: 'Hazard alerts', es: 'Avisos y terremotos', de: 'Warnungen und Erdbeben', 'zh-Hant': '災害示警', 'zh-Hans': '灾害预警', ja: '災害情報' },
  version: VERSION,
  description: {
    en: 'Official warnings published by NWS, tsunami.gov, CWA, AEMET, Meteoalarm and GDACS, on your panels. Informational: they may arrive minutes late; not a substitute for official alerts.',
    es: 'Avisos oficiales publicados por NWS, tsunami.gov, la CWA, AEMET, Meteoalarm y GDACS, en tus paneles. Informativo: pueden llegar minutos después; no sustituye a los avisos oficiales.',
    de: 'Amtliche Warnungen von NWS, tsunami.gov, CWA, AEMET, Meteoalarm und GDACS auf deinen Panels. Zur Information: Sie können Minuten später ankommen; kein Ersatz für amtliche Warnungen.',
    'zh-Hant': '在你的面板上顯示 NWS、tsunami.gov、中央氣象署、AEMET、Meteoalarm 與 GDACS 發布的官方警特報。僅供參考：可能晚幾分鐘才到，不能取代官方警報。',
    'zh-Hans': '在你的副屏上显示 NWS、tsunami.gov、台湾地区气象部门、AEMET、Meteoalarm 与 GDACS 发布的官方预警。仅供参考：可能晚几分钟才到，不能替代官方预警。',
    ja: 'NWS、tsunami.gov、CWA、AEMET、Meteoalarm、GDACS が発表した公式の警報をパネルに表示します。参考情報：数分遅れることがあり、公式の警報の代わりにはなりません。',
  },
  author: 'Loksly',
  homepage: 'https://github.com/kiosko-lcd/kiosko-plugin-hazards#readme',
  repository: 'https://github.com/kiosko-lcd/kiosko-plugin-hazards',
  license: 'MIT',
  icon: 'siren',
  sdk: '^0.2.0',
  permissions: {
    network: ['api.weather.gov', 'www.tsunami.gov', 'alerts.ncdr.nat.gov.tw', 'www.aemet.es', 'feeds.meteoalarm.org', 'www.gdacs.org', 'user'],
    files: ['user'],
  },
  languages: [...LANGS],
  sources: [alerts],
  widgets: [latest],
});
