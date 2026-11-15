// Offscreen document: the engine. Model, scoring, and (later) fetching and parsing.
import type { RuntimeMsg, ScorePageResult } from '../shared/types';
import { chunk } from '../engine/chunk';
import { embed, loadModel } from '../engine/embed';
import { scorePassages } from '../engine/score';

async function scorePage(query: string, blocks: string[]): Promise<ScorePageResult> {
  const t0 = performance.now();
  const chunks = chunk(blocks);
  const [qVec, ...vecs] = await embed([query, ...chunks.map((c) => c.text)]);
  const passages = scorePassages(query, qVec, chunks, vecs).sort((a, b) => b.score - a.score);
  return { passages, ms: Math.round(performance.now() - t0) };
}

chrome.runtime.onMessage.addListener((msg: RuntimeMsg, _sender, sendResponse) => {
  if (msg.to !== 'offscreen') return false;
  switch (msg.type) {
    case 'warmup':
      loadModel()
        .then(() => embed(['warmup']))
        .then(() => sendResponse({ ok: true }), (e: unknown) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case 'score-page':
      scorePage(msg.query, msg.blocks).then(sendResponse, (e: unknown) => {
        console.error('[engine] score-page failed', e);
        sendResponse({ passages: [], ms: 0, error: String(e) });
      });
      return true;
  }
  return false;
});
