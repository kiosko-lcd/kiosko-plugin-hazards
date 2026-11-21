/**
 * `hazards/latest`: the warnings in force and the earthquake reports of the
 * last day, the gravest first, with where each comes from and when each feed
 * last answered (study §4.13, §7.3). The full-screen alerts are the source's,
 * not this tile's: two tiles don't double them, and they don't depend on a page.
 */
import { defineWidget, drawEmpty, drawMore, listLayout, listOptions, matchFilter, t, type Graphics, type Localized, type RenderContext } from '@kiosko/sdk';
import { demoData } from './demo.ts';
import { RANK, join } from './model.ts';
import { TX, fill } from './texts.ts';
import type { FeedStatus, HazardsData, Item } from './view.ts';

const SOURCE = 'hazards/alerts';

const dataOf = (sources: Record<string, unknown>) => sources[SOURCE] as HazardsData | undefined;

const fresh = (f: FeedStatus, d: HazardsData, now: number) => f.lastOk !== undefined && now - f.lastOk <= d.staleMs;
/** Down: no answer for `staleMs` (counting from when it started, if it never answered). */
export const staleFeeds = (d: HazardsData, now: number) => d.feeds.filter((f) => !fresh(f, d, now) && now - (f.lastOk ?? f.since) > d.staleMs);

const active = (it: Item, now: number) => it.ended === undefined && now < it.expires;

/** The rows, the gravest and newest first; what is over goes last, greyed. */
export function rowsOf(d: HazardsData | undefined, kinds: readonly string[], now: number): Item[] {
  if (!d) return [];
  const rank = (it: Item) => (active(it, now) ? (it.level ? RANK[it.level] + 1 : 0) : -1);
  return d.items
    .filter((it) => matchFilter(it.kind, kinds))
    .filter((it) => active(it, now) || now - (it.ended ?? it.expires) < 24 * 3600_000)
    .sort((a, b) => rank(b) - rank(a) || (b.eventTime ?? b.sent) - (a.eventTime ?? a.sent));
}

export const latest = defineWidget({
  id: 'latest',
  name: { en: 'Latest warnings', es: 'Últimos avisos', de: 'Neueste Warnungen', 'zh-Hant': '最新警特報', 'zh-Hans': '最新预警', ja: '最新の警報' },
  description: {
    en: 'Official warnings for your place and recent earthquake reports, with their source and how fresh each feed is. Informational: not a substitute for official alerts.',
    es: 'Avisos oficiales para tu sitio e informes de terremotos recientes, con su fuente y lo recientes que son los datos de cada feed. Informativo: no sustituye a los avisos oficiales.',
    de: 'Amtliche Warnungen für deinen Ort und aktuelle Erdbebenberichte, mit Quelle und Aktualität jedes Feeds. Zur Information: ersetzt keine amtlichen Warnungen.',
    'zh-Hant': '你所在地點的官方警特報與近期地震報告，標示來源與各資料來源的更新時間。僅供參考：不能取代官方警報。',
    'zh-Hans': '你所在地点的官方预警与近期地震报告，标示来源与各数据源的更新时间。仅供参考：不能替代官方预警。',
    ja: 'あなたの場所の公式の警報と最近の地震情報を、発表元と各フィードの更新時刻とともに表示します。参考情報：公式の警報の代わりにはなりません。',
  },
  icon: 'siren',
  category: 'info',
  tags: ['cap', 'earthquake', 'tsunami', 'weather', 'warnings'],
  size: { min: { w: 320, h: 154 }, preferred: { w: 640, h: 462 } },
  sources: [SOURCE],
  options: t.object({
    kinds: t.filter({
      choices: { source: SOURCE, list: 'kinds' },
      label: { en: 'Kinds', es: 'Tipos', de: 'Arten', 'zh-Hant': '類型', 'zh-Hans': '类型', ja: '種類' },
      help: { en: 'Empty: all. earthquake, tsunami, weather, other (a tile of earthquakes only: "earthquake").', es: 'Vacío: todos. earthquake, tsunami, weather, other (una tesela solo de terremotos: «earthquake»).', de: 'Leer: alle. earthquake, tsunami, weather, other (eine Kachel nur für Erdbeben: „earthquake“).', 'zh-Hant': '留空：全部。earthquake、tsunami、weather、other（只顯示地震：「earthquake」）。', 'zh-Hans': '留空：全部。earthquake、tsunami、weather、other（只显示地震：“earthquake”）。', ja: '空欄：すべて。earthquake、tsunami、weather、other（地震だけのタイル：「earthquake」）。' },
    }),
    ...listFields(),
  }),
  redraw: 'minute',
  urgent: ({ sources, now }) => {
    const d = dataOf(sources);
    return !!d && (staleFeeds(d, now).length > 0 || d.items.some((it) => active(it, now) && (it.level === 'warn' || it.level === 'critical')));
  },
  empty: ({ sources, options, now }) => {
    const d = dataOf(sources);
    return !!d && !rowsOf(d, options.kinds, now).length && !staleFeeds(d, now).length;
  },
  render(g, ctx) {
    paint(g, ctx);
  },
  demo: ({ now, locale }) => ({ sources: { [SOURCE]: demoData(now, locale) } }),
});

