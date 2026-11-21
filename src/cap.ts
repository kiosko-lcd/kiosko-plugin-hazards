/**
 * CAP 1.1 and 1.2 messages, and the Atom and RSS indexes that list them,
 * turned into `HazardEvent`s.
 *
 * A CAP message has one `<info>` per language and, sometimes, several per
 * language for different things (tsunami.gov sends the Warning, the
 * Advisory and the Watch of one earthquake as three `<info>` blocks). Blocks
 * are paired across languages by their order: the k-th `<info>` in each
 * language is one event (`key#k`, k > 0).
 */
import type { Area, Colour, HazardEvent, Kind, MsgType, Status, TsunamiTier } from './model.ts';
import { langOf, localized, tidy } from './model.ts';
import { CAP_MAX_CHARS, childText, kid, kids, parseXml, textOf, type XmlElement } from './xml.ts';

const STATUSES: readonly Status[] = ['Actual', 'Exercise', 'System', 'Test', 'Draft'];
const MSG_TYPES: readonly MsgType[] = ['Alert', 'Update', 'Cancel', 'Ack', 'Error'];

/** CAP dates carry their offset (`-00:00` for UTC). NaN-safe: undefined when unreadable. */
export function capTime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : undefined;
}

const num = (s: string | undefined) => {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n : undefined;
};

/** `lat,lon` pairs separated by spaces. Bad pairs are dropped; a ring needs at least four. */
export function parsePolygon(s: string): [number, number][] | null {
  const pts: [number, number][] = [];
  for (const pair of s.trim().split(/\s+/)) {
    const [a, b] = pair.split(',');
    const lat = num(a), lon = num(b);
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    pts.push([lat, lon]);
  }
  return pts.length >= 3 ? pts : null;
}

/** `lat,lon radius-km`. */
export function parseCircle(s: string): { c: [number, number]; km: number } | null {
  const m = s.trim().match(/^(-?[\d.]+)\s*,\s*(-?[\d.]+)\s+([\d.]+)$/);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]), km = Number(m[3]);
  if (![lat, lon, km].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { c: [lat, lon], km };
}

function pairs(info: XmlElement, name: 'parameter' | 'eventCode' | 'geocode'): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of kids(info, name)) {
    const k = childText(p, 'valueName');
    if (!k) continue;
    (out[k] ??= []).push(childText(p, 'value'));
  }
  return out;
}

/** What kind of hazard, from the category, the event's words and its codes. */
export function kindOf(category: string, words: string, codes: Record<string, string[]>): Kind {
  const s = `${words} ${Object.values(codes).flat().join(' ')}`.toLowerCase();
  if (/tsunami|津波|海嘯|海啸|maremoto/.test(s)) return 'tsunami';
  if (/earthquake|terremoto|sismo|seism|地震|\beqw\b|\beq\b/.test(s)) return 'earthquake';
  if (/^met$/i.test(category)) return 'weather';
  if (/\b(tc|fl)\b|cyclone|flood|typhoon|颱風|台风|hurricane/.test(s)) return 'weather';
  return 'other';
}

export function tsunamiTier(event: string, codes: Record<string, string[]>): TsunamiTier | undefined {
  const cat = (codes.TsunamiSystemCategory?.[0] ?? '').toLowerCase();
  const s = `${cat} ${event}`.toLowerCase();
  if (/warning|大津波警報|津波警報|海嘯警報|海啸警报/.test(s) && !/information|statement/.test(cat)) return 'warning';
  if (/advisory|津波注意報/.test(s)) return 'advisory';
  if (/watch/.test(s)) return 'watch';
  if (/information|statement|threat|予報|cancel/.test(s)) return 'information';
  return undefined;
}

