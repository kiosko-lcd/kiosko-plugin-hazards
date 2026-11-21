/** The source's insides against stand-in feeds: queues per host, CAP fetching, AEMET zones, staleness, the drill. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Engine, type EngineOptions, type Fetcher } from './engine.ts';
import { chosenFeeds, defaultFeeds } from './feeds.ts';
import { pick } from './model.ts';
import { alertsOf, type HazardsData } from './view.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const T0 = Date.UTC(2026, 10, 21, 12);

function options(o: Partial<EngineOptions> = {}): EngineOptions {
  return {
    feeds: [],
    customFeeds: [],
    view: { kinds: ['earthquake', 'tsunami', 'weather'], events: [], radiusKm: 300, minMagnitude: 4, maxQuakeLevel: 'warn', maxWeatherLevel: 'warn', includeTests: false },
    zones: [],
    marginKm: 0,
    staleMs: 15 * 60_000,
    ...o,
  };
}

/** A fetcher that answers from a table of URL → body (or error), and logs when each request was made. */
function fake(table: Record<string, string | Error>): Fetcher & { calls: { url: string; at: number }[] } {
  const calls: { url: string; at: number }[] = [];
  return {
    calls,
    async text(url) {
      calls.push({ url, at: performance.now() });
      const v = table[url];
      if (v === undefined) throw new Error(`HTTP 404 from ${new URL(url).host}`);
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function engine(o: { options?: Partial<EngineOptions>; point?: [number, number]; place?: string; fetcher: Fetcher; dataDir?: string; now?: () => number; key?: string; gap?: number }) {
  let last: HazardsData | undefined;
  const e = new Engine({
    options: options(o.options),
    optionsKey: o.key ?? 'k',
    ...(o.point ? { point: o.point } : {}),
    ...(o.place ? { place: o.place } : {}),
    hour12: false,
    ...(o.dataDir ? { dataDir: o.dataDir } : {}),
    fetcher: o.fetcher,
    log: () => {},
    now: o.now ?? (() => T0),
    emit: (d) => (last = d),
    gapOf: (g) => g * (o.gap ?? 0),
  });
  return { e, last: () => last };
}

const NCDR = 'https://alerts.ncdr.nat.gov.tw/RssAtomFeeds.ashx';
const COLD = 'https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/coldSurge/fifows_cold-surge_202611211634.cap';
const WIND = 'https://alerts.ncdr.nat.gov.tw/Capstorage/CWA/2026/Weather_warnings_WIND/fifows_strong-wind_202611211635.cap';

test('NCDR: the index, then each .cap one at a time, at least the host\'s gap apart (3.5 s, here a tenth)', async () => {
  const f = fake({ [NCDR]: fixture('ncdr-index.xml'), [COLD]: fixture('ncdr-cold.cap'), [WIND]: fixture('ncdr-wind.cap') });
  const { e } = engine({ options: { feeds: ['ncdr'] }, point: [24.99, 121.30], place: '桃園市', fetcher: f, gap: 0.1 });
  await e.poll('ncdr');
  assert.deepEqual(f.calls.map((c) => c.url), [NCDR, COLD, WIND]);
  for (let i = 1; i < f.calls.length; i++) assert.ok(f.calls[i]!.at - f.calls[i - 1]!.at >= 340, `request ${i} waited its turn`);
  const d = e.snapshot();
  // Taoyuan: in the wind warning, not in the cold one (Hsinchu, Miaoli).
  assert.deepEqual(d.items.map((it) => pick(it.title, 'zh-Hant')), ['陸上強風特報(黃色燈號)']);
  assert.equal(d.items[0]!.level, 'info', 'yellow');
  assert.equal(pick(d.items[0]!.source, 'zh-Hant'), '民生示警');
  assert.ok(d.zones.some((z) => z.value === '6800500'), 'its town codes are offered as zones');
  // A second read fetches only the index: the .cap files are kept.
  f.calls.length = 0;
  await e.poll('ncdr');
  assert.deepEqual(f.calls.map((c) => c.url), [NCDR]);
  e.stop();
});

const RSS = 'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/rss/CAP_AFAE_wah_RSS.xml';

/** AEMET: every CAP of the trimmed RSS answers; only 770301 is the user's zone, the others are far away. */
function aemetTable(rss: string): Record<string, string> {
  const table: Record<string, string> = { [RSS]: rss };
  for (const m of rss.matchAll(/<link>([^<]+AFAZ(\d{6})[^<]+)<\/link>/g)) {
    const [, url, zone] = m;
    table[url!] = zone === '770301' ? fixture('aemet-cap.xml') : fixture('aemet-cap.xml').replaceAll('770301', zone!).replace(/<polygon>[^<]+<\/polygon>/g, '<polygon>43.0,-8.0 43.1,-8.0 43.1,-7.9 43.0,-8.0</polygon>');
  }
  return table;
}

test('AEMET: the first read learns every zone\'s shape; from then on only the user\'s zones are fetched, even after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazards-'));
  const rss = fixture('aemet-rss.xml');
  const f1 = fake(aemetTable(rss));
  const a = engine({ options: { feeds: ['aemet'] }, point: [38.82, 0.02], place: 'Ondara', fetcher: f1, dataDir: dir });
  await a.e.poll('aemet');
  assert.equal(f1.calls.length, 1 + 4, 'the index and one CAP file per zone (three items share a far zone: learnt from the first)');
  const d = a.e.snapshot();
  assert.deepEqual(d.items.map((it) => pick(it.title, 'es')), ['Aviso de vientos de nivel amarillo. Litoral norte de Alicante']);
  assert.deepEqual(alertsOf(d, T0).map((x) => [x.level, x.source]), [['info', 'AEMET']]);
  a.e.stop();

  // The next elaboration: same zones, new file names.
  const next = rss.replaceAll('20261121103633', '20261121160000').replaceAll('20261121102417', '20261121160000').replaceAll('20261120080138', '20261121160000');
  const f2 = fake(aemetTable(next));
  const b = engine({ options: { feeds: ['aemet'] }, point: [38.82, 0.02], fetcher: f2, dataDir: dir });
  await b.e.poll('aemet');
  assert.deepEqual(f2.calls.map((c) => c.url.replace(/.*AFAZ/, 'AFAZ')), [RSS.replace(/.*AFAZ/, 'AFAZ'), 'AFAZ770301VIRM2211.xml'], 'the index and the one zone that is the user\'s');
  b.e.stop();
});

