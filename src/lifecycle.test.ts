/** Chains of messages, levels over time, expiry and the alerts they give (study §4.8, §4.9). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceAlerts } from '@kiosko/sdk/testing';
import { parseCapDocument } from './cap.ts';
import { DEFAULT_TTL_MS, Ledger, expiryOf } from './ledger.ts';
import type { HazardEvent } from './model.ts';
import { pick } from './model.ts';
import { alerts as source } from './source.ts';
import { ENDED_MS, alertsOf, buildItems, type HazardsData, type ViewOptions } from './view.ts';

const T0 = Date.UTC(2026, 10, 21, 12);
const MIN = 60_000;
const opts: ViewOptions = { kinds: ['earthquake', 'tsunami', 'weather'], events: [], radiusKm: 300, minMagnitude: 4, maxQuakeLevel: 'warn', maxWeatherLevel: 'warn', includeTests: false };
const here: [number, number] = [0.5, 0.5];
const square: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];

let n = 0;
const msg = (o: Partial<HazardEvent> = {}): HazardEvent => {
  const id = o.identifier ?? `M${++n}`;
  return {
    key: `wx@example.org|${id}`, feed: 'cap:x', sender: 'wx@example.org', identifier: id, sent: T0, status: 'Actual', msgType: 'Alert', scope: 'Public', references: [],
    kind: 'weather', category: 'Met', event: 'Wind warning', headline: 'Wind warning for the square', urgency: 'Expected', severity: 'Moderate', certainty: 'Likely',
    expires: T0 + 6 * 3600_000, areas: [{ desc: 'The square', polygons: [square], circles: [], geocodes: {} }], ...o,
  };
};
const after = (prev: HazardEvent, o: Partial<HazardEvent>) => msg({ msgType: 'Update', sent: prev.sent + 10 * MIN, references: [{ key: prev.key, sent: prev.sent }], ...o });

function view(ledger: Ledger, now: number, o: Partial<ViewOptions> = {}, latest = false): HazardsData {
  const { items, unplaced } = buildItems({ ledger, query: { point: here, marginKm: 0, zones: [] }, options: { ...opts, ...o }, sourceOf: () => 'WX', latestOnly: () => latest, now });
  return { items, unplaced, feeds: [], staleMs: 15 * MIN, hour12: false, zones: [], events: [], updated: now };
}

test('Alert → Update at the same level keeps the id ("Seen" holds); up a level, a new id; down again, the higher id stays; Cancel → "Warning over" for 2 min', () => {
  const l = new Ledger();
  const a = msg();
  l.ingest('cap:x', [a], true, T0);
  const [first] = alertsOf(view(l, T0), T0);
  assert.equal(first!.level, 'info');
  assert.equal(first!.id, 'wx@example.org|' + a.identifier + ':info');
  assert.equal(first!.source, 'WX');

  const u1 = after(a, { description: 'Gusts of 80 km/h' });
  l.ingest('cap:x', [u1], true, T0 + 10 * MIN);
  assert.equal(l.chains.size, 1, 'one chain');
  assert.equal(alertsOf(view(l, T0 + 10 * MIN), T0 + 10 * MIN)[0]!.id, first!.id, 'same level: same id');

  const u2 = after(u1, { severity: 'Severe', urgency: 'Immediate', certainty: 'Observed', headline: 'Severe wind warning' });
  l.ingest('cap:x', [u2], true, T0 + 20 * MIN);
  const [up] = alertsOf(view(l, T0 + 20 * MIN), T0 + 20 * MIN);
  assert.equal(up!.level, 'warn');
  assert.notEqual(up!.id, first!.id, 'up a level: shows again');
  assert.equal(up!.title, 'Severe wind warning');

  const u3 = after(u2, { severity: 'Moderate', urgency: 'Expected', certainty: 'Likely' });
  l.ingest('cap:x', [u3], true, T0 + 30 * MIN);
  const [down] = alertsOf(view(l, T0 + 30 * MIN), T0 + 30 * MIN);
  assert.equal(down!.level, 'info');
  assert.equal(down!.id, up!.id, 'down: keeps the id of the highest, so a seen warning stays seen');

  const c = after(u3, { msgType: 'Cancel' });
  l.ingest('cap:x', [c], true, T0 + 40 * MIN);
  const [over] = alertsOf(view(l, T0 + 40 * MIN), T0 + 40 * MIN);
  assert.equal(over!.level, 'info');
  assert.equal(pick(over!.title, 'es'), 'Fin del aviso · Wind warning for the square');
  assert.deepEqual(alertsOf(view(l, T0 + 40 * MIN + ENDED_MS + 1), T0 + 40 * MIN + ENDED_MS + 1), []);
  assert.equal(view(l, T0 + 41 * MIN).items.length, 1, 'still in the tile, greyed');
});

test('an Update whose first message was never seen starts the chain at the message it refers to (a stable id after a restart)', () => {
  const l = new Ledger();
  const [ncdr] = parseCapDocument(readFileSync(new URL('./fixtures/ncdr-wind.cap', import.meta.url), 'utf8'), 'ncdr');
  l.ingest('ncdr', [ncdr!], true, T0);
  assert.deepEqual([...l.chains.keys()], ['weather@cwa.gov.tw|CWA-Weather_strong-wind_202611171036001']);
});

test('a Cancel of something never seen does nothing; an older message seen late does not replace a newer one', () => {
  const l = new Ledger();
  l.ingest('cap:x', [msg({ msgType: 'Cancel', references: [{ key: 'wx@example.org|gone', sent: 0 }] })], true, T0);
  assert.equal(l.chains.size, 0);
  const a = msg();
  const u = after(a, { headline: 'newer' });
  l.ingest('cap:x', [u], true, T0);
  l.ingest('cap:x', [a, u], true, T0 + MIN);
  assert.equal(pick([...l.chains.values()][0]!.current.headline, 'en'), 'newer');
});

test('active feeds: a warning gone from two reads in a row is over (one failed read is not enough)', () => {
  const l = new Ledger();
  const a = msg();
  l.ingest('cap:x', [a], true, T0);
  l.ingest('cap:x', [], true, T0 + MIN);
  assert.equal(alertsOf(view(l, T0 + MIN), T0 + MIN).length, 1, 'once gone: still on');
  l.ingest('cap:x', [a], true, T0 + 2 * MIN);
  l.ingest('cap:x', [], true, T0 + 3 * MIN);
  assert.equal(alertsOf(view(l, T0 + 3 * MIN), T0 + 3 * MIN).length, 1, 'counting starts again when it comes back');
  l.ingest('cap:x', [], true, T0 + 4 * MIN);
  assert.equal(alertsOf(view(l, T0 + 4 * MIN), T0 + 4 * MIN).length, 0, 'twice in a row: over, silently');
});

test('latest-only feeds (tsunami.gov): a warning no longer in the file goes on until it expires or is cancelled', () => {
  const l = new Ledger();
  const w = msg({ kind: 'tsunami', tsunami: 'warning', event: 'Tsunami Warning', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed', expires: T0 + 2 * 3600_000 });
  l.ingest('tsunami-ntwc', [w], false, T0);
  const info = msg({ kind: 'tsunami', tsunami: 'information', event: 'Tsunami Information', severity: 'Minor', certainty: 'Unlikely', areas: [{ desc: 'Far away', polygons: [], circles: [{ c: [60, -147], km: 0 }], geocodes: {} }] });
  for (let i = 1; i <= 3; i++) l.ingest('tsunami-ntwc', [info], false, T0 + i * MIN);
  const d = view(l, T0 + 3 * MIN, {}, true);
  const [a] = alertsOf(d, T0 + 3 * MIN);
  assert.equal(a!.level, 'critical');
  assert.equal(pick(a!.title, 'es'), 'Aviso de tsunami · The square');
  assert.equal(d.items.length, 2, 'the "no threat" bulletin is in the tile, from a coast that can\'t be placed');
  assert.deepEqual(alertsOf(view(l, T0 + 2 * 3600_000, {}, true), T0 + 2 * 3600_000), [], 'expired');
});

test('expiry: the message\'s, else 30 min for a report, 6 h for a tsunami, 12 h for weather; the drill 60 s', () => {
  assert.equal(expiryOf(msg({ expires: T0 + 5 })), T0 + 5);
  const { expires: _drop, ...noExpiry } = msg();
  assert.equal(expiryOf({ ...noExpiry, kind: 'earthquake', eventTime: T0 - MIN }), T0 - MIN + DEFAULT_TTL_MS.earthquake);
  assert.equal(expiryOf({ ...noExpiry, kind: 'tsunami' }), T0 + 6 * 3600_000);
  assert.equal(expiryOf({ ...noExpiry, kind: 'weather' }), T0 + 12 * 3600_000);
  assert.equal(expiryOf({ ...noExpiry, feed: 'test' }), T0 + 60_000);
});

test('tests and exercises never as real: left out, or info with TEST / EXERCISE in front', () => {
  const l = new Ledger();
  l.ingest('cap:x', [msg({ status: 'Test', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }), msg({ status: 'Exercise', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' })], true, T0);
  assert.deepEqual(alertsOf(view(l, T0), T0), []);
  assert.equal(view(l, T0).items.length, 0);
  const shown = alertsOf(view(l, T0, { includeTests: true }), T0);
  assert.deepEqual(shown.map((a) => [a.level, pick(a.title, 'es')]).sort(), [['info', 'PRUEBA · Wind warning for the square'], ['info', 'SIMULACRO · Wind warning for the square']]);
});

test('the same warning through two feeds (AEMET and Meteoalarm) is listed once, as the authority\'s', () => {
  const l = new Ledger();
  l.ingest('meteoalarm-spain', [msg({ feed: 'meteoalarm-spain', sender: 'other', sent: T0 + MIN })], true, T0);
  l.ingest('aemet', [msg({ feed: 'aemet' })], true, T0);
  const { items } = view(l, T0);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.feed, 'aemet');
});

test('only what the user could see is saved; the rest is read again after a restart (a new place still finds it)', () => {
  const l = new Ledger();
  const mine = msg();
  const elsewhere = msg({ areas: [{ desc: 'Elsewhere', polygons: [[[10, 10], [10, 11], [11, 11], [10, 10]]], circles: [], geocodes: {} }] });
  l.ingest('cap:x', [mine, elsewhere], true, T0);
  const keep = new Set(view(l, T0).items.map((it) => it.root));
  const saved = l.toJSON(keep);
  assert.deepEqual(saved.chains.map((c) => c.root), [mine.key]);
  assert.deepEqual(saved.seen.map(([k]) => k), [mine.key]);
  const again = new Ledger(saved);
  assert.equal(again.ingest('cap:x', [mine, elsewhere], true, T0 + MIN), true, 'the other one comes back as new');
  assert.equal(again.chains.size, 2);
});

test('warnings elsewhere are left out; those that can\'t be placed are only counted', () => {
  const l = new Ledger();
  l.ingest('cap:x', [msg({ areas: [{ desc: 'Elsewhere', polygons: [[[10, 10], [10, 11], [11, 11], [10, 10]]], circles: [], geocodes: {} }] })], true, T0);
  l.ingest('cap:x', [msg({ areas: [{ desc: 'Zone 7', polygons: [], circles: [], geocodes: { EMMA_ID: ['XX007'] } }] })], true, T0);
  const d = view(l, T0);
  assert.equal(d.items.length, 0);
  assert.equal(d.unplaced, 1);
});

test('a state saved and loaded again keeps chains and seen messages: nothing shows twice after a restart', () => {
  const l = new Ledger();
  const a = msg();
  l.ingest('cap:x', [a], true, T0);
  const again = new Ledger(JSON.parse(JSON.stringify(l.toJSON())));
  assert.equal(again.ingest('cap:x', [a], true, T0 + MIN), false, 'nothing new');
  assert.equal(alertsOf(view(again, T0 + MIN), T0 + MIN).length, 1, 'and still in force');
  assert.equal(again.prune(T0 + 6 * 3600_000 + 25 * 3600_000), true, 'forgotten a day after it expired');
  assert.equal(again.chains.size, 0);
});

test('alert texts: the time it lasts until in each language, the authority\'s instruction as detail, the icon by event', () => {
  const l = new Ledger();
  l.ingest('cap:x', [msg({ instruction: { en: 'Stay indoors', es: 'Quédese en casa' }, severity: 'Severe', urgency: 'Future', certainty: 'Likely', expires: T0 + 3 * 3600_000 })], true, T0);
  const [a] = alertsOf(view(l, T0), T0);
  assert.equal(a!.level, 'warn');
  assert.equal(a!.icon, 'wind');
  assert.equal(pick(a!.detail, 'es'), 'Quédese en casa');
  assert.match(pick(a!.text, 'es'), /^Hasta \d\d:\d\d · The square$/);
  assert.match(pick(a!.text, 'en'), /^Until \d\d:\d\d · The square$/);
  assert.equal(a!.expiresAt, T0 + 3 * 3600_000);
});

test('sourceAlerts: the source answers Kiosko the same way, and nothing without data', () => {
  const l = new Ledger();
  l.ingest('cap:x', [msg({ kind: 'tsunami', tsunami: 'warning', event: 'Tsunami Warning', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' })], false, T0);
  const [a] = sourceAlerts(source, { data: view(l, T0), now: T0 });
  assert.equal(a!.level, 'critical');
  assert.equal(a!.icon, 'waves');
  assert.deepEqual(sourceAlerts(source, { data: undefined, now: T0 }), []);
  // Its demo data asks for nothing full-screen by itself (Kiosko asks none in demo mode anyway).
  assert.ok(Array.isArray(sourceAlerts(source, { now: T0 })));
});