/** The colour an authority puts on a warning, when it does. */
export function colourOf(params: Record<string, string[]>, extra = ''): Colour | undefined {
  const s = [
    ...(params.awareness_level ?? []),
    ...(params['AEMET-Meteoalerta nivel'] ?? []),
    ...(params.alert_color ?? []),
    ...(params.alertlevel ?? []),
    extra,
  ].join(' ').toLowerCase();
  if (/\bred\b|rojo|紅色|红色/.test(s)) return 'red';
  if (/orange|naranja|橙色/.test(s)) return 'orange';
  if (/yellow|amarillo|黃色|黄色/.test(s)) return 'yellow';
  if (/green|verde|綠色|绿色/.test(s)) return 'green';
  return undefined;
}

function areasOf(infos: XmlElement[]): Area[] {
  // Areas are the same in every language; their descriptions are localized by position.
  const first = infos[0];
  if (!first) return [];
  return kids(first, 'area').map((a, i) => {
    const desc: Record<string, string> = {};
    for (const inf of infos) {
      const other = kids(inf, 'area')[i];
      const d = tidy(childText(other, 'areaDesc'));
      if (d) desc[langOf(childText(inf, 'language'))] = d;
    }
    return {
      desc: localized(desc) ?? '',
      polygons: kids(a, 'polygon').map((p) => parsePolygon(textOf(p))).filter((p): p is [number, number][] => !!p),
      circles: kids(a, 'circle').map((c) => parseCircle(textOf(c))).filter((c): c is { c: [number, number]; km: number } => !!c),
      geocodes: pairs(a, 'geocode'),
    };
  });
}

function loc(infos: XmlElement[], name: string): HazardEvent['event'] | undefined {
  const by: Record<string, string> = {};
  for (const inf of infos) {
    const v = tidy(childText(inf, name));
    if (v) by[langOf(childText(inf, 'language'))] ??= v;
  }
  return localized(by);
}

/** `sender,identifier,sent` triplets. */
export function parseReferences(s: string): { key: string; sent: number }[] {
  const out: { key: string; sent: number }[] = [];
  for (const ref of s.trim().split(/\s+/)) {
    const [sender, identifier, sent] = ref.split(',');
    if (!sender || !identifier) continue;
    out.push({ key: `${sender}|${identifier}`, sent: capTime(sent) ?? 0 });
  }
  return out;
}

export interface CapExtras {
  /** A point the index gave for it (GDACS `geo:Point`), used as the epicentre of a report. */
  point?: [number, number];
}

