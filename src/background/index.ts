// Service worker: routes messages and runs the dig. No parsing or model here; that's the offscreen engine.
import {
  RELEVANT,
  type ContentMsg,
  type DigLink,
  type DigReadResult,
  type DigRun,
  type SkippedLink,
  type EngineAck,
  type PageText,
  type RuntimeMsg,
  type ScorePageResult,
  type TreeNode,
} from '../shared/types';
import { canvasContext, safeLink } from '../engine/links';
import { runBestFirst } from './queue';
import { normalizeSettings } from '../shared/settings';

const MAX_HIGHLIGHTS = 30;

// ---------- Side panel opening ----------

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-search' || tab?.windowId === undefined) return;
  // Must run synchronously inside the shortcut's user gesture, so no await before it.
  chrome.sidePanel
    .open({ windowId: tab.windowId })
    .then(() => toPanel({ to: 'panel', type: 'focus-search' }))
    .catch(() => {});
});

// ---------- Messaging helpers ----------

function toPanel(msg: RuntimeMsg): void {
  chrome.runtime.sendMessage(msg).catch(() => {}); // panel may be closed
}

let creating: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'src/offscreen/index.html',
      reasons: [chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.BLOBS],
      justification: 'Runs the on-device model and parses fetched pages and files.',
    })
    .finally(() => (creating = null));
  await creating;
}

async function toEngine<T>(msg: RuntimeMsg): Promise<T> {
  await ensureOffscreen();
  return (await chrome.runtime.sendMessage(msg)) as T;
}

