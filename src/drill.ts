/**
 * The drill (study §4.14): a CAP message bundled with the plugin, a tsunami
 * warning in the user's own area with `status` Test, read through the same
 * parser, area filter and levels as a real one. It shows as `critical` with
 * "TEST ·" in front, for 60 s, once each time the `test` feed is chosen.
 */
import { capEvents } from './cap.ts';
import type { HazardEvent } from './model.ts';
import { parseXml } from './xml.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const INFOS: [lang: string, event: string, headline: string, instruction: string][] = [
  ['en-US', 'Tsunami Warning', 'Tsunami warning drill', 'This is a test of Kiosko. No action is needed.'],
  ['es-ES', 'Aviso de tsunami', 'Simulacro de aviso de tsunami', 'Esto es una prueba de Kiosko. No hay que hacer nada.'],
  ['de-DE', 'Tsunamiwarnung', 'Probe einer Tsunamiwarnung', 'Dies ist ein Test von Kiosko. Es ist nichts zu tun.'],
  ['zh-TW', '海嘯警報', '海嘯警報演練', '這是 Kiosko 的測試，不需要採取任何行動。'],
  ['zh-CN', '海啸警报', '海啸警报演练', '这是 Kiosko 的测试，无需采取任何行动。'],
  ['ja-JP', '津波警報', '津波警報の訓練', 'これは Kiosko のテストです。何もする必要はありません。'],
];

/** The drill message as CAP 1.2 XML, sent at `now` and centred on `point`. */
export function drillXml(now: number, point: [number, number] = [0, 0], place = ''): string {
  const t = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '-00:00');
  const id = `kiosko-drill-${Math.floor(now / 1000)}`;
  const area = esc(place || `${point[0].toFixed(2)}, ${point[1].toFixed(2)}`);
  const infos = INFOS.map(
    ([lang, event, headline, instruction]) => `
  <info>
    <language>${lang}</language>
    <category>Geo</category>
    <event>${esc(event)}</event>
    <responseType>None</responseType>
    <urgency>Immediate</urgency>
    <severity>Extreme</severity>
    <certainty>Observed</certainty>
    <eventCode><valueName>TsunamiSystemCategory</valueName><value>Warning</value></eventCode>
    <expires>${t(now + 60_000)}</expires>
    <senderName>Kiosko</senderName>
    <headline>${esc(headline)}</headline>
    <instruction>${esc(instruction)}</instruction>
    <area>
      <areaDesc>${area}</areaDesc>
      <circle>${point[0].toFixed(4)},${point[1].toFixed(4)} 10</circle>
    </area>
  </info>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${id}</identifier>
  <sender>drill@kiosko.invalid</sender>
  <sent>${t(now)}</sent>
  <status>Test</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>${infos}
</alert>
`;
}

/** The drill as events, through the real parser. */
export function drillEvents(now: number, point?: [number, number], place?: string): HazardEvent[] {
  return capEvents(parseXml(drillXml(now, point, place)), 'test');
}