/** One CAP `<alert>` (any prefix, CAP 1.1 or 1.2) as events, one per group of `<info>`. */
export function capEvents(alert: XmlElement, feed: string, extras: CapExtras = {}): HazardEvent[] {
  const sender = childText(alert, 'sender');
  const identifier = childText(alert, 'identifier');
  if (!identifier) return [];
  const key = `${sender}|${identifier}`;
  const sent = capTime(childText(alert, 'sent')) ?? 0;
  const statusRaw = childText(alert, 'status');
  const status = (STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase()) ?? 'Actual') as Status;
  const msgRaw = childText(alert, 'msgType');
  const msgType = (MSG_TYPES.find((s) => s.toLowerCase() === msgRaw.toLowerCase()) ?? 'Alert') as MsgType;
  const scope = childText(alert, 'scope') || 'Public';
  const references = parseReferences(childText(alert, 'references'));
  const incident = childText(alert, 'incidents') || undefined;

  // Group the <info> blocks: the k-th of each language together.
  const byLang = new Map<string, XmlElement[]>();
  for (const inf of kids(alert, 'info')) {
    const l = langOf(childText(inf, 'language'));
    if (!byLang.has(l)) byLang.set(l, []);
    byLang.get(l)!.push(inf);
  }
  const groups = Math.max(0, ...[...byLang.values()].map((v) => v.length));
  const out: HazardEvent[] = [];
  for (let k = 0; k < groups; k++) {
    const infos = [...byLang.values()].map((v) => v[k]).filter((x): x is XmlElement => !!x);
    // English first, so its words decide the kind when there are several.
    infos.sort((a, b) => Number(langOf(childText(b, 'language')) === 'en') - Number(langOf(childText(a, 'language')) === 'en'));
    const main = infos[0]!;
    const category = childText(main, 'category');
    const codes = pairs(main, 'eventCode');
    const params = pairs(main, 'parameter');
    const words = infos.map((i) => `${childText(i, 'event')} ${childText(i, 'headline')}`).join(' ');
    const gdacsType = params.eventtype?.[0];
    let kind = kindOf(category, words, codes);
    if (gdacsType === 'EQ') kind = 'earthquake';
    else if (gdacsType === 'TC' || gdacsType === 'FL') kind = 'weather';
    else if (gdacsType) kind = kind === 'tsunami' ? 'tsunami' : 'other';
    const event = loc(infos, 'event') ?? childText(main, 'event');
    const ev: HazardEvent = {
      key: k ? `${key}#${k}` : key,
      feed,
      sender,
      identifier,
      sent,
      status,
      msgType,
      scope,
      references: k ? references.map((r) => ({ ...r, key: `${r.key}#${k}` })) : references,
      kind,
      category,
      event,
      urgency: childText(main, 'urgency') || 'Unknown',
      severity: childText(main, 'severity') || 'Unknown',
      certainty: childText(main, 'certainty') || 'Unknown',
      areas: areasOf(infos),
    };
    if (incident) ev.incident = incident;
    const senderName = loc(infos, 'senderName');
    if (senderName) ev.senderName = senderName;
    for (const f of ['headline', 'description', 'instruction'] as const) {
      const v = loc(infos, f);
      if (v) ev[f] = v;
    }
    const rt = childText(main, 'responseType');
    if (rt) ev.responseType = rt;
    for (const f of ['effective', 'onset', 'expires'] as const) {
      const v = capTime(childText(main, f));
      if (v !== undefined) ev[f] = v;
    }
    const web = childText(main, 'web');
    if (web) ev.web = web;
    const colour = colourOf(params);
    if (colour) ev.colour = colour;
    if (kind === 'tsunami') {
      const tier = tsunamiTier(childText(main, 'event'), codes);
      if (tier) ev.tsunami = tier;
    }
    // The earthquake behind it: tsunami.gov's parameters, GDACS's.
    const mag = num(params.EventPreliminaryMagnitude?.[0]) ?? num(/magnitude=([\d.]+)/.exec(params.hazardcomponents?.[0] ?? '')?.[1]);
    if (mag !== undefined) ev.magnitude = mag;
    const depth = num(params.EventDepth?.[0]) ?? num(/depth=([\d.]+)/.exec(params.hazardcomponents?.[0] ?? '')?.[1]);
    if (depth !== undefined) ev.depthKm = depth;
    const ll = params.EventLatLon?.[0]?.split(/[\s,]+/).map(Number);
    if (ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1])) ev.epicenter = [ll[0]!, ll[1]!];
    else if (extras.point) ev.epicenter = extras.point;
    const origin = capTime(params.EventOriginTime?.[0]) ?? (gdacsType === 'EQ' ? capTime(params.fromdate?.[0]) : undefined);
    if (origin !== undefined) ev.eventTime = origin;
    const place = params.EventLocationName?.[0] ?? params.country?.[0];
    if (place) ev.place = tidy(place);
    out.push(ev);
  }
  return out;
}

/** A whole CAP document (a `.cap` file), as events. Throws on XML it won't read. */
export function parseCapDocument(xml: string, feed: string): HazardEvent[] {
  const root = parseXml(xml, { maxChars: CAP_MAX_CHARS });
  if (root.name !== 'alert') throw new Error(`not a CAP message (<${root.name}>)`);
  return capEvents(root, feed);
}

/** One entry of an Atom feed or one item of an RSS feed that announces a CAP message. */
export interface IndexEntry {
  id: string;
  title: string;
  /** The CAP message itself, if the entry carries it (GDACS). */
  events?: HazardEvent[];
  /** Or what it says of it in `cap:` fields (Meteoalarm, NCDR), without the full text. */
  summary?: HazardEvent;
  /** Where the full CAP message is. */
  capUrl?: string;
}

