// Service worker: routes messages and runs the dig. No parsing or model here; that's the offscreen engine.
import {
  LINK_MIN,
  hitStrength,
  type HighlightPassage,
  type Passage,
  type SearchMode,
  type ContentMsg,
  type DigContext,
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
import { canvasContext, digLink, filterLinks, isCanvas, siteFileKind, skippedLinks } from '../engine/links';
import { wordCount, MIN_WORDS } from '../engine/site';
import { pageIdentity } from '../engine/identity';
import { runBestFirst, runBranchBatches } from './queue';
import { indexHops, MatchBar } from './matching';
import { normalizeSettings } from '../shared/settings';
import { memorySnapshot } from '../debug/memory'; // TEMP: RAM benchmark

const MAX_HIGHLIGHTS = 30;
/** A JavaScript-built page gets this long in a background tab to render. */
const TAB_TIMEOUT = 12000;

/** File nodes: Canvas files (by id) and same-site PDF/PPTX/DOCX links. */
const isFile = (node: TreeNode): boolean => !!node.fileId || node.kind !== 'page';

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
/** Mode of the current search (file progress arrives later and is scored the same way). */
let mode: SearchMode = 'exact';
/** What counts as a match in the current search (rises with the best semantic match). */
let bar = new MatchBar('exact');
/** Identity keys (final URL, canonical URL, text fingerprint) of every page read in this search. */
let readPages = new Set<string>();

/**
 * True if this read is a page we already have under another URL (a redirect alias, a ?title= or
 * canonical variant, or the same text). The first read wins; later ones are dropped, and their
 * links aren't followed, which also stops cycles back to pages already in the tree.
 */
function isDuplicate(identity: string[] | undefined): boolean {
  if (!identity?.length) return false;
  if (identity.some((key) => readPages.has(key))) return true;
  for (const key of identity) readPages.add(key);
  return false;
}

/** Semantic hits are highlighted by their marked sentences, best first. */
function passageHighlights(passages: Passage[]): HighlightPassage[] {
  return passages.map((p, i) => ({ texts: p.marks, best: i === 0 }));
}

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

  mode = settings.mode;
  bar = new MatchBar(mode);
  readPages = new Set();
  const exact = mode === 'exact';

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
    exactQuery: exact ? query : undefined,
    parentId: null,
    url: page.url,
    title: page.title || page.url,
    kind: 'page',
    state: 'reading',
    depth: 0,
    best: 0,
  };
  isDuplicate(pageIdentity(page.url, page.canonical, page.blocks));
  emit(root);
  status(exact ? 'Scoring this page…' : 'Scoring this page by meaning…', true);

  const res = await toEngine<ScorePageResult>({ to: 'offscreen', type: 'score-page', mode: settings.mode, query, url: page.url, blocks: page.blocks });
  if (run !== runId) return; // a newer search started
  if (res.error) throw new Error(res.error);

  const hits = bar.matches(res.passages).matches.slice(0, MAX_HIGHLIGHTS);
  console.log(`[ctrlf++] scored ${res.passages.length} passages in ${res.ms} ms`, res.passages.slice(0, 10));
  emit({
    ...root,
    state: hits.length ? 'hit' : 'ruled-out',
    best: res.passages[0]?.score ?? 0,
    snippet: hits[0]?.marks.join(' '),
    hits,
    strength: hits.length ? hitStrength(mode, hits[0].score) : undefined,
  });

  if (hits.length) {
    await toTab<number>(tab.id, exact ? { type: 'highlight-exact', query } : { type: 'highlight', passages: passageHighlights(hits) });
    highlightedTabs.add(tab.id);
  }
  if (run !== runId) return;
  const context: DigContext = canvasContext(page.url) ?? { origin: new URL(page.url).origin };
  const where = isCanvas(context) ? 'Canvas' : new URL(page.url).hostname;
  const dig: DigRun = { id: run, query, context, queue: [], seen: new Set([digLink(page.url, page.url, context) ?? page.url]), started: 1, failed: 0, settings };
  status(`Finding ${isCanvas(context) ? 'Canvas ' : ''}links…`, true);
  const seed = await toEngine<DigReadResult>({ to: 'offscreen', type: 'dig-read', run, query, context, url: page.url, depth: 0, settings, visited: [...dig.seen], seed: page.links });
  if (run !== runId) return;
  if (seed.error) {
    status(`Current page searched. Dig failed: ${seed.error}`, false);
    return;
  }
  if (!enqueue(dig, root, seed.links) && !exact) enqueueIndexes(dig, root, seed.indexLinks ?? []);
  showSkipped(dig, root, seed.skipped ?? []);
  const runQueue = exact ? runBranchBatches : runBestFirst;
  await runQueue(dig, async ({ node }) => {
    if (run !== runId) return;
    emit({ ...node, state: 'reading', deferred: false });
    status(`Digging ${where}: ${dig.started}/${settings.pageBudget} pages started…`, true);
    try {
      let result = await toEngine<DigReadResult>({ to: 'offscreen', type: 'dig-read', run, query, context, url: node.url, depth: node.depth, settings, visited: [...dig.seen], index: node.index });
      if (run !== runId) return;
      if (result.error) throw new Error(result.error);
      if (result.needsTab) result = await readInTab(result.finalUrl ?? node.url, dig, node);
      if (run !== runId) return;
      if (isDuplicate(result.identity)) {
        // Same page under another URL: drop it from the tree, the counters and the results.
        emit({ ...node, deferred: false, state: 'ruled-out', hidden: true });
        return;
      }
      emitResult(node, result);
      // A dead end (nothing worth following): fall back on this page's index pages, if any.
      if (!enqueue(dig, node, result.links) && !exact) enqueueIndexes(dig, node, result.indexLinks ?? []);
      showSkipped(dig, node, result.skipped ?? []);
    } catch (error) {
      if (run !== runId) return;
      dig.failed++;
      console.warn('[ctrlf++] read failed', node.url, error);
      const partial = nodes.get(node.id);
      if (partial?.state !== 'hit') emit({ ...node, deferred: false, state: 'unreadable', snippet: String(error), hidden: isFile(node) && !settings.showUnreadable });
    }
  }, () => run === runId, settings.pageBudget);
  if (run !== runId) return;
  settlePending();
  const found = [...nodes.values()].filter((node) => node.state === 'hit').length;
  if (!exact && !found) {
    // An honest dead end: like Ctrl+F, the dig only reaches what this page leads to.
    status(dig.started <= 1
      ? `Nothing on this page leads toward “${query}”. Start from a page closer to the topic.`
      : `Nothing related found in ${dig.started - dig.failed} pages. Start from a page closer to the topic.`, false);
    return;
  }
  status(`${dig.started - dig.failed} pages searched · ${found} with matches${dig.failed ? ` · ${dig.failed} could not be read` : ''}${dig.queue.length ? ` · ${settings.pageBudget}-page limit reached` : ' · Dig complete'}`, false);
}

