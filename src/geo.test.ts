import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCapDocument } from './cap.ts';
import { distanceToRingKm, haversineKm, inPolygon, matchArea, matchEvent, nearTaiwanCounties, type AreaQuery } from './geo.ts';
import type { Area } from './model.ts';
import { countryOf, countryOfLocale } from './tables.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const q = (point: [number, number] | undefined, o: Partial<AreaQuery> = {}): AreaQuery => ({ marginKm: 0, zones: [], ...(point ? { point } : {}), ...o });
const area = (o: Partial<Area>): Area => ({ desc: '', polygons: [], circles: [], geocodes: {}, ...o });

const square: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];

test('point in polygon, at the edges and outside', () => {
  assert.equal(inPolygon([0.5, 0.5], square), true);
  assert.equal(inPolygon([1.5, 0.5], square), false);
  assert.equal(inPolygon([0.5, -0.0001], square), false);
  assert.equal(inPolygon([0.999, 0.999], square), true);
});

test('a polygon across the antimeridian (the Pacific, for PTWC)', () => {
  const ring: [number, number][] = [[50, 170], [50, -170], [55, -170], [55, 170], [50, 170]];
  assert.equal(inPolygon([52, 179.5], ring), true);
  assert.equal(inPolygon([52, -179.5], ring), true);
  assert.equal(inPolygon([52, 0], ring), false);
  assert.equal(inPolygon([52, 160], ring), false);
});

test('distances: haversine and to a polygon edge', () => {
  assert.ok(Math.abs(haversineKm([40.4168, -3.7038], [41.3874, 2.1686]) - 505) < 5, 'Madrid–Barcelona ≈ 505 km');
  assert.ok(Math.abs(distanceToRingKm([0.5, 1.1], square) - 11.1) < 0.5);
});

test('AEMET polygon: Ondara is in Litoral norte de Alicante, Valencia city is not, unless with a wide margin', () => {
  const [e] = parseCapDocument(fixture('aemet-cap.xml'), 'aemet');
  assert.equal(matchEvent(e!, q([38.82, 0.02])), 'in', 'Ondara');
  assert.equal(matchEvent(e!, q([39.47, -0.38])), 'out', 'Valencia');
  assert.equal(matchEvent(e!, q([39.47, -0.38], { marginKm: 80 })), 'in');
  assert.equal(matchEvent(e!, q(undefined)), 'unknown', 'no place: it can\'t be told');
});

test('circles count with their radius; a radius 0 (an epicentre) says nothing', () => {
  assert.equal(matchArea(area({ circles: [{ c: [19.43, -99.13], km: 50 }] }), q([19.5, -99.2])), 'in');
  assert.equal(matchArea(area({ circles: [{ c: [19.43, -99.13], km: 50 }] }), q([20.5, -99.2])), 'out');
  assert.equal(matchArea(area({ circles: [{ c: [60.3, -147.8], km: 0 }] }), q([60.3, -147.8])), 'unknown');
});

test('UGC codes are placed by their state: the tsunami Warning for southern California', () => {
  const [w, adv, watch] = parseCapDocument(fixture('tsunami-warning-sample.xml'), 'tsunami-ntwc');
  assert.equal(matchEvent(w!, q([33.77, -118.19])), 'in', 'Long Beach');
  assert.equal(matchEvent(w!, q([25.76, -80.19])), 'out', 'Miami');
  assert.equal(matchEvent(adv!, q([36.6, -121.9])), 'in', 'Monterey');
  assert.equal(matchEvent(watch!, q([61.2, -149.9])), 'in', 'Anchorage');
  assert.equal(matchEvent(w!, q([40.4, -3.7])), 'out', 'Madrid');
});

test('zones the user chose: codes, area names, patterns; a shape still decides', () => {
  const ma = area({ desc: 'Litoral norte de Alicante', geocodes: { EMMA_ID: ['ES239'] } });
  assert.equal(matchArea(ma, q([38.5, -0.1])), 'unknown', 'no shape and no zone chosen');
  assert.equal(matchArea(ma, q(undefined, { zones: ['ES239'] })), 'in');
  assert.equal(matchArea(ma, q(undefined, { zones: ['litoral norte*'] })), 'in');
  assert.equal(matchArea(ma, q(undefined, { zones: ['ES240'] })), 'out');
  const shaped = area({ polygons: [square], geocodes: { EMMA_ID: ['ES239'] } });
  assert.equal(matchArea(shaped, q([5, 5], { zones: ['ES239'] })), 'out', 'the polygon decides');
});

test('shapes learnt for a geocode (AEMET zones) count as its polygon', () => {
  const a = area({ geocodes: { 'AEMET-Meteoalerta zona': ['770301'] } });
  assert.equal(matchArea(a, q([0.5, 0.5], { shapes: (n, v) => (n.includes('zona') && v === '770301' ? square : undefined) })), 'in');
});

test('NCDR town areas: placed by the Taiwan county nearest the user', () => {
  const [e] = parseCapDocument(fixture('ncdr-wind.cap'), 'ncdr');
  assert.deepEqual(nearTaiwanCounties([24.99, 121.30]).slice(0, 1), ['桃園市']);
  assert.equal(matchEvent(e!, q([24.99, 121.30])), 'in', 'Taoyuan is in the wind warning');
  assert.equal(matchEvent(e!, q([25.04, 121.56])), 'out', 'Taipei is not');
  assert.equal(matchEvent(e!, q([40.4, -3.7])), 'out', 'Madrid is not in Taiwan');
  assert.equal(matchEvent(e!, q([25.04, 121.56], { zones: ['臺北市*'] })), 'out');
  assert.equal(matchEvent(e!, q([25.04, 121.56], { zones: ['桃園市*'] })), 'in', 'the user\'s zones win');
});

test('countries for the default feeds, from the place or else the language', () => {
  assert.equal(countryOf([40.42, -3.70]), 'ES');
  assert.equal(countryOf([28.1, -15.4]), 'ES', 'Canarias');
  assert.equal(countryOf([38.72, -9.14]), 'PT');
  assert.equal(countryOf([38.88, -6.97]), 'ES', 'Badajoz, at the border');
  assert.equal(countryOf([25.03, 121.56]), 'TW');
  assert.equal(countryOf([47.6, -122.3]), 'US');
  assert.equal(countryOf([61.2, -149.9]), 'US', 'Alaska');
  assert.equal(countryOf([52.52, 13.40]), 'DE');
  assert.equal(countryOf([46.95, 7.45]), 'CH');
  assert.equal(countryOf([-33.9, 151.2]), undefined);
  assert.equal(countryOfLocale('zh-Hant'), 'TW');
  assert.equal(countryOfLocale('es-ES'), 'ES');
});