/** Makes sure our content script is in the tab (tabs opened before install don't have it). */
async function ensureContent(tabId: number): Promise<void> {
  const ping: ContentMsg = { type: 'ping' };
  try {
    if (await chrome.tabs.sendMessage(tabId, ping)) return;
  } catch {
    /* not injected yet */
  }
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function toTab<T>(tabId: number, msg: ContentMsg): Promise<T> {
  await ensureContent(tabId);
  return (await chrome.tabs.sendMessage(tabId, msg)) as T;
}

// ---------- The search ----------

let runId = Date.now();
const nodes = new Map<string, TreeNode>();
const highlightedTabs = new Set<number>();

function status(text: string, running: boolean): void {
  toPanel({ to: 'panel', type: 'status', text, running });
}

function emit(node: TreeNode): void {
  nodes.set(node.id, node);
  toPanel({ to: 'panel', type: 'node', node });
}

async function search(query: string, windowId: number): Promise<void> {
  cancelDig();
  const run = ++runId;
  nodes.clear();
  toPanel({ to: 'panel', type: 'reset', query });

  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (run !== runId) return;
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
    // LATER: read local PDFs and file:// pages.
    status(`Can't read this page (${tab?.url?.split(':')[0] ?? 'no tab'}). Open a web page and try again.`, false);
    return;
  }
  await Promise.all([...highlightedTabs].map(clearTab));
  highlightedTabs.clear();
  if (run !== runId) return;

  const stored = await chrome.storage.local.get('searchSettings');
  const settings = normalizeSettings(stored.searchSettings);
  if (run !== runId) return;

  if (settings.mode === 'semantic') {
    // LATER: semantic mode will rank links and passages; currently it performs no search.
    status('Semantic search is not available yet. Choose Exact in settings.', false);
    return;
  }

  status('Reading this page…', true);
  let page: PageText;
  try {
    page = await toTab<PageText>(tab.id, { type: 'extract' });
  } catch (e) {
    if (run !== runId) return;
    console.error('[ctrlf++] extract failed', e);
    status(`Can't read this page: ${e instanceof Error ? e.message : String(e)}`, false);
    return;
  }
  if (run !== runId) return;

  const root: TreeNode = {
    id: 'root',
    exactQuery: query,
    parentId: null,
    url: page.url,
    title: page.title || page.url,
    kind: 'page',
    state: 'reading',
    depth: 0,
    best: 0,
  };
  emit(root);
  status('Scoring this page…', true);

  const res = await toEngine<ScorePageResult>({ to: 'offscreen', type: 'score-page', mode: settings.mode, query, url: page.url, blocks: page.blocks });
  if (run !== runId) return; // a newer search started
  if (res.error) throw new Error(res.error);

  const hits = res.passages.filter((p) => p.score >= RELEVANT && p.marks.length > 0).slice(0, MAX_HIGHLIGHTS);
  console.log(`[ctrlf++] scored ${res.passages.length} passages in ${res.ms} ms`, res.passages.slice(0, 10));
  emit({
    ...root,
    state: hits.length ? 'hit' : 'ruled-out',
    best: res.passages[0]?.score ?? 0,
    snippet: hits[0]?.marks.join(' '),
    hits,
  });

  const shown = hits.length
    ? await toTab<number>(tab.id, { type: 'highlight-exact', query })
    : 0;
  if (hits.length) highlightedTabs.add(tab.id);
  if (run !== runId) return;
  const context = canvasContext(page.url);
  if (!context) {
    // LATER: non-Canvas crawling is milestone 6.
    status(`${hits.length} matches on this page (${shown} highlighted). Digging currently supports Canvas courses.`, false);
    return;
  }
  const dig: DigRun = { id: run, query, context, queue: [], seen: new Set([safeLink(page.url, page.url, context) ?? page.url]), started: 1, failed: 0, settings };
  status('Finding Canvas links…', true);
  const seed = await toEngine<DigReadResult>({ to: 'offscreen', type: 'canvas-read', run, query, context, url: page.url, depth: 0, settings, visited: [...dig.seen], seed: page.links });
  if (run !== runId) return;
  if (seed.error) {
    status(`Current page searched. Canvas dig failed: ${seed.error}`, false);
    return;
  }
  enqueue(dig, root, seed.links);
  showSkipped(dig, root, seed.skipped ?? []);
  await runBestFirst(dig, async ({ node }) => {
    if (run !== runId) return;
    emit({ ...node, state: 'reading' });
    status(`Digging Canvas: ${dig.started}/${settings.pageBudget} pages started…`, true);
    try {
      const result = await toEngine<DigReadResult>({ to: 'offscreen', type: 'canvas-read', run, query, context, url: node.url, depth: node.depth, settings, visited: [...dig.seen] });
      if (run !== runId) return;
      if (result.error) throw new Error(result.error);
      emitResult(node, result);
      enqueue(dig, node, result.links);
      showSkipped(dig, node, result.skipped ?? []);
    } catch (error) {
      if (run !== runId) return;
      dig.failed++;
      console.warn('[ctrlf++] Canvas read failed', node.url, error);
      const partial = nodes.get(node.id);
      if (partial?.state !== 'hit') emit({ ...node, state: 'unreadable', snippet: String(error), hidden: !!node.fileId && !settings.showUnreadable });
    }
  }, () => run === runId, settings.pageBudget);
  if (run !== runId) return;
  settlePending();
  const found = [...nodes.values()].filter((node) => node.state === 'hit').length;
  status(`${dig.started - dig.failed} pages searched · ${found} with matches${dig.failed ? ` · ${dig.failed} could not be read` : ''}${dig.queue.length ? ` · ${settings.pageBudget}-page limit reached` : ' · Dig complete'}`, false);
}

function enqueue(run: DigRun, parent: TreeNode, links: DigLink[]): void {
  if (parent.depth >= run.settings.maxDepth) return;
  for (const link of links) {
    const url = safeLink(link.url, parent.url, run.context);
    if (!url || run.seen.has(url) || (run.settings.mode !== 'exact' && (link.score ?? 0) < 0.3)) continue;
    run.seen.add(url);
    const node: TreeNode = { id: url, parentId: parent.id, url, title: link.title || url, kind: 'page', state: 'queued', depth: parent.depth + 1, best: 0 };
    node.fileId = new URL(url).pathname.match(/\/files\/(\d+)$/)?.[1];
    if (node.fileId) { node.parentUrl = parent.url; node.linkTitle = link.title; }
    node.exactQuery = run.query;
    run.queue.push({ node, priority: 1 });
    emit(node);
  }
}

