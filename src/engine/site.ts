// Non-Canvas sites: plain GET fetches of same-origin pages and supported files.
import type { FileData, PageText, SiteContext } from '../shared/types';
import { parseHtml } from './canvas';
import { fileKind, MAX_BYTES } from './files';
import { siteLink } from './links';

/** Fewer words than this, on a page that ships scripts, means JavaScript builds the content. */
export const MIN_WORDS = 15;

export type SiteFetch = { page: PageText; needsTab: boolean; finalUrl: string } | { file: FileData; finalUrl: string };

export function wordCount(blocks: string[]): number {
  return blocks.join(' ').split(/\s+/).filter(Boolean).length;
}

export async function fetchSite(url: string, context: SiteContext, signal: AbortSignal, parse = parseHtml): Promise<SiteFetch> {
  if (!siteLink(url, url, context)) throw new Error('Blocked unsafe link');
  const response = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow', signal });
  const finalUrl = response.url || url;
  // The redirect itself was a GET; reading an off-site page it landed on is not.
  if (new URL(finalUrl).origin !== context.origin) throw new Error('Redirected off-site; not followed');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const name = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() ?? '');
  const kind = fileKind(name, mime);
  if (kind) {
    // LATER: stream or cache larger documents instead of retaining their bytes in memory.
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('File exceeds the 50 MB demo limit');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error('File exceeds the 50 MB demo limit');
    return { file: { bytes, kind, title: name || finalUrl }, finalUrl };
  }
  if (mime && !/^(?:text\/html|application\/xhtml\+xml)$/.test(mime)) throw new Error(`Not a web page (${mime})`);
  const html = await response.text();
  const page = parse(html, finalUrl, '');
  page.links = page.links.flatMap((link) => {
    try { return [{ ...link, url: new URL(link.url, finalUrl).href }]; } catch { return []; }
  });
  return { page, finalUrl, needsTab: wordCount(page.blocks) < MIN_WORDS && /<script\b/i.test(html) };
}
