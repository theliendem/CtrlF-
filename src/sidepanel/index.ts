// Side panel: search box, live graph, results list, settings.
import { STRONG, type RuntimeMsg, type TreeNode } from '../shared/types';
import { Graph, strengthColor } from './graph';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = $<HTMLInputElement>('q');
const form = $<HTMLFormElement>('search-form');
const stopBtn = $<HTMLButtonElement>('stop');
const statusEl = $<HTMLParagraphElement>('status');
const resultsEl = $<HTMLUListElement>('results');
const settingsBtn = $<HTMLButtonElement>('settings');
const settingsForm = $<HTMLFormElement>('settings-form');
const pageBudget = $<HTMLInputElement>('page-budget');
const searchMode = $<HTMLSelectElement>('search-mode');
const maxDepth = $<HTMLInputElement>('max-depth');
const showOffsite = $<HTMLInputElement>('show-offsite');
const showUnreadable = $<HTMLInputElement>('show-unreadable');
const settingsStatus = $('settings-status');
let settings = { ...DEFAULT_SETTINGS };

function fillSettings(): void {
  searchMode.value = settings.mode;
  pageBudget.value = String(settings.pageBudget);
  maxDepth.value = String(settings.maxDepth);
  showOffsite.checked = settings.showOffsite;
  showUnreadable.checked = settings.showUnreadable;
}
fillSettings();
const settingsReady = chrome.storage.local.get('searchSettings').then((stored) => {
  settings = normalizeSettings(stored.searchSettings);
  fillSettings();
}).catch(() => { settingsStatus.textContent = 'Could not load saved settings. Defaults shown.'; });

function closeSettings(): void {
  settingsForm.hidden = true;
  settingsBtn.setAttribute('aria-expanded', 'false');
  settingsBtn.focus();
}
settingsBtn.addEventListener('click', async () => {
  await settingsReady;
  if (!settingsForm.hidden) { closeSettings(); return; }
  fillSettings();
  settingsForm.hidden = false;
  settingsBtn.setAttribute('aria-expanded', 'true');
  pageBudget.focus();
});
$('settings-close').addEventListener('click', closeSettings);
settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!settingsForm.reportValidity()) return;
  const next = normalizeSettings({ mode: searchMode.value, pageBudget: pageBudget.valueAsNumber, maxDepth: maxDepth.valueAsNumber, showOffsite: showOffsite.checked, showUnreadable: showUnreadable.checked });
  try {
    await chrome.storage.local.set({ searchSettings: next });
    settings = next;
    fillSettings();
    settingsStatus.textContent = 'Saved. Applies to your next search.';
  } catch {
    settingsStatus.textContent = 'Could not save settings. Try again.';
  }
});

const nodes = new Map<string, TreeNode>();
const graph = new Graph($('graph'), (id) => openResult(id));

const send = (msg: RuntimeMsg): void => void chrome.runtime.sendMessage(msg).catch(() => {});
const openResult = (nodeId: string, openFile = false): void => {
  const node = nodes.get(nodeId);
  if (node) send({ to: 'sw', type: 'open-result', node, openFile });
};

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
  if (!settingsForm.hidden) { closeSettings(); return; }
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

function renderResults(): void {
  const hits = [...nodes.values()].filter((n) => n.state === 'hit').sort((a, b) => b.best - a.best);
  resultsEl.replaceChildren(
    ...hits.map((n) => {
      const li = document.createElement('li');
      li.className = n.best >= STRONG ? 'strong' : '';
      li.style.setProperty('--hit', strengthColor(n.strength));
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
      if (n.kind === 'pdf' && n.pageNumber) {
        const openPage = document.createElement('button');
        openPage.type = 'button';
        openPage.className = 'btn file-page';
        openPage.textContent = `Open at page ${n.pageNumber}`;
        openPage.addEventListener('click', (event) => {
          event.stopPropagation();
          openResult(n.id, true);
        });
        body.append(openPage);
      }
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
      renderResults();
      break;
    case 'status':
      setStatus(msg.text, msg.running);
      break;
    case 'node':
      nodes.set(msg.node.id, msg.node);
      graph.upsert(msg.node);
      renderResults();
      if (msg.node.hits?.length) console.log('[ctrlf++]', msg.node.title, msg.node.hits);
      break;
  }
  return false;
});
