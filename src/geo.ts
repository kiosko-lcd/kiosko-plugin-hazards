/**
 * Whether a warning's area is the user's: point in polygon, in circle, near
 * either (a margin for whoever lives at the edge), or a geocode the user
 * chose. Plain lat/lon geometry: enough at the scale of a province.
 */
import { matchFilter } from '@kiosko/sdk';
import type { Area, HazardEvent } from './model.ts';
import { pick } from './model.ts';
import { TW_COUNTIES, US_STATES, inBox } from './tables.ts';

export type LatLon = [number, number];
const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** A ring that crosses the antimeridian (the Pacific) is read with longitudes 0..360. */
function unwrap(ring: LatLon[], pt: LatLon): { ring: LatLon[]; pt: LatLon } {
  let min = Infinity, max = -Infinity;
  for (const [, lon] of ring) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  if (max - min <= 180) return { ring, pt };
  const w = (lon: number) => (lon < 0 ? lon + 360 : lon);
  return { ring: ring.map(([la, lo]) => [la, w(lo)]), pt: [pt[0], w(pt[1])] };
}

/** Ray casting in lat/lon. */
export function inPolygon(pt: LatLon, poly: LatLon[]): boolean {
  if (poly.length < 3) return false;
  const { ring, pt: p } = unwrap(poly, pt);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's edge, km (equirectangular around the point: fine for tens of km). */
export function distanceToRingKm(pt: LatLon, poly: LatLon[]): number {
  const { ring, pt: p } = unwrap(poly, pt);
  const kx = Math.cos(rad(p[0])) * (Math.PI / 180) * R;
  const ky = (Math.PI / 180) * R;
  const xy = ([la, lo]: LatLon) => [(lo - p[1]) * kx, (la - p[0]) * ky] as const;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = xy(ring[j]!);
    const [bx, by] = xy(ring[i]!);
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export type AreaMatch = 'in' | 'out' | 'unknown';

export interface AreaQuery {
  point?: LatLon;
  marginKm: number;
  /** The user's zones (`zones` option): geocode values or area names, as `matchFilter` patterns. */
  zones: readonly string[];
  /** Polygons learnt for geocodes that came without one (AEMET's zones), by `name:value`. */
  shapes?: (name: string, value: string) => LatLon[] | undefined;
}

/** Taiwan counties near a point: the nearest and any almost as near (a town at a county line). */
export function nearTaiwanCounties(pt: LatLon): string[] {
  const d = TW_COUNTIES.map((c) => ({ name: c.name, km: haversineKm(pt, c.at) })).sort((a, b) => a.km - b.km);
  if (!d.length || d[0]!.km > 80) return [];
  return d.filter((c) => c.km <= d[0]!.km + 12).map((c) => c.name);
}

const twNorm = (s: string) => s.replace(/台/g, '臺');

/**
 * One area against the user: geometry first (a polygon or a circle with a
 * radius), then the zones the user chose, then what can be told from the
 * geocode alone (the US state of a UGC code, the Taiwan county of an NCDR
 * town). Circles of radius 0 (an epicentre) say nothing about the area.
 */
export function matchArea(a: Area, q: AreaQuery): AreaMatch {
  const pt = q.point;
  const polys = [...a.polygons];
  if (q.shapes) for (const [name, values] of Object.entries(a.geocodes)) for (const v of values) {
    const s = q.shapes(name, v);
    if (s) polys.push(s);
  }
  const circles = a.circles.filter((c) => c.km > 0);
  if (pt && (polys.length || circles.length)) {
    for (const p of polys) if (inPolygon(pt, p) || (q.marginKm > 0 && distanceToRingKm(pt, p) <= q.marginKm)) return 'in';
    for (const c of circles) if (haversineKm(pt, c.c) <= c.km + q.marginKm) return 'in';
    return 'out';
  }
  const codes = Object.values(a.geocodes).flat();
  const desc = pick(a.desc, 'en');
  if (q.zones.length && (codes.length || desc)) {
    const names = [...codes, ...Object.entries(a.geocodes).flatMap(([k, vs]) => vs.map((v) => `${k}:${v}`)), ...(typeof a.desc === 'string' ? [a.desc] : Object.values(a.desc).filter((x): x is string => !!x))];
    if (matchFilter(names, q.zones)) return 'in';
    // Chosen zones that are all exclusions still leave the rest unknown.
    if (q.zones.some((z) => !z.startsWith('!'))) return 'out';
  }
  if (!pt) return 'unknown';
  const ugc = a.geocodes.UGC ?? a.geocodes.NWSUGC?.flatMap((s) => s.split('-').filter((x) => /^[A-Z]{2}[CZ]\d{3}$/.test(x)));
  if (ugc?.length) {
    const states = new Set(ugc.map((u) => u.slice(0, 2)));
    let known = false;
    for (const st of states) {
      const boxes = US_STATES[st];
      if (!boxes) continue;
      known = true;
      if (boxes.some((b) => inBox(pt, b, q.marginKm))) return 'in';
    }
    if (known) return 'out';
  }
  if (a.geocodes.Taiwan_Geocode_103 || TW_COUNTIES.some((c) => twNorm(desc).startsWith(c.name))) {
    const near = nearTaiwanCounties(pt);
    if (!near.length) return 'out';
    const names = typeof a.desc === 'string' ? [a.desc] : Object.values(a.desc).filter((s): s is string => !!s);
    return names.some((n) => near.some((c) => twNorm(n).startsWith(c))) ? 'in' : 'out';
  }
  return 'unknown';
}

/**
 * The whole event: in if any area is; out if some area could be placed and
 * none is the user's (a tsunami bulletin's forecast points come without
 * codes, next to the coast's zones that have them); else unknown.
 */
export function matchEvent(ev: HazardEvent, q: AreaQuery): AreaMatch {
  if (ev.serverFiltered) return 'in';
  if (!ev.areas.length) return 'unknown';
  let out = 0;
  for (const a of ev.areas) {
    const m = matchArea(a, q);
    if (m === 'in') return 'in';
    if (m === 'out') out++;
  }
  return out > 0 ? 'out' : 'unknown';
}