/** Queue a page's links. Returns how many were queued (0 = a dead end). */
function enqueue(run: DigRun, parent: TreeNode, links: DigLink[]): number {
  if (parent.depth >= run.settings.maxDepth) return 0;
  let added = 0;
  for (const link of links) {
    const url = digLink(link.url, parent.url, run.context);
    if (!url || run.seen.has(url) || (run.settings.mode !== 'exact' && (link.score ?? 0) < LINK_MIN)) continue;
    run.seen.add(url);
    const node: TreeNode = { id: url, parentId: parent.id, url, title: link.title || url, kind: 'page', state: 'queued', deferred: true, depth: parent.depth + 1, best: 0 };
    if (isCanvas(run.context)) node.fileId = new URL(url).pathname.match(/\/files\/(\d+)$/)?.[1];
    else node.kind = siteFileKind(url) ?? 'page';
    if (isFile(node)) { node.parentUrl = parent.url; node.linkTitle = link.title; }
    if (run.settings.mode === 'exact') node.exactQuery = run.query;
    run.queue.push({ node, priority: link.score ?? 1 });
    emit(node);
    added++;
  }
  return added;
}

/**
 * Semantic dead end: queue the page's best index pages (contents, portals, topic lists). They're read
 * only for their links, which must clear the normal bar, and never become results. At most
 * MAX_INDEX_HOPS index pages in a row.
 */
function enqueueIndexes(run: DigRun, parent: TreeNode, links: DigLink[]): void {
  const hops = indexHops(parent);
  if (hops === null || parent.depth >= run.settings.maxDepth || isCanvas(run.context)) return;
  for (const link of links) {
    if (run.seen.has(link.url)) continue;
    run.seen.add(link.url);
    const node: TreeNode = { id: link.url, parentId: parent.id, url: link.url, title: link.title || link.url, kind: 'page', state: 'queued', deferred: true, depth: parent.depth + 1, best: 0, index: true, indexHops: hops };
    run.queue.push({ node, priority: link.score ?? 0 });
    emit(node);
  }
}

function emitResult(node: TreeNode, result: DigReadResult): void {
  // Index pages are read only for their links: never a result.
  const { matches: all, raised } = node.index ? { matches: [], raised: false } : bar.matches(result.passages);
  const matches = all.slice(0, MAX_HIGHLIGHTS);
  emit({ ...node, deferred: false, url: isFile(node) ? node.url : result.finalUrl ?? node.url, title: result.title || node.title, kind: result.kind ?? node.kind, location: result.location, pageNumber: result.pageNumber,
    state: matches.length ? 'hit' : 'ruled-out', best: result.passages[0]?.score ?? 0, hits: matches, snippet: matches[0]?.marks.join(' '),
    strength: matches.length ? hitStrength(mode, matches[0].score) : undefined });
  if (raised) recheckMatches();
}

/** The bar rose: earlier matches now far below the best one stop counting. */
function recheckMatches(): void {
  // LATER: the starting tab keeps its highlights even if the starting page stops counting as a match.
  for (const node of [...nodes.values()]) {
    if (node.state !== 'hit' || !node.hits?.length) continue;
    const kept = bar.keep(node.hits);
    if (kept.length === node.hits.length) continue;
    emit(kept.length
      ? { ...node, hits: kept, snippet: kept[0].marks.join(' '), strength: hitStrength(mode, kept[0].score) }
      : { ...node, state: 'ruled-out', hits: [], snippet: undefined, strength: undefined });
  }
}