const CAP_LINK = /cap\+xml|\.cap$/i;

function linkOf(entry: XmlElement): string | undefined {
  const links = kids(entry, 'link');
  // Atom: <link href type="application/cap+xml">, else a .cap or .xml alternate. RSS: <link>text</link>.
  const atom = links.filter((l) => l.attrs.href);
  const cap = atom.find((l) => CAP_LINK.test(l.attrs.type ?? '')) ?? atom.find((l) => CAP_LINK.test(l.attrs.href!)) ?? atom.find((l) => /\.xml(\?|$)/i.test(l.attrs.href!) && (l.attrs.rel ?? 'alternate') !== 'self');
  if (cap) return cap.attrs.href;
  const rss = links.map((l) => textOf(l)).find(Boolean);
  return rss || undefined;
}

/** The `cap:` fields an index entry carries (Meteoalarm's legacy Atom, NCDR's), as a summary event. */
function summaryOf(entry: XmlElement, feed: string, title: string): HazardEvent | undefined {
  const capKids = entry.children.filter((c): c is XmlElement => typeof c !== 'string' && c.prefix === 'cap');
  const field = (n: string) => textOf(capKids.find((c) => c.name === n));
  const identifier = field('identifier') || childText(entry, 'id');
  const event = field('event') || title;
  if (!identifier || !capKids.length) return undefined;
  const geocodes: Record<string, string[]> = {};
  for (const g of capKids.filter((c) => c.name === 'geocode')) {
    const k = childText(g, 'valueName');
    if (k) (geocodes[k] ??= []).push(childText(g, 'value'));
  }
  const statusRaw = field('status');
  const msgRaw = field('msgType') || field('message_type');
  const sent = capTime(field('sent')) ?? capTime(childText(entry, 'updated')) ?? 0;
  const ev: HazardEvent = {
    key: `${feed}|${identifier}`,
    feed,
    sender: feed,
    identifier,
    sent,
    status: (STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase()) ?? 'Actual') as Status,
    msgType: (MSG_TYPES.find((s) => s.toLowerCase() === msgRaw.toLowerCase()) ?? 'Alert') as MsgType,
    scope: field('scope') || 'Public',
    references: [],
    kind: kindOf('', `${event} ${title}`, {}),
    category: '',
    event,
    urgency: field('urgency') || 'Unknown',
    severity: field('severity') || 'Unknown',
    certainty: field('certainty') || 'Unknown',
    areas: [{ desc: field('areaDesc') || '', polygons: [], circles: [], geocodes }],
  };
  if (/weather|wind|rain|snow|storm|thunder|fog|heat|cold|temperature|flood|coastal|avalanche|fire|forest/i.test(`${event} ${title}`) && ev.kind === 'other') ev.kind = 'weather';
  for (const f of ['effective', 'onset', 'expires'] as const) {
    const v = capTime(field(f));
    if (v !== undefined) ev[f] = v;
  }
  const colour = colourOf({}, title);
  if (colour) ev.colour = colour;
  return ev;
}

/** The entries of an Atom or RSS index of CAP messages. */
export function parseIndex(root: XmlElement, feed: string): IndexEntry[] {
  const items = root.name === 'feed' ? kids(root, 'entry') : kids(kid(root, 'channel'), 'item');
  return items.map((item) => {
    const title = tidy(childText(item, 'title'));
    const id = childText(item, 'id') || childText(item, 'guid') || linkOf(item) || title;
    const entry: IndexEntry = { id, title };
    const inline = kid(item, 'alert');
    if (inline) {
      const pt = kid(item, 'Point');
      const lat = num(childText(pt, 'lat')), lon = num(childText(pt, 'long'));
      entry.events = capEvents(inline, feed, lat !== undefined && lon !== undefined ? { point: [lat, lon] } : {});
    } else {
      const s = summaryOf(item, feed, title);
      if (s) entry.summary = s;
    }
    const url = linkOf(item);
    if (url && !inline) entry.capUrl = url;
    return entry;
  });
}

