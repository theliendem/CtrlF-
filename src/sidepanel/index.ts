import { extensionApi } from '../shared/browser';
// Side panel: search box, live graph, results list, settings.
import { STRONG, type RuntimeMsg, type TreeNode } from '../shared/types';
import { Graph, bridges, strengthColor } from './graph';
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
const resumeBtn = $<HTMLButtonElement>('resume');
const resultsEl = $<HTMLUListElement>('results');
const resultsBox = resultsEl.parentElement!;
const noResults = $('no-results');
const noResultsTitle = $('no-results-title');
$('no-results-settings').addEventListener('click', () => $<HTMLButtonElement>('settings').click());
/** A dig is running (from the service worker's status messages). */
let digRunning = false;
const settingsBtn = $<HTMLButtonElement>('settings');
const settingsForm = $<HTMLFormElement>('settings-form');
const pageBudget = $<HTMLInputElement>('page-budget');
const modeButtons = { semantic: $<HTMLButtonElement>('mode-semantic'), exact: $<HTMLButtonElement>('mode-exact') };
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
  for (const [mode, button] of Object.entries(modeButtons)) button.setAttribute('aria-pressed', String(mode === settings.mode));
  pageBudget.value = String(settings.pageBudget);
  maxDepth.value = String(settings.maxDepth);
  showOffsite.checked = settings.showOffsite;
  showUnreadable.checked = settings.showUnreadable;
}
fillSettings();
const settingsReady = extensionApi.storage.local.get('searchSettings').then((stored) => {
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
  const next = normalizeSettings({ mode: searchMode.value, pageBudget: pageBudget.valueAsNumber, maxDepth: maxDepth.valueAsNumber, showOffsite: showOffsite.checked, showUnreadable: showUnreadable.checked, keepCache: false });
  try {
    await extensionApi.storage.local.set({ searchSettings: next });
    settings = next;
    fillSettings();
    settingsStatus.textContent = 'Saved. Applies to your next search.';
  } catch {
    settingsStatus.textContent = 'Could not save settings. Try again.';
  }
});

let modeSaved: Promise<void> = settingsReady;
for (const mode of ['semantic', 'exact'] as const) modeButtons[mode].addEventListener('click', () => {
  for (const [value, button] of Object.entries(modeButtons)) button.setAttribute('aria-pressed', String(value === mode));
  modeSaved = modeSaved.then(async () => {
    try {
      const next = { ...settings, mode, keepCache: false } as typeof settings;
      await extensionApi.storage.local.set({ searchSettings: next });
      settings = next;
      fillSettings();
    } catch { statusEl.textContent = 'Could not save search mode. Try again.'; fillSettings(); }
  });
});
$('refresh').addEventListener('click', async () => {
  const query = q.value.trim() || shownQuery;
  await modeSaved;
  if (query) void extensionApi.windows.getCurrent().then(w => send({ to: 'sw', type: 'search', query, windowId: w.id!, refresh: true }));
});

const nodes = new Map<string, TreeNode>();
const graph = new Graph($('graph'), (id) => openResult(id));

const send = (msg: RuntimeMsg): void => void extensionApi.runtime.sendMessage(msg).catch(() => {});
const openResult = (nodeId: string): void => {
  const node = nodes.get(nodeId);
  const next = nodes.get(bridges(nodes.values()).get(nodeId) ?? '');
  if (node) send({ to: 'sw', type: 'open-result', node, next });
};

/** The query of the search on screen, for "Keep searching". */
let shownQuery = '';

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = q.value.trim();
  if (!query) return;
  await modeSaved;
  // The panel's own window, not "last focused" (that can be a DevTools window).
  extensionApi.windows.getCurrent().then((w) => send({ to: 'sw', type: 'search', query, windowId: w.id! }));
});

resumeBtn.addEventListener('click', () => {
  resumeBtn.hidden = true;
  extensionApi.windows.getCurrent().then((w) => send({ to: 'sw', type: 'resume', query: shownQuery, windowId: w.id! }));
});

stopBtn.addEventListener('click', () => {
  setStatus('Stopping…', true);
  send({ to: 'sw', type: 'stop' });
});

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

function setStatus(text: string, running: boolean, canResume = false): void {
  statusEl.textContent = text;
  resumeBtn.hidden = !canResume;
  statusEl.classList.toggle('running', running);
  stopBtn.hidden = !running;
  // A search finishing (or starting) decides whether the "no matches" line shows.
  if (digRunning !== running) {
    digRunning = running;
    renderResults();
  }
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

// Large link queues can deliver many updates together. Render the list once per frame.
let resultsFrame = 0;
const graphUpdates = new Map<string, TreeNode>();
function scheduleResults(): void {
  if (resultsFrame) return;
  resultsFrame = requestAnimationFrame(() => {
    resultsFrame = 0;
    graph.upsertMany(graphUpdates.values());
    graphUpdates.clear();
    renderResults();
  });
}

const resultRows = new Map<string, { row: HTMLLIElement; signature: string }>();
function renderResults(): void {
  // Bridges led to matches but aren't matches themselves, so they stay out of the list.
  const bridge = bridges(nodes.values());
  const hits = [...nodes.values()].filter((n) => n.state === 'hit' && !bridge.has(n.id)).sort((a, b) => b.best - a.best);
  // The page was read (root exists) and the search is over, but nothing matched: say so instead of staying blank.
  const nothing = hits.length === 0 && !digRunning && nodes.has('root');
  resultsBox.hidden = hits.length === 0;
  noResults.hidden = !nothing;
  if (nothing) noResultsTitle.textContent = `No matches for “${shownQuery}”`;
  const active = document.activeElement;
  const wanted = new Set(hits.map(n => n.id));
  for (const [id, entry] of resultRows) if (!wanted.has(id)) { entry.row.remove(); resultRows.delete(id); }
  const rows = hits.map((n, i) => {
      const signature = JSON.stringify([n.title, n.url, n.best, n.strength, n.kind, n.location, n.snippet, i === 0]);
      const existing = resultRows.get(n.id);
      if (existing?.signature === signature) return existing.row;
      const li = el('li', [n.best >= STRONG ? 'strong' : '', i === 0 ? 'top' : ''].join(' ').trim());
      li.style.setProperty('--hit', strengthColor(n.strength));
      li.title = n.url;
      li.tabIndex = 0;
      li.setAttribute('role', 'link');
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
      if (existing) { existing.row.replaceChildren(...li.childNodes); existing.row.className = li.className; existing.row.style.cssText = li.style.cssText; existing.row.title = li.title; }
      const row = existing?.row ?? li;
      resultRows.set(n.id, { row, signature });
      return row;
    });
  rows.forEach((row, i) => { if (resultsEl.children[i] !== row) resultsEl.insertBefore(row, resultsEl.children[i] ?? null); });
  if (active instanceof HTMLElement && resultsEl.contains(active)) active.focus({ preventScroll: true });
}

extensionApi.runtime.onMessage.addListener((msg: RuntimeMsg) => {
  if (msg.to !== 'panel') return false;
  switch (msg.type) {
    case 'focus-search':
      focusSearch();
      break;
    case 'reset':
      shownQuery = msg.query;
      nodes.clear();
      graphUpdates.clear();
      graph.reset();
      renderResults();
      break;
    case 'status':
      setStatus(msg.text, msg.running, msg.canResume);
      break;
    case 'node':
      nodes.set(msg.node.id, msg.node);
      graphUpdates.set(msg.node.id, msg.node);
      scheduleResults();
      if (msg.node.hits?.length) console.log('[ctrlf++]', msg.node.title, msg.node.hits);
      break;
  }
  return false;
});
