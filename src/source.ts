/**
 * `hazards/alerts`: one source for every feed, push-based (`watch`), that
 * may run with no tile (`background`) for its full-screen alerts.
 */
import { createHttp, defineSource, locationOptions, placeOf, t, type Localized } from '@kiosko/sdk';
import { demoData } from './demo.ts';
import { Engine } from './engine.ts';
import { PRESETS, chosenFeeds } from './feeds.ts';
import { KINDS } from './model.ts';
import { alertsOf, type HazardsData } from './view.ts';

export const VERSION = '0.1.0';
export const AGENT = `kiosko-plugin-hazards/${VERSION} (+https://github.com/kiosko-lcd/kiosko-plugin-hazards)`;

type L6 = { en: string; es: string; de: string; 'zh-Hant': string; 'zh-Hans': string; ja: string };
const L = (en: string, es: string, de: string, hant: string, hans: string, ja: string): L6 => ({ en, es, de, 'zh-Hant': hant, 'zh-Hans': hans, ja });

export const KIND_LABELS: Record<string, L6> = {
  earthquake: L('Earthquakes', 'Terremotos', 'Erdbeben', '地震', '地震', '地震'),
  tsunami: L('Tsunamis', 'Tsunamis', 'Tsunamis', '海嘯', '海啸', '津波'),
  weather: L('Weather', 'Tiempo', 'Wetter', '天氣', '天气', '気象'),
  other: L('Other', 'Otros', 'Andere', '其他', '其他', 'その他'),
};

const LEVELS = ['info', 'warn', 'critical'] as const;
const levelLabels = { info: L('Info (blue)', 'Información (azul)', 'Info (blau)', '資訊（藍）', '信息（蓝）', '情報（青）'), warn: L('Warning (amber)', 'Aviso (ámbar)', 'Warnung (gelb)', '警告（琥珀）', '警告（琥珀）', '警告（黄）'), critical: L('Critical (red)', 'Crítico (rojo)', 'Kritisch (rot)', '緊急（紅）', '紧急（红）', '緊急（赤）') };

/** The SDK's place fields, with Japanese too. */
function placeFields() {
  const f = locationOptions();
  const add = (l: Localized | undefined, ja: string): Localized | undefined => (l && typeof l !== 'string' ? { ...l, ja } : l);
  f.latitude = { ...f.latitude, label: add(f.latitude.label, '緯度')!, help: add(f.latitude.help, '緯度と経度を 0 のままにすると、設定の場所を使います。')! };
  f.longitude = { ...f.longitude, label: add(f.longitude.label, '経度')! };
  f.placeName = { ...f.placeName, label: add(f.placeName.label, '地名')!, help: add(f.placeName.help, '空欄：設定の場所。')! };
  return f;
}

