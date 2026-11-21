/**
 * From the chains of warnings to what the tile lists and the alerts Kiosko
 * shows full-screen (study §4.11).
 */
import { createFormatters, matchFilter, type Alert, type AlertLevel, type Choice, type Localized } from '@kiosko/sdk';
import { bearing, haversineKm, matchEvent, type AreaQuery } from './geo.ts';
import { expiryOf, type Chain, type Ledger } from './ledger.ts';
import { decide, type LevelOptions } from './levels.ts';
import type { HazardEvent, Kind, TsunamiTier } from './model.ts';
import { join, pick } from './model.ts';
import { TX, awayText, say } from './texts.ts';

export interface Item {
  /** The Kiosko alert id: the chain and the highest level it reached. */
  id: string;
  root: string;
  feed: string;
  kind: Kind;
  /** Full-screen level now; `null`: the tile only. */
  level: AlertLevel | null;
  /** The highest level it has had (for "Warning over"). */
  maxLevel: AlertLevel | null;
  mark?: 'test' | 'exercise' | 'drill';
  source: Localized;
  title: Localized;
  /** Where, when the title doesn't say. */
  area?: Localized;
  instruction?: Localized;
  sent: number;
  onset?: number;
  expires: number;
  ended?: number;
  cancelled?: boolean;
  magnitude?: number;
  eventTime?: number;
  place?: string;
  tsunami?: TsunamiTier;
  icon: string;
}

export interface FeedStatus {
  id: string;
  source: Localized;
  /** Last successful read. */
  lastOk?: number;
  lastError?: string;
  /** When the plugin started reading it. */
  since: number;
}

export interface HazardsData {
  items: Item[];
  feeds: FeedStatus[];
  /** The user's place, for "No warnings for Madrid". */
  place?: string;
  /** Warnings whose zone can't be told (no shape, no zone chosen): counted, not listed. */
  unplaced: number;
  staleMs: number;
  hour12: boolean;
  /** Geocodes seen, for the `zones` option's list. */
  zones: Choice[];
  /** Event names seen, for the `events` option's list. */
  events: string[];
  updated: number;
}

/** How long "Warning over" stays after a Cancel. */
export const ENDED_MS = 2 * 60_000;

export interface ViewOptions extends LevelOptions {
  kinds: string[];
  events: string[];
}

const TIER: Record<TsunamiTier, Localized> = { warning: TX.tsunamiWarning, advisory: TX.tsunamiAdvisory, watch: TX.tsunamiWatch, information: TX.tsunamiInfo };

/** A Lucide icon the panel draws (docs/plugins.md, Alerts). */
export function iconOf(e: HazardEvent): string {
  if (e.kind === 'tsunami') return 'waves';
  if (e.kind === 'earthquake') return 'activity';
  const s = `${pick(e.event, 'en')} ${Object.values(typeof e.event === 'string' ? {} : e.event).join(' ')}`.toLowerCase();
  if (/coast|costero|marine|surf|海上|海象|高浪/.test(s)) return 'waves';
  if (/thunder|tormenta|storm|lightning|雷|tornado/.test(s)) return 'cloud-lightning';
  if (/wind|viento|gale|風|风|typhoon|cyclone|hurricane|颱|台风/.test(s)) return 'wind';
  if (/rain|lluvia|flood|inundac|precip|雨|水/.test(s)) return 'droplet';
  if (/heat|cold|calor|frío|temperat|freeze|frost|低溫|低温|高溫|高温|寒/.test(s)) return 'thermometer';
  if (/fire|incendio|火/.test(s)) return 'flame';
  return 'triangle-alert';
}

function areaText(e: HazardEvent, max = 2): Localized | undefined {
  const descs = e.areas.map((a) => a.desc).filter((d) => pick(d, 'en'));
  if (!descs.length) return undefined;
  const shown = join(descs.slice(0, max), ', ');
  return descs.length > max ? join([shown, `+${descs.length - max}`], ' ') : shown;
}

