// Side panel: search box, live graph, results list, settings.
import { STRONG, type RuntimeMsg, type TreeNode } from '../shared/types';
import { Graph } from './graph';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = $<HTMLInputElement>('q');
const form = $<HTMLFormElement>('search-form');
const stopBtn = $<HTMLButtonElement>('stop');
const statusEl = $<HTMLParagraphElement>('status');
const resultsEl = $<HTMLUListElement>('results');
const cSearched = $('c-searched');
const cRuled = $('c-ruled');
const cFound = $('c-found');

const nodes = new Map<string, TreeNode>();
const graph = new Graph($('graph'), (id) => openResult(id));

const send = (msg: RuntimeMsg): void => void chrome.runtime.sendMessage(msg).catch(() => {});
const openResult = (nodeId: string): void => send({ to: 'sw', type: 'open-result', nodeId });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = q.value.trim();
  if (!query) return;
  // The panel's own window, not "last focused" (that can be a DevTools window).
  chrome.windows.getCurrent().then((w) => send({ to: 'sw', type: 'search', query, windowId: w.id! }));
});

stopBtn.addEventListener('click', () => send({ to: 'sw', type: 'stop' }));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  send({ to: 'sw', type: 'clear' });
  setStatus('Highlights cleared.', false);
});

function focusSearch(): void {
  window.focus();
  q.focus();
  q.select();
}
focusSearch();
window.addEventListener('focus', () => q.focus(), { once: true });

function setStatus(text: string, running: boolean): void {
  statusEl.textContent = text;
  stopBtn.hidden = !running;
}

const ICON: Record<TreeNode['kind'], string> = { page: '📄', pdf: '📕', pptx: '📊', docx: '📝' };

function renderCounters(): void {
  let searched = 0, ruled = 0, found = 0;
  for (const n of nodes.values()) {
    if (n.state === 'hit' || n.state === 'trail' || n.state === 'ruled-out') searched++;
    if (n.state === 'ruled-out') ruled++;
    if (n.state === 'hit') found++;
  }
  cSearched.textContent = String(searched);
  cRuled.textContent = String(ruled);
  cFound.textContent = String(found);
}

function renderResults(): void {
  const hits = [...nodes.values()].filter((n) => n.state === 'hit').sort((a, b) => b.best - a.best);
  resultsEl.replaceChildren(
    ...hits.map((n) => {
      const li = document.createElement('li');
      li.className = n.best >= STRONG ? 'strong' : '';
      li.title = n.url;
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = ICON[n.kind];
      const body = document.createElement('div');
      body.className = 'body';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = n.title + (n.location ? ` · ${n.location}` : '');
      const snip = document.createElement('div');
      snip.className = 'snippet';
      snip.textContent = n.snippet ?? '';
      body.append(title, snip);
      li.append(icon, body);
      li.addEventListener('click', () => openResult(n.id));
      return li;
    }),
  );
}

chrome.runtime.onMessage.addListener((msg: RuntimeMsg) => {
  if (msg.to !== 'panel') return false;
  switch (msg.type) {
    case 'focus-search':
      focusSearch();
      break;
    case 'reset':
      nodes.clear();
      graph.reset();
      renderCounters();
      renderResults();
      break;
    case 'status':
      setStatus(msg.text, msg.running);
      break;
    case 'node':
      nodes.set(msg.node.id, msg.node);
      graph.upsert(msg.node);
      renderCounters();
      renderResults();
      if (msg.node.hits?.length) console.log('[ctrlf++]', msg.node.title, msg.node.hits);
      break;
  }
  return false;
});
