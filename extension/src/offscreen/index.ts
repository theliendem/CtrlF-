// Offscreen document. Owner: A. Hosts the engine; does all fetching and parsing for the dig (A3).
import type { Msg, OffscreenEnvelope } from '../../../shared/contracts';
import { createEngine, ENGINE_KIND } from './engine';

const engine = createEngine();

async function handle(msg: Msg): Promise<Msg | undefined> {
  switch (msg.type) {
    case 'SEARCH_PAGE': {
      await engine.remove(msg.url);
      const vectors = await engine.embed(msg.passages.map((p) => p.text));
      await engine.indexAdd(msg.passages, vectors);
      const hits = await engine.search(msg.query, msg.k ?? 20, msg.url);
      return { type: 'SEARCH_RESULTS', query: msg.query, url: msg.url, hits };
    }
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((raw: Msg | OffscreenEnvelope, _sender, sendResponse) => {
  if (!raw || !('target' in raw) || raw.target !== 'offscreen') return false;
  handle(raw.msg).then(sendResponse, (e) => {
    console.error('[ctrlfpp offscreen]', e);
    sendResponse(undefined);
  });
  return true;
});

engine.init().then(() => {
  chrome.runtime.sendMessage({ type: 'ENGINE_READY', engine: ENGINE_KIND, weightsVersion: engine.weights().version } satisfies Msg);
});
