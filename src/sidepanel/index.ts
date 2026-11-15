// Side panel: search box, live graph, results list, settings.
import { STRONG, type RuntimeMsg, type TreeNode } from '../shared/types';
import { Graph, strengthColor } from './graph';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import '@fontsource/ibm-plex-sans-condensed/400.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource-variable/source-code-pro/wght.css';
import '@fontsource-variable/archivo/wght.css';
import '@fontsource-variable/rubik/wght.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const q = $<HTMLInputElement>('q');
const form = $<HTMLFormElement>('search-form');
const stopBtn = $<HTMLButtonElement>('stop');
const statusEl = $<HTMLParagraphElement>('status');
const resultsEl = $<HTMLUListElement>('results');
const resultsBox = resultsEl.parentElement!;
const settingsBtn = $<HTMLButtonElement>('settings');
const settingsForm = $<HTMLFormElement>('settings-form');
const pageBudget = $<HTMLInputElement>('page-budget');
const searchMode = $<HTMLSelectElement>('search-mode');
const maxDepth = $<HTMLInputElement>('max-depth');
const showOffsite = $<HTMLInputElement>('show-offsite');
const showUnreadable = $<HTMLInputElement>('show-unreadable');
const settingsStatus = $('settings-status');
let settings = { ...DEFAULT_SETTINGS };

// Panel looks, for comparing styles. Applied live; remembered per browser (a panel preference, not a search setting).
const THEMES = [
  ['notebook', 'Notebook'],
  ['blueprint', 'Blueprint'],
  ['dig', 'Dig site'],
  ['grep', 'grep'],
  ['findbar', 'Chrome find bar'],
  ['highlighters', 'Highlighters'],
] as const;
const THEME_KEY = 'ctrlfpp-theme';
const themeSelect = $<HTMLSelectElement>('theme');
themeSelect.append(...THEMES.map(([id, name]) => new Option(name, id)));
function applyTheme(id: string | null): void {
  const theme = THEMES.find(([t]) => t === id)?.[0] ?? 'notebook';
  document.documentElement.dataset.theme = theme;
  themeSelect.value = theme;
}
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch { applyTheme(null); }
themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value);
  try { localStorage.setItem(THEME_KEY, themeSelect.value); } catch { /* preview only lasts this session */ }
});

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
  themeSelect.focus();
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
const openResult = (nodeId: string): void => {
  const node = nodes.get(nodeId);
  if (node) send({ to: 'sw', type: 'open-result', node });
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
  statusEl.classList.toggle('running', running);
  stopBtn.hidden = !running;
}

// File glyphs: a page outline, with a band in the color people already know for each file type.
const BAND: Record<TreeNode['kind'], string | null> = { page: null, pdf: '#d64541', pptx: '#d9782b', docx: '#2f6fd1' };
function fileIcon(kind: TreeNode['kind']): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 18 22');
  svg.setAttribute('class', 'file');
  svg.setAttribute('aria-hidden', 'true');
  const sheet = document.createElementNS(NS, 'path');
  sheet.setAttribute('d', 'M3 1.5h8l4.5 4.5v13a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 19V3A1.5 1.5 0 0 1 3 1.5Z M11 1.5V6h4.5');
  sheet.setAttribute('fill', 'var(--paper)');
  sheet.setAttribute('stroke', 'var(--ink-soft)');
  sheet.setAttribute('stroke-width', '1.3');
  sheet.setAttribute('stroke-linejoin', 'round');
  svg.append(sheet);
  const band = BAND[kind];
  if (band) {
    const r = document.createElementNS(NS, 'rect');
    for (const [k, v] of Object.entries({ x: '0', y: '11', width: '13', height: '7', rx: '1.5', fill: band })) r.setAttribute(k, v);
    svg.append(r);
  } else {
    const lines = document.createElementNS(NS, 'path');
    lines.setAttribute('d', 'M5 10.5h8M5 13.5h8M5 16.5h5');
    lines.setAttribute('stroke', 'var(--edge)');
    lines.setAttribute('stroke-width', '1.3');
    lines.setAttribute('stroke-linecap', 'round');
    svg.append(lines);
  }
  return svg;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function renderResults(): void {
  const hits = [...nodes.values()].filter((n) => n.state === 'hit').sort((a, b) => b.best - a.best);
  resultsBox.hidden = hits.length === 0;
  resultsEl.replaceChildren(
    ...hits.map((n, i) => {
      const li = el('li', [n.best >= STRONG ? 'strong' : '', i === 0 ? 'top' : ''].join(' ').trim());
      li.style.setProperty('--hit', strengthColor(n.strength));
      li.title = n.url;
      li.tabIndex = 0;
      const body = el('div', 'body');
      const head = el('div', 'head');
      head.append(el('span', 'title', n.title));
      if (n.location) head.append(el('span', 'where', n.location));
      body.append(head);
      if (n.snippet) {
        const snip = el('div', 'snippet');
        snip.append(el('mark', '', n.snippet));
        body.append(snip);
      }
      li.append(el('span', 'strength'), fileIcon(n.kind), body);
      li.addEventListener('click', () => openResult(n.id));
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target === li) openResult(n.id);
      });
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
