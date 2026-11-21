/**
 * From a warning to a Kiosko alert level (study §4.7). The first rule that
 * applies decides. `null`: it goes in the tile only, never full-screen.
 */
import type { AlertLevel } from '@kiosko/sdk';
import type { AreaMatch } from './geo.ts';
import type { HazardEvent } from './model.ts';
import { LEVEL_OF, RANK } from './model.ts';

export interface LevelOptions {
  radiusKm: number;
  minMagnitude: number;
  maxQuakeLevel: AlertLevel;
  maxWeatherLevel: AlertLevel;
  includeTests: boolean;
}

export interface Decision {
  level: AlertLevel | null;
  /** `test`/`exercise`: shown only with includeTests, marked; `drill`: the plugin's own drill. */
  mark?: 'test' | 'exercise' | 'drill';
  /** For the tile: why it is there when it doesn't take the screen. */
  why?: 'area' | 'far' | 'minor' | 'information';
}

const cap = (level: AlertLevel, max: AlertLevel): AlertLevel => (RANK[level] > RANK[max] ? max : level);
const imminent = (e: HazardEvent) => /^(immediate|expected)$/i.test(e.urgency) && /^(observed|likely)$/i.test(e.certainty);

/**
 * The level of an event for this user. `area` is where it is against the
 * user's place; `distanceKm` how far its epicentre is, for reports.
 * Returns `undefined` when it must not appear at all (a test without
 * `includeTests`, a `System` message, a message not for the public).
 */
export function decide(e: HazardEvent, area: AreaMatch, o: LevelOptions, distanceKm?: number): Decision | undefined {
  if (e.status === 'System' || e.status === 'Draft' || !/^public$/i.test(e.scope)) return undefined;
  // 1. Tests and exercises never as real.
  if (e.status !== 'Actual') {
    // The plugin's own drill goes through the area filter like a real warning.
    if (e.feed === 'test') return area === 'in' ? { level: 'critical', mark: 'drill' } : { level: null, mark: 'drill', why: 'area' };
    if (!o.includeTests) return undefined;
    return { level: 'info', mark: e.status === 'Exercise' ? 'exercise' : 'test' };
  }
  return decideActual(e, area, o, distanceKm);
}

function decideActual(e: HazardEvent, area: AreaMatch, o: LevelOptions, distanceKm?: number): Decision {
  // A warning whose area can't be read never takes the screen; one elsewhere neither.
  if (e.kind === 'earthquake') {
    // 11. A report near enough and big enough; 12. a far one GDACS or PAGER call orange or red.
    const near = distanceKm !== undefined ? distanceKm <= o.radiusKm : area === 'in';
    if (near && (e.magnitude ?? 0) >= o.minMagnitude) return { level: o.maxQuakeLevel };
    if (e.colour === 'orange' || e.colour === 'red') return { level: cap('info', o.maxQuakeLevel) };
    return { level: null, why: near ? 'minor' : 'far' };
  }
  if (area !== 'in') return { level: null, why: 'area' };
  if (e.kind === 'tsunami') {
    // 3–5.
    if (e.tsunami === 'warning') return { level: 'critical' };
    if (e.tsunami === 'advisory' || e.tsunami === 'watch') return { level: 'warn' };
    if (e.tsunami === 'information' || (/^minor$/i.test(e.severity) && /^unlikely$/i.test(e.certainty))) return { level: null, why: 'information' };
  }
  // The authority's colour, when it gives one, decides (Meteoalarm, AEMET, CWA), capped.
  if (e.colour && e.kind !== 'tsunami') {
    if (e.colour === 'red') return { level: cap('critical', o.maxWeatherLevel) };
    if (e.colour === 'orange') return { level: cap('warn', o.maxWeatherLevel) };
    if (e.colour === 'yellow') return { level: cap('info', o.maxWeatherLevel) };
    return { level: null, why: 'minor' };
  }
  const sev = e.severity.toLowerCase();
  // 10. Already past, or minor.
  if (/^past$/i.test(e.urgency) || sev === 'minor' || sev === 'unknown') return { level: null, why: 'minor' };
  // 6. Extreme, imminent and certain.
  if (sev === 'extreme' && imminent(e)) return { level: 'critical' };
  // 7. Severe, imminent and certain: warn, or critical if the user allows it.
  if (sev === 'severe' && imminent(e)) return { level: o.maxWeatherLevel === 'critical' ? 'critical' : cap('warn', o.maxWeatherLevel) };
  // 8. Extreme or Severe, later or less certain.
  if (sev === 'extreme' || sev === 'severe') return { level: cap('warn', o.maxWeatherLevel) };
  // 9. Moderate.
  if (sev === 'moderate') return { level: 'info' };
  return { level: null, why: 'minor' };
}

/** The higher of two levels. */
export const higher = (a: AlertLevel | null, b: AlertLevel | null): AlertLevel | null => (a === null ? b : b === null ? a : LEVEL_OF[Math.max(RANK[a], RANK[b])]!);
