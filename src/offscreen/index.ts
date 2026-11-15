// Offscreen document: the engine. Scoring, fetching and parsing pages and files.
import { RELEVANT, type DigLink, type DigReadMsg, type DigReadResult, type EngineAck, type FileData, type FileSection, type PageText, type RuntimeMsg, type ScorePageResult } from '../shared/types';
import { exactPassages, exactLinks } from '../engine/exact';
import { discoverCourse, readCanvas } from '../engine/canvas';
import { digLink, filterLinks, isCanvas, skippedLinks } from '../engine/links';
import { downloadCanvasFile, officeSections } from '../engine/files';
import { pdfSections } from '../engine/pdf';
import { fetchSite } from '../engine/site';
import { recall, recordSections, remember, replaySections, type CachedRead } from '../engine/cache';

const controllers = new Map<number, Set<AbortController>>();
let cancelledThrough = 0;

export async function digRead(msg: DigReadMsg): Promise<DigReadResult> {
  if (msg.settings.mode !== 'exact') throw new Error('Semantic search is not available yet. Choose Exact in settings.');
  if (msg.run <= cancelledThrough) throw new Error('Search stopped');
  const controller = new AbortController();
  const { signal } = controller;
  const active = controllers.get(msg.run) ?? new Set<AbortController>();
  active.add(controller);
  controllers.set(msg.run, active);
  // The timeout is for fetching, not for time spent reading and scoring locally.
  const timer = setTimeout(() => controller.abort(), 8000);
  const context = msg.context;
  const canDig = msg.depth < msg.settings.maxDepth;

  /** Score a page and pass its links through the free filter. */
  const finish = async (page: PageText, base: string): Promise<DigReadResult> => {
    clearTimeout(timer);
    signal.throwIfAborted();
    const { passages } = page.blocks.length ? await scorePage(msg.query, page.blocks) : { passages: [] };
    signal.throwIfAborted();
    const visited = new Set(msg.visited);
    const links = canDig ? exactLinks(filterLinks(page.links, base, context).filter((link) => !visited.has(link.url))) : [];
    return { title: page.title, passages, links, skipped: canDig ? skippedLinks(page.links, base, context, msg.settings) : [], finalUrl: base };
  };

  /** Read a file section by section; report each better match as it is found. */
  const readFile = async (file: Pick<FileData, 'kind' | 'title'>, sections: AsyncIterable<FileSection>, base: string): Promise<DigReadResult> => {
    clearTimeout(timer);
    let result: DigReadResult = { title: file.title, kind: file.kind, passages: [], links: [] };
    let hasText = false;
    const fileLinks: DigLink[] = [];
    for await (const section of sections) {
      signal.throwIfAborted();
      fileLinks.push(...section.links ?? []);
      if (!section.blocks.length) continue;
      hasText = true;
      const scored = await scorePage(msg.query, section.blocks);
      signal.throwIfAborted();
      const hits = scored.passages.filter((p) => p.score >= RELEVANT && p.marks.length);
      if (hits.length && (!result.passages.length || hits[0].score > result.passages[0].score)) {
        result = { title: file.title, kind: file.kind, passages: hits, links: [], location: section.location, pageNumber: section.pageNumber };
        const progress: RuntimeMsg = { to: 'sw', type: 'file-progress', run: msg.run, url: msg.url, result };
        void chrome.runtime.sendMessage(progress).catch(() => {});
      }
    }
    // LATER: OCR for image-only pages/slides and scanned PDFs.
    if (!hasText) throw new Error('No readable text (scanned or image-only file)');
    if (canDig) {
      result.links = exactLinks(filterLinks(fileLinks, base, context).filter((link) => !msg.visited.includes(link.url)));
      result.skipped = skippedLinks(fileLinks, base, context, msg.settings);
    }
    return result;
  };

  /** Freshly downloaded bytes: read them, remembering the sections for next time. */
  const readBytes = (file: FileData, finalUrl: string): Promise<DigReadResult> => {
    const sections = file.kind === 'pdf' ? pdfSections(file.bytes, signal) : officeSections(file.bytes, file.kind, signal);
    return readFile(file, recordSections(msg.url, file, finalUrl, sections), finalUrl);
  };

  try {
    if (msg.seed) {
      // The starting page: its own links, plus the course map on Canvas.
      let links = msg.seed;
      if (isCanvas(context)) {
        const key = `course-map:${context.origin}/${context.courseId}`;
        const map = recall<DigLink[]>(key) ?? remember(key, await discoverCourse(context, signal));
        links = [...msg.seed, ...map];
      }
      return await finish({ url: msg.url, title: '', blocks: [], links }, msg.url);
    }
    if (!digLink(msg.url, msg.url, context)) throw new Error('Blocked unsafe link');
    const seen = recall<CachedRead>(msg.url);
    if (seen && 'file' in seen) return await readFile(seen.file, replaySections(seen.sections), seen.finalUrl);
    if (seen?.needsTab) return { title: seen.page.title, passages: [], links: [], needsTab: true, finalUrl: seen.finalUrl };
    if (seen) return await finish(seen.page, seen.finalUrl);
    if (isCanvas(context)) {
      if (/\/files\/\d+$/.test(new URL(msg.url).pathname)) return await readBytes(await downloadCanvasFile(msg.url, context, signal), msg.url);
      const page = await readCanvas(msg.url, context, signal);
      remember<CachedRead>(msg.url, { page, needsTab: false, finalUrl: msg.url });
      return await finish(page, msg.url);
    }
    const got = await fetchSite(msg.url, context, signal);
    if ('file' in got) return await readBytes(got.file, got.finalUrl);
    remember<CachedRead>(msg.url, { page: got.page, needsTab: got.needsTab, finalUrl: got.finalUrl });
    if (got.needsTab) return { title: got.page.title, passages: [], links: [], needsTab: true, finalUrl: got.finalUrl };
    return await finish(got.page, got.finalUrl);
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
    case 'dig-read':
      digRead(msg).then(sendResponse, (e: unknown) => sendResponse({ title: '', passages: [], links: [], error: String(e) } satisfies DigReadResult));
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
