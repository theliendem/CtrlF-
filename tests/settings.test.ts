import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/settings.ts';
import { skippedLinks, filterLinks } from '../src/engine/links.ts';

test('settings default to 200 pages and clamp invalid saved values', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ pageBudget: 5000, maxDepth: -3, showOffsite: true, showUnreadable: 'yes' }), { mode: 'exact', pageBudget: 1000, maxDepth: 1, showOffsite: true, showUnreadable: false });
  assert.equal(normalizeSettings({ pageBudget: NaN }).pageBudget, 200);
  assert.equal(normalizeSettings({ pageBudget: 3, maxDepth: 2 }).pageBudget, 3);
});

test('external stubs stay unfetched while Canvas files now enter the reader', () => {
  const context = { origin: 'https://canvas.wisc.edu', courseId: '123' };
  const base = `${context.origin}/courses/123`;
  const links = [
    { url: 'https://example.com/notes', title: 'External notes', heading: '' },
    { url: `${base}/files/456`, title: 'Slides', heading: '' },
  ];
  assert.equal(skippedLinks(links, base, context, DEFAULT_SETTINGS).length, 0);
  assert.deepEqual(skippedLinks(links, base, context, { ...DEFAULT_SETTINGS, showOffsite: true }).map((n) => n.state), ['not-followed']);
  assert.deepEqual(skippedLinks(links, base, context, { ...DEFAULT_SETTINGS, showUnreadable: true }), []);
  assert.equal(filterLinks(links, base, context).length, 1);
});
