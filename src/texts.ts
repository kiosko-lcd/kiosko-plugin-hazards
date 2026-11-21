/**
 * The plugin's own words. The warnings' texts are not here and are never
 * translated: they go as the authority wrote them (study §4.10).
 */
import type { Localized } from '@kiosko/sdk';

type L = { en: string; es: string; de: string; 'zh-Hant': string; 'zh-Hans': string; ja: string };

export const TX = {
  test: { en: 'TEST', es: 'PRUEBA', de: 'TEST', 'zh-Hant': '測試', 'zh-Hans': '测试', ja: 'テスト' },
  exercise: { en: 'EXERCISE', es: 'SIMULACRO', de: 'ÜBUNG', 'zh-Hant': '演習', 'zh-Hans': '演习', ja: '訓練' },
  ended: { en: 'Warning over', es: 'Fin del aviso', de: 'Warnung aufgehoben', 'zh-Hant': '警報解除', 'zh-Hans': '警报解除', ja: '警報解除' },
  tsunamiWarning: { en: 'Tsunami warning', es: 'Aviso de tsunami', de: 'Tsunamiwarnung', 'zh-Hant': '海嘯警報', 'zh-Hans': '海啸警报', ja: '津波警報' },
  tsunamiAdvisory: { en: 'Tsunami advisory', es: 'Advertencia de tsunami', de: 'Tsunami-Hinweis', 'zh-Hant': '海嘯注意', 'zh-Hans': '海啸注意', ja: '津波注意報' },
  tsunamiWatch: { en: 'Tsunami watch', es: 'Vigilancia de tsunami', de: 'Tsunami-Vorwarnung', 'zh-Hant': '海嘯警戒', 'zh-Hans': '海啸警戒', ja: '津波の可能性' },
  tsunamiInfo: { en: 'Tsunami information: no threat', es: 'Información de tsunami: sin amenaza', de: 'Tsunami-Information: keine Gefahr', 'zh-Hant': '海嘯資訊：無威脅', 'zh-Hans': '海啸信息：无威胁', ja: '津波情報：津波の心配なし' },
  earthquake: { en: 'Earthquake', es: 'Terremoto', de: 'Erdbeben', 'zh-Hant': '地震', 'zh-Hans': '地震', ja: '地震' },
  noWarningsFor: { en: 'No warnings for {place}', es: 'Sin avisos para {place}', de: 'Keine Warnungen für {place}', 'zh-Hant': '{place}目前沒有警特報', 'zh-Hans': '{place}目前没有预警', ja: '{place}に警報・注意報はありません' },
  noWarnings: { en: 'No warnings for your area', es: 'Sin avisos para tu zona', de: 'Keine Warnungen für deine Gegend', 'zh-Hant': '你所在地區目前沒有警特報', 'zh-Hans': '你所在地区目前没有预警', ja: 'お住まいの地域に警報・注意報はありません' },
  noData: { en: 'No warnings data', es: 'Sin datos de avisos', de: 'Keine Warndaten', 'zh-Hant': '沒有警特報資料', 'zh-Hans': '没有预警数据', ja: '警報データがありません' },
  waiting: { en: 'Waiting for the first data…', es: 'Esperando los primeros datos…', de: 'Warte auf die ersten Daten…', 'zh-Hant': '等待第一筆資料…', 'zh-Hans': '等待第一批数据…', ja: '最初のデータを待っています…' },
  data: { en: 'Data: {feeds} · {ago}', es: 'Datos: {feeds} · {ago}', de: 'Daten: {feeds} · {ago}', 'zh-Hant': '資料：{feeds} · {ago}', 'zh-Hans': '数据：{feeds} · {ago}', ja: 'データ：{feeds} · {ago}' },
  staleSince: { en: '{feed}: no data since {time}', es: '{feed} sin datos desde {time}', de: '{feed}: keine Daten seit {time}', 'zh-Hant': '{feed} 自 {time} 起沒有資料', 'zh-Hans': '{feed} 自 {time} 起没有数据', ja: '{feed}：{time}以降データなし' },
  staleNever: { en: '{feed}: no data yet', es: '{feed} sin datos todavía', de: '{feed}: noch keine Daten', 'zh-Hant': '{feed} 尚無資料', 'zh-Hans': '{feed} 尚无数据', ja: '{feed}：まだデータなし' },
  unplaced: { en: '{n} more with no zone known: choose your zones', es: '{n} más sin zona conocida: elige tus zonas', de: '{n} weitere ohne bekanntes Gebiet: wähle deine Gebiete', 'zh-Hant': '另有 {n} 則無法判斷地區：請選擇你的地區', 'zh-Hans': '另有 {n} 条无法判断地区：请选择你的地区', ja: '地域不明が他に{n}件：地域を選んでください' },
  footer: { en: 'Informational · not a substitute for official warnings', es: 'Informativo · no sustituye a los avisos oficiales', de: 'Zur Information · ersetzt keine amtlichen Warnungen', 'zh-Hant': '僅供參考 · 不能取代官方警報', 'zh-Hans': '仅供参考 · 不能替代官方预警', ja: '参考情報 · 公式の警報の代わりにはなりません' },
  until: { en: 'Until {time}', es: 'Hasta {time}', de: 'Bis {time}', 'zh-Hant': '至 {time}', 'zh-Hans': '至 {time}', ja: '{time}まで' },
  from: { en: 'From {time}', es: 'Desde {time}', de: 'Ab {time}', 'zh-Hant': '{time} 起', 'zh-Hans': '{time} 起', ja: '{time}から' },
  away: { en: '{km} km {dir}', es: 'a {km} km al {dir}', de: '{km} km {dir}', 'zh-Hant': '{dir}方 {km} 公里', 'zh-Hans': '{dir}方 {km} 公里', ja: '{dir} {km} km' },
} satisfies Record<string, L>;

const DIRS: Record<keyof L, string[]> = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  es: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  de: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'],
  'zh-Hant': ['北', '東北', '東', '東南', '南', '西南', '西', '西北'],
  'zh-Hans': ['北', '东北', '东', '东南', '南', '西南', '西', '西北'],
  ja: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
};

/** "35 km SW" from a distance and a bearing, in every language. */
export function awayText(km: number, deg: number): Localized {
  const i = Math.round(((deg % 360) + 360) / 45) % 8;
  const out: Record<string, string> = {};
  for (const l of Object.keys(TX.away) as (keyof L)[]) out[l] = fill(TX.away[l], { km: String(Math.round(km)), dir: DIRS[l][i]! });
  return out as Localized;
}

/** `{name}` placeholders. */
export function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** A text of `TX` with its placeholders filled, in every language. */
export function say(text: L, vars: Record<string, string | ((lang: string) => string)> = {}): Localized {
  const out: Record<string, string> = {};
  for (const [l, s] of Object.entries(text)) out[l] = fill(s, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'function' ? v(l) : v])));
  return out as Localized;
}
