// Offscreen document: the engine. Model, scoring, and (later) fetching and parsing.
import type { CanvasReadMsg, DigReadResult, EngineAck, RuntimeMsg, ScorePageResult } from '../shared/types';
import { chunk } from '../engine/chunk';
import { embed, loadModel } from '../engine/embed';
import { scorePassages } from '../engine/score';
import { discoverCourse, readCanvas } from '../engine/canvas';
import { filterLinks, safeLink } from '../engine/links';

const controllers = new Map<number, Set<AbortController>>();
let cancelledThrough = 0;

async function canvasRead(msg: CanvasReadMsg): Promise<DigReadResult> {
  if (msg.run <= cancelledThrough) throw new Error('Search stopped');
  const controller = new AbortController();
  const active = controllers.get(msg.run) ?? new Set<AbortController>();
  active.add(controller);
  controllers.set(msg.run, active);
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (!safeLink(msg.url, msg.context.origin, msg.context)) throw new Error('Blocked unsafe Canvas URL');
    const page = msg.seed
      ? { title: '', blocks: [], links: [...msg.seed, ...await discoverCourse(msg.context, controller.signal)] }
      : await readCanvas(msg.url, msg.context, controller.signal);
    clearTimeout(timer); // Timeout is for fetching, not time waiting for local inference.
    controller.signal.throwIfAborted();
    const { passages } = page.blocks.length ? await scorePage(msg.query, page.blocks) : { passages: [] };
    controller.signal.throwIfAborted();
    const visited = new Set(msg.visited);
    const candidates = msg.depth < 5 ? filterLinks(page.links, msg.url, msg.context).filter((link) => !visited.has(link.url)) : [];
    const texts = candidates.map((link) => `${link.title} ${decodeURIComponent(new URL(link.url).pathname).replace(/[\/_-]/g, ' ')} ${link.heading}`);
    const [qVec, ...vecs] = texts.length ? await embed([msg.query, ...texts]) : [];
    controller.signal.throwIfAborted();
    const scores = texts.length ? scorePassages(msg.query, qVec, texts.map((text) => ({ text, parts: [text] })), vecs) : [];
    const links = candidates.map((link, i) => ({ ...link, score: scores[i].score - 0.02 * (msg.depth + 1) }))
      .filter((link) => link.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 15);
    return { title: page.title, passages, links };
  } finally {
    clearTimeout(timer);
    active.delete(controller);
    if (!active.size) controllers.delete(msg.run);
  }
}

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
        .then(() => sendResponse({ ok: true } satisfies EngineAck), (e: unknown) => sendResponse({ ok: false, error: String(e) } satisfies EngineAck));
      return true;
    case 'score-page':
      scorePage(msg.query, msg.blocks).then(sendResponse, (e: unknown) => {
        console.error('[engine] score-page failed', e);
        sendResponse({ passages: [], ms: 0, error: String(e) } satisfies ScorePageResult);
      });
      return true;
    case 'canvas-read':
      canvasRead(msg).then(sendResponse, (e: unknown) => sendResponse({ title: '', passages: [], links: [], error: String(e) } satisfies DigReadResult));
      return true;
    case 'cancel-dig':
      cancelledThrough = Math.max(cancelledThrough, msg.run);
      for (const [run, active] of controllers) {
        if (run <= msg.run) for (const controller of active) controller.abort();
      }
      return false;
  }
  return false;
});
