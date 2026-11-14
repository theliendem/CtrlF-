// Sources: turn any URL into a SourceDoc. Owner: A (except pdf.ts, owned by B).
// Run in the offscreen document (needs DOMParser).
import type { SourceDoc } from '../../../shared/contracts';
import { canvasCourseOf, canvasDoc, isCanvasHost } from './canvas';
import { fromHtml } from './html';
import { fromPdf } from './pdf';
import { isSafeToFetch, safeGet, UnsafeUrlError } from './safety';

export { fromHtml, fromHtmlFragment, extractLinks, extractPassages, splitSentences } from './html';
export { canvasDoc, canvasCourseOf, canvasGet, canvasGetAll, fromCanvas, isCanvasHost } from './canvas';
export { isSafeToFetch, safeGet, UnsafeUrlError } from './safety';
export { fromPdf } from './pdf';

const looksLikePdf = (url: string) => /\.pdf($|[?#])/i.test(url);

/**
 * Load any URL the dig wants to visit. Canvas course URLs go through the Canvas API; PDFs go to
 * fromPdf; everything else is a plain GET + fromHtml. Returns null for things we can't read.
 */
export async function loadDoc(url: string, linkText = ''): Promise<SourceDoc | null> {
  if (!isSafeToFetch(url, linkText)) throw new UnsafeUrlError(`refusing to fetch ${url}`);
  const host = new URL(url).hostname;
  if (canvasCourseOf(url) || (isCanvasHost(host) && /^\/files\/\d+/.test(new URL(url).pathname))) {
    const doc = await canvasDoc(url);
    if (doc) return doc;
    // Canvas pages are JS-rendered; a plain fetch would come back mostly empty. Skip.
    return null;
  }
  if (looksLikePdf(url)) return fromPdf(url);
  const res = await safeGet(url, { linkText, accept: 'text/html,application/pdf' });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/pdf')) return fromPdf(res.url || url);
  if (!type.includes('html')) return null;
  return fromHtml(await res.text(), res.url || url);
}
