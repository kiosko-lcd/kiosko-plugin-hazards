import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { capTime, nwsEvents, parseCapDocument, parseDocument, parseReferences } from './cap.ts';
import { pick } from './model.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('CAP dates with their offset, -00:00 included', () => {
  assert.equal(capTime('2026-11-21T04:32:57-00:00'), Date.UTC(2026, 10, 21, 4, 32, 57));
  assert.equal(capTime('2026-11-21T16:35:08+08:00'), Date.UTC(2026, 10, 21, 8, 35, 8));
  assert.equal(capTime('soon'), undefined);
});

test('tsunami.gov (NTWC): a Tsunami Information Statement, signed, read as a "no threat" bulletin', () => {
  const [e, ...rest] = parseCapDocument(fixture('tsunami-ntwc-info.xml'), 'tsunami-ntwc');
  assert.equal(rest.length, 0);
  assert.equal(e!.key, 'ntwc@noaa.gov|PAAQ-1-tou4gr');
  assert.equal(e!.kind, 'tsunami');
  assert.equal(e!.tsunami, 'information');
  assert.equal(e!.status, 'Actual');
  assert.equal(e!.severity, 'Minor');
  assert.equal(e!.magnitude, 4);
  assert.deepEqual(e!.epicenter, [60.312, -147.791]);
  assert.equal(e!.place, '55 miles NE of Seward, Alaska');
  assert.equal(e!.eventTime, Date.UTC(2026, 10, 21, 4, 29, 15));
  assert.equal(e!.expires, Date.UTC(2026, 10, 21, 5, 32, 57));
  assert.deepEqual(e!.areas[0]!.circles, [{ c: [60.312, -147.791], km: 0 }]);
  const [p] = parseCapDocument(fixture('tsunami-ptwc-info.xml'), 'tsunami-ptwc');
  assert.equal(p!.tsunami, 'information');
  assert.equal(p!.place, 'CENTRAL PERU');
});

test('tsunami.gov sample Warning: one message, three <info> (Warning, Advisory, Watch) as three events with UGC zones', () => {
  const evs = parseCapDocument(fixture('tsunami-warning-sample.xml'), 'tsunami-ntwc');
  assert.deepEqual(evs.map((e) => [e.key, e.tsunami, e.severity]), [
    ['ntwc@noaa.gov|PAAQ-2-maiqdx', 'warning', 'Extreme'],
    ['ntwc@noaa.gov|PAAQ-2-maiqdx#1', 'advisory', 'Moderate'],
    ['ntwc@noaa.gov|PAAQ-2-maiqdx#2', 'watch', 'Moderate'],
  ]);
  const w = evs[0]!;
  assert.equal(w.msgType, 'Update');
  assert.equal(w.references.length, 1);
  assert.match(w.references[0]!.key, /^ntwc@noaa\.gov\|PAAQ-1-/);
  assert.equal(evs[1]!.references[0]!.key.endsWith('#1'), true, 'each group continues its own group');
  assert.equal(w.magnitude, 8.4);
  assert.ok(w.areas[0]!.geocodes.UGC!.includes('CAZ043'));
  assert.match(pick(w.instruction, 'en'), /^Recommended Actions/);
});

test('AEMET CAP 1.2: Spanish and English <info> become one localized event, with its polygon, zone and colour', () => {
  const [e] = parseCapDocument(fixture('aemet-cap.xml'), 'aemet');
  assert.equal(e!.kind, 'weather');
  assert.equal(e!.colour, 'yellow');
  assert.deepEqual(e!.event, { es: 'Aviso de vientos de nivel amarillo', en: 'Moderate wind warning' });
  assert.equal(pick(e!.headline, 'es'), 'Aviso de vientos de nivel amarillo. Litoral norte de Alicante');
  assert.equal(pick(e!.headline, 'de'), 'Moderate wind warning. Litoral norte de Alicante', 'English when there is no German');
  assert.equal(e!.areas.length, 1);
  assert.equal(e!.areas[0]!.polygons[0]!.length, 33, 'closed: the first pair again at the end');
  assert.deepEqual(e!.areas[0]!.geocodes, { 'AEMET-Meteoalerta zona': ['770301'] });
  assert.equal(e!.onset, Date.UTC(2026, 10, 22, 2, 0, 0));
});

