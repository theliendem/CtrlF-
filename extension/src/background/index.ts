// Service worker. Owner: A. Routes messages, owns the offscreen document, runs the crawl (A3).
import type { Msg, MsgOf, OffscreenEnvelope, TreeEvent } from '../../../shared/contracts';
import fixtureEvents from '../../../shared/fixtures/synthetic/tree-events.json';

const OFFSCREEN_URL = 'src/offscreen/index.html';
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
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Runs the embedding model and parses fetched pages for search and the dig.',
    });
  }
  return offscreenReady;
}

async function toOffscreen<T = unknown>(msg: Msg): Promise<T> {
  await ensureOffscreen();
  const env: OffscreenEnvelope = { target: 'offscreen', msg };
  return chrome.runtime.sendMessage(env);
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'open-search') return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId == null) return;
  const msg: Msg = { type: 'OPEN_SEARCH' };
  chrome.tabs.sendMessage(tabId, msg).catch((e) => console.warn('[ctrlfpp] no content script in tab', e));
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
    case 'START_DIG':
      // TODO(A3): real best-first crawl. Until then, replay the synthetic fixture so C can build the tree.
      replayFixtureDig();
      return false;
    case 'STOP_DIG':
      stopReplay();
      return false;
    default:
      return false;
  }
});

// ---------- fixture replay (temporary, until the crawler lands) ----------
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
    replayTimers.push(
      setTimeout(() => chrome.runtime.sendMessage({ type: 'TREE_EVENT', digId, event } satisfies Msg).catch(() => {}), event.t),
    );
  }
  const end = events.at(-1)?.t ?? 0;
  const hits = events.filter((e) => e.state === 'hit' && e.hit).map((e) => e.hit!);
  replayTimers.push(
    setTimeout(
      () =>
        chrome.runtime
          .sendMessage({ type: 'DIG_DONE', digId, reason: 'exhausted', pagesSearched: events.filter((e) => e.state === 'digging').length, hits } satisfies Msg)
          .catch(() => {}),
      end + 200,
    ),
  );
}
