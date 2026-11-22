// Original substrings are preserved for highlighting. Context is used for ranking only.
export interface Chunk { text: string; parts: string[] }
export type TokenCount = (text: string) => number;
export interface ChunkOptions { countTokens?: TokenCount; maxTokens?: number; overlap?: boolean; title?: string }
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const words = (text: string): number => text.split(/\s+/u).filter(Boolean).length;

/** Split oversized sentences, even a single long code identifier, without dropping characters. */
export function splitToFit(text: string, fits: (text: string) => boolean): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining && !fits(remaining)) {
    // Find a fitting prefix, then prefer its last word boundary. Token counts need not be monotonic.
    let length = Math.max(1, Math.floor(remaining.length / 2));
    while (length > 1 && !fits(remaining.slice(0, length))) length = Math.floor(length / 2);
    if (!fits(remaining.slice(0, length))) throw new Error('Token budget cannot fit one character');
    const boundary = remaining.slice(0, length).search(/\s+\S*$/u);
    if (boundary > 0 && fits(remaining.slice(0, boundary))) length = boundary;
    pieces.push(remaining.slice(0, length).trim());
    remaining = remaining.slice(length).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

/** Infer short heading blocks; actual token counts are supplied by the bundled tokenizer. */
export function chunk(blocks: string[], options: ChunkOptions = {}): Chunk[] {
  const count = options.countTokens ?? words;
  const maxTokens = options.maxTokens ?? 256;
  const fits = (text: string): boolean => count(text) <= maxTokens && words(text) <= 80;
  const out: Chunk[] = [];
  let heading = '';
  let headingUsed = false;
  let previous = '';
  let parts: string[] = [];
  const textFor = (body: string[]): string => {
    let text = body.join(' ');
    // Reserve the document topic before local heading/overlap context. Never drop body text.
    const contexts = [options.title, heading, options.overlap !== false ? previous : ''];
    const included: string[] = [];
    for (const context of contexts) {
      const candidate = [...included, context, body.join(' ')].filter(Boolean).join(' ');
      if (context && !text.includes(context) && !included.includes(context) && fits(candidate)) {
        included.push(context);
        text = candidate;
      }
    }
    return [...included, body.join(' ')].join(' ');
  };
  const flush = (): void => {
    if (!parts.length) return;
    const text = textFor(parts);
    out.push({ text, parts });
    headingUsed ||= text.includes(heading);
    previous = parts.at(-1)!;
    parts = [];
  };
  const flushHeading = (): void => {
    if (heading && !headingUsed) out.push({ text: heading, parts: [heading] });
  };
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    if (words(block) <= 8 && !/[.!?;\n]/u.test(block) && fits(block)) {
      flush();
      flushHeading();
      heading = block;
      headingUsed = false;
      previous = '';
      continue;
    }
    for (const { segment } of sentences.segment(block)) {
      const context = options.title || heading;
      const bodyFits = (text: string): boolean => fits(text) && (!context || count(context) > maxTokens / 3 || fits(`${context} ${text}`));
      for (const piece of splitToFit(segment, bodyFits)) {
        if (parts.length && (!bodyFits([...parts, piece].join(' ')) || (parts.length >= 3 && words(parts.join(' ')) >= 25))) flush();
        parts.push(piece);
      }
    }
  }
  flush();
  flushHeading();
  return out;
}
