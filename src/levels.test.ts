/** The whole table of study §4.7, rule by rule. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, type LevelOptions } from './levels.ts';
import type { HazardEvent } from './model.ts';

const O: LevelOptions = { radiusKm: 300, minMagnitude: 4, maxQuakeLevel: 'warn', maxWeatherLevel: 'warn', includeTests: false };
const ev = (o: Partial<HazardEvent>): HazardEvent => ({
  key: 'a|1', feed: 'cap:x', sender: 'a', identifier: '1', sent: 0, status: 'Actual', msgType: 'Alert', scope: 'Public', references: [],
  kind: 'weather', category: 'Met', event: 'Something', urgency: 'Expected', severity: 'Moderate', certainty: 'Likely', areas: [], ...o,
});
const level = (e: Partial<HazardEvent>, o: Partial<LevelOptions> = {}, area: 'in' | 'out' | 'unknown' = 'in', km?: number) => decide(ev(e), area, { ...O, ...o }, km)?.level;

test('1. tests and exercises: nothing by default; info with a mark if asked; System and Draft never; the drill is critical, in its area', () => {
  assert.equal(decide(ev({ status: 'Test' }), 'in', O), undefined);
  assert.deepEqual(decide(ev({ status: 'Test', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }), 'in', { ...O, includeTests: true }), { level: 'info', mark: 'test' });
  assert.deepEqual(decide(ev({ status: 'Exercise' }), 'in', { ...O, includeTests: true }), { level: 'info', mark: 'exercise' });
  assert.equal(decide(ev({ status: 'System' }), 'in', { ...O, includeTests: true }), undefined);
  assert.equal(decide(ev({ status: 'Draft' }), 'in', { ...O, includeTests: true }), undefined);
  assert.equal(decide(ev({ scope: 'Restricted' }), 'in', O), undefined);
  assert.deepEqual(decide(ev({ status: 'Test', feed: 'test' }), 'in', O), { level: 'critical', mark: 'drill' });
  assert.equal(decide(ev({ status: 'Test', feed: 'test' }), 'unknown', O)?.level, null, 'no place: the tile only');
});

test('3–5. tsunami: Warning critical, Advisory and Watch warn, Information only in the tile', () => {
  assert.equal(level({ kind: 'tsunami', tsunami: 'warning', severity: 'Extreme' }), 'critical');
  assert.equal(level({ kind: 'tsunami', tsunami: 'warning' }, { maxWeatherLevel: 'info' }), 'critical', 'weather caps don\'t apply');
  assert.equal(level({ kind: 'tsunami', tsunami: 'advisory' }), 'warn');
  assert.equal(level({ kind: 'tsunami', tsunami: 'watch' }), 'warn');
  assert.equal(level({ kind: 'tsunami', tsunami: 'information', severity: 'Minor', certainty: 'Unlikely' }), null);
  assert.equal(level({ kind: 'tsunami', severity: 'Minor', certainty: 'Unlikely' }), null);
  assert.equal(level({ kind: 'tsunami', tsunami: 'warning' }, {}, 'out'), null, 'another coast');
  assert.equal(level({ kind: 'tsunami', tsunami: 'warning' }, {}, 'unknown'), null, 'an area that can\'t be read never takes the screen');
});

test('6. Extreme, imminent and certain: critical', () => {
  assert.equal(level({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }), 'critical');
  assert.equal(level({ severity: 'Extreme', urgency: 'Expected', certainty: 'Likely' }), 'critical');
});

test('7. Severe, imminent and certain: warn, critical only if the user raises maxWeatherLevel', () => {
  const sev = { severity: 'Severe', urgency: 'Immediate', certainty: 'Likely' };
  assert.equal(level(sev), 'warn');
  assert.equal(level(sev, { maxWeatherLevel: 'critical' }), 'critical');
  assert.equal(level(sev, { maxWeatherLevel: 'info' }), 'info');
});

test('8. Extreme or Severe, later or less certain: warn', () => {
  assert.equal(level({ severity: 'Severe', urgency: 'Future', certainty: 'Possible' }), 'warn');
  assert.equal(level({ severity: 'Extreme', urgency: 'Future', certainty: 'Likely' }), 'warn');
  assert.equal(level({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Possible' }), 'warn');
});

test('9–10. Moderate info; Minor, Unknown or Past only in the tile', () => {
  assert.equal(level({ severity: 'Moderate' }), 'info');
  assert.equal(level({ severity: 'Minor' }), null);
  assert.equal(level({ severity: 'Unknown' }), null);
  assert.equal(level({ severity: 'Severe', urgency: 'Past' }), null);
});

test('colours decide when given: red critical (capped by maxWeatherLevel, warn by default), orange warn, yellow info, green nothing', () => {
  assert.equal(level({ colour: 'red', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }), 'warn', 'AEMET red: warn by default');
  assert.equal(level({ colour: 'red' }, { maxWeatherLevel: 'critical' }), 'critical');
  assert.equal(level({ colour: 'orange', severity: 'Severe' }), 'warn');
  assert.equal(level({ colour: 'yellow', severity: 'Moderate' }), 'info');
  assert.equal(level({ colour: 'yellow' }, { maxWeatherLevel: 'info' }), 'info');
  assert.equal(level({ colour: 'orange' }, { maxWeatherLevel: 'info' }), 'info');
  assert.equal(level({ colour: 'green' }), null);
  assert.equal(level({ colour: 'red' }, {}, 'out'), null);
});

test('11–12. earthquake reports: maxQuakeLevel (warn) near and big enough, info far if orange or red, else the tile', () => {
  const eq = { kind: 'earthquake' as const, urgency: 'Past', certainty: 'Observed', magnitude: 5.2 };
  assert.equal(level(eq, {}, 'out', 120), 'warn');
  assert.equal(level(eq, { maxQuakeLevel: 'info' }, 'out', 120), 'info');
  assert.equal(level(eq, { maxQuakeLevel: 'critical' }, 'out', 120), 'critical', 'if the user wants it');
  assert.equal(level({ ...eq, colour: 'red' }, { maxQuakeLevel: 'critical' }, 'out', 9000), 'info', 'a far one stays info');
  assert.equal(level({ ...eq, magnitude: 3.9 }, {}, 'in', 20), null, 'too small');
  assert.equal(level(eq, {}, 'out', 2000), null, 'too far');
  assert.equal(level({ ...eq, colour: 'orange' }, {}, 'out', 6000), 'info');
  assert.equal(level({ ...eq, colour: 'red', magnitude: 7.8 }, {}, 'out', 9000), 'info');
  assert.equal(level({ ...eq, magnitude: 6 }, { radiusKm: 1000 }, 'out', 900), 'warn');
});