test('CWA via NCDR: zh-TW text kept as Traditional Chinese, geocode-only areas, 17 references', () => {
  const [e] = parseCapDocument(fixture('ncdr-wind.cap'), 'ncdr');
  assert.equal(e!.sender, 'weather@cwa.gov.tw');
  assert.equal(e!.msgType, 'Update');
  assert.equal(e!.references.length, 17);
  assert.equal(e!.event, '強風');
  assert.equal(pick(e!.headline, 'zh-Hant'), '陸上強風特報(黃色燈號)');
  assert.equal(pick(e!.headline, 'zh-Hans'), '陸上強風特報(黃色燈號)', 'the authority\'s text, untranslated');
  assert.equal(e!.colour, 'yellow');
  assert.equal(e!.areas.length, 25);
  assert.deepEqual(e!.areas[0], { desc: '桃園市蘆竹區', polygons: [], circles: [], geocodes: { Taiwan_Geocode_103: ['6800500'] } });
  const [cold] = parseCapDocument(fixture('ncdr-cold.cap'), 'ncdr');
  assert.equal(cold!.event, '低溫');
  assert.equal(cold!.kind, 'weather');
});

test('CAP 1.1 (namespace and all) reads the same', () => {
  const xml = `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.1">
  <identifier>S-1</identifier><sender>alerts@example.org</sender><sent>2026-11-21T10:00:00-06:00</sent>
  <status>Exercise</status><msgType>Alert</msgType><scope>Public</scope>
  <info><language>es-MX</language><category>Geo</category><event>Sismo</event><urgency>Immediate</urgency>
    <severity>Severe</severity><certainty>Observed</certainty>
    <eventCode><valueName>SAME</valueName><value>EQW</value></eventCode>
    <area><areaDesc>Ciudad de México</areaDesc><circle>19.43,-99.13 50</circle></area></info>
</alert>`;
  const [e] = parseCapDocument(xml, 'cap:x');
  assert.equal(e!.status, 'Exercise');
  assert.equal(e!.kind, 'earthquake');
  assert.equal(e!.event, 'Sismo');
  assert.deepEqual(e!.areas[0]!.circles, [{ c: [19.43, -99.13], km: 50 }]);
});

test('references: sender,identifier,sent triplets', () => {
  assert.deepEqual(parseReferences('a@b,ID-1,2026-11-21T00:00:00-00:00 a@b,ID-2,2026-11-21T01:00:00-00:00'), [
    { key: 'a@b|ID-1', sent: Date.UTC(2026, 10, 21) },
    { key: 'a@b|ID-2', sent: Date.UTC(2026, 10, 21, 1) },
  ]);
});

test('NCDR Atom index: entries with their .cap links (dates in the index are local text and ignored)', () => {
  const d = parseDocument(fixture('ncdr-index.xml'), 'ncdr');
  assert.equal(d.kind, 'index');
  if (d.kind !== 'index') return;
  assert.deepEqual(d.entries.map((e) => e.capUrl), [
    'https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/coldSurge/fifows_cold-surge_202611211634.cap',
    'https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/Weather_warnings_WIND/fifows_strong-wind_202611211635.cap',
  ]);
  assert.equal(d.entries[0]!.summary!.msgType, 'Update');
});

test('AEMET RSS: items link to their CAP files, whose names carry the zone', () => {
  const d = parseDocument(fixture('aemet-rss.xml'), 'aemet');
  if (d.kind !== 'index') return assert.fail('an index');
  assert.equal(d.entries.length, 6);
  assert.match(d.entries[0]!.capUrl!, /AFAZ770301VIRM2211\.xml$/);
});

