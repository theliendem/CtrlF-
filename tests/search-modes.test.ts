import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeMsg } from '../src/shared/types.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';

const EXACT = { ...DEFAULT_SETTINGS, mode: 'exact' as const };

let listener: (message: RuntimeMsg, sender: unknown, respond: (response: any) => void) => unknown;
Object.assign(globalThis, { chrome: { runtime: { onMessage: { addListener: (handler: typeof listener) => { listener = handler; } } } } });
await import('../src/offscreen/entry.ts');
const send = (message: RuntimeMsg): Promise<any> => new Promise((resolve) => listener(message, {}, resolve));
const context = { origin: 'https://canvas.wisc.edu', courseId: '123' };
const base = `${context.origin}/courses/123`;

test('semantic settings no longer stop a read before it starts', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('[]'));
  // A depth-limited seed read with no links needs no model and must not be refused.
  const own = { origin: context.origin, courseId: '999' }; // own course: the read cache is shared across tests
  const result = await send({ to: 'offscreen', type: 'dig-read', run: 1, query: 'exam', context: own, url: `${own.origin}/courses/999`, depth: 5, settings: { ...DEFAULT_SETTINGS, mode: 'semantic' }, visited: [], seed: [] });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.links, []);
});

test('exact link picking for tab-read pages queues every link without the model', async () => {
  const links = [{ url: `${base}/pages/a`, title: 'A', heading: '' }, { url: `${base}/pages/b`, title: 'B', heading: '' }];
  const picked = await send({ to: 'offscreen', type: 'score-links', mode: 'exact', query: 'aardvark', links, depth: 1, context, from: base });
  assert.deepEqual(picked.links.map((l: { score: number }) => l.score), [0, 0]);
});

test('exact engine queues every module and every nested file with unrelated titles', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    return new Response(JSON.stringify(url.pathname.endsWith('/items')
      ? Array.from({ length: 23 }, (_, i) => ({ id: i + 1, content_id: i + 100, title: `Week ${i} notes`, type: 'File' }))
      : Array.from({ length: 22 }, (_, i) => ({ id: i + 1, name: `Week ${i}`, items_count: 23 }))));
  });
  const root = await send({ to: 'offscreen', type: 'dig-read', run: 2, query: 'aardvark', context, url: base, depth: 0, settings: EXACT, visited: [base], seed: [] });
  assert.equal(root.links.length, 26); // 22 modules plus syllabus, assignments, announcements, pages.
  const nested = await send({ to: 'offscreen', type: 'dig-read', run: 2, query: 'aardvark', context, url: root.links[0].url, depth: 1, settings: EXACT, visited: [base] });
  assert.equal(nested.links.length, 23);
  assert.ok(nested.links.every((link: { url: string }) => link.url.includes('/files/')));
  const limited = await send({ to: 'offscreen', type: 'dig-read', run: 2, query: 'aardvark', context, url: root.links[0].url, depth: 1, settings: { ...EXACT, maxDepth: 1 }, visited: [] });
  assert.equal(limited.links.length, 0);
});

test('exact page scoring needs no model and finds the phrase across text blocks', async () => {
  const result = await send({ to: 'offscreen', type: 'score-page', mode: 'exact', query: 'midterm 2', url: base, blocks: ['MIDTERM', '2 is Friday. Homework is Monday.'], keepCache: false });
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
  const first = await send({ to: 'offscreen', type: 'dig-read', run: 3, query: 'exam', context: other, url: otherBase, depth: 0, settings: EXACT, visited: [], seed: [] });
  const module = await send({ to: 'offscreen', type: 'dig-read', run: 3, query: 'exam', context: other, url: first.links[0].url, depth: 1, settings: EXACT, visited: [] });
  const online = calls;
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  const again = await send({ to: 'offscreen', type: 'dig-read', run: 4, query: 'exam', context: other, url: otherBase, depth: 0, settings: EXACT, visited: [], seed: [] });
  const moduleAgain = await send({ to: 'offscreen', type: 'dig-read', run: 4, query: 'exam', context: other, url: first.links[0].url, depth: 1, settings: EXACT, visited: [] });
  assert.ok(online > 0);
  assert.equal(again.error, undefined);
  assert.deepEqual(again.links, first.links);
  assert.deepEqual(moduleAgain.links, module.links);
});

test('exact engine ranks link titles, URLs and headings while retaining every candidate', async () => {
  const links = [
    { url: `${base}/pages/policies`, title: 'Policies', heading: '' },
    { url: `${base}/pages/review`, title: 'Midterm 2 review', heading: '' },
    { url: `${base}/pages/midterm-2`, title: 'Notes', heading: '' },
    { url: `${base}/pages/misc`, title: 'Resources', heading: 'Midterm 2' },
  ];
  const picked = await send({ to: 'offscreen', type: 'score-links', mode: 'exact', query: 'midterm 2', links, depth: 2, context, from: base });
  assert.equal(picked.links.length, links.length);
  assert.ok(picked.links[1].score > picked.links[2].score);
  assert.ok(picked.links[2].score > picked.links[3].score);
  assert.ok(picked.links[3].score > picked.links[0].score);
});

test('Stop cancels starting-page scoring and rejects late work from the stopped search', async () => {
  const run = 100;
  const pending = send({ to: 'offscreen', type: 'score-page', run, mode: 'exact', query: 'midterm', url: base, blocks: ['midterm'], keepCache: false });
  listener({ to: 'offscreen', type: 'cancel-dig', run }, {}, () => {});
  assert.ok((await pending).error);
  const late = await send({ to: 'offscreen', type: 'score-page', run, mode: 'exact', query: 'midterm', url: base, blocks: ['midterm'], keepCache: false });
  assert.match(late.error, /stopped/i);
  const fresh = await send({ to: 'offscreen', type: 'score-page', run: run + 1, mode: 'exact', query: 'midterm', url: base, blocks: ['midterm'], keepCache: false });
  assert.equal(fresh.passages.length, 1);
});


test('link scoring errors remain distinguishable from no matching links', async () => {
  const result = await send({ to: 'offscreen', type: 'score-links', run: 1, mode: 'exact', query: 'exam', links: [], depth: 1, context, from: base });
  assert.ok(result.error);
  assert.deepEqual(result.links, []);
});

test('refresh bypasses cached course maps and retrieves changed content', async (t) => {
  const own = { origin: context.origin, courseId: '888' };
  const url = `${own.origin}/courses/888`;
  let name = 'Original module';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify([{ id: 1, name, items_count: 0 }])); });
  const read = () => send({ to: 'offscreen', type: 'dig-read', run: 200, query: 'module', context: own, url, depth: 0, settings: EXACT, visited: [], seed: [] });
  const first = await read();
  assert.equal(first.error, undefined);
  const initialCalls = calls;
  name = 'Changed module';
  await read();
  assert.equal(calls, initialCalls);
  assert.deepEqual(await send({ to: 'offscreen', type: 'refresh-content' }), { ok: true });
  const fresh = await read();
  assert.ok(calls > initialCalls);
  assert.ok(fresh.links.some((link: { title: string }) => link.title === name));
});
