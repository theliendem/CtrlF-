// What a read page *is*, beyond the link that reached it. Wikipedia-style sites reach one article
// through many URLs (redirect titles served with 200, ?title= aliases, mobile/desktop), so two
// different links can read the same page. Any shared key means the second read is a duplicate.
// Pure functions: used by the offscreen engine and the service worker.

/** Below this many words, pages are too generic ("Loading…", stubs) to fingerprint safely. */
const MIN_FINGERPRINT_WORDS = 50;

/** A URL without its fragment; #section links read the same document. */
export function urlKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = '';
    return `url:${url.href}`;
  } catch {
    return null;
  }
}

/** FNV-1a over the page's normalized text. Same text from two URLs = same page. */
export function textFingerprint(blocks: string[]): string | null {
  const text = blocks.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  if (text.split(' ').length < MIN_FINGERPRINT_WORDS) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `text:${(h >>> 0).toString(36)}:${text.length}`;
}

/** Every key that identifies a read page: where it landed, what it calls itself, and its text. */
export function pageIdentity(finalUrl: string, canonical: string | undefined, blocks: string[]): string[] {
  let canon: string | undefined;
  if (canonical) {
    try {
      canon = new URL(canonical, finalUrl).href;
    } catch { /* ignore a malformed canonical */ }
  }
  return [urlKey(finalUrl), canon ? urlKey(canon) : null, textFingerprint(blocks)].filter((k): k is string => !!k);
}
