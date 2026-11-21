/**
 * The common model every feed is turned into: a CAP message, flattened
 * (`HazardEvent`), and the languages the plugin speaks.
 */
import type { AlertLevel, Localized } from '@kiosko/sdk';

export type Kind = 'earthquake' | 'tsunami' | 'weather' | 'other';
export const KINDS: readonly Kind[] = ['earthquake', 'tsunami', 'weather', 'other'];

export type Status = 'Actual' | 'Exercise' | 'System' | 'Test' | 'Draft';
export type MsgType = 'Alert' | 'Update' | 'Cancel' | 'Ack' | 'Error';

/** Colour of a warning where the authority gives one (Meteoalarm, AEMET, CWA, GDACS). */
export type Colour = 'green' | 'yellow' | 'orange' | 'red';

/** Tier of a tsunami product. */
export type TsunamiTier = 'warning' | 'advisory' | 'watch' | 'information';

export interface Area {
  desc: Localized;
  /** Rings of `[lat, lon]`. */
  polygons: [number, number][][];
  circles: { c: [number, number]; km: number }[];
  geocodes: Record<string, string[]>;
}

export interface HazardEvent {
  /** `sender|identifier`. */
  key: string;
  /** Preset id it came from (`nws`, `aemet`, `cap:<url>`). */
  feed: string;
  sender: string;
  identifier: string;
  senderName?: Localized;
  sent: number;
  status: Status;
  msgType: MsgType;
  scope: string;
  /** Keys of the messages it updates or cancels, with when those were sent. */
  references: { key: string; sent: number }[];
  incident?: string;
  kind: Kind;
  category: string;
  event: Localized;
  headline?: Localized;
  description?: Localized;
  instruction?: Localized;
  responseType?: string;
  urgency: string;
  severity: string;
  certainty: string;
  effective?: number;
  onset?: number;
  expires?: number;
  colour?: Colour;
  tsunami?: TsunamiTier;
  magnitude?: number;
  depthKm?: number;
  epicenter?: [number, number];
  /** When the earthquake happened, for reports. */
  eventTime?: number;
  /** Where it happened, in words ("55 miles NE of Seward, Alaska", "China"). */
  place?: string;
  areas: Area[];
  web?: string;
  /** The feed itself filtered by the user's point (the NWS `point=`): every area counts as theirs. */
  serverFiltered?: boolean;
}

/** The languages the plugin's own texts come in. */
export const LANGS = ['en', 'es', 'de', 'zh-Hant', 'zh-Hans', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

/** A CAP `language` (`en-US`, `zh-TW`) as a Kiosko language tag (`en`, `zh-Hant`). */
export function langOf(tag: string | undefined): string {
  const t = (tag || 'en-US').trim();
  const lower = t.toLowerCase();
  if (lower.startsWith('zh')) {
    if (/hant|-tw|-hk|-mo/.test(lower)) return 'zh-Hant';
    return 'zh-Hans';
  }
  return lower.split(/[-_]/)[0] || 'en';
}

/** The best text of a `Localized` for a language: itself, the same language in another script, English, the first. */
export function pick(text: Localized | undefined, lang: string): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  const r = text as Record<string, string | undefined>;
  if (r[lang]) return r[lang]!;
  const base = lang.split('-')[0]!;
  for (const k of Object.keys(r)) if (k.split('-')[0] === base && r[k]) return r[k]!;
  return r.en ?? Object.values(r).find(Boolean) ?? '';
}

/** A `Localized` from texts by language: a plain string when there is only one, else with `en` always there. */
export function localized(byLang: Record<string, string>): Localized | undefined {
  const entries = Object.entries(byLang).filter(([, v]) => v);
  if (!entries.length) return undefined;
  const distinct = new Set(entries.map(([, v]) => v));
  if (distinct.size === 1) return entries[0]![1];
  const out: Record<string, string> = Object.fromEntries(entries);
  if (!out.en) out.en = entries[0]![1];
  return out as Localized;
}

/** The languages a `Localized` has, besides the plugin's own. */
function langsOf(parts: readonly (Localized | undefined)[]): string[] {
  const set = new Set<string>(LANGS);
  for (const p of parts) if (p && typeof p !== 'string') for (const k of Object.keys(p)) set.add(k);
  return [...set];
}

/** Joins texts language by language: `join([prefix, title], ' · ')`. Empty parts are left out. */
export function join(parts: readonly (Localized | undefined)[], sep = ' · '): Localized {
  const present = parts.filter((p): p is Localized => p !== undefined && pick(p, 'en') !== '');
  if (present.every((p) => typeof p === 'string')) return (present as string[]).join(sep);
  const out: Record<string, string> = {};
  for (const l of langsOf(present)) out[l] = present.map((p) => pick(p, l)).filter(Boolean).join(sep);
  return out as Localized;
}

/** Applies `fn` to every language of a text (plus the plugin's own). */
export function mapLoc(text: Localized, fn: (s: string, lang: string) => string): Localized {
  const out: Record<string, string> = {};
  for (const l of langsOf([text])) out[l] = fn(pick(text, l), l);
  return out as Localized;
}

/** Plain text from HTML-ish CAP text: entities that came escaped twice, tags, runs of space. */
export function tidy(s: string): string {
  return s
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, e: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e]!)
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const RANK: Record<AlertLevel, number> = { info: 0, warn: 1, critical: 2 };
export const LEVEL_OF: readonly AlertLevel[] = ['info', 'warn', 'critical'];