test('a feed that fails is recorded, and after staleMs it is down; open warnings stay until they expire', async () => {
  let now = T0;
  const table: Record<string, string | Error> = { [NCDR]: fixture('ncdr-index.xml'), [COLD]: fixture('ncdr-cold.cap'), [WIND]: fixture('ncdr-wind.cap') };
  const { e } = engine({ options: { feeds: ['ncdr'] }, point: [24.99, 121.30], fetcher: fake(table), now: () => now });
  await e.poll('ncdr');
  table[NCDR] = new Error('HTTP 503 from alerts.ncdr.nat.gov.tw');
  now += 20 * 60_000;
  await assert.rejects(e.poll('ncdr'), /503/);
  const d = e.snapshot();
  assert.equal(d.feeds[0]!.lastError, 'HTTP 503 from alerts.ncdr.nat.gov.tw');
  assert.equal(d.feeds[0]!.lastOk, T0);
  assert.equal(d.items.length, 1, 'the wind warning stays');
  assert.equal(alertsOf(d, now).length, 1);
  e.stop();
});

test('the drill: a TEST tsunami warning in the user\'s area, critical, for 60 s, once per choice of options', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazards-'));
  let now = T0;
  const a = engine({ options: { feeds: ['test'] }, point: [40.42, -3.70], place: 'Madrid', fetcher: fake({}), dataDir: dir, now: () => now, key: 'with-test' });
  a.e.start();
  a.e.stop();
  const d = a.last()!;
  const [alert] = alertsOf(d, now);
  assert.equal(alert!.level, 'critical');
  assert.equal(pick(alert!.title, 'es'), 'PRUEBA · Aviso de tsunami · Madrid');
  assert.equal(pick(alert!.title, 'en'), 'TEST · Tsunami warning · Madrid');
  assert.equal(pick(alert!.detail, 'es'), 'Esto es una prueba de Kiosko. No hay que hacer nada.');
  assert.equal(alert!.icon, 'waves');
  assert.deepEqual(alertsOf(d, now + 61_000), [], 'over after 60 s');
  // Kiosko restarts with the same options: no second drill.
  now += 5 * 60_000;
  const b = engine({ options: { feeds: ['test'] }, point: [40.42, -3.70], place: 'Madrid', fetcher: fake({}), dataDir: dir, now: () => now, key: 'with-test' });
  b.e.start();
  b.e.stop();
  assert.deepEqual(alertsOf(b.last()!, now), []);
  // Taken out and put back: it runs again.
  const c = engine({ options: { feeds: ['gdacs'] }, fetcher: fake({}), dataDir: dir, now: () => now, key: 'without' });
  c.e.start();
  c.e.stop();
  const d2 = engine({ options: { feeds: ['test'] }, point: [40.42, -3.70], fetcher: fake({}), dataDir: dir, now: () => now, key: 'with-test' });
  d2.e.start();
  d2.e.stop();
  assert.equal(alertsOf(d2.last()!, now)[0]!.level, 'critical');
});

