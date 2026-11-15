// Splits page blocks into passages of about 25-80 words (1-3 sentences for prose).
// Paragraphs stay whole. Short blocks (headings, list items, table cells) are merged
// forward, so a heading travels with the paragraph under it.

const MIN_CHUNK_WORDS = 25;
const MAX_WORDS = 80;
const SHORT = 15; // blocks under this many words are "short" and get merged
const HEADING = 8; // a short run this small is a heading and travels with the next paragraph
const MAX_SENTENCES = 3;

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/** Breaks a long block into groups of up to 3 sentences / 80 words. */
function splitLong(block: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let n = 0;
  const flush = (): void => {
    if (cur.length) out.push(cur.join(' '));
    cur = [];
    n = 0;
  };
  for (const seg of segmenter.segment(block)) {
    const s = seg.segment.trim();
    if (!s) continue;
    const w = words(s);
    if (w > MAX_WORDS) {
      flush();
      const ws = s.split(/\s+/);
      for (let i = 0; i < ws.length; i += 60) out.push(ws.slice(i, i + MAX_WORDS).join(' '));
      continue;
    }
    if (n + w > MAX_WORDS || (cur.length >= MAX_SENTENCES && n >= MIN_CHUNK_WORDS)) flush();
    cur.push(s);
    n += w;
  }
  flush();
  return out;
}

/** A passage plus the blocks it was built from, so highlights can target just the matching pieces. */
export interface Chunk {
  text: string;
  parts: string[];
}

const mk = (parts: string[]): Chunk => ({ text: parts.join(' '), parts });

export function chunk(blocks: string[]): Chunk[] {
  const out: Chunk[] = [];
  let pending: string[] = []; // short blocks waiting for context
  let pendingWords = 0;
  const flushPending = (): void => {
    if (pending.length) out.push(mk(pending));
    pending = [];
    pendingWords = 0;
  };

  for (const block of blocks) {
    const w = words(block);
    if (w < SHORT) {
      if (pendingWords + w > MAX_WORDS) flushPending();
      pending.push(block);
      pendingWords += w;
      if (pendingWords >= MIN_CHUNK_WORDS) flushPending();
    } else if (w <= MAX_WORDS) {
      if (pendingWords <= HEADING && pendingWords + w <= MAX_WORDS) {
        out.push(mk([...pending, block]));
        pending = [];
        pendingWords = 0;
      } else {
        flushPending();
        out.push(mk([block]));
      }
    } else {
      const pieces = splitLong(block).map((p) => mk([p]));
      if (pending.length && pieces.length && pendingWords <= HEADING && pendingWords + words(pieces[0].text) <= MAX_WORDS) {
        pieces[0] = mk([...pending, pieces[0].text]);
        pending = [];
        pendingWords = 0;
      } else flushPending();
      out.push(...pieces);
    }
  }
  flushPending();
  return out;
}
