/**
 * A small XML reader for CAP, Atom, RSS and GeoRSS, with no dependencies.
 *
 * It reads elements, attributes, text and CDATA, the five predefined
 * entities and numeric character references, and keeps namespace prefixes
 * apart from local names. It does **not** read DTDs: a document with
 * `<!DOCTYPE` or `<!ENTITY` is refused outright, so there are no external
 * entities (XXE) and no entity expansion (billion laughs). Neither CAP nor
 * Atom need them. Any other named entity is left as it is, unexpanded.
 *
 * It also refuses documents that are too big, too deep or have too many
 * elements, and never evaluates anything (no XInclude, no XSLT, signatures
 * are ignored).
 */

export interface XmlElement {
  /** Local name, without its prefix: `alert`, `event`, `link`. */
  name: string;
  /** Namespace prefix as written (`cap`, `georss`), or `''`. */
  prefix: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlLimits {
  /** Longest document, in characters. Default 10 MB (GDACS is ≈ 6 MB). */
  maxChars?: number;
  /** Deepest nesting. Default 64. */
  maxDepth?: number;
  /** Most elements. Default 200 000. */
  maxElements?: number;
}

export const XML_LIMITS = { maxChars: 10 * 1024 * 1024, maxDepth: 64, maxElements: 200_000 } as const;
/** One CAP message is never near this; a bigger one is not a CAP message. */
export const CAP_MAX_CHARS = 1024 * 1024;

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Expands the five predefined entities and numeric references; leaves any other `&name;` alone. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    return PREDEFINED[ref] ?? m;
  });
}

const NAME = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/;
const ATTR = /([A-Za-z_][\w.\-:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function split(qname: string): { prefix: string; name: string } {
  const i = qname.indexOf(':');
  return i < 0 ? { prefix: '', name: qname } : { prefix: qname.slice(0, i), name: qname.slice(i + 1) };
}

/** Where a tag that starts at `from` (just after `<`) ends: its `>`, skipping quoted values. */
function tagEnd(src: string, from: number): number {
  let q = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

/**
 * Parses a document and returns its root element. Throws `XmlError` for
 * anything it won't read: a DTD or entity declaration, a malformed or
 * unbalanced document, or one over the limits.
 */
export function parseXml(src: string, limits: XmlLimits = {}): XmlElement {
  const maxChars = limits.maxChars ?? XML_LIMITS.maxChars;
  const maxDepth = limits.maxDepth ?? XML_LIMITS.maxDepth;
  const maxElements = limits.maxElements ?? XML_LIMITS.maxElements;
  if (src.length > maxChars) throw new XmlError(`document too big (${src.length} > ${maxChars} characters)`);
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src)) throw new XmlError('DTDs and entity declarations are not accepted');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let count = 0;
  let i = 0;
  const addText = (t: string) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (t.trim()) throw new XmlError('text outside the root element');
      return;
    }
    if (!t) return;
    const last = top.children[top.children.length - 1];
    if (typeof last === 'string') top.children[top.children.length - 1] = last + t;
    else top.children.push(t);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      addText(decodeEntities(src.slice(i)));
      break;
    }
    if (lt > i) addText(decodeEntities(src.slice(i, lt)));
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('unterminated processing instruction');
      i = end + 2;
    } else if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('unterminated comment');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('unterminated CDATA section');
      if (!stack.length) throw new XmlError('CDATA outside the root element');
      addText(src.slice(lt + 9, end));
      i = end + 3;
    } else if (src.startsWith('<!', lt)) {
      throw new XmlError('declarations are not accepted');
    } else if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt + 2);
      if (end < 0) throw new XmlError('unterminated end tag');
      const qname = src.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top) throw new XmlError(`unexpected </${qname}>`);
      const want = top.prefix ? `${top.prefix}:${top.name}` : top.name;
      if (qname !== want) throw new XmlError(`</${qname}> closes <${want}>`);
      i = end + 1;
    } else {
      const end = tagEnd(src, lt + 1);
      if (end < 0) throw new XmlError('unterminated tag');
      let body = src.slice(lt + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const sp = body.search(/\s/);
      const qname = sp < 0 ? body : body.slice(0, sp);
      if (!NAME.test(qname)) throw new XmlError(`bad element name <${qname.slice(0, 40)}>`);
      if (++count > maxElements) throw new XmlError(`too many elements (> ${maxElements})`);
      const attrs: Record<string, string> = {};
      if (sp >= 0) {
        for (const m of body.slice(sp).matchAll(ATTR)) attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '');
      }
      const el: XmlElement = { ...split(qname), attrs, children: [] };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) throw new XmlError('more than one root element');
      else root = el;
      if (!selfClosing) {
        stack.push(el);
        if (stack.length > maxDepth) throw new XmlError(`nested too deep (> ${maxDepth})`);
      }
      i = end + 1;
    }
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1]!.name}> is never closed`);
  if (!root) throw new XmlError('no root element');
  return root;
}

/* Reading helpers. Names are local names (no prefix). */

export function kids(el: XmlElement | undefined, name?: string): XmlElement[] {
  if (!el) return [];
  const out: XmlElement[] = [];
  for (const c of el.children) if (typeof c !== 'string' && (name === undefined || c.name === name)) out.push(c);
  return out;
}

export function kid(el: XmlElement | undefined, name: string): XmlElement | undefined {
  if (!el) return undefined;
  for (const c of el.children) if (typeof c !== 'string' && c.name === name) return c;
  return undefined;
}

/** All the text inside an element (its descendants' too), trimmed. */
export function textOf(el: XmlElement | undefined): string {
  if (!el) return '';
  let s = '';
  const walk = (e: XmlElement) => {
    for (const c of e.children) s += typeof c === 'string' ? c : (walk(c), '');
  };
  walk(el);
  return s.trim();
}

/** Text of the first child called `name`, or `''`. */
export const childText = (el: XmlElement | undefined, name: string): string => textOf(kid(el, name));
