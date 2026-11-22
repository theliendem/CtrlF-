import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { DEFAULT_SETTINGS } from '../src/shared/settings.ts';
import type { ContentMsg, RuntimeMsg } from '../src/shared/types.ts';

type Listener = (msg: RuntimeMsg, sender: unknown, respond: (value?: unknown) => void) => boolean;
let listener: Listener;
let toolbar: () => void;
let shortcut: (command: string) => void;
let opens = 0;
const messages: RuntimeMsg[] = [];
const content: ContentMsg[] = [];
const base = 'https://example.edu/course/';
const file = `${base}notes.docx`;
const unusedEvent = { addListener() {} };

// No chrome global: all calls must use Firefox's promise-based browser namespace.
Object.assign(globalThis, { DOMParser, browser: {
  sidebarAction: { open: () => { opens++; return Promise.resolve(); } },
  action: { onClicked: { addListener: (fn: typeof toolbar) => { toolbar = fn; } } },
  commands: { onCommand: { addListener: (fn: typeof shortcut) => { shortcut = fn; } } },
  runtime: {
    onInstalled: unusedEvent, onStartup: unusedEvent,
    onMessage: { addListener: (fn: Listener) => { listener = fn; } },
    sendMessage: async (msg: RuntimeMsg) => { messages.push(msg); },
  },
  storage: { onChanged: unusedEvent, local: { get: async () => ({ searchSettings: { ...DEFAULT_SETTINGS, mode: 'exact' } }) } },
  tabs: {
    query: async () => [{ id: 1, windowId: 1, url: base }],
    sendMessage: async (_id: number, msg: ContentMsg) => {
      content.push(msg);
      if (msg.type === 'extract') return { url: base, title: 'Course', blocks: ['The midterm is Friday.'], links: [{ url: file, title: 'Notes', heading: '' }] };
      return true;
    },
  },
} });
await import('../src/background/index.ts');

test('Firefox toolbar and shortcut open the sidebar synchronously, without a command tab', () => {
  toolbar();
  assert.equal(opens, 1);
  shortcut('unrelated');
  assert.equal(opens, 1);
  shortcut('open-search');
  assert.equal(opens, 2);
});

test('Firefox searches and highlights pages, delivers incremental file hits, and holds the response until finished', async (t) => {
  const bytes = await new JSZip().file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Midterm review notes</w:t></w:r></w:p></w:body></w:document>').generateAsync({ type: 'uint8array' });
  t.mock.method(globalThis, 'fetch', async () => {
    const response = new Response(bytes, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
    Object.defineProperty(response, 'url', { value: file });
    return response;
  });
  messages.length = 0;
  await new Promise<void>((resolve) => {
    const pending = listener({ to: 'sw', type: 'search', query: 'midterm', windowId: 1 }, {}, resolve);
    assert.equal(pending, true);
    assert.ok(!messages.some((m) => m.type === 'status' && !m.running));
  });
  assert.ok(content.some((m) => m.type === 'highlight-exact' && m.query === 'midterm'));
  const hits = messages.filter((m) => m.type === 'node' && m.node.id === file && m.node.state === 'hit');
  assert.equal(hits.length, 2, 'one incremental file update and one completed result');
  assert.ok(messages.some((m) => m.type === 'status' && !m.running && m.text.includes('Dig complete')));
  assert.ok(messages.every((m) => m.to === 'panel'), 'engine calls and file progress stay local to the Firefox background page');
});

test('Stop aborts active requests, preserves hits and allows a new search immediately', { timeout: 5000 }, async (t) => {
  const api = (globalThis as any).browser;
  const slow = `${base}slow-page`;
  t.mock.method(api.tabs, 'sendMessage', async (_id: number, msg: ContentMsg) => {
    if (msg.type === 'extract') return { url: base, title: 'Course', blocks: ['The midterm is Friday.'], links: [{ url: slow, title: 'Midterm notes', heading: '' }] };
    return true;
  });
  let started!: () => void;
  const fetching = new Promise<void>((resolve) => { started = resolve; });
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => {
      aborted = true;
      reject(init.signal!.reason);
    }, { once: true });
    started();
  }));
  messages.length = 0;
  const search = new Promise<void>((resolve) => listener({ to: 'sw', type: 'search', query: 'midterm', windowId: 1 }, {}, resolve));
  await fetching;
  listener({ to: 'sw', type: 'stop' }, {}, () => {});
  assert.ok(messages.some((m) => m.type === 'status' && m.text === 'Stopped. Results kept.' && !m.running));
  await search;
  assert.equal(aborted, true);
  assert.ok(messages.some((m) => m.type === 'node' && m.node.id === 'root' && m.node.state === 'hit'));
  assert.ok(!messages.some((m) => m.type === 'node' && m.node.id === slow && m.node.state === 'hit'));
  t.mock.method(api.tabs, 'sendMessage', async (_id: number, msg: ContentMsg) => {
    if (msg.type === 'extract') return { url: base, title: 'Course', blocks: ['The midterm is Friday.'], links: [] };
    return true;
  });
  messages.length = 0;
  await new Promise<void>((resolve) => listener({ to: 'sw', type: 'search', query: 'midterm', windowId: 1 }, {}, resolve));
  assert.ok(messages.some((m) => m.type === 'status' && m.text.includes('Dig complete')));
});
