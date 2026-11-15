import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasContext, filterLinks, safeLink } from '../src/engine/links.ts';
import { allowedApi, canvasGet, canvasList, discoverCourse, readCanvas } from '../src/engine/canvas.ts';

const context = { origin: 'https://canvas.wisc.edu', courseId: '123' };
const base = `${context.origin}/courses/123`;
const signal = new AbortController().signal;

test('course detection and free filter exclude unsafe, off-site, cross-course and duplicate links', () => {
  assert.deepEqual(canvasContext(`${base}/pages/home`), context);
  assert.equal(canvasContext('https://example.com/courses/123'), null);
  const blocked = [
    '/courses/123/quizzes/2', '/courses/123/assignments/2/submissions/3', '/courses/123/grades',
    '/courses/123/people', '/conversations', '/logout', '/courses/123/pages/delete',
    '/courses/124/pages/home', 'https://example.com/courses/123/pages/home',
    '/courses/123/external_tools/7', 'javascript:alert(1)', '#section',
    '/courses/123/pages/%2e%2e/quizzes/1', '/courses/123/pages/a%2Fquizzes%2F1',
  ];
  for (const url of blocked) assert.equal(safeLink(url, base, context), null, url);
  const links = filterLinks([
    { url: '/courses/123/pages/midterm?module_item_id=1', title: 'Midterm', heading: '' },
    { url: '/courses/123/pages/midterm', title: 'Duplicate', heading: '' },
    { url: '#section', title: 'Same page', heading: '' },
  ], base, context);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, `${base}/pages/midterm`);
  assert.equal(safeLink(`${base}/modules#context_module_9`, base, context), `${base}/modules#context_module_9`);
});

test('API allowlist denies unsafe endpoints and other courses', () => {
  for (const path of ['/api/v1/courses/123/quizzes', '/api/v1/courses/123/assignments/1/submissions', '/api/v1/courses/1234', '/api/v1/courses/123/users', '/api/v1/announcements?context_codes[]=course_456', '/api/v1/courses/123/pages/a%2Fquizzes%2F1', '/api/v1/courses/123/assignments?include[]=submissions', '/api/v1/courses/123/modules?_method=DELETE']) {
    assert.equal(allowedApi(new URL(path, context.origin), context), false, path);
  }
  assert.equal(allowedApi(new URL('/api/v1/courses/123/modules/9/items', context.origin), context), true);
});

test('pagination strips anti-JSON prefix and sends only credentialed GETs without redirects', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit) => {
    calls.push(String(input));
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'include');
    assert.equal(init.redirect, 'error');
    assert.equal(init.signal, signal);
    return calls.length === 1
      ? new Response('while(1);[{"id":1}]', { headers: { Link: '</api/v1/courses/123/modules?page=2>; rel="next"' } })
      : new Response('[{"id":2}]');
  });
  assert.deepEqual(await canvasList('/api/v1/courses/123/modules', context, signal), [{ id: 1 }, { id: 2 }]);
  assert.equal(calls.length, 2);
});

test('malicious pagination is rejected before the second fetch', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return new Response('[]', { headers: { Link: '<https://evil.example/api/v1/courses/123/modules>; rel="next"' } });
  });
  await assert.rejects(canvasList('/api/v1/courses/123/modules', context, signal), /Blocked unsafe/);
  assert.equal(count, 1);
  await assert.rejects(canvasGet('/api/v1/courses/123/quizzes', context, signal), /Blocked unsafe/);
  assert.equal(count, 1);
});

test('HTTP errors, invalid JSON and pagination loops are reported', async (t) => {
  const mocked = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  await assert.rejects(canvasList('/api/v1/courses/123/modules', context, signal), /HTTP 403/);
  mocked.mock.mockImplementation(async () => new Response('<html>Login</html>'));
  await assert.rejects(canvasList('/api/v1/courses/123/modules', context, signal), SyntaxError);
  mocked.mock.mockImplementation(async () => new Response('[]', { headers: { Link: '</api/v1/courses/123/modules>; rel="next"' } }));
  await assert.rejects(canvasList('/api/v1/courses/123/modules', context, signal), /pagination loop/);
});

test('module discovery keeps safe item titles and reads paginated items, excluding quizzes and files', async (t) => {
  const items = [
    { id: 1, type: 'Page', page_url: 'midterm-2', title: 'Midterm 2 review' },
    { id: 2, type: 'Quiz', content_id: 42, title: 'Secret quiz' },
    { id: 3, type: 'File', content_id: 99, title: 'Slides' },
    { id: 4, type: 'ExternalUrl', external_url: 'https://evil.example/', title: 'External' },
  ];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/items')) return new Response(JSON.stringify(items));
    return new Response(JSON.stringify([{ id: 7, name: 'Week 7', items_count: 4, items }]));
  });
  const links = await discoverCourse(context, signal);
  assert.equal(links[0].url, `${base}/modules#context_module_7`);
  assert.ok(links[0].heading.includes('Midterm 2 review'));
  assert.ok(!links[0].heading.includes('Secret quiz'));
  const page = await readCanvas(links[0].url, context, signal);
  assert.equal(page.links.length, 1);
  assert.equal(page.links[0].url, `${base}/pages/midterm-2`);
});

test('quiz assignments are skipped instead of being scored as regular assignments', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 1, name: 'Quiz', is_quiz_assignment: true })));
  await assert.rejects(readCanvas(`${base}/assignments/1`, context, signal), /quiz assignment skipped/);
});
