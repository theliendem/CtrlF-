// Service worker: routes messages and runs the dig. No parsing or model here; that's the offscreen engine.
import {
  RELEVANT,
  type ContentMsg,
  type PageText,
  type RuntimeMsg,
  type ScorePageResult,
  type TreeNode,
} from '../shared/types';

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

let runId = 0;
let searchedTabId: number | null = null;
const nodes = new Map<string, TreeNode>();

function status(text: string, running: boolean): void {
  toPanel({ to: 'panel', type: 'status', text, running });
}

function emit(node: TreeNode): void {
  nodes.set(node.id, node);
  toPanel({ to: 'panel', type: 'node', node });
}

async function search(query: string, windowId: number): Promise<void> {
  const run = ++runId;
  nodes.clear();
  toPanel({ to: 'panel', type: 'reset', query });

  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
    // LATER: read local PDFs and file:// pages.
    status(`Can't read this page (${tab?.url?.split(':')[0] ?? 'no tab'}). Open a web page and try again.`, false);
    return;
  }
  if (searchedTabId !== null) await clearTab(searchedTabId);
  searchedTabId = tab.id;

  status('Reading this page…', true);
  let page: PageText;
  try {
    page = await toTab<PageText>(tab.id, { type: 'extract' });
  } catch (e) {
    console.error('[ctrlf++] extract failed', e);
    status(`Can't read this page: ${e instanceof Error ? e.message : String(e)}`, false);
    return;
  }

  const root: TreeNode = {
    id: 'root',
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

  const res = await toEngine<ScorePageResult>({ to: 'offscreen', type: 'score-page', query, url: page.url, blocks: page.blocks });
  if (run !== runId) return; // a newer search started

  const hits = res.passages.filter((p) => p.score >= RELEVANT).slice(0, MAX_HIGHLIGHTS);
  console.log(`[ctrlf++] scored ${res.passages.length} passages in ${res.ms} ms`, res.passages.slice(0, 10));
  emit({
    ...root,
    state: hits.length ? 'hit' : 'ruled-out',
    best: res.passages[0]?.score ?? 0,
    snippet: hits[0]?.text,
    hits,
  });

  const shown = hits.length
    ? await toTab<number>(tab.id, { type: 'highlight', passages: hits.map((p, i) => ({ text: p.text, best: i === 0 })) })
    : 0;
  // LATER (milestone 3): keep digging from here instead of stopping.
  status(hits.length ? `${hits.length} matches on this page (${shown} highlighted)` : 'No match on this page.', false);
}

async function clearTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'clear-highlights' } satisfies ContentMsg);
  } catch {
    /* no content script there; nothing to clear */
  }
}

async function openResult(nodeId: string): Promise<void> {
  const node = nodes.get(nodeId);
  if (!node?.hits?.length) return;
  // Root: the page is already open; re-highlight and scroll it.
  // LATER (milestone 3): other nodes open in a new tab and highlight there.
  if (node.id === 'root' && searchedTabId !== null) {
    await chrome.tabs.update(searchedTabId, { active: true });
    await toTab(searchedTabId, { type: 'highlight', passages: node.hits.map((p, i) => ({ text: p.text, best: i === 0 })) });
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMsg) => {
  if (msg.to !== 'sw') return false;
  switch (msg.type) {
    case 'search':
      search(msg.query, msg.windowId).catch((e: unknown) => {
        console.error('[ctrlf++] search failed', e);
        status('Something went wrong. See the service worker console.', false);
      });
      break;
    case 'clear':
      runId++;
      if (searchedTabId !== null) void clearTab(searchedTabId);
      break;
    case 'open-result':
      void openResult(msg.nodeId);
      break;
  }
  return false;
});

// Load the model as soon as the extension starts, so the first search isn't waiting on it.
async function warmup(): Promise<void> {
  const t0 = performance.now();
  const r = await toEngine<{ ok: boolean; error?: string }>({ to: 'offscreen', type: 'warmup' });
  console.log(`[ctrlf++] engine warmup ${r.ok ? 'ok' : 'FAILED ' + r.error} in ${Math.round(performance.now() - t0)} ms`);
}
chrome.runtime.onInstalled.addListener(() => void warmup());
chrome.runtime.onStartup.addListener(() => void warmup());
