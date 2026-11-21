import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPlugin, renderWidget, widgetState } from '@kiosko/sdk/testing';
import plugin from './index.ts';
import { demoData } from './demo.ts';
import type { HazardsData } from './view.ts';
import { latest } from './widget.ts';

const NOW = Date.UTC(2026, 10, 5, 9, 42);
const S = 'hazards/alerts';
const base = (o: Partial<HazardsData> = {}): HazardsData => ({ items: [], feeds: [{ id: 'aemet', source: 'AEMET', lastOk: NOW - 60_000, since: NOW - 3600_000 }], place: 'Madrid', unplaced: 0, staleMs: 15 * 60_000, hour12: false, zones: [], events: [], updated: NOW, ...o });
const paint = (data: HazardsData | undefined, locale = 'es', size = { w: 640, h: 462 }) => renderWidget(latest, { sources: { [S]: data }, locale, size, now: NOW });

test('the demo: an orange warning, a report from 12 minutes ago, a feed that is down, and the fixed note', () => {
  const r = renderWidget(latest, { locale: 'es', now: NOW });
  assert.equal(r.error, undefined);
  assert.equal(r.outside, 0);
  assert.ok(r.texts.includes('Terremoto M4.3'));
  assert.ok(r.texts.some((t) => /^a 35 km al SO · hace 12 min · GDACS$/.test(t)), r.texts.join(' | '));
  assert.ok(r.texts.some((t) => t.startsWith('Aviso de lluvias de nivel naranja')));
  assert.ok(r.texts.some((t) => /^GDACS sin datos desde \d\d:\d\d$/.test(t)));
  assert.ok(r.texts.includes('Informativo · no sustituye a los avisos oficiales'));
  assert.equal(widgetState(latest, 'urgent', { now: NOW }), true, 'a feed down keeps the tile');
});

test('no warnings: says for where and from which data, never a bare "all calm"', () => {
  const r = paint(base());
  assert.deepEqual(r.texts, ['Datos: AEMET · hace 1 min', 'Informativo · no sustituye a los avisos oficiales', 'Sin avisos para Madrid']);
  assert.equal(widgetState(latest, 'empty', { sources: { [S]: base() }, now: NOW }), true);
  assert.equal(widgetState(latest, 'urgent', { sources: { [S]: base() }, now: NOW }), false);
});

test('a feed that doesn\'t answer is not "no warnings": "no warnings data", and the feed named', () => {
  const r = paint(base({ feeds: [{ id: 'aemet', source: 'AEMET', lastOk: NOW - 40 * 60_000, since: NOW - 3600_000 }] }));
  assert.ok(r.texts.includes('Sin datos de avisos'));
  assert.ok(r.texts.some((t) => /^AEMET sin datos desde \d\d:\d\d$/.test(t)));
  assert.ok(!r.texts.some((t) => t.startsWith('Sin avisos para')));
  assert.equal(widgetState(latest, 'urgent', { sources: { [S]: base({ feeds: [{ id: 'a', source: 'AEMET', since: NOW - 3600_000 }] }) }, now: NOW }), true);
});

test('before the first read: waiting, not down', () => {
  const r = paint(base({ feeds: [{ id: 'aemet', source: 'AEMET', since: NOW - 30_000 }] }));
  assert.ok(r.texts.includes('Esperando los primeros datos…'));
  assert.equal(paint(undefined).texts.includes('Esperando los primeros datos…'), true);
});

test('warnings that can\'t be placed are counted, with a hint to choose zones', () => {
  const r = paint(base({ unplaced: 12 }));
  assert.ok(r.texts.includes('12 más sin zona conocida: elige tus zonas'));
});

test('a tile of earthquakes only', () => {
  const d = demoData(NOW, 'en');
  const r = renderWidget(latest, { sources: { [S]: d }, options: { kinds: ['earthquake'] }, locale: 'en', now: NOW });
  assert.ok(r.texts.includes('Earthquake M4.3'));
  assert.ok(!r.texts.some((t) => t.startsWith('Wind Advisory')));
});

test('in Traditional Chinese, at the smallest size, nothing spills', () => {
  const r = renderWidget(latest, { locale: 'zh-Hant', size: { w: 320, h: 154 }, now: NOW });
  assert.equal(r.outside, 0);
  assert.ok(r.texts.includes('僅供參考 · 不能取代官方警報'));
});

test('kiosko check: every widget, size, theme and language, without problems', () => {
  assert.deepEqual(checkPlugin(plugin), []);
});