/** The SDK's list options, with Japanese too. */
function listFields() {
  const f = listOptions({ layouts: ['one-line', 'detailed'] });
  const add = (l: Localized | undefined, ja: string): Localized | undefined => (l && typeof l !== 'string' ? { ...l, ja } : l);
  f.rows = { ...f.rows, label: add(f.rows.label, '行数')!, help: add(f.rows.help, '0：入るだけ。数字を入れるとその数を読みやすい大きさで表示し（小さいタイルでは少なめに）、残りは「+N」で数えます。')! };
  const labels = f.layout.labels ?? {};
  f.layout = {
    ...f.layout,
    label: add(f.layout.label, '行のレイアウト')!,
    help: add(f.layout.help, '自動：タイルの形に合わせて選びます。')!,
    labels: { auto: add(labels.auto, '自動')!, 'one-line': add(labels['one-line'], '1行')!, detailed: add(labels.detailed, '詳細')! },
  };
  return f;
}

type Ctx = RenderContext<{ kinds: string[]; rows: number; layout: 'auto' | 'one-line' | 'detailed' }, unknown>;

function paint(g: Graphics, ctx: Ctx): void {
  const { box, theme, kit, now } = ctx;
  const c = theme.colors;
  const d = dataOf(ctx.sources);
  const tr = ctx.t;
  const small = Math.round(Math.max(10, Math.min(20, box.h * 0.062)));
  const lineH = Math.round(small * 1.45);

  // Bottom lines, from the bottom up: the fixed note, then what the feeds say.
  const lines: { text: string; color: string }[] = [];
  if (d) {
    for (const f of staleFeeds(d, now)) {
      const name = tr(f.source);
      lines.push({ color: c.warn, text: f.lastOk !== undefined ? fill(tr(TX.staleSince), { feed: name, time: ctx.fmt.time(f.lastOk) }) : fill(tr(TX.staleNever), { feed: name }) });
    }
    const ok = d.feeds.filter((f) => fresh(f, d, now));
    if (ok.length) {
      const last = Math.max(...ok.map((f) => f.lastOk!));
      lines.push({ color: c.inkDim, text: fill(tr(TX.data), { feeds: ok.map((f) => tr(f.source)).join(', '), ago: ctx.fmt.ago(last) }) });
    }
    if (d.unplaced > 0) lines.push({ color: c.inkFaint, text: fill(tr(TX.unplaced), { n: String(d.unplaced) }) });
  }
  lines.push({ color: c.inkFaint, text: tr(TX.footer) });
  // A small tile keeps the warnings about feeds and the note, and drops the rest first.
  const room = Math.max(1, Math.floor((box.h * 0.45) / lineH));
  while (lines.length > room) {
    const i = lines.findIndex((l) => l.color === c.inkDim || (l.color === c.inkFaint && l.text !== tr(TX.footer)));
    lines.splice(i >= 0 ? i : 0, 1);
  }
  const linesTop = box.y + box.h - lines.length * lineH;
  lines.forEach((l, i) => {
    const font = { size: small, family: theme.fonts.sans, color: l.color };
    kit.drawTracked(g, kit.truncate(g, l.text, box.w, font), box.x, linesTop + i * lineH + small * 1.05, font);
  });

  const list = { x: box.x, y: box.y, w: box.w, h: Math.max(0, linesTop - box.y - small * 0.4) };
  const rows = rowsOf(d, ctx.options.kinds, now);
  if (!rows.length) {
    const anyFresh = !!d && d.feeds.some((f) => fresh(f, d, now));
    const waiting = !!d && !anyFresh && d.feeds.every((f) => f.lastOk === undefined && now - f.since <= d.staleMs);
    const msg = !d || waiting ? tr(TX.waiting) : !anyFresh ? tr(TX.noData) : d.place ? fill(tr(TX.noWarningsFor), { place: d.place }) : tr(TX.noWarnings);
    drawEmpty(g, { ...ctx, box: list }, msg);
    return;
  }
  const plan = listLayout(list, rows.length, ctx.options, {
    sizes: { 'one-line': { min: 22, max: 46 }, detailed: { min: 44, max: 96 } },
    auto: (b, n) => (b.h / Math.max(1, n) >= 48 ? 'detailed' : 'one-line'),
  });
  const detailed = plan.layout === 'detailed';
  const bar = Math.max(3, Math.round(plan.textSize * 0.22));
  const tx = box.x + bar * 3;
  const tw = box.x + box.w - tx;
  plan.rows.forEach((row, i) => {
    const it = rows[i]!;
    const on = active(it, now);
    const colour = !on ? c.inkFaint : it.level === 'critical' ? c.alert : it.level === 'warn' ? c.warn : it.level === 'info' ? c.info : c.inkDim;
    g.fillStyle = colour;
    const pad = Math.max(2, Math.round(plan.rowH * 0.12));
    g.fillRect(box.x, row.y + pad, bar, row.h - 2 * pad);
    const title = tr(it.mark ? join([TX[it.mark === 'exercise' ? 'exercise' : 'test'], it.title]) : it.title);
    const meta = metaOf(ctx, it, on);
    const main = { size: plan.textSize, family: theme.fonts.sansBold, color: on ? c.ink : c.inkDim };
    if (detailed) {
      const base = row.y + plan.rowH * 0.12 + plan.textSize;
      kit.drawTracked(g, kit.truncate(g, title, tw, main), tx, base, main);
      const sub = { size: plan.detailSize, family: theme.fonts.sans, color: on ? c.inkDim : c.inkFaint };
      kit.drawTracked(g, kit.truncate(g, meta, tw, sub), tx, base + plan.detailSize * 1.35, sub);
    } else {
      const base = row.y + plan.rowH * 0.5 + plan.textSize * 0.36;
      const sub = { size: Math.round(plan.textSize * 0.8), family: theme.fonts.sans, color: on ? c.inkDim : c.inkFaint };
      const metaW = Math.min(tw * 0.45, kit.measureTracked(g, meta, sub));
      const shownMeta = kit.truncate(g, meta, metaW, sub);
      kit.drawTracked(g, kit.truncate(g, title, tw - metaW - plan.textSize, main), tx, base, main);
      kit.drawTracked(g, shownMeta, box.x + box.w, base, { ...sub, align: 'right' });
    }
  });
  drawMore(g, ctx, plan, { indent: tx - box.x });
}

/** A clock time, with the weekday when it isn't today ("dom 03:00"). */
function clock(ctx: Ctx, at: number): string {
  const t = ctx.fmt.time(at);
  if (new Date(at).toDateString() === new Date(ctx.now).toDateString()) return t;
  try {
    return `${new Intl.DateTimeFormat(ctx.locale, { weekday: 'short' }).format(new Date(at))} ${t}`;
  } catch {
    return t;
  }
}

/** "Litoral sur de Valencia · until 22:00 · AEMET", "35 km SW · 12 min ago · GDACS". */
function metaOf(ctx: Ctx, it: Item, on: boolean): string {
  const tr = ctx.t;
  const parts: string[] = [];
  if (it.area) parts.push(tr(it.area));
  else if (it.place) parts.push(it.place);
  if (it.kind === 'earthquake' || it.kind === 'tsunami' || !on) parts.push(ctx.fmt.ago(it.eventTime ?? it.sent));
  else if (it.onset !== undefined && it.onset > ctx.now) parts.push(fill(tr(TX.from), { time: clock(ctx, it.onset) }));
  else parts.push(fill(tr(TX.until), { time: clock(ctx, it.expires) }));
  parts.push(tr(it.source));
  return parts.filter(Boolean).join(' · ');
}

