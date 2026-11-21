/**
 * What runs inside the `hazards/alerts` source: one scheduler per feed, at
 * the interval its provider asks for, a queue per host (NCDR answers 429 to
 * two requests less than 3 s apart), the CAP messages an index links to
 * fetched one at a time and kept, and the ledger saved in `dataDir`.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Choice, Localized } from '@kiosko/sdk';
import { nwsEvents, parseCapDocument, parseDocument, type IndexEntry } from './cap.ts';
import { drillEvents } from './drill.ts';
import { customPreset, presetById, type Preset } from './feeds.ts';
import { matchArea, type AreaQuery, type LatLon } from './geo.ts';
import { Ledger, type LedgerState } from './ledger.ts';
import type { HazardEvent } from './model.ts';
import { pick } from './model.ts';
import { buildItems, type FeedStatus, type HazardsData, type ViewOptions } from './view.ts';
import { XML_LIMITS } from './xml.ts';

/** Longest one request may take. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** CAP messages fetched from one index in one read at most; the rest wait for the next read. */
export const MAX_CAPS_PER_READ = 40;
/** Longest wait after failures. */
const MAX_BACKOFF_MS = 30 * 60_000;

export interface Fetcher {
  /** GET a URL as text (conditional, polite: `createHttp`'s `text`). */
  text(url: string, o: { signal: AbortSignal; headers?: Record<string, string> }): Promise<string>;
}

export interface EngineOptions {
  feeds: string[];
  customFeeds: string[];
  view: ViewOptions;
  zones: string[];
  marginKm: number;
  staleMs: number;
}

export interface EngineInit {
  options: EngineOptions;
  /** Stable text of the options, so the drill runs once per choice of it. */
  optionsKey: string;
  point?: LatLon;
  place?: string;
  hour12: boolean;
  dataDir?: string;
  fetcher: Fetcher;
  log: (msg: string) => void;
  now?: () => number;
  emit: (data: HazardsData) => void;
  /** Random numbers, for the start jitter. */
  rnd?: () => number;
  /** The wait between two requests to a host, from the preset's (tests shorten it). */
  gapOf?: (gapMs: number) => number;
}

interface FeedRun {
  preset: Preset;
  status: FeedStatus;
  failures: number;
  /** Messages in its last read, to log when that changes. */
  count?: number;
  timer?: ReturnType<typeof setTimeout>;
  /** CAP messages already fetched, by URL (their files never change). */
  caps: Map<string, HazardEvent[]>;
}

interface Saved {
  ledger?: LedgerState;
  drillFor?: string;
}

export class Engine {
  readonly ledger: Ledger;
  readonly runs = new Map<string, FeedRun>();
  private readonly init: EngineInit;
  private readonly now: () => number;
  private readonly abort = new AbortController();
  private readonly hosts = new Map<string, Promise<void>>();
  /** AEMET's zones learnt from its CAP messages: zone code → polygon. They don't change. */
  private aemetZones: Record<string, LatLon[]> = {};
  private drillFor?: string;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private tick?: ReturnType<typeof setInterval>;
  private lastSig = '';
  private readonly zoneChoices = new Map<string, Choice>();
  private readonly eventNames = new Set<string>();
  /** Chains the tile lists (the ones worth saving). */
  private listed = new Set<string>();

  constructor(init: EngineInit) {
    this.init = init;
    this.now = init.now ?? Date.now;
    const saved = this.load<Saved>('state.json') ?? {};
    this.ledger = new Ledger(saved.ledger);
    if (saved.drillFor) this.drillFor = saved.drillFor;
    this.aemetZones = this.load<Record<string, LatLon[]>>('aemet-zones.json') ?? {};
    const since = this.now();
    const ids = [...init.options.feeds.map((id) => presetById(id)).filter((p): p is Preset => !!p), ...init.options.customFeeds.filter(Boolean).map(customPreset)];
    for (const preset of ids) {
      if (preset.id !== 'test' && preset.url(init.point) === null) {
        init.log(`${preset.id}: not for this place, left out`);
        continue;
      }
      this.runs.set(preset.id, { preset, status: { id: preset.id, source: preset.source, since }, failures: 0, caps: new Map() });
    }
    // Warnings of feeds no longer chosen go (the drill's, below, when it is taken out).
    for (const c of [...this.ledger.chains.values()]) if (!this.runs.has(c.feed) && c.feed !== 'test') this.ledger.forgetFeed(c.feed);
  }

  get query(): AreaQuery {
    const q: AreaQuery = { marginKm: this.init.options.marginKm, zones: this.init.options.zones, shapes: (name, value) => (/meteoalerta zona/i.test(name) ? this.aemetZones[value] : undefined) };
    if (this.init.point) q.point = this.init.point;
    return q;
  }

