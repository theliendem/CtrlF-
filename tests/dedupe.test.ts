import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageIdentity, textFingerprint, urlKey } from '../src/engine/identity.ts';
import { siteLink } from '../src/engine/links.ts';
import { hitStrength, SEMANTIC_RELEVANT } from '../src/shared/types.ts';
import { strengthColor } from '../src/sidepanel/graph.ts';

const article = Array.from({ length: 80 }, (_, i) => `Hitler died by suicide in the Führerbunker on 30 April 1945 sentence ${i}.`);
const shares = (a: string[], b: string[]): boolean => a.some((key) => b.includes(key));

test('a redirect alias and the article it points to share an identity', () => {
  const real = pageIdentity('https://en.wikipedia.org/wiki/Death_of_Adolf_Hitler', 'https://en.wikipedia.org/wiki/Death_of_Adolf_Hitler', article);
  // Wikipedia serves /wiki/Death_of_Hitler with 200 and a canonical pointing at the article.
  const alias = pageIdentity('https://en.wikipedia.org/wiki/Death_of_Hitler', 'https://en.wikipedia.org/wiki/Death_of_Adolf_Hitler', article);
  assert.ok(shares(real, alias));
  // Same text with no canonical (a ?title= view) is still caught by the fingerprint.
  const viaTitle = pageIdentity('https://en.wikipedia.org/w/index.php?title=Death_of_Adolf_Hitler', undefined, [...article]);
  assert.ok(shares(real, viaTitle));
  // A #section link is the same document.
  assert.ok(shares(real, pageIdentity('https://en.wikipedia.org/wiki/Death_of_Adolf_Hitler#Aftermath', undefined, [])));
});

test('different pages, and short generic pages, are not merged', () => {
  const a = pageIdentity('https://site.edu/a', undefined, article);
  const b = pageIdentity('https://site.edu/b', undefined, article.map((s) => s.replace('Hitler', 'Himmler')));
  assert.ok(!shares(a, b));
  assert.equal(textFingerprint(['Loading…']), null);
});

test('Canvas module API reads have distinct identities from each other and the module index', () => {
  const base = 'https://canvas.wisc.edu/courses/123/modules';
  const index = pageIdentity(base, undefined, []);
  const first = pageIdentity(`${base}#context_module_11`, undefined, []);
  const second = pageIdentity(`${base}#context_module_22`, undefined, []);
  assert.ok(!shares(first, second));
  assert.ok(!shares(index, first));
  assert.ok(!shares(index, second));
  assert.ok(shares(first, pageIdentity(`${base}#context_module_11`, undefined, [])));
  // Other section anchors still identify the same document, even on Canvas.
  assert.equal(urlKey(`${base}#top`), urlKey(base));
  assert.equal(urlKey('https://site.edu/courses/123/modules#context_module_11'),
    urlKey('https://site.edu/courses/123/modules'));
});

test('Canvas module discovery retains all child links regardless of read completion order', () => {
  const base = 'https://canvas.wisc.edu/courses/123/modules';
  const modules = [
    { url: `${base}#context_module_11`, links: ['doubly-linked-lists'] },
    { url: `${base}#context_module_22`, links: ['overview-linked-lists', 'program-7', 'llm-linked-lists'] },
  ];
  for (const reads of [modules, [...modules].reverse()]) {
    const seen = new Set(pageIdentity(base, undefined, []));
    const discovered: string[] = [];
    for (const read of reads) {
      // The background drops duplicate reads before enqueuing their child links.
      const keys = pageIdentity(read.url, undefined, []);
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      discovered.push(...read.links);
    }
    assert.deepEqual(discovered.sort(), modules.flatMap((read) => read.links).sort());
  }
});

test('wiki revision, diff, history and namespace links are never queued', () => {
  const context = { origin: 'https://en.wikipedia.org' };
  const base = 'https://en.wikipedia.org/wiki/Adolf_Hitler';
  for (const raw of [
    '/w/index.php?title=Death_of_Adolf_Hitler&diff=1234&oldid=1200',
    '/w/index.php?title=Death_of_Adolf_Hitler&oldid=1200',
    '/w/index.php?title=Death_of_Adolf_Hitler&action=history',
    '/wiki/Talk:Death_of_Adolf_Hitler',
    '/wiki/Special:WhatLinksHere/Adolf_Hitler',
    '/wiki/File:Hitler_portrait.jpg',
    '/wiki/Category:1945_deaths',
  ]) assert.equal(siteLink(raw, base, context), null, raw);
  assert.equal(siteLink('/wiki/Death_of_Adolf_Hitler', base, context), 'https://en.wikipedia.org/wiki/Death_of_Adolf_Hitler');
  // action= is only a wiki view on index.php; elsewhere it can be ordinary content.
  assert.ok(siteLink('https://shop.example/list?action=view', 'https://shop.example/', { origin: 'https://shop.example' }));
});

test('hit strength runs red at the cutoff to green at strong matches', () => {
  assert.equal(hitStrength('semantic', SEMANTIC_RELEVANT), 0);
  assert.equal(hitStrength('semantic', 0.9), 1);
  assert.ok(hitStrength('semantic', 0.45) > 0.4 && hitStrength('semantic', 0.45) < 0.6);
  assert.equal(hitStrength('exact', 1), 1);
  assert.equal(strengthColor(0), 'hsl(0 72% 48%)');
  assert.equal(strengthColor(1), 'hsl(120 72% 48%)');
  assert.equal(strengthColor(undefined), 'hsl(120 72% 48%)');
});
