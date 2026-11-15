import type { DigLink, ExactMatch, Passage } from '../shared/types';

/** Literal phrase search; only case and runs of whitespace are ignored. */
export function exactMatches(query: string, text: string): ExactMatch[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return [...text.matchAll(new RegExp(pattern, 'giu'))].map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
}

export function exactPassages(query: string, blocks: string[]): Passage[] {
  return exactMatches(query, blocks.join('\n')).map((match) => ({ text: match.text, marks: [match.text], score: 1, cos: 0, kw: 1 }));
}

/** Every surviving content link enters the queue. No relevance cutoff or per-page cap. */
export function exactLinks(links: DigLink[]): DigLink[] {
  return links.map((link) => ({ ...link, score: 1 }));
}