  /** Starts every feed's scheduler, each a little apart (thousands of Kioskos shouldn't all ask at :00). */
  start(): void {
    const rnd = this.init.rnd ?? Math.random;
    this.drill();
    for (const run of this.runs.values()) {
      if (run.preset.id === 'test') continue;
      const jitter = Math.round(rnd() * Math.min(10_000, run.preset.intervalMs * 0.1));
      run.timer = setTimeout(() => void this.loop(run), jitter);
    }
    // Expiries, "Warning over" and ages move on without new data.
    this.tick = setInterval(() => this.publish(), 60_000);
    this.publish(true);
  }

  stop(): void {
    this.abort.abort();
    for (const r of this.runs.values()) clearTimeout(r.timer);
    clearInterval(this.tick);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.save();
    }
  }

  private async loop(run: FeedRun): Promise<void> {
    if (this.abort.signal.aborted) return;
    let wait = run.preset.intervalMs;
    try {
      await this.poll(run.preset.id);
      run.failures = 0;
    } catch (err) {
      run.failures++;
      const retryAt = (err as { retryAt?: number }).retryAt;
      wait = retryAt ? Math.max(retryAt - this.now(), wait) : Math.min(MAX_BACKOFF_MS, wait * 2 ** Math.min(run.failures, 5));
    }
    if (this.abort.signal.aborted) return;
    run.timer = setTimeout(() => void this.loop(run), wait);
  }

  /** One read of one feed. Throws (after recording it) when the feed couldn't be read. */
  async poll(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    const p = run.preset;
    try {
      const url = p.url(this.init.point);
      if (!url) return;
      let events: HazardEvent[];
      if (p.format === 'nws') {
        const body = await this.get(url, p.gapMs, { Accept: 'application/geo+json' });
        events = nwsEvents(JSON.parse(body), p.id);
      } else {
        const doc = parseDocument(await this.get(url, p.gapMs), p.id);
        events = doc.kind === 'cap' ? doc.events : await this.resolve(run, doc.entries);
      }
      // Stopped while reading (options changed, Kiosko stopping): nothing to record.
      if (this.abort.signal.aborted) return;
      for (const e of events) this.learn(e);
      if (events.length !== run.count) this.init.log(`${p.id}: ${events.length} message${events.length === 1 ? '' : 's'}`);
      run.count = events.length;
      const changed = this.ledger.ingest(p.id, events, p.mode === 'active', this.now());
      run.status.lastOk = this.now();
      delete run.status.lastError;
      if (changed) this.scheduleSave();
      this.publish();
    } catch (err) {
      if (this.abort.signal.aborted) return;
      run.status.lastError = err instanceof Error ? err.message : String(err);
      this.init.log(`${p.id}: ${run.status.lastError}`);
      this.publish();
      throw err;
    }
  }

  /** The events an index announces: carried in it, kept from before, or fetched now. */
  private async resolve(run: FeedRun, entries: IndexEntry[]): Promise<HazardEvent[]> {
    const p = run.preset;
    const out: HazardEvent[] = [];
    const keep = new Set<string>();
    let fetched = 0;
    for (const e of entries) {
      if (e.events) {
        out.push(...e.events);
        continue;
      }
      const url = e.capUrl;
      const want = url && this.wants(p, e);
      if (url && want) {
        keep.add(url);
        let evs = run.caps.get(url);
        if (!evs && fetched < MAX_CAPS_PER_READ && !this.abort.signal.aborted) {
          fetched++;
          try {
            evs = parseCapDocument(await this.get(url, p.gapMs), p.id);
            run.caps.set(url, evs);
            if (p.fetchCaps === 'aemet') this.learnAemetZone(e, evs);
          } catch (err) {
            if (!this.abort.signal.aborted) this.init.log(`${p.id}: ${url}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // AEMET: a zone just learnt may turn out to be elsewhere.
        if (evs && (p.fetchCaps !== 'aemet' || this.aemetWanted(e) !== false)) {
          out.push(...evs);
          continue;
        }
      }
      if (e.summary) {
        out.push(e.summary);
        this.learn(e.summary);
      }
    }
    for (const u of run.caps.keys()) if (!keep.has(u)) run.caps.delete(u);
    return out;
  }

  /** Whether to fetch the CAP message behind an index entry. */
  private wants(p: Preset, e: IndexEntry): boolean {
    switch (p.fetchCaps) {
      case 'all':
        return true;
      case 'zones':
        // Meteoalarm: only the warnings of the user's zones (its index has no shapes).
        return !!e.summary && this.init.options.zones.length > 0 && e.summary.areas.some((a) => matchArea(a, { ...this.query, shapes: undefined }) === 'in');
      case 'aemet':
        return this.aemetWanted(e) !== false;
      default:
        return false;
    }
  }

  /** AEMET's index names the zone in each file name; once its shape is known, only the zones near the user are fetched. */
  private aemetWanted(e: IndexEntry): boolean | undefined {
    const zone = /AFAZ(\d{6})/.exec(`${e.id} ${e.capUrl ?? ''}`)?.[1];
    const shape = zone ? this.aemetZones[zone] : undefined;
    if (!shape || !this.init.point) return undefined;
    return matchArea({ desc: '', polygons: [shape], circles: [], geocodes: {} }, this.query) === 'in';
  }

  private learnAemetZone(e: IndexEntry, evs: HazardEvent[]): void {
    const zone = /AFAZ(\d{6})/.exec(`${e.id} ${e.capUrl ?? ''}`)?.[1];
    const ring = evs[0]?.areas[0]?.polygons[0];
    if (!zone || !ring || this.aemetZones[zone]) return;
    this.aemetZones[zone] = ring;
    this.write('aemet-zones.json', this.aemetZones);
  }

  /** Remembers geocodes and event names, for the editor's lists. */
  private learn(e: HazardEvent): void {
    if (this.eventNames.size < 300) this.eventNames.add(pick(e.event, 'en'));
    for (const a of e.areas) {
      for (const [name, values] of Object.entries(a.geocodes)) {
        for (const v of values) {
          if (!v || this.zoneChoices.size >= 3000 || this.zoneChoices.has(v)) continue;
          const label = pick(a.desc, 'en');
          this.zoneChoices.set(v, { value: v, ...(label ? { label: `${label} (${v})` } : {}), group: `${pick(this.runs.get(e.feed)?.preset.source ?? e.feed, 'en')} · ${name}` });
        }
      }
    }
  }

  /** One GET through the host's queue, with a deadline. `file://` URLs are read from disk (a drill of the user's own). */
  private async get(url: string, gapMs: number, headers?: Record<string, string>): Promise<string> {
    if (url.startsWith('file:')) {
      const path = fileURLToPath(url);
      if (statSync(path).size > XML_LIMITS.maxChars) throw new Error('file too big');
      return readFile(path, 'utf8');
    }
    const host = new URL(url).host;
    const prev = this.hosts.get(host) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.hosts.set(host, prev.then(() => mine));
    await prev;
    try {
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const body = await this.init.fetcher.text(url, { signal, ...(headers ? { headers } : {}) });
      if (body.length > XML_LIMITS.maxChars) throw new Error(`response too big (${body.length} characters)`);
      return body;
    } finally {
      // The next request to this host waits its gap after this one ends.
      setTimeout(release, this.init.gapOf ? this.init.gapOf(gapMs) : gapMs);
    }
  }

  /** The drill: once per choice of options that includes the `test` feed. */
  private drill(): void {
    if (!this.runs.has('test')) {
      if (this.drillFor) {
        delete this.drillFor;
        this.ledger.forgetFeed('test');
        this.scheduleSave();
      }
      return;
    }
    if (this.drillFor === this.init.optionsKey) return;
    this.drillFor = this.init.optionsKey;
    const now = this.now();
    this.ledger.ingest('test', drillEvents(now, this.init.point, this.init.place), false, now);
    this.runs.get('test')!.status.lastOk = now;
    this.scheduleSave();
  }

  /** The data the source hands out now. */
  snapshot(): HazardsData {
    const now = this.now();
    if (this.ledger.prune(now)) this.scheduleSave();
    const o = this.init.options;
    const { items, unplaced } = buildItems({
      ledger: this.ledger,
      query: this.query,
      options: o.view,
      sourceOf: (feed) => this.runs.get(feed)?.preset.source ?? (feed.startsWith('cap:') ? customPreset(feed.slice(4)).source : (presetById(feed)?.source ?? feed)) as Localized,
      latestOnly: (feed) => (this.runs.get(feed)?.preset ?? presetById(feed))?.mode === 'latest',
      now,
    });
    const listed = new Set(items.map((it) => it.root));
    if ([...listed].some((r) => !this.listed.has(r)) || listed.size !== this.listed.size) this.scheduleSave();
    this.listed = listed;
    const data: HazardsData = {
      items,
      feeds: [...this.runs.values()].filter((r) => r.preset.id !== 'test').map((r) => ({ ...r.status })),
      unplaced,
      staleMs: o.staleMs,
      hour12: this.init.hour12,
      zones: [...this.zoneChoices.values()],
      events: [...this.eventNames].filter(Boolean).sort(),
      updated: now,
    };
    if (this.init.place) data.place = this.init.place;
    return data;
  }

  private publish(force = false): void {
    const data = this.snapshot();
    const sig = JSON.stringify({ ...data, updated: 0 });
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    this.init.emit(data);
  }

  private scheduleSave(): void {
    if (this.saveTimer || !this.init.dataDir) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 2000);
    this.saveTimer.unref?.();
  }

  private save(): void {
    const s: Saved = { ledger: this.ledger.toJSON(this.listed), ...(this.drillFor ? { drillFor: this.drillFor } : {}) };
    this.write('state.json', s);
  }

  private load<T>(name: string): T | undefined {
    if (!this.init.dataDir) return undefined;
    try {
      return JSON.parse(readFileSync(joinPath(this.init.dataDir, name), 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  private write(name: string, value: unknown): void {
    if (!this.init.dataDir) return;
    try {
      mkdirSync(this.init.dataDir, { recursive: true });
      const file = joinPath(this.init.dataDir, name);
      writeFileSync(`${file}.tmp`, JSON.stringify(value));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      this.init.log(`could not save ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
