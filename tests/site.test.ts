import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digLink, filterLinks, siteFileKind, siteLink, skippedLinks } from '../src/engine/links.ts';
import { fetchSite, MIN_WORDS } from '../src/engine/site.ts';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { PageText } from '../src/shared/types.ts';

const site = { origin: 'https://cs.wisc.edu' };
const base = 'https://cs.wisc.edu/courses/cs400/';
const signal = new AbortController().signal;

test('site filter keeps same-origin pages and supported files, drops everything else', () => {
  const blocked = [
    'https://other.edu/page', 'mailto:a@b.c', 'javascript:alert(1)', '/logout', '/user/login?next=/', '/account/settings',
    '/help/faq', '/cart', '/wp-admin/post.php', '/images/logo.png', '/style.css', '/notes.doc', '/old.ppt', 'https://u:p@cs.wisc.edu/x',
  ];
  for (const url of blocked) assert.equal(siteLink(url, base, site), null, url);
  assert.equal(siteLink('schedule/#week3', base, site), 'https://cs.wisc.edu/courses/cs400/schedule/');
  assert.equal(siteLink('/news?page=2&utm_source=x', base, site), 'https://cs.wisc.edu/news?page=2');
  assert.equal(siteLink('/files/midterm.PDF', base, site), 'https://cs.wisc.edu/files/midterm.PDF');
  assert.equal(siteLink('/', base, site), 'https://cs.wisc.edu/');
  assert.equal(siteFileKind('https://cs.wisc.edu/a/slides.pptx'), 'pptx');
  assert.equal(siteFileKind('https://cs.wisc.edu/a/page'), null);
  // The same filter is used for Canvas URLs only when the context has a course.
  assert.equal(digLink('/courses/1/pages/x', base, site), 'https://cs.wisc.edu/courses/1/pages/x');
});

test('site links deduplicate, and same-page anchors are dropped', () => {
  const links = filterLinks([
    { url: '#top', title: 'Top', heading: '' },
    { url: base, title: 'Self', heading: '' },
    { url: 'schedule', title: 'Schedule', heading: '' },
    { url: 'schedule#later', title: 'Schedule again', heading: '' },
    { url: 'https://elsewhere.org/', title: 'Off-site', heading: '' },
  ], base, site);
  assert.deepEqual(links.map((l) => l.url), ['https://cs.wisc.edu/courses/cs400/schedule']);
  const stubs = skippedLinks([{ url: 'https://elsewhere.org/', title: 'Off-site', heading: '' }], base, site, { ...DEFAULT_SETTINGS, showOffsite: true });
  assert.deepEqual(stubs.map((s) => s.state), ['not-followed']);
});

function respond(body: string | Uint8Array, type: string, url: string, status = 200) {
  return {
    ok: status < 400, status, url,
    headers: new Headers({ 'content-type': type }),
    text: async () => String(body),
    arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body) : body).buffer,
  } as unknown as Response;
}
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const fakeParse = (html: string, url: string): PageText => ({ url, title: 'T', blocks: [html.replace(/<[^>]+>/g, ' ').trim()], links: [{ url: 'next', title: 'Next', heading: '' }] });

test('site fetch is a credentialed GET, resolves links against where it landed', async (t) => {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => { calls.push(init); return respond(`<p>${words(80)}</p>`, 'text/html; charset=utf-8', 'https://cs.wisc.edu/courses/cs400/home/'); });
  const got = await fetchSite('https://cs.wisc.edu/courses/cs400/home', site, signal, fakeParse);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].credentials, 'include');
  assert.ok('page' in got);
  if ('page' in got) {
    assert.equal(got.needsTab, false);
    assert.equal(got.page.links[0].url, 'https://cs.wisc.edu/courses/cs400/home/next');
  }
});

test('a nearly empty page with scripts asks for a real tab; a short static page does not', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => respond(`<div id="app"></div><script src="app.js"></script>`, 'text/html', 'https://cs.wisc.edu/app'));
  const app = await fetchSite('https://cs.wisc.edu/app', site, signal, fakeParse);
  assert.ok('page' in app && app.needsTab);
  t.mock.method(globalThis, 'fetch', async () => respond(`<p>${words(MIN_WORDS - 10)}</p>`, 'text/html', 'https://cs.wisc.edu/short'));
  const short = await fetchSite('https://cs.wisc.edu/short', site, signal, fakeParse);
  assert.ok('page' in short && !short.needsTab);
});

test('off-site redirects, non-pages and blocked links are refused; PDFs come back as files', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => respond('<p>hi</p>', 'text/html', 'https://login.other.edu/sso'));
  await assert.rejects(fetchSite('https://cs.wisc.edu/private', site, signal, fakeParse), /off-site/);
  t.mock.method(globalThis, 'fetch', async () => respond('x', 'image/png', 'https://cs.wisc.edu/pic'));
  await assert.rejects(fetchSite('https://cs.wisc.edu/pic', site, signal, fakeParse), /Not a web page/);
  await assert.rejects(fetchSite('https://cs.wisc.edu/logout', site, signal, fakeParse), /Blocked/);
  t.mock.method(globalThis, 'fetch', async () => respond(new Uint8Array([37, 80, 68, 70]), 'application/pdf', 'https://cs.wisc.edu/files/exam.pdf'));
  const pdf = await fetchSite('https://cs.wisc.edu/files/exam.pdf', site, signal, fakeParse);
  assert.ok('file' in pdf && pdf.file.kind === 'pdf' && pdf.file.title === 'exam.pdf');
});