function emitResult(node: TreeNode, result: DigReadResult): void {
  const matches = result.passages.filter((p) => p.score >= RELEVANT && p.marks.length > 0).slice(0, MAX_HIGHLIGHTS);
  emit({ ...node, title: result.title || node.title, kind: result.kind ?? node.kind, location: result.location, pageNumber: result.pageNumber,
    state: matches.length ? 'hit' : 'ruled-out', best: result.passages[0]?.score ?? 0, hits: matches, snippet: matches[0]?.marks.join(' ') });
}

function showSkipped(run: DigRun, parent: TreeNode, skipped: SkippedLink[]): void {
  for (const link of skipped) {
    if (run.seen.has(link.url)) continue;
    run.seen.add(link.url);
    emit({ id: link.url, parentId: parent.id, url: link.url, title: link.title, kind: link.kind, state: link.state, depth: parent.depth + 1, best: 0 });
  }
}

function cancelDig(): void {
  const msg: RuntimeMsg = { to: 'offscreen', type: 'cancel-dig', run: runId };
  void chrome.runtime.sendMessage(msg).catch(() => {});
}

function settlePending(): void {
  for (const node of nodes.values()) {
    if (node.state === 'queued' || node.state === 'reading') emit({ ...node, state: 'not-followed' });
  }
}

function stop(clear: boolean): void {
  cancelDig();
  runId++;
  settlePending();
  if (clear) {
    for (const id of highlightedTabs) void clearTab(id);
    highlightedTabs.clear();
  }
  status(clear ? 'Stopped. Highlights cleared.' : 'Stopped. Results kept.', false);
}

async function clearTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'clear-highlights' } satisfies ContentMsg);
  } catch {
    /* no content script there; nothing to clear */
  }
}

async function openResult(nodeId: string, openFile = false): Promise<void> {
  const node = nodes.get(nodeId);
  if (!node?.hits?.length) return;
  if (openFile && node.kind === 'pdf' && node.pageNumber) {
    await chrome.tabs.create({ url: `${node.url}/download?inline=1#page=${node.pageNumber}`, active: true });
    return;
  }
  const run = runId;
  const tab = await chrome.tabs.create({ url: node.parentUrl ?? node.url, active: true });
  if (tab.id === undefined) return;
  const tabId = tab.id;
  // Wait for Canvas to render its body, then retry highlights briefly for delayed content.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (run !== runId) return;
    const current = await chrome.tabs.get(tabId);
    if (current.status === 'complete') {
      const message: ContentMsg = node.fileId
        ? { type: 'highlight-file', fileId: node.fileId, url: node.url, title: node.linkTitle ?? node.title }
        : { type: 'highlight-exact', query: node.exactQuery ?? '' };
      const shown = await toTab<number>(tabId, message);
      highlightedTabs.add(tabId);
      if (shown > 0) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.warn('[ctrlf++] Opened result but could not locate its passages', node.url);
}

chrome.runtime.onMessage.addListener((msg: RuntimeMsg) => {
  if (msg.to !== 'sw') return false;
  switch (msg.type) {
    case 'search': {
      const pending = search(msg.query, msg.windowId);
      const run = runId;
      pending.catch((e: unknown) => {
        if (run !== runId) return;
        console.error('[ctrlf++] search failed', e);
        settlePending();
        status('Something went wrong. See the service worker console.', false);
      });
      break;
    }
    case 'clear':
      stop(true);
      break;
    case 'stop':
      stop(false);
      break;
    case 'open-result':
      void openResult(msg.nodeId, msg.openFile).catch((error: unknown) => console.warn('[ctrlf++] Open result failed', error));
      break;
    case 'file-progress': {
      if (msg.run !== runId) break;
      const node = nodes.get(msg.url);
      if (node?.fileId) emitResult(node, msg.result);
      break;
    }
  }
  return false;
});

// Load the model as soon as the extension starts, so the first search isn't waiting on it.
async function warmup(): Promise<void> {
  const t0 = performance.now();
  const r = await toEngine<EngineAck>({ to: 'offscreen', type: 'warmup' });
  console.log(`[ctrlf++] engine warmup ${r.ok ? 'ok' : 'FAILED ' + r.error} in ${Math.round(performance.now() - t0)} ms`);
}
chrome.runtime.onInstalled.addListener(() => void warmup());
chrome.runtime.onStartup.addListener(() => void warmup());
