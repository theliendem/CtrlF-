import { CONFLICT_FACTOR, type DigLink, type ExactMatch, type Passage } from '../shared/types';
import { keywordScore, parseQuery } from './keywords';
import { linkPath } from './link-text';

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

/** Rank every surviving link without a model, relevance cutoff or per-page cap.
 * Titles are the strongest clue, followed by URL words and the nearby heading.
 * This affects traversal only; page matches still use the literal phrase.
 */
export function exactLinks(links: DigLink[], query: string): DigLink[] {
  const terms = parseQuery(query);
  const relevance = (text: string): number => {
    const { kw, conflict } = keywordScore(terms, text);
    const literal = exactMatches(query, text).length > 0 ? 1 : 0;
    return (literal + kw) * (conflict ? CONFLICT_FACTOR : 1);
  };
  return links.map((link) => ({
    ...link,
    score: 2 * relevance(link.title) + relevance(linkPath(link.url)) + 0.5 * relevance(link.heading),
  }));
}
