import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexHops, MatchBar } from '../src/background/matching.ts';
import { indexLinks, siteLink } from '../src/engine/links.ts';
import { MAX_INDEX_HOPS, NEAR_BEST, SEMANTIC_RELEVANT, type Passage, type TreeNode } from '../src/shared/types.ts';

const p = (score: number, marks = ['m']): Passage => ({ text: 't', marks, score, cos: score, kw: 0 });

test('semantic matches must be near the best match so far; weak word-sharing pages drop out', () => {
  const bar = new MatchBar('semantic');
  // Scores measured on live Wikipedia for "linked list".
  const shopping = bar.matches([p(0.71)]);
  assert.equal(shopping.matches.length, 1); // the best so far, so it counts for now
  const real = bar.matches([p(0.857)]);
  assert.equal(real.matches.length, 1);
  assert.equal(real.raised, true);
  assert.deepEqual(bar.keep([p(0.71)]), []); // Shopping list falls out
  assert.equal(bar.keep([p(0.785)]).length, 1); // Doubly linked list stays
  assert.equal(bar.matches([p(0.382)]).matches.length, 0); // List of 2025 albums never counts
});

test('the bar never drops below the semantic cutoff, and matches need marks', () => {
  const bar = new MatchBar('semantic');
  assert.equal(bar.floor(), SEMANTIC_RELEVANT);
  bar.matches([p(0.3)]);
  assert.equal(bar.floor(), SEMANTIC_RELEVANT); // 0.3 - 0.1 is under the cutoff
  assert.equal(bar.matches([p(0.29, [])]).matches.length, 0);
  // A Canvas-style question match (low absolute score) still counts when it's the best.
  assert.equal(new MatchBar('semantic').matches([p(0.281)]).matches.length, 1);
  assert.ok(Math.abs(NEAR_BEST - 0.1) < 1e-9);
});

test('exact mode keeps its fixed bar', () => {
  const bar = new MatchBar('exact');
  bar.matches([p(1)]);
  assert.equal(bar.matches([p(1)]).raised, false);
  assert.equal(bar.keep([p(1)]).length, 1);
});

const node = (extra: Partial<TreeNode> = {}): TreeNode => ({ id: 'x', parentId: null, url: 'https://a.b/x', title: 'x', kind: 'page', state: 'ruled-out', depth: 1, best: 0, ...extra });

test('index pages can be chained at most twice in a row', () => {
  assert.equal(indexHops(node()), 1);
  assert.equal(indexHops(node({ index: true, indexHops: 1 })), 2);
  assert.equal(indexHops(node({ index: true, indexHops: MAX_INDEX_HOPS })), null);
});

test('index links: wiki portals, categories and contents, plus course and site index pages', () => {
  const wiki = { origin: 'https://en.wikipedia.org' };
  const base = 'https://en.wikipedia.org/wiki/Main_Page';
  const links = [
    { url: '/wiki/Wikipedia:Contents/Portals', title: 'Content portals', heading: '' },
    { url: '/wiki/Portal:Current_events', title: 'More current events', heading: '' },
    { url: '/wiki/Category:Data_structures', title: 'Data structures', heading: '' },
    { url: '/wiki/Linked_list', title: 'Linked list', heading: '' },
    { url: '/wiki/Special:Random', title: 'Random article', heading: '' },
    { url: '/wiki/Talk:Main_Page', title: 'Talk', heading: '' },
    // Seen live: citation-maintenance categories and prose links that just say "index".
    { url: '/wiki/Category:CS1_maint:_multiple_names:_authors_list', title: 'link', heading: '' },
    { url: '/wiki/Indexed_family', title: 'index', heading: '' },
  ];
  assert.deepEqual(indexLinks(links, base, wiki).map((l) => l.url.replace(wiki.origin, '')), [
    '/wiki/Wikipedia:Contents/Portals', '/wiki/Portal:Current_events', '/wiki/Category:Data_structures',
  ]);
  assert.ok(indexLinks(links, base, wiki).every((l) => l.index));
  // Ordinary link filtering still never queues those namespaces.
  assert.equal(siteLink('/wiki/Portal:Arts', base, wiki), null);
  const course = { origin: 'https://cs.wisc.edu' };
  const found = indexLinks([
    { url: '/cs400/lectures/', title: 'Lectures', heading: '' },
    { url: '/cs400/x', title: 'Schedule', heading: '' },
    { url: '/cs400/hw1', title: 'Homework 1', heading: '' },
  ], 'https://cs.wisc.edu/cs400/', course);
  assert.deepEqual(found.map((l) => l.title), ['Lectures', 'Schedule']);
});