test('your own CAP feed (file://): a Test message is left out, and shown as info marked TEST with includeTests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazards-'));
  const file = join(dir, 'drill.xml');
  writeFileSync(file, fixture('aemet-cap.xml').replace('<status>Actual</status>', '<status>Test</status>'));
  const url = pathToFileURL(file).href;
  const off = engine({ options: { customFeeds: [url] }, point: [38.82, 0.02], fetcher: fake({}) });
  await off.e.poll(`cap:${url}`);
  assert.equal(off.e.snapshot().items.length, 0);
  const on = engine({ options: { customFeeds: [url], view: { ...options().view, includeTests: true } }, point: [38.82, 0.02], fetcher: fake({}) });
  await on.e.poll(`cap:${url}`);
  const [a] = alertsOf(on.e.snapshot(), T0);
  assert.equal(a!.level, 'info');
  assert.equal(pick(a!.title, 'es'), 'PRUEBA · Aviso de vientos de nivel amarillo. Litoral norte de Alicante');
});

test('GDACS: a far green earthquake only in the tile if near; an orange drought elsewhere not at all', async () => {
  const f = fake({ 'https://www.gdacs.org/xml/gdacs_cap.xml': fixture('gdacs.xml') });
  const tenFiftyFive = () => Date.UTC(2026, 10, 21, 10, 55);
  const near = engine({ options: { feeds: ['gdacs'] }, point: [36.5, 97.5], fetcher: f, now: tenFiftyFive });
  await near.e.poll('gdacs');
  const d = near.e.snapshot();
  const quake = d.items.find((it) => it.kind === 'earthquake')!;
  assert.equal(quake.level, 'warn', 'M5.9 within 300 km');
  assert.match(pick(quake.area, 'es'), /^a \d+ km al [NSEO]+ · China$/);
  const far = engine({ options: { feeds: ['gdacs'] }, point: [40.42, -3.70], now: tenFiftyFive, fetcher: fake({ 'https://www.gdacs.org/xml/gdacs_cap.xml': fixture('gdacs.xml') }) });
  await far.e.poll('gdacs');
  assert.deepEqual(far.e.snapshot().items, []);
});

test('NWS: a point outside the US leaves it out; inside, the point goes in the URL', async () => {
  const out = engine({ options: { feeds: ['nws'] }, point: [40.42, -3.70], fetcher: fake({}) });
  assert.equal(out.e.runs.size, 0);
  const url = 'https://api.weather.gov/alerts/active?point=45.9000,-123.9500';
  const f = fake({ [url]: fixture('nws-tsunami-warning.json') });
  const inside = engine({ options: { feeds: ['nws'] }, point: [45.9, -123.95], fetcher: f });
  await inside.e.poll('nws');
  const [a] = alertsOf(inside.e.snapshot(), Date.UTC(2026, 10, 21, 12));
  assert.equal(a!.level, 'critical');
  assert.equal(pick(a!.title, 'en'), 'Tsunami warning · North Oregon Coast');
  assert.equal(pick(a!.detail, 'en'), 'Move off the beach and out of harbors and marinas. Go to high ground or inland.');
  assert.equal(a!.source, 'NWS');
});

test('default feeds by place, and the user\'s patterns over them', () => {
  assert.deepEqual(defaultFeeds([40.42, -3.70], 'es'), ['aemet']);
  assert.deepEqual(defaultFeeds([25.03, 121.56], 'zh-Hant'), ['ncdr']);
  assert.deepEqual(defaultFeeds([47.6, -122.3], 'en'), ['nws', 'tsunami-ntwc', 'tsunami-ptwc']);
  assert.deepEqual(defaultFeeds([48.86, 2.35], 'fr'), ['meteoalarm-france', 'gdacs']);
  assert.deepEqual(defaultFeeds([-33.9, 151.2], 'en'), ['gdacs']);
  assert.deepEqual(defaultFeeds(undefined, 'zh-Hant'), ['ncdr'], 'no place: by language');
  assert.deepEqual(chosenFeeds(['!gdacs'], [48.86, 2.35], 'fr'), ['meteoalarm-france']);
  assert.deepEqual(chosenFeeds(['aemet', 'tsunami-*'], [40.42, -3.70], 'es'), ['tsunami-ntwc', 'tsunami-ptwc', 'aemet']);
});
