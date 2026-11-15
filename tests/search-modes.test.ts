import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeMsg } from '../src/shared/types.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

let listener: (message: RuntimeMsg, sender: unknown, respond: (response: any) => void) => unknown;
Object.assign(globalThis, { chrome: { runtime: { onMessage: { addListener: (handler: typeof listener) => { listener = handler; } } } } });
await import('../src/offscreen/index.ts');
const send = (message: RuntimeMsg): Promise<any> => new Promise((resolve) => listener(message, {}, resolve));
const context = { origin: 'https://canvas.wisc.edu', courseId: '123' };
const base = `${context.origin}/courses/123`;

test('semantic mode returns unavailable without fetching a page or running scoring', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const result = await send({ to: 'offscreen', type: 'dig-read', run: 1, query: 'exam', context, url: base, depth: 0, settings: { ...DEFAULT_SETTINGS, mode: 'semantic' }, visited: [] });
  assert.match(result.error, /Semantic search is not available/);
  const scored = await send({ to: 'offscreen', type: 'score-page', mode: 'semantic', query: 'exam', url: base, blocks: ['exam'] });
  assert.match(scored.error, /not available/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('exact engine queues every module and every nested file with unrelated titles', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    return new Response(JSON.stringify(url.pathname.endsWith('/items')
      ? Array.from({ length: 23 }, (_, i) => ({ id: i + 1, content_id: i + 100, title: `Week ${i} notes`, type: 'File' }))
      : Array.from({ length: 22 }, (_, i) => ({ id: i + 1, name: `Week ${i}`, items_count: 23 }))));
  });
  const root = await send({ to: 'offscreen', type: 'dig-read', run: 2, query: 'aardvark', context, url: base, depth: 0, settings: DEFAULT_SETTINGS, visited: [base], seed: [] });
  assert.equal(root.links.length, 25); // 22 modules plus syllabus, assignments, announcements.
  const nested = await send({ to: 'offscreen', type: 'dig-read', run: 2, query: 'aardvark', context, url: root.links[0].url, depth: 1, settings: DEFAULT_SETTINGS, visited: [base] });
  assert.equal(nested.links.length, 23);
  assert.ok(nested.links.every((link: { url: string }) => link.url.includes('/files/')));
  const limited = await send({ to: 'offscreen', type: 'dig-read', run: 2, query: 'aardvark', context, url: root.links[0].url, depth: 1, settings: { ...DEFAULT_SETTINGS, maxDepth: 1 }, visited: [] });
  assert.equal(limited.links.length, 0);
});

test('exact page scoring needs no model and finds the phrase across text blocks', async () => {
  const result = await send({ to: 'offscreen', type: 'score-page', mode: 'exact', query: 'midterm 2', url: base, blocks: ['MIDTERM', '2 is Friday. Homework is Monday.'] });
  assert.equal(result.passages.length, 1);
  assert.deepEqual(result.passages[0].marks, ['MIDTERM\n2']);
});

test('a second read of the same pages works offline from the cache', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    calls++;
    const url = new URL(input);
    return new Response(JSON.stringify(url.pathname.endsWith('/items')
      ? [{ id: 1, content_id: 7, title: 'Exam notes', type: 'File' }]
      : [{ id: 41, name: 'Week 41', items_count: 1 }]));
  });
  const other = { origin: 'https://canvas.wisc.edu', courseId: '777' };
  const otherBase = `${other.origin}/courses/777`;
  const first = await send({ to: 'offscreen', type: 'dig-read', run: 3, query: 'exam', context: other, url: otherBase, depth: 0, settings: DEFAULT_SETTINGS, visited: [], seed: [] });
  const module = await send({ to: 'offscreen', type: 'dig-read', run: 3, query: 'exam', context: other, url: first.links[0].url, depth: 1, settings: DEFAULT_SETTINGS, visited: [] });
  const online = calls;
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  const again = await send({ to: 'offscreen', type: 'dig-read', run: 4, query: 'exam', context: other, url: otherBase, depth: 0, settings: DEFAULT_SETTINGS, visited: [], seed: [] });
  const moduleAgain = await send({ to: 'offscreen', type: 'dig-read', run: 4, query: 'exam', context: other, url: first.links[0].url, depth: 1, settings: DEFAULT_SETTINGS, visited: [] });
  assert.ok(online > 0);
  assert.equal(again.error, undefined);
  assert.deepEqual(again.links, first.links);
  assert.deepEqual(moduleAgain.links, module.links);
});
