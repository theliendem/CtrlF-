import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasFetch } from '../src/background/canvas.ts';
import { createCanvasApiReader, readCanvasApi } from '../src/content/canvas.ts';
import { canvasList, discoverCourse } from '../src/engine/canvas.ts';
import { downloadCanvasFile } from '../src/engine/files.ts';
import type { CanvasApiGetMsg, ContentMsg } from '../src/shared/types.ts';

const context = { origin: 'https://canvas.wisc.edu', courseId: '123', sourceTabId: 42 };
const page = `${context.origin}/courses/123/pages/home`;
const url = `${context.origin}/api/v1/courses/123/modules`;
const signal = new AbortController().signal;
const message = (apiUrl = url): CanvasApiGetMsg => ({ type: 'canvas-api-get', requestId: 'test', url: apiUrl, context });

test('Canvas page requests use the tab session and preserve pagination without forwarding cookies', async (t) => {
  const link = '</api/v1/courses/123/modules?page=2>; rel="next"';
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(input, url);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, signal);
    return new Response('while(1);[{"id":1}]', { headers: { Link: link, 'Set-Cookie': 'session=private' } });
  });
  assert.deepEqual(await readCanvasApi(message(), page, signal), { status: 200, body: 'while(1);[{"id":1}]', link });
});

test('Canvas tab transport refuses unsafe URLs, other courses, and a navigated source tab', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('[]'));
  for (const target of [url.replace('canvas.wisc.edu', 'evil.example'), url.replace('/123/', '/456/'), url.replace('/modules', '/quizzes'), `${url}?_method=DELETE`]) {
    await assert.rejects(readCanvasApi(message(target), page, signal), /Blocked unsafe/);
  }
  for (const changed of ['https://other.example/courses/123', `${context.origin}/courses/1234`, `${context.origin}/login`]) {
    await assert.rejects(readCanvasApi(message(), changed, signal), /original Canvas tab changed/);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('Canvas discovery and pagination stay bound to the source tab and never use background fetch', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Background fetch would return HTTP 401'); });
  const requests: ContentMsg[] = [];
  const transport = createCanvasFetch(async (tabId, msg) => {
    assert.equal(tabId, 42);
    assert.equal(msg.type, 'canvas-api-get');
    requests.push(msg);
    if (msg.type !== 'canvas-api-get') throw new Error('Unexpected cancellation');
    return msg.url.includes('page=2')
      ? { status: 200, body: '[{"id":2,"name":"Second module","items":[]}]', link: null }
      : { status: 200, body: 'while(1);[{"id":1,"name":"First module","items":[]}]', link: '</api/v1/courses/123/modules?page=2>; rel="next"' };
  });
  const links = await discoverCourse(context, signal, transport);
  assert.equal(requests.length, 2);
  assert.equal(links[0].title, 'First module');
  assert.equal(links[1].title, 'Second module');
});

test('unsafe pagination is still blocked when using the source-tab transport', async () => {
  let calls = 0;
  const transport = createCanvasFetch(async () => {
    calls++;
    return { status: 200, body: '[]', link: '<https://other.example/api/v1/courses/123/modules>; rel="next"' };
  });
  await assert.rejects(canvasList(url, context, signal, transport), /Blocked unsafe/);
  assert.equal(calls, 1);
});

test('Canvas cancellation reaches the in-tab network request', async (t) => {
  let fetchSignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', (_input, init) => new Promise((_resolve, reject) => {
    fetchSignal = init!.signal!;
    fetchSignal.addEventListener('abort', () => reject(fetchSignal!.reason), { once: true });
  }));
  const reader = createCanvasApiReader(() => page);
  const transport = createCanvasFetch(async (_tabId, msg) => {
    if (msg.type === 'canvas-api-get') return reader.read(msg);
    if (msg.type === 'canvas-api-cancel') reader.cancel(msg.requestId);
  });
  const controller = new AbortController();
  const pending = transport(url, context, controller.signal);
  assert.ok(fetchSignal);
  controller.abort();
  await assert.rejects(pending, /abort/i);
  assert.equal(fetchSignal.aborted, true);
});

test('missing tabs and expired Canvas sessions produce actionable errors', async () => {
  const closed = createCanvasFetch(async () => { throw new Error('Missing tab'); });
  await assert.rejects(closed(url, context, signal), /original Canvas tab/);
  const stale = createCanvasFetch(async () => undefined);
  await assert.rejects(stale(url, context, signal), /Reload the Canvas tab/);
  const expired = createCanvasFetch(async () => ({ status: 401, body: '{}', link: null }));
  await assert.rejects(canvasList(url, context, signal, expired), /Canvas HTTP 401: sign in again/);
});

test('Canvas file metadata uses the tab session; signed external downloads omit credentials', async (t) => {
  let metadata = false;
  const transport = createCanvasFetch(async (tabId, msg) => {
    assert.equal(tabId, 42);
    assert.equal(msg.type, 'canvas-api-get');
    if (msg.type !== 'canvas-api-get') throw new Error('Unexpected cancellation');
    assert.equal(msg.url, `${context.origin}/api/v1/courses/123/files/7`);
    metadata = true;
    return { status: 200, link: null, body: JSON.stringify({ filename: 'notes.pdf', 'content-type': 'application/pdf', size: 3, url: 'https://files.example/notes.pdf?signature=test' }) };
  });
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.ok(metadata);
    assert.equal(input, 'https://files.example/notes.pdf?signature=test');
    assert.equal(init?.credentials, 'omit');
    return new Response(new Uint8Array([1, 2, 3]));
  });
  const file = await downloadCanvasFile(`${context.origin}/courses/123/files/7`, context, signal, transport);
  assert.equal(file.kind, 'pdf');
  assert.deepEqual([...file.bytes], [1, 2, 3]);
});
