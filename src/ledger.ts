/**
 * The life of a warning (study §4.8): messages grouped in chains (a first
 * message and its Updates), closed by a Cancel, by expiring, or, in feeds
 * that list what is active, by being gone from two reads in a row. Kept on
 * disk so a restart neither shows old warnings again nor loses current ones.
 */
import type { AlertLevel } from '@kiosko/sdk';
import type { HazardEvent, Kind } from './model.ts';
import { RANK } from './model.ts';

export interface Chain {
  /** Stable id of the warning: the oldest message it refers to, or its first one. */
  root: string;
  feed: string;
  /** The latest message of the chain. */
  current: HazardEvent;
  firstSeen: number;
  updated: number;
  /** When it ended (Cancel, All clear, gone from an active feed). */
  ended?: number;
  /** Ended by its authority (Cancel / All clear) rather than by disappearing. */
  cancelled?: boolean;
  /** Reads of its (active) feed in a row without it. */
  missing: number;
  /** The highest level it reached, so a warning that comes down keeps the alert the user already saw. */
  maxLevel?: AlertLevel;
}

/** How long a warning lasts when its message doesn't say (§4.9). */
export const DEFAULT_TTL_MS: Record<Kind, number> = {
  earthquake: 30 * 60_000,
  tsunami: 6 * 3600_000,
  weather: 12 * 3600_000,
  other: 12 * 3600_000,
};
/** The drill lasts a minute. */
export const DRILL_TTL_MS = 60_000;
/** Ended and expired chains stay this long, greyed, in the tile's history. */
export const HISTORY_MS = 24 * 3600_000;
/** Keys of messages already seen are remembered this long. */
export const SEEN_MS = 48 * 3600_000;
/** Reads in a row without it before a warning of an active feed counts as over. */
export const MISSING_READS = 2;

/** When a chain's warning stops on its own. */
export function expiryOf(e: HazardEvent): number {
  if (e.feed === 'test') return e.sent + DRILL_TTL_MS;
  return e.expires ?? (e.eventTime ?? e.sent) + DEFAULT_TTL_MS[e.kind];
}

const ends = (e: HazardEvent) => e.msgType === 'Cancel' || /^allclear$/i.test(e.responseType ?? '');

export interface LedgerState {
  chains: Chain[];
  /** Message key, when it was seen, the chain it went to (`''`: none). */
  seen: [string, number, string][];
}

export class Ledger {
  readonly chains = new Map<string, Chain>();
  /** Message key → the chain it belongs to. */
  private readonly owner = new Map<string, string>();
  private readonly seen = new Map<string, { at: number; root: string }>();

  constructor(state?: LedgerState) {
    if (!state) return;
    for (const c of state.chains ?? []) {
      if (!c?.root || !c.current?.key) continue;
      this.chains.set(c.root, c);
      this.owner.set(c.current.key, c.root);
    }
    for (const [k, at, root] of state.seen ?? []) this.seen.set(k, { at, root: root ?? '' });
  }

  /**
   * One successful read of a feed: the messages it carries now. `active`
   * feeds list what is in force, so what is gone twice is over; the others
   * (tsunami.gov, one latest message) only end by Cancel or expiry.
   * Returns whether anything changed.
   */
  ingest(feed: string, events: HazardEvent[], active: boolean, now: number): boolean {
    let changed = false;
    const present = new Set<string>();
    // Oldest first, so an Update after its Alert in the same read finds it.
    for (const e of [...events].sort((a, b) => a.sent - b.sent)) {
      const known = this.owner.get(e.key);
      if (known) {
        present.add(known);
        continue;
      }
      if (this.seen.has(e.key)) continue;
      const mark = { at: now, root: '' };
      this.seen.set(e.key, mark);
      // The first message of a chain that was rooted at it from a later one's references: old news.
      if (this.chains.has(e.key)) {
        mark.root = e.key;
        present.add(e.key);
        continue;
      }
      changed = true;
      // The chain it continues, by the messages it names.
      let root: string | undefined;
      for (const r of e.references) {
        const o = this.owner.get(r.key) ?? (this.chains.has(r.key) ? r.key : undefined);
        if (o && this.chains.has(o)) {
          root = o;
          break;
        }
      }
      const chain = root ? this.chains.get(root) : undefined;
      if (chain) {
        mark.root = chain.root;
        if (e.sent < chain.current.sent) continue; // an older message seen late
        this.owner.delete(chain.current.key);
        chain.current = e;
        chain.updated = now;
        chain.missing = 0;
        if (ends(e)) {
          chain.ended = now;
          chain.cancelled = true;
        } else {
          delete chain.ended;
          delete chain.cancelled;
        }
        this.owner.set(e.key, chain.root);
        present.add(chain.root);
        continue;
      }
      // A Cancel of something never seen: nothing to end.
      if (ends(e)) continue;
      // Its own chain. Rooted at the oldest message it refers to, if any, so a
      // restart without state (or a late start) still gives the same id.
      const oldest = [...e.references].sort((a, b) => a.sent - b.sent)[0];
      const id = oldest?.key ?? e.key;
      const c: Chain = { root: this.chains.has(id) ? e.key : id, feed, current: e, firstSeen: now, updated: now, missing: 0 };
      this.chains.set(c.root, c);
      this.owner.set(e.key, c.root);
      mark.root = c.root;
      present.add(c.root);
    }
    if (active) {
      for (const c of this.chains.values()) {
        if (c.feed !== feed || c.ended !== undefined) continue;
        if (present.has(c.root)) {
          c.missing = 0;
          continue;
        }
        if (++c.missing >= MISSING_READS) {
          c.ended = now;
          changed = true;
        }
      }
    }
    return changed;
  }

  /** Records the level a chain shows now; returns the highest it has had (its alert keeps that one's id). */
  raise(c: Chain, level: AlertLevel | null): AlertLevel | null {
    if (level && (!c.maxLevel || RANK[level] > RANK[c.maxLevel])) c.maxLevel = level;
    return c.maxLevel ?? null;
  }

  /** Forgets what is too old to show even as history. */
  prune(now: number): boolean {
    let changed = false;
    for (const [root, c] of this.chains) {
      const over = Math.min(c.ended ?? Infinity, expiryOf(c.current));
      if (now - over > HISTORY_MS) {
        this.chains.delete(root);
        this.owner.delete(c.current.key);
        changed = true;
      }
    }
    for (const [k, s] of this.seen) if (now - s.at > SEEN_MS) this.seen.delete(k);
    return changed;
  }

  /** Drops what one feed brought (a feed the user switched off). */
  forgetFeed(feed: string): void {
    for (const [root, c] of this.chains) if (c.feed === feed) {
      this.chains.delete(root);
      this.owner.delete(c.current.key);
    }
  }

  /**
   * What to save. `keep`: only these chains (the ones the user could see),
   * and only their messages as seen: the rest (warnings elsewhere, hundreds
   * of them in GDACS and Meteoalarm) are read again from their feeds after a
   * restart, so a change of place or zones still finds them.
   */
  toJSON(keep?: ReadonlySet<string>): LedgerState {
    const chains = [...this.chains.values()].filter((c) => !keep || keep.has(c.root));
    const seen = [...this.seen].filter(([, s]) => !keep || keep.has(s.root)).map(([k, s]) => [k, s.at, s.root] as [string, number, string]);
    return { chains, seen };
  }
}