export const sourceOptions = t.object({
  feeds: t.filter({
    choices: { source: 'hazards/alerts', list: 'feeds' },
    label: L('Feeds', 'Fuentes', 'Feeds', '資料來源', '数据源', 'フィード'),
    help: L(
      'Empty: the ones for your place (US: NWS and tsunami.gov; Taiwan: NCDR; Spain: AEMET; elsewhere in Europe: Meteoalarm; everywhere: GDACS). Names or patterns, comma-separated; "!gdacs" leaves one out. "test" runs a drill once.',
      'Vacío: las de tu sitio (EE. UU.: NWS y tsunami.gov; Taiwán: NCDR; España: AEMET; resto de Europa: Meteoalarm; todo el mundo: GDACS). Nombres o patrones separados por comas; «!gdacs» quita una. «test» hace un simulacro una vez.',
      'Leer: die für deinen Ort (USA: NWS und tsunami.gov; Taiwan: NCDR; Spanien: AEMET; übriges Europa: Meteoalarm; überall: GDACS). Namen oder Muster, durch Kommas getrennt; „!gdacs“ lässt einen weg. „test“ startet einmal eine Probe.',
      '留空：依你的地點選擇（美國：NWS 與 tsunami.gov；臺灣：民生示警；西班牙：AEMET；歐洲其他地區：Meteoalarm；全球：GDACS）。名稱或模式以逗號分隔；「!gdacs」可排除一個。「test」執行一次演練。',
      '留空：按你的地点选择（美国：NWS 与 tsunami.gov；台湾：民生示警；西班牙：AEMET；欧洲其他地区：Meteoalarm；全球：GDACS）。名称或模式用逗号分隔；“!gdacs”可排除一个。“test”执行一次演练。',
      '空欄：場所に合わせて選びます（米国：NWS と tsunami.gov、台湾：NCDR、スペイン：AEMET、その他の欧州：Meteoalarm、全世界：GDACS）。名前やパターンをカンマ区切りで。「!gdacs」で除外。「test」で訓練を1回。',
    ),
  }),
  customFeeds: t.list(t.string({ format: 'url', risk: ['network', 'path'], placeholder: 'https://…/cap.xml' }), {
    max: 10,
    label: L('Your own CAP feeds', 'Tus feeds CAP', 'Eigene CAP-Feeds', '自訂 CAP 來源', '自定义 CAP 源', '独自の CAP フィード'),
    help: L(
      'Atom, RSS or a single CAP message of any alerting authority (the WMO register lists them: alertingauthority.wmo.int). A file:// path reads a CAP file of your own, for a drill. Read every 2 min.',
      'Atom, RSS o un mensaje CAP suelto de cualquier autoridad de avisos (el registro de la OMM las lista: alertingauthority.wmo.int). Una ruta file:// lee un CAP tuyo, para un simulacro. Se lee cada 2 min.',
      'Atom, RSS oder eine einzelne CAP-Nachricht einer Warnbehörde (das WMO-Register listet sie: alertingauthority.wmo.int). Ein file://-Pfad liest eine eigene CAP-Datei, für eine Probe. Alle 2 min gelesen.',
      '任何警報機關的 Atom、RSS 或單一 CAP 訊息（WMO 名錄：alertingauthority.wmo.int）。file:// 路徑可讀取你自己的 CAP 檔，用於演練。每 2 分鐘讀取一次。',
      '任何预警机构的 Atom、RSS 或单条 CAP 消息（WMO 名录：alertingauthority.wmo.int）。file:// 路径可读取你自己的 CAP 文件，用于演练。每 2 分钟读取一次。',
      '警報機関の Atom・RSS・CAP メッセージ（WMO の登録簿：alertingauthority.wmo.int）。file:// で自分の CAP ファイルを読み込み訓練に使えます。2分ごとに読み込み。',
    ),
  }),
  kinds: t.filter({
    default: ['earthquake', 'tsunami', 'weather'],
    choices: { source: 'hazards/alerts', list: 'kinds' },
    label: L('Kinds', 'Tipos', 'Arten', '類型', '类型', '種類'),
    help: L('earthquake, tsunami, weather, other.', 'earthquake (terremoto), tsunami, weather (tiempo), other (otros).', 'earthquake (Erdbeben), tsunami, weather (Wetter), other (andere).', 'earthquake（地震）、tsunami（海嘯）、weather（天氣）、other（其他）。', 'earthquake（地震）、tsunami（海啸）、weather（天气）、other（其他）。', 'earthquake（地震）、tsunami（津波）、weather（気象）、other（その他）。'),
  }),
  events: t.filter({
    choices: { source: 'hazards/alerts', list: 'events' },
    advanced: true,
    label: L('Events', 'Sucesos', 'Ereignisse', '事件', '事件', '事象'),
    help: L('Empty: all. By the authority\'s event name: "*Wind*", "!*Frost*".', 'Vacío: todos. Por el nombre del suceso de la autoridad: «*viento*», «!*helada*».', 'Leer: alle. Nach dem Ereignisnamen der Behörde: „*Wind*“, „!*Frost*“.', '留空：全部。依機關的事件名稱：「*強風*」、「!*低溫*」。', '留空：全部。按机构的事件名称：“*大风*”、“!*低温*”。', '空欄：すべて。機関の事象名で：「*Wind*」「!*Frost*」。'),
  }),
  zones: t.filter({
    choices: { source: 'hazards/alerts', list: 'zones' },
    label: L('Your zones', 'Tus zonas', 'Deine Gebiete', '你的地區', '你的地区', 'あなたの地域'),
    help: L(
      'For warnings that come with a zone code and no shape (Meteoalarm, US tsunami zones): codes or names as the feeds write them ("ES239", "CAZ043", "桃園市*"). A warning with a shape is placed by it.',
      'Para avisos que llegan con un código de zona y sin forma (Meteoalarm, zonas de tsunami de EE. UU.): códigos o nombres como los escriben los feeds («ES239», «CAZ043», «桃園市*»). Un aviso con forma se sitúa por ella.',
      'Für Warnungen mit Gebietscode und ohne Umriss (Meteoalarm, US-Tsunamizonen): Codes oder Namen wie in den Feeds („DE…“, „CAZ043“, „桃園市*“). Eine Warnung mit Umriss wird danach verortet.',
      '適用於只有地區代碼、沒有範圍的警報（Meteoalarm、美國海嘯區）：依來源寫法填代碼或名稱（「CAZ043」、「桃園市*」）。有範圍的警報依範圍判斷。',
      '适用于只有地区代码、没有范围的预警（Meteoalarm、美国海啸区）：按来源写法填代码或名称（“CAZ043”、“桃園市*”）。有范围的预警按范围判断。',
      'ゾーンコードだけで形のない警報（Meteoalarm、米国の津波ゾーン）用：フィードの表記どおりのコードや名前（「CAZ043」「桃園市*」）。形のある警報はその形で判定します。',
    ),
  }),
  marginKm: t.integer({ default: 0, min: 0, max: 100, unit: 'km', label: L('Margin', 'Margen', 'Rand', '邊界範圍', '边界范围', '余裕'), help: L('Also warnings for areas this close to your place (if you live at the edge of one).', 'También los avisos de zonas a esta distancia de tu sitio (si vives en el borde de una).', 'Auch Warnungen für Gebiete so nah an deinem Ort (wenn du am Rand eines Gebiets wohnst).', '也包含距離你的地點這麼近的地區警報（住在邊界時）。', '也包括距离你的地点这么近的地区预警（住在边界时）。', 'この距離以内の地域の警報も含めます（境界付近にお住まいの場合）。') }),
  radiusKm: t.integer({ default: 300, min: 10, max: 3000, unit: 'km', label: L('Earthquakes within', 'Terremotos a menos de', 'Erdbeben im Umkreis von', '地震範圍', '地震范围', '地震の範囲'), help: L('Earthquake reports nearer than this, and at least the magnitude below, take the screen.', 'Los informes de terremoto a menos de esta distancia y con al menos la magnitud de abajo salen a pantalla completa.', 'Erdbebenberichte näher als dies und mindestens mit der Magnitude unten erscheinen bildschirmfüllend.', '比這個距離近、且達到下方規模的地震報告會全螢幕顯示。', '比这个距离近、且达到下方震级的地震报告会全屏显示。', 'この距離より近く、下の規模以上の地震情報が全画面に出ます。') }),
  minMagnitude: t.number({ default: 4, min: 0, max: 10, step: 0.1, label: L('Least magnitude', 'Magnitud mínima', 'Mindestmagnitude', '最小規模', '最小震级', '最小マグニチュード') }),
  maxQuakeLevel: t.enum(LEVELS, { default: 'warn', labels: levelLabels, label: L('Earthquake reports at most', 'Informes de terremoto como mucho', 'Erdbebenberichte höchstens', '地震報告最高等級', '地震报告最高级别', '地震情報の最高レベル'), help: L('A report says what already happened; critical would wake the panel in quiet hours.', 'Un informe cuenta lo que ya ha pasado; crítico despertaría el panel en las horas de silencio.', 'Ein Bericht sagt, was schon geschehen ist; kritisch würde das Panel in den Ruhezeiten wecken.', '報告說的是已經發生的事；緊急等級會在安靜時段喚醒面板。', '报告说的是已经发生的事；紧急级别会在安静时段唤醒面板。', '情報はすでに起きたことです。緊急にすると静かな時間帯にもパネルが点きます。') }),
  maxWeatherLevel: t.enum(LEVELS, { default: 'warn', labels: levelLabels, label: L('Red and severe weather warnings', 'Avisos rojos y graves de tiempo', 'Rote und schwere Wetterwarnungen', '紅色及嚴重天氣警報', '红色及严重天气预警', '赤色・重大な気象警報'), help: L('Critical makes a red warning (AEMET, Meteoalarm, CWA) or an imminent Severe one cross quiet hours.', 'Crítico hace que un aviso rojo (AEMET, Meteoalarm, CWA) o uno grave inminente cruce las horas de silencio.', 'Kritisch lässt eine rote Warnung (AEMET, Meteoalarm, CWA) oder eine unmittelbare schwere die Ruhezeiten durchbrechen.', '選緊急時，紅色警報（AEMET、Meteoalarm、氣象署）或即將發生的嚴重警報會穿過安靜時段。', '选紧急时，红色预警（AEMET、Meteoalarm、气象署）或即将发生的严重预警会穿过安静时段。', '緊急にすると、赤色警報（AEMET、Meteoalarm、CWA）や差し迫った重大警報が静かな時間帯にも出ます。') }),
  includeTests: t.boolean({ label: L('Include tests and exercises', 'Incluir pruebas y simulacros', 'Tests und Übungen einbeziehen', '包含測試與演習', '包含测试与演习', 'テストと訓練を含める'), help: L('Shown as info with TEST or EXERCISE in front, never as real.', 'Salen como información con PRUEBA o SIMULACRO delante, nunca como reales.', 'Als Info mit TEST oder ÜBUNG davor, nie als echt.', '以資訊等級顯示，前面加上「測試」或「演習」，絕不當作真實警報。', '以信息级别显示，前面加上“测试”或“演习”，绝不当作真实预警。', '情報として先頭に「テスト」「訓練」を付けて表示し、本物としては扱いません。') }),
  staleMs: t.duration({ default: 15 * 60_000, min: 60_000, label: L('No data after', 'Sin datos pasado', 'Keine Daten nach', '無資料時間', '无数据时间', 'データなしと見なす時間'), help: L('A feed that hasn\'t answered for this long is shown as down in the tile (never full-screen).', 'Un feed que no responde en este tiempo sale como caído en la tesela (nunca a pantalla completa).', 'Ein Feed, der so lange nicht antwortet, erscheint in der Kachel als ausgefallen (nie bildschirmfüllend).', '超過這段時間沒有回應的來源，會在圖塊中標示為中斷（不會全螢幕）。', '超过这段时间没有响应的源，会在图块中标示为中断（不会全屏）。', 'この時間応答のないフィードはタイルで停止中と表示します（全画面にはしません）。') }),
  ...placeFields(),
});

