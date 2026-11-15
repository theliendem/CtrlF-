// Offscreen document: the engine. Model, scoring, and (later) fetching and parsing.
import { RELEVANT, type CanvasReadMsg, type DigLink, type DigReadResult, type EngineAck, type RuntimeMsg, type ScorePageResult } from '../shared/types';
import { exactPassages, exactLinks } from '../engine/exact';
import { discoverCourse, readCanvas } from '../engine/canvas';
import { filterLinks, safeLink, skippedLinks } from '../engine/links';
import { downloadCanvasFile, officeSections } from '../engine/files';
import { pdfSections } from '../engine/pdf';

const controllers = new Map<number, Set<AbortController>>();
let cancelledThrough = 0;

async function canvasRead(msg: CanvasReadMsg): Promise<DigReadResult> {
  if (msg.settings.mode !== 'exact') throw new Error('Semantic search is not available yet. Choose Exact in settings.');
  if (msg.run <= cancelledThrough) throw new Error('Search stopped');
  const controller = new AbortController();
  const active = controllers.get(msg.run) ?? new Set<AbortController>();
  active.add(controller);
  controllers.set(msg.run, active);
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (!safeLink(msg.url, msg.context.origin, msg.context)) throw new Error('Blocked unsafe Canvas URL');
    if (!msg.seed && /\/files\/\d+$/.test(new URL(msg.url).pathname)) {
      const file = await downloadCanvasFile(msg.url, msg.context, controller.signal);
      clearTimeout(timer);
      const sections = file.kind === 'pdf' ? pdfSections(file.bytes, controller.signal) : officeSections(file.bytes, file.kind, controller.signal);
      let result: DigReadResult = { title: file.title, kind: file.kind, passages: [], links: [] };
      let hasText = false;
      const fileLinks: DigLink[] = [];
      for await (const section of sections) {
        controller.signal.throwIfAborted();
        fileLinks.push(...section.links ?? []);
        if (!section.blocks.length) continue;
        hasText = true;
        const scored = await scorePage(msg.query, section.blocks);
        controller.signal.throwIfAborted();
        const hits = scored.passages.filter((p) => p.score >= RELEVANT && p.marks.length);
        if (hits.length && (!result.passages.length || hits[0].score > result.passages[0].score)) {
          result = { title: file.title, kind: file.kind, passages: hits, links: [], location: section.location, pageNumber: section.pageNumber };
          const progress: RuntimeMsg = { to: 'sw', type: 'file-progress', run: msg.run, url: msg.url, result };
          void chrome.runtime.sendMessage(progress).catch(() => {});
        }
      }
      // LATER: OCR for image-only pages/slides and scanned PDFs.
      if (!hasText) throw new Error('No readable text (scanned or image-only file)');
      if (msg.depth < msg.settings.maxDepth) {
        result.links = exactLinks(filterLinks(fileLinks, msg.url, msg.context).filter((link) => !msg.visited.includes(link.url)));
        result.skipped = skippedLinks(fileLinks, msg.url, msg.context, msg.settings);
      }
      return result;
    }
    const page = msg.seed
      ? { title: '', blocks: [], links: [...msg.seed, ...await discoverCourse(msg.context, controller.signal)] }
      : await readCanvas(msg.url, msg.context, controller.signal);
    clearTimeout(timer); // Timeout is for fetching, not time waiting for local inference.
    controller.signal.throwIfAborted();
    const { passages } = page.blocks.length ? await scorePage(msg.query, page.blocks) : { passages: [] };
    controller.signal.throwIfAborted();
    const visited = new Set(msg.visited);
    const candidates = msg.depth < msg.settings.maxDepth ? filterLinks(page.links, msg.url, msg.context).filter((link) => !visited.has(link.url)) : [];
    const links = exactLinks(candidates);
    return { title: page.title, passages, links, skipped: msg.depth < msg.settings.maxDepth ? skippedLinks(page.links, msg.url, msg.context, msg.settings) : [] };
  } finally {
    clearTimeout(timer);
    active.delete(controller);
    if (!active.size) controllers.delete(msg.run);
  }
}

async function scorePage(query: string, blocks: string[]): Promise<ScorePageResult> {
  const t0 = performance.now();
  const passages = exactPassages(query, blocks);
  return { passages, ms: Math.round(performance.now() - t0) };
}

chrome.runtime.onMessage.addListener((msg: RuntimeMsg, _sender, sendResponse) => {
  if (msg.to !== 'offscreen') return false;
  switch (msg.type) {
    case 'warmup':
      // LATER: warm up the model when semantic mode is implemented.
      sendResponse({ ok: true } satisfies EngineAck);
      return true;
    case 'score-page':
      if (msg.mode !== 'exact') {
        sendResponse({ passages: [], ms: 0, error: 'Semantic search is not available yet.' } satisfies ScorePageResult);
        return false;
      }
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
