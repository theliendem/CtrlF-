// Service worker. Owner: A. Routes messages, owns the offscreen document (which runs the engine and
// the dig), stores settings and dig logs, opens hits.
import { DEFAULT_DIG_SETTINGS, type DigLog, type DigSettings, type Locator, type Msg, type MsgOf, type OffscreenEnvelope, type TreeEvent } from '../../../shared/contracts';
import fixtureEvents from '../../../shared/fixtures/synthetic/tree-events.json';

const OFFSCREEN_URL = 'src/offscreen/index.html';
const SETTINGS_KEY = 'digSettings'; // chrome.storage.sync, Partial<DigSettings> (C's panel may write it)
const LOGS_KEY = 'digLogs'; // chrome.storage.local, DigLog[]
const MAX_LOGS = 20000;

let offscreenReady: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length > 0) return offscreenReady ?? Promise.resolve();
  if (!offscreenReady) {
    offscreenReady = new Promise<void>((r) => (resolveReady = r));
    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Runs the embedding model and parses fetched pages for search and the dig.',
      });
    } catch (e) {
      offscreenReady = null;
      throw e;
    }
  }
  return offscreenReady;
}

async function toOffscreen<T = unknown>(msg: Msg): Promise<T> {
  await ensureOffscreen();
  const env: OffscreenEnvelope = { target: 'offscreen', msg };
  return chrome.runtime.sendMessage(env);
}

async function digSettings(override?: Partial<DigSettings>): Promise<DigSettings> {
  const stored = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<DigSettings> | undefined;
  const s = { ...DEFAULT_DIG_SETTINGS, ...stored, ...override };
  return { scope: s.scope === 'any' ? 'any' : 'same-site', maxDepth: clamp(s.maxDepth, 1, 10), pageBudget: clamp(s.pageBudget, 1, 500) };
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

// Serialize log writes so concurrent appends don't clobber each other.
let logWrite: Promise<void> = Promise.resolve();
function appendLogs(logs: DigLog[]) {
  logWrite = logWrite.then(async () => {
    const cur = ((await chrome.storage.local.get(LOGS_KEY))[LOGS_KEY] as DigLog[] | undefined) ?? [];
    await chrome.storage.local.set({ [LOGS_KEY]: cur.concat(logs).slice(-MAX_LOGS) });
  }, console.error);
}

async function exportLogs(): Promise<MsgOf<'DIGLOGS_FILE'>> {
  await logWrite;
  const logs = ((await chrome.storage.local.get(LOGS_KEY))[LOGS_KEY] as DigLog[] | undefined) ?? [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return { type: 'DIGLOGS_FILE', filename: `ctrlfpp-diglogs-${stamp}.json`, json: JSON.stringify(logs, null, 1), count: logs.length };
}

/** Text-fragment URL (#:~:text=start,end) so Chrome scrolls to and highlights the passage. */
function textFragmentUrl(url: string, text: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C');
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const frag = words.length <= 8 ? enc(words.join(' ')) : `${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}`;
  return `${url.split('#')[0]}#:~:text=${frag}`;
}

function openLocator(url: string, locator: Locator, text: string) {
  if (locator.kind === 'pdf') {
    const q = new URLSearchParams({ url: locator.url, page: String(locator.page), start: String(locator.start), end: String(locator.end), text });
    return chrome.tabs.create({ url: chrome.runtime.getURL(`src/pdfviewer/index.html?${q}`) });
  }
  return chrome.tabs.create({ url: textFragmentUrl(url, text) });
}

// Start the engine as soon as the extension loads (install, reload, browser start, worker wake-up),
// so the model is warm before the first search.
const warmUp = () => ensureOffscreen().catch((e) => console.error('[ctrlfpp] offscreen start failed', e));
chrome.runtime.onInstalled.addListener(warmUp);
chrome.runtime.onStartup.addListener(warmUp);
warmUp();

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'open-search') return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'OPEN_SEARCH' } satisfies Msg).catch((e) => console.warn('[ctrlfpp] no content script in tab', e));
});

chrome.runtime.onMessage.addListener((raw: Msg | OffscreenEnvelope, sender, sendResponse) => {
  if ('target' in raw) return false; // envelopes are for the offscreen page
  const msg = raw as Msg;
  switch (msg.type) {
    case 'ENGINE_READY':
      console.log('[ctrlfpp] engine ready', msg.engine, msg.weightsVersion);
      resolveReady?.();
      return false;

    case 'SEARCH_PAGE':
      toOffscreen<MsgOf<'SEARCH_RESULTS'>>(msg).then(sendResponse, (e) => {
        console.error('[ctrlfpp] search failed', e);
        sendResponse({ type: 'SEARCH_RESULTS', query: msg.query, url: msg.url, hits: [] } satisfies Msg);
      });
      return true;

    case 'START_DIG': {
      const tabId = msg.tabId ?? sender.tab?.id;
      // Must run before any await to keep the user gesture; harmless if the panel is already open.
      if (tabId != null) chrome.sidePanel.open({ tabId }).catch(() => {});
      if (msg.url === 'fixture') {
        replayFixtureDig(); // dev: replays shared/fixtures/synthetic/tree-events.json
        return false;
      }
      // The side panel may not know the page URL; use the tab's.
      const url = msg.url || sender.tab?.url;
      Promise.all([digSettings(msg.settings), url ? url : chrome.tabs.query({ active: true, currentWindow: true }).then((t) => t[0]?.url ?? '')])
        .then(([settings, u]) => toOffscreen({ ...msg, url: u, tabId, settings }))
        .catch((e) => console.error('[ctrlfpp] start dig failed', e));
      return false;
    }

    case 'STOP_DIG':
      stopReplay();
      toOffscreen(msg).catch(console.error);
      return false;

    case 'RESUME_DIG':
      toOffscreen(msg).catch(console.error);
      return false;

    case 'DIGLOGS_APPEND':
      appendLogs(msg.logs);
      return false;

    case 'EXPORT_DIGLOGS':
      exportLogs().then(sendResponse);
      return true;

    case 'OPEN_LOCATOR':
      openLocator(msg.url, msg.locator, msg.text);
      return false;

    default:
      return false;
  }
});

// ---------- fixture replay (dev only: START_DIG with url 'fixture') ----------
let replayTimers: ReturnType<typeof setTimeout>[] = [];
function stopReplay() {
  replayTimers.forEach(clearTimeout);
  replayTimers = [];
}
function replayFixtureDig() {
  stopReplay();
  const digId = `fixture-${Date.now()}`;
  const events = fixtureEvents as TreeEvent[];
  for (const event of events) {
    replayTimers.push(setTimeout(() => chrome.runtime.sendMessage({ type: 'TREE_EVENT', digId, event } satisfies Msg).catch(() => {}), event.t));
  }
  const end = events.at(-1)?.t ?? 0;
  const hits = events.filter((e) => e.state === 'hit' && e.hit).map((e) => e.hit!);
  replayTimers.push(
    setTimeout(() => {
      const pagesSearched = new Set(events.filter((e) => e.state === 'digging').map((e) => e.nodeId)).size;
      chrome.runtime.sendMessage({ type: 'DIG_DONE', digId, reason: 'exhausted', pagesSearched, hits } satisfies Msg).catch(() => {});
    }, end + 200),
  );
}