const contains = (title: Localized, part: Localized | undefined) => !!part && pick(title, 'en').includes(pick(part, 'en'));

function titleOf(e: HazardEvent): { title: Localized; area?: Localized } {
  const area = areaText(e, 1);
  if (e.kind === 'tsunami') return { title: join([e.tsunami ? TIER[e.tsunami] : e.event, area]) };
  if (e.kind === 'earthquake') return { title: join([TX.earthquake, e.magnitude !== undefined ? `M${e.magnitude.toFixed(1)}` : undefined], ' ') };
  const head = e.headline && pick(e.headline, 'en').length <= 90 ? e.headline : undefined;
  const title = head ?? join([e.event, area]);
  const more = areaText(e);
  return contains(title, area) ? { title } : more ? { title, area: more } : { title };
}

export interface BuildInput {
  ledger: Ledger;
  query: AreaQuery;
  options: ViewOptions;
  /** Who publishes each feed. */
  sourceOf: (feed: string) => Localized;
  /** Feeds that carry only their latest message (tsunami centres): their bulletins go to the tile wherever they are. */
  latestOnly: (feed: string) => boolean;
  now: number;
}

/** Every chain the tile may list, decided for this user; and how many could not be placed. */
export function buildItems(b: BuildInput): { items: Item[]; unplaced: number } {
  const items: Item[] = [];
  let unplaced = 0;
  const seen = new Set<string>();
  // Newest first; the authority's own feed before an aggregator that passes the same warning on.
  const aggregator = (feed: string) => (/^(meteoalarm-|gdacs)/.test(feed) ? 1 : 0);
  const chains = [...b.ledger.chains.values()].sort((x, y) => aggregator(x.feed) - aggregator(y.feed) || y.current.sent - x.current.sent);
  for (const c of chains) {
    const e = c.current;
    if (!matchFilter(e.kind, b.options.kinds)) continue;
    if (b.options.events.length && !matchFilter(typeof e.event === 'string' ? [e.event] : (Object.values(e.event).filter(Boolean) as string[]), b.options.events)) continue;
    const area = matchEvent(e, b.query);
    const distance = e.epicenter && b.query.point ? haversineKm(b.query.point, e.epicenter) : undefined;
    const d = decide(e, area, b.options, e.kind === 'earthquake' ? distance : undefined);
    if (!d) continue;
    const listed = d.level !== null || area === 'in' || b.latestOnly(c.feed) || e.feed === 'test' || (e.kind === 'earthquake' && d.why === 'minor');
    if (!listed) {
      if (area === 'unknown' && c.ended === undefined && b.now < expiryOf(e)) unplaced++;
      continue;
    }
    // The same warning through two feeds (AEMET and Meteoalarm): once.
    const dup = `${e.status}|${pick(e.event, 'en')}|${e.areas.map((a) => pick(a.desc, 'en')).join(',')}|${e.expires ?? ''}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    items.push(itemOf(b, c, e, d.level, d.mark, distance));
  }
  return { items, unplaced };
}

function itemOf(b: BuildInput, c: Chain, e: HazardEvent, level: AlertLevel | null, mark: Item['mark'], distance: number | undefined): Item {
  const expires = expiryOf(e);
  const over = c.ended !== undefined || b.now >= expires;
  const max = over ? (c.maxLevel ?? null) : b.ledger.raise(c, level);
  const { title, area } = titleOf(e);
  const it: Item = {
    id: `${c.root}:${max ?? 'none'}`,
    root: c.root,
    feed: c.feed,
    kind: e.kind,
    level: over ? null : level,
    maxLevel: max,
    // NCDR passes on the warnings of many agencies: name the one that issued it (中央氣象署).
    source: c.feed === 'ncdr' && e.senderName ? e.senderName : b.sourceOf(c.feed),
    title,
    sent: e.sent,
    expires,
    icon: iconOf(e),
  };
  if (mark) it.mark = mark;
  if (e.kind === 'earthquake' && distance !== undefined && e.epicenter && b.query.point) it.area = join([awayText(distance, bearing(b.query.point, e.epicenter)), e.place]);
  else if (area) it.area = area;
  if (e.instruction) it.instruction = e.instruction;
  if (e.onset !== undefined) it.onset = e.onset;
  if (c.ended !== undefined) it.ended = c.ended;
  if (c.cancelled) it.cancelled = true;
  if (e.magnitude !== undefined) it.magnitude = e.magnitude;
  if (e.eventTime !== undefined) it.eventTime = e.eventTime;
  // Where the earthquake was, unless the title already says it (a "no threat" bulletin names only that).
  if (e.place && !contains(title, e.place)) it.place = e.place;
  if (e.tsunami) it.tsunami = e.tsunami;
  return it;
}

/* Times in every language, for alerts (which get no formatter of their own). */

const LANGS = ['en', 'es', 'de', 'zh-Hant', 'zh-Hans', 'ja'];

function clock(at: number, now: number, lang: string, hour12: boolean): string {
  const f = createFormatters({ locale: lang, timeFormat: hour12 ? '12h' : '24h', now });
  const t = f.time(at);
  const a = new Date(at), n = new Date(now);
  if (a.toDateString() === n.toDateString()) return t;
  let day = '';
  try {
    day = new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(a);
  } catch {
    day = a.toISOString().slice(5, 10);
  }
  return `${day} ${t}`;
}

const timeText = (at: number, now: number, hour12: boolean) => {
  const out: Record<string, string> = {};
  for (const l of LANGS) out[l] = clock(at, now, l, hour12);
  return out as Localized;
};

const agoText = (at: number, now: number) => {
  const out: Record<string, string> = {};
  for (const l of LANGS) out[l] = createFormatters({ locale: l, now }).ago(at);
  return out as Localized;
};

/** The one line under an alert's title. */
export function lineOf(it: Item, now: number, hour12: boolean): Localized {
  if (it.kind === 'earthquake') {
    const at = it.eventTime ?? it.sent;
    return join([it.area ?? it.place, join([timeText(at, now, hour12), join(['(', agoText(at, now), ')'], '')], ' ')]);
  }
  if (it.kind === 'tsunami') {
    return join([timeText(it.eventTime ?? it.sent, now, hour12), it.magnitude !== undefined ? `M${it.magnitude.toFixed(1)}` : undefined, it.place]);
  }
  const when = it.onset !== undefined && it.onset > now ? say(TX.from, { time: (l) => clock(it.onset!, now, l, hour12) }) : say(TX.until, { time: (l) => clock(it.expires, now, l, hour12) });
  return join([when, it.area]);
}

/** The alerts to show full-screen now (the source's `alerts`). */
export function alertsOf(data: HazardsData | undefined, now: number): Alert[] {
  if (!data) return [];
  const out: Alert[] = [];
  for (const it of data.items) {
    if (it.ended !== undefined) {
      // 2. A Cancel or All clear of something that took the screen: "Warning over" for two minutes.
      if (it.cancelled && it.maxLevel && now - it.ended < ENDED_MS) {
        out.push({ id: `${it.root}:ended`, level: 'info', title: join([TX.ended, it.title]), source: it.source, icon: it.icon, expiresAt: it.ended + ENDED_MS });
      }
      continue;
    }
    if (!it.level || now >= it.expires) continue;
    const title = it.mark ? join([TX[it.mark === 'exercise' ? 'exercise' : 'test'], it.title]) : it.title;
    const a: Alert = { id: it.id, level: it.level, title, text: lineOf(it, now, data.hour12), source: it.source, icon: it.icon, expiresAt: it.expires };
    if (it.instruction) a.detail = it.instruction;
    out.push(a);
  }
  return out;
}