/** Every value as text, so the drill knows whether it already ran for this choice. */
const keyOf = (o: unknown) => JSON.stringify(o, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

export const alerts = defineSource<typeof sourceOptions, HazardsData>({
  id: 'alerts',
  name: L('Official warnings', 'Avisos oficiales', 'Amtliche Warnungen', '官方警特報', '官方预警', '公式の警報'),
  description: L(
    'Official warnings published by NWS, tsunami.gov, CWA (via NCDR), AEMET, Meteoalarm and GDACS, filtered to your place. Informational: they may arrive minutes late and do not replace official alerts (your phone, radio and TV).',
    'Avisos oficiales publicados por NWS, tsunami.gov, la CWA (vía NCDR), AEMET, Meteoalarm y GDACS, filtrados para tu sitio. Informativo: pueden llegar minutos después y no sustituyen a los avisos oficiales (ES-Alert, el móvil, radio y TV).',
    'Amtliche Warnungen von NWS, tsunami.gov, CWA (über NCDR), AEMET, Meteoalarm und GDACS, gefiltert für deinen Ort. Zur Information: Sie können Minuten später ankommen und ersetzen keine amtlichen Warnungen (Handy, Radio, Fernsehen).',
    'NWS、tsunami.gov、中央氣象署（經民生示警）、AEMET、Meteoalarm 與 GDACS 發布的官方警特報，依你的地點篩選。僅供參考：可能晚幾分鐘才到，不能取代官方警報（手機、廣播與電視）。',
    'NWS、tsunami.gov、台湾气象署（经 NCDR）、AEMET、Meteoalarm 与 GDACS 发布的官方预警，按你的地点筛选。仅供参考：可能晚几分钟才到，不能替代官方预警（手机、广播与电视）。',
    'NWS、tsunami.gov、CWA（NCDR経由）、AEMET、Meteoalarm、GDACS が発表した公式の警報を、あなたの場所で絞り込みます。参考情報：数分遅れることがあり、公式の警報（携帯電話・ラジオ・テレビ）の代わりにはなりません。',
  ),
  options: sourceOptions,
  background: true,
  watch(ctx, emit) {
    const o = ctx.options;
    const place = placeOf(o, ctx.location);
    const point: [number, number] | undefined = place ? [place.latitude, place.longitude] : undefined;
    const http = createHttp({ agent: AGENT });
    const engine = new Engine({
      options: {
        feeds: chosenFeeds(o.feeds, point, ctx.locale),
        customFeeds: o.customFeeds,
        view: { kinds: o.kinds, events: o.events, radiusKm: o.radiusKm, minMagnitude: o.minMagnitude, maxQuakeLevel: o.maxQuakeLevel, maxWeatherLevel: o.maxWeatherLevel, includeTests: o.includeTests },
        zones: o.zones,
        marginKm: o.marginKm,
        staleMs: o.staleMs,
      },
      optionsKey: keyOf({ o, point }),
      ...(point ? { point } : {}),
      ...(place?.name ? { place: place.name } : {}),
      hour12: ctx.fmt.hour12,
      dataDir: ctx.dataDir,
      fetcher: { text: async (url, req) => (await http.text(url, req)).data },
      log: ctx.log,
      emit,
    });
    engine.start();
    return () => engine.stop();
  },
  alerts: ({ data, now }) => alertsOf(data, now),
  choices: {
    feeds: (_data, { t: tr }) => PRESETS.map((p) => ({ value: p.id, label: tr(p.name), group: p.country ?? 'World' })),
    kinds: (_data, { t: tr }) => KINDS.map((k) => ({ value: k, label: tr(KIND_LABELS[k]!) })),
    zones: (data) => data?.zones ?? [],
    events: (data) => (data?.events ?? []).map((e) => ({ value: e })),
  },
  demo: ({ now, locale }) => demoData(now, locale),
});

export type { HazardsData };
