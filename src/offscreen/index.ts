import type { CanvasFetch } from '../shared/canvas-api';
// Shared engine: Firefox background page or Chrome offscreen document. Scoring, fetching and parsing pages and files.
import { relevantScore, type DigContext, type DigLink, type DigReadMsg, type DigReadResult, type EngineAck, type FileData, type FileSection, type PageText, type RuntimeMsg, type ScorePageResult, type SearchMode } from '../shared/types';
import { exactPassages, exactLinks } from '../engine/exact';
import { isCanvasHub, loadModel, semanticLinks, semanticPassages } from '../engine/semantic';
import { discoverCourse, readCanvas } from '../engine/canvas';
import { digLink, filterLinks, isCanvas, skippedLinks } from '../engine/links';
import { downloadCanvasFile, officeSections } from '../engine/files';
import { pdfSections } from '../engine/pdf';
import { fetchSite } from '../engine/site';
import { pageIdentity, urlKey } from '../engine/identity';
import { refreshContent, cacheReady, recall, recordSections, remember, replaySections, type CachedRead } from '../engine/cache';
import { setKeepCache } from '../engine/persist';
import { checkpoint } from '../engine/inference';

const controllers = new Map<number, Set<AbortController>>();
let cancelledThrough = 0;

/** Starting-page and tab scoring belong to the search too, not just fetched pages. */
async function runTask<T>(run: number | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (run !== undefined && run <= cancelledThrough) throw new Error('Search stopped');
  const controller = new AbortController();
  const active = run === undefined ? new Set<AbortController>() : controllers.get(run) ?? new Set<AbortController>();
  active.add(controller);
  if (run !== undefined) controllers.set(run, active);
  try {
    const result = await work(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    active.delete(controller);
    if (run !== undefined && !active.size) controllers.delete(run);
  }
}

export async function digRead(msg: DigReadMsg, reportProgress: (msg: RuntimeMsg) => void = () => {}, canvasFetch?: CanvasFetch): Promise<DigReadResult> {
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
  const mode = msg.settings.mode;
  /** Exact queues every link; semantic keeps the ones whose words are close to the query. */
  const pick = (links: DigLink[]): Promise<DigLink[]> => pickLinks(mode, msg.query, links, msg.depth + 1, context, msg.url, signal);

  /** Score a page and pass its links through the free filter. */
  const finish = async (page: PageText, base: string): Promise<DigReadResult> => {
    clearTimeout(timer);
    signal.throwIfAborted();
    const { passages } = page.blocks.length ? await scorePage(msg.query, page.blocks, mode, page.title, signal) : { passages: [] };
    signal.throwIfAborted();
    const visited = new Set(msg.visited);
    const links = canDig ? await pick(filterLinks(page.links, base, context).filter((link) => !visited.has(link.url))) : [];
    signal.throwIfAborted();
    return { title: page.title, passages, links, skipped: canDig ? skippedLinks(page.links, base, context, msg.settings) : [], finalUrl: base, identity: pageIdentity(base, page.canonical, page.blocks) };
  };

  /** Read a file section by section; report each better match as it is found. */
  const readFile = async (file: Pick<FileData, 'kind' | 'title'>, sections: AsyncIterable<FileSection>, base: string): Promise<DigReadResult> => {
    clearTimeout(timer);
    await checkpoint(signal);
    const identity = [urlKey(base)].filter((k): k is string => !!k);
    let result: DigReadResult = { title: file.title, kind: file.kind, passages: [], links: [], identity };
    let hasText = false;
    const fileLinks: DigLink[] = [];
    for await (const section of sections) {
      await checkpoint(signal);
      fileLinks.push(...section.links ?? []);
      if (!section.blocks.length) continue;
      hasText = true;
      const scored = await scorePage(msg.query, section.blocks, mode, file.title, signal);
      signal.throwIfAborted();
      const hits = scored.passages.filter((p) => p.score >= relevantScore(mode) && p.marks.length);
      if (hits.length && (!result.passages.length || hits[0].score > result.passages[0].score)) {
        result = { title: file.title, kind: file.kind, passages: hits, links: [], location: section.location, pageNumber: section.pageNumber, identity };
        const progress: RuntimeMsg = { to: 'sw', type: 'file-progress', run: msg.run, url: msg.url, result };
        reportProgress(progress);
      }
    }
    // LATER: OCR for image-only pages/slides and scanned PDFs.
    if (!hasText) throw new Error('No readable text (scanned or image-only file)');
    if (canDig) {
      result.links = await pick(filterLinks(fileLinks, base, context).filter((link) => !msg.visited.includes(link.url)));
      result.skipped = skippedLinks(fileLinks, base, context, msg.settings);
    }
    signal.throwIfAborted();
    return result;
  };

  /** Freshly downloaded bytes: read them, remembering the sections for next time. */
  const readBytes = (file: FileData, finalUrl: string): Promise<DigReadResult> => {
    const sections = file.kind === 'pdf' ? pdfSections(file.bytes, signal) : officeSections(file.bytes, file.kind, signal);
    return readFile(file, recordSections(msg.url, file, finalUrl, sections), finalUrl);
  };

  try {
    await cacheReady();
    await checkpoint(signal);
    if (msg.seed) {
      // The starting page: its own links, plus the course map on Canvas.
      let links = msg.seed;
      if (isCanvas(context)) {
        const key = `course-map:${context.origin}/${context.courseId}`;
        const map = recall<DigLink[]>(key) ?? remember(key, await discoverCourse(context, signal, canvasFetch));
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
      if (/\/files\/\d+$/.test(new URL(msg.url).pathname)) return await readBytes(await downloadCanvasFile(msg.url, context, signal, canvasFetch), msg.url);
      const page = await readCanvas(msg.url, context, signal, canvasFetch);
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

async function scorePage(query: string, blocks: string[], mode: SearchMode, title?: string, signal?: AbortSignal): Promise<ScorePageResult> {
  await checkpoint(signal);
  const t0 = performance.now();
  const passages = mode === 'semantic' ? await semanticPassages(query, blocks, { title, signal }) : exactPassages(query, blocks);
  signal?.throwIfAborted();
  return { passages, ms: Math.round(performance.now() - t0) };
}

/**
 * Exact follows every surviving link; semantic scores them by meaning and keeps the close ones.
 * Semantic keeps every link on the start page, and every item on a Canvas module or list page,
 * because titles like "U2 homework" don't say what's inside. Those are still read best first.
 * from is the page the links were found on.
 */
export async function pickLinks(mode: SearchMode, query: string, links: DigLink[], depth: number, context: DigContext, from: string, signal?: AbortSignal): Promise<DigLink[]> {
  await checkpoint(signal);
  if (mode !== 'semantic') return Promise.resolve(exactLinks(links, query));
  const canvas = isCanvas(context);
  const keepAll = depth === 1 || (canvas && isCanvasHub(from));
  return semanticLinks(query, links, depth, canvas, undefined, keepAll, signal);
}

export function handleEngineMessage(msg: RuntimeMsg, sendResponse: (response: unknown) => void, reportProgress: (msg: RuntimeMsg) => void, canvasFetch?: CanvasFetch): boolean {
  if (msg.to !== 'offscreen') return false;
  // Settings travel with each search because Chrome's offscreen page only has runtime APIs.
  if (msg.type === 'dig-read') setKeepCache(false);
  else if (msg.type === 'score-page') setKeepCache(false);
  switch (msg.type) {
    case 'refresh-content':
      refreshContent();
      sendResponse({ ok: true } satisfies EngineAck);
      return false;
    case 'warmup':
      // Only sent in semantic mode; Exact never loads the model.
      loadModel().then(() => sendResponse({ ok: true } satisfies EngineAck), (e: unknown) => sendResponse({ ok: false, error: String(e) } satisfies EngineAck));
      return true;
    case 'score-links':
      runTask(msg.run, (signal) => pickLinks(msg.mode, msg.query, msg.links, msg.depth, msg.context, msg.from, signal)).then((links) => sendResponse({ links }), (e: unknown) => {
        if (msg.run === undefined || msg.run > cancelledThrough) console.error('[engine] score-links failed', e);
        sendResponse({ links: [], error: String(e) });
      });
      return true;
    case 'score-page':
      runTask(msg.run, (signal) => scorePage(msg.query, msg.blocks, msg.mode, msg.title, signal)).then(sendResponse, (e: unknown) => {
        if (msg.run === undefined || msg.run > cancelledThrough) console.error('[engine] score-page failed', e);
        sendResponse({ passages: [], ms: 0, error: String(e) } satisfies ScorePageResult);
      });
      return true;
    case 'dig-read':
      digRead(msg, reportProgress, canvasFetch).then(sendResponse, (e: unknown) => sendResponse({ title: '', passages: [], links: [], error: String(e) } satisfies DigReadResult));
      return true;
    case 'cancel-dig':
      cancelledThrough = Math.max(cancelledThrough, msg.run);
      for (const [run, active] of controllers) {
        if (run <= msg.run) for (const controller of active) controller.abort();
      }
      return false;
  }
  return false;
}
