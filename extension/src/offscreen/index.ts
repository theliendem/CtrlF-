// Offscreen document. Owner: A. Hosts the engine, runs the dig (crawler.ts), does all fetching/parsing.
// Only chrome.runtime exists here, so persistence (settings, dig logs) goes through the background.
import { DEFAULT_DIG_SETTINGS, type Msg, type OffscreenEnvelope } from '../../../shared/contracts';
import { Dig } from './crawler';
import { createEngine, ENGINE_KIND } from './engine';
import { bundledWeights } from './weights';
import './debug';

const engine = createEngine();
let dig: Dig | null = null;

async function handle(msg: Msg): Promise<Msg | undefined> {
  switch (msg.type) {
    case 'SEARCH_PAGE': {
      await engine.remove(msg.url);
      const vectors = await engine.embed(msg.passages.map((p) => p.text));
      await engine.indexAdd(msg.passages, vectors);
      const hits = await engine.search(msg.query, msg.k ?? 20, msg.url);
      return { type: 'SEARCH_RESULTS', query: msg.query, url: msg.url, hits };
    }
    case 'START_DIG': {
      dig?.stop();
      const settings = { ...DEFAULT_DIG_SETTINGS, ...msg.settings };
      dig = new Dig(engine, msg.query, msg.url, settings, (logs) => {
        chrome.runtime.sendMessage({ type: 'DIGLOGS_APPEND', logs } satisfies Msg).catch(() => {});
      });
      dig.start().catch((e) => console.error('[ctrlfpp dig]', e));
      return undefined;
    }
    case 'STOP_DIG':
      dig?.stop();
      return undefined;
    case 'RESUME_DIG':
      dig?.resume();
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Dev: run a real dig from the offscreen console and watch it.
 *   await ctrlfpp.dig('can I use a calculator on the midterm', 'https://canvas.wisc.edu/courses/<id>')
 */
async function devDig(query: string, url: string, settings: Partial<typeof DEFAULT_DIG_SETTINGS> = {}) {
  dig?.stop();
  const d = new Dig(engine, query, url, { ...DEFAULT_DIG_SETTINGS, ...settings }, () => {});
  dig = d;
  return new Promise((resolve) => {
    d.onMsg = (m) => {
      if (m.type === 'TREE_EVENT') {
        const e = m.event;
        if (e.state !== 'queued' && e.state !== 'skipped' && e.state !== 'digging') {
          const path = e.url.replace(/^https?:\/\/[^/]+/, '');
          console.log(`${e.t}ms ${e.state.padEnd(8)} ${e.score.toFixed(2)} ${e.title}  [${path}]`, e.snippet ? `\n    "${e.snippet}"` : '');
        }
      } else if (m.type === 'DIG_DONE') {
        console.log(`DONE ${m.reason}: ${m.pagesSearched} pages, ${m.hits.length} hits`);
        console.table(m.hits.slice(0, 10).map((h) => ({ score: h.score.toFixed(2), url: h.url, text: h.text.slice(0, 100) })));
        resolve(m);
      }
    };
    d.start();
  });
}
const g = globalThis as unknown as { ctrlfpp: Record<string, unknown> };
g.ctrlfpp = { ...g.ctrlfpp, dig: devDig, stop: () => dig?.stop(), resume: () => dig?.resume() };

chrome.runtime.onMessage.addListener((raw: Msg | OffscreenEnvelope, _sender, sendResponse) => {
  if (!raw || !('target' in raw) || raw.target !== 'offscreen') return false;
  handle(raw.msg).then(sendResponse, (e) => {
    console.error('[ctrlfpp offscreen]', e);
    sendResponse(undefined);
  });
  return true;
});

engine
  .init()
  .then(() => {
    engine.loadWeights(bundledWeights());
    chrome.runtime.sendMessage({ type: 'ENGINE_READY', engine: ENGINE_KIND, weightsVersion: engine.weights().version } satisfies Msg);
  })
  .catch((e) => console.error('[ctrlfpp] engine init failed', e));