test('Meteoalarm Atom: cap: fields give a summary with the EMMA_ID zone and the colour from the title', () => {
  const d = parseDocument(fixture('meteoalarm-spain.xml'), 'meteoalarm-spain');
  if (d.kind !== 'index') return assert.fail('an index');
  const s = d.entries.find((e) => e.summary?.areas[0]!.geocodes.EMMA_ID?.[0] === 'ES239')!;
  assert.equal(s.summary!.event, 'Moderate wind warning');
  assert.equal(s.summary!.colour, 'yellow');
  assert.equal(s.summary!.kind, 'weather');
  assert.match(s.capUrl!, /^https:\/\/feeds\.meteoalarm\.org\/api\/v1\/warnings\/feeds-spain\//);
  const [full] = parseCapDocument(fixture('meteoalarm-cap.xml'), 'meteoalarm-spain');
  assert.equal(full!.colour, 'yellow');
  assert.deepEqual(full!.areas[0]!.geocodes, { EMMA_ID: ['ES239'] });
});

test('GDACS RSS: CAP carried in each item, with the item\'s point as epicentre; doubly escaped text cleaned', () => {
  const d = parseDocument(fixture('gdacs.xml'), 'gdacs');
  if (d.kind !== 'index') return assert.fail('an index');
  const [eq, dr, tc] = d.entries.map((e) => e.events![0]!);
  assert.equal(eq!.kind, 'earthquake');
  assert.equal(eq!.magnitude, 5.9);
  assert.deepEqual(eq!.epicenter, [37.1958, 96.6398]);
  assert.equal(eq!.colour, 'green');
  assert.equal(eq!.urgency, 'Past');
  assert.ok(!pick(eq!.headline, 'en').includes('&gt;'));
  assert.equal(dr!.kind, 'other');
  assert.equal(dr!.colour, 'orange');
  assert.equal(tc!.kind, 'weather');
});

test('tsunami.gov Atom: the entry links to the CAP message', () => {
  const d = parseDocument(fixture('tsunami-ntwc-atom.xml'), 'tsunami-ntwc');
  if (d.kind !== 'index') return assert.fail('an index');
  assert.match(d.entries[0]!.capUrl!, /PAAQCAP\.xml$/);
});

test('NWS GeoJSON: the same CAP fields, references as keys, filtered by the server', () => {
  const evs = nwsEvents(JSON.parse(fixture('nws-ak-active.json')), 'nws');
  assert.equal(evs.length, 3);
  const [upd, , watch] = evs;
  assert.equal(upd!.msgType, 'Update');
  assert.equal(upd!.references.length, 2);
  assert.match(upd!.references[0]!.key, /^w-nws\.webmaster@noaa\.gov\|urn:oid:/);
  assert.equal(upd!.serverFiltered, true);
  assert.equal(upd!.event, 'Wind Advisory');
  assert.equal(watch!.severity, 'Severe');
  assert.equal(watch!.urgency, 'Future');
  assert.deepEqual(upd!.areas[0]!.geocodes.UGC, ['AKZ849']);
});

test('NWS GeoJSON: a Tsunami Warning is a tsunami warning; polygons come as [lat, lon]', () => {
  const [e] = nwsEvents(JSON.parse(fixture('nws-tsunami-warning.json')), 'nws');
  assert.equal(e!.kind, 'tsunami');
  assert.equal(e!.tsunami, 'warning');
  assert.deepEqual(e!.areas[0]!.polygons[0]![0], [46.27, -124.08]);
});

test('anything else is refused', () => {
  assert.throws(() => parseDocument('<html><body/></html>', 'x'), /not CAP, Atom or RSS/);
  assert.throws(() => parseCapDocument('<feed/>', 'x'), /not a CAP message/);
  assert.throws(() => nwsEvents({ type: 'nope' }, 'nws'), /not an NWS/);
});