export type Document = { kind: 'cap'; events: HazardEvent[] } | { kind: 'index'; entries: IndexEntry[] };

/** Any of the XML documents a feed may serve: a CAP message, an Atom or an RSS index. */
export function parseDocument(xml: string, feed: string): Document {
  const root = parseXml(xml);
  if (root.name === 'alert') {
    if (xml.length > CAP_MAX_CHARS) throw new Error('CAP message too big');
    return { kind: 'cap', events: capEvents(root, feed) };
  }
  if (root.name === 'feed' || root.name === 'rss') return { kind: 'index', entries: parseIndex(root, feed) };
  throw new Error(`not CAP, Atom or RSS (<${root.name}>)`);
}

/* The NWS API (api.weather.gov), GeoJSON: the same fields as its CAP. */

interface NwsFeature {
  id?: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, any>;
}

/** GeoJSON polygons are `[lon, lat]` rings; CAP's are `[lat, lon]`. */
function geoRings(g: NwsFeature['geometry']): [number, number][][] {
  if (!g) return [];
  const flip = (ring: unknown) => (Array.isArray(ring) ? ring.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [Number(p[1]), Number(p[0])] as [number, number]) : []);
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return [flip(g.coordinates[0])];
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) return (g.coordinates as unknown[][]).map((poly) => flip(poly[0]));
  return [];
}

export function nwsEvents(json: unknown, feed: string): HazardEvent[] {
  const features = (json as { features?: NwsFeature[] })?.features;
  if (!Array.isArray(features)) throw new Error('not an NWS alert collection');
  const out: HazardEvent[] = [];
  for (const f of features) {
    const p = f.properties;
    if (!p || !p.id) continue;
    const sender = String(p.sender ?? 'w-nws.webmaster@noaa.gov');
    const event = String(p.event ?? '');
    const codes = { ...(p.eventCode ?? {}) } as Record<string, string[]>;
    const kind = kindOf(String(p.category ?? 'Met'), event, codes);
    const ev: HazardEvent = {
      key: `${sender}|${p.id}`,
      feed,
      sender,
      identifier: String(p.id),
      sent: capTime(p.sent) ?? 0,
      status: (STATUSES.find((s) => s === p.status) ?? 'Actual') as Status,
      msgType: (MSG_TYPES.find((s) => s === p.messageType) ?? 'Alert') as MsgType,
      scope: String(p.scope ?? 'Public'),
      references: (Array.isArray(p.references) ? p.references : []).map((r: any) => ({ key: `${r.sender}|${r.identifier}`, sent: capTime(r.sent) ?? 0 })),
      kind,
      category: String(p.category ?? 'Met'),
      event,
      urgency: String(p.urgency ?? 'Unknown'),
      severity: String(p.severity ?? 'Unknown'),
      certainty: String(p.certainty ?? 'Unknown'),
      areas: [{ desc: tidy(String(p.areaDesc ?? '')), polygons: geoRings(f.geometry), circles: [], geocodes: { ...(p.geocode ?? {}) } }],
      serverFiltered: true,
    };
    if (p.senderName) ev.senderName = String(p.senderName);
    if (p.headline) ev.headline = tidy(String(p.headline));
    if (p.description) ev.description = tidy(String(p.description));
    if (p.instruction) ev.instruction = tidy(String(p.instruction));
    if (p.response) ev.responseType = String(p.response);
    // `ends` is when the hazard ends; `expires` when this message stops being current.
    for (const [f, src] of [['effective', p.effective], ['onset', p.onset], ['expires', p.ends ?? p.expires]] as const) {
      const v = capTime(src);
      if (v !== undefined) ev[f] = v;
    }
    if (kind === 'tsunami') {
      const tier = tsunamiTier(event, codes);
      if (tier) ev.tsunami = tier;
    }
    out.push(ev);
  }
  return out;
}