// ---------- JavaScript-built pages ----------

let tabLock: Promise<unknown> = Promise.resolve();

/**
 * Read a page whose fetched HTML was nearly empty by loading it in a minimized, unfocused window,
 * one at a time. It's a plain navigation (GET); nothing on the page is clicked.
 */
async function readInTab(url: string, run: DigRun, node: TreeNode): Promise<DigReadResult> {
  const turn = tabLock.then(() => readInTabNow(url, run, node));
  tabLock = turn.catch(() => {});
  return turn;
}

async function readInTabNow(url: string, run: DigRun, node: TreeNode): Promise<DigReadResult> {
  // LATER: cache tab-rendered pages too, so JavaScript-built pages also work offline.
  // LATER: offer index-page fallbacks for tab-rendered pages too.
  if (run.id !== runId) throw new Error('Search stopped');
  const win = await chrome.windows.create({ url, state: 'minimized', focused: false });
  const tabId = win?.tabs?.[0]?.id;
  try {
    if (tabId === undefined) throw new Error('Could not open a background tab');
    const deadline = Date.now() + TAB_TIMEOUT;
    let page: PageText | null = null;
    let lastCount = -1;
    while (Date.now() < deadline && run.id === runId) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const tab = await chrome.tabs.get(tabId);
      if (tab.status !== 'complete') continue;
      if (tab.url && new URL(tab.url).origin !== run.context.origin) throw new Error('Redirected off-site; not followed');
      try { page = await toTab<PageText>(tabId, { type: 'extract' }); } catch { continue; }
      // Done once there's real text, or once rendering has settled on a short page.
      const count = wordCount(page.blocks);
      if (count >= MIN_WORDS || count === lastCount) break;
      lastCount = count;
    }
    if (run.id !== runId) throw new Error('Search stopped');
    if (!page) throw new Error('Page did not load in time');
    const res = await toEngine<ScorePageResult>({ to: 'offscreen', type: 'score-page', mode: run.settings.mode, query: run.query, url: page.url, blocks: page.blocks });
    if (res.error) throw new Error(res.error);
    const canDig = node.depth < run.settings.maxDepth;
    const candidates = canDig ? filterLinks(page.links, page.url, run.context).filter((link) => !run.seen.has(link.url)) : [];
    const links = candidates.length ? await toEngine<DigLink[]>({ to: 'offscreen', type: 'score-links', mode: run.settings.mode, query: run.query, links: candidates, depth: node.depth + 1, context: run.context }) : [];
    return { title: page.title, passages: res.passages, links, skipped: canDig ? skippedLinks(page.links, page.url, run.context, run.settings) : [], finalUrl: page.url, identity: pageIdentity(page.url, page.canonical, page.blocks) };
  } finally {
    if (win?.id !== undefined) await chrome.windows.remove(win.id).catch(() => {});
  }
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
    const url = node.fileId ? `${node.url}/download?inline=1#page=${node.pageNumber}` : `${node.url}#page=${node.pageNumber}`;
    await chrome.tabs.create({ url, active: true });
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
      const message: ContentMsg = isFile(node)
        ? { type: 'highlight-file', fileId: node.fileId, url: node.url, title: node.linkTitle ?? node.title }
        : node.exactQuery ? { type: 'highlight-exact', query: node.exactQuery } : { type: 'highlight', passages: passageHighlights(node.hits) };
      const shown = await toTab<number>(tabId, message);
      highlightedTabs.add(tabId);
      if (shown > 0) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.warn('[ctrlf++] Opened result but could not locate its passages', node.url);
}

chrome.runtime.onMessage.addListener((msg: RuntimeMsg, _sender, sendResponse) => {
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
    case 'mem-report':
      // TEMP: RAM benchmark. Service workers usually don't expose a heap figure (reported as null).
      sendResponse(memorySnapshot());
      return false;
    case 'file-progress': {
      if (msg.run !== runId) break;
      const node = nodes.get(msg.url);
      if (node && isFile(node)) emitResult(node, msg.result);
      break;
    }
  }
  return false;
});

// In semantic mode, load the model as soon as the extension starts (or semantic is chosen),
// so the first search isn't waiting on it. Exact mode never loads it.
async function warmup(): Promise<void> {
  const stored = await chrome.storage.local.get('searchSettings');
  if (normalizeSettings(stored.searchSettings).mode !== 'semantic') return;
  const t0 = performance.now();
  const r = await toEngine<EngineAck>({ to: 'offscreen', type: 'warmup' });
  console.log(`[ctrlf++] engine warmup ${r.ok ? 'ok' : 'FAILED ' + r.error} in ${Math.round(performance.now() - t0)} ms`);
}
chrome.runtime.onInstalled.addListener(() => void warmup());
chrome.runtime.onStartup.addListener(() => void warmup());
chrome.storage.onChanged.addListener((changes) => {
  if (changes.searchSettings) void warmup();
});
