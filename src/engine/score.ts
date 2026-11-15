import { CONFLICT_FACTOR, W_COS, W_KW, type Passage } from '../shared/types';
import type { Chunk } from './chunk';
import { keywordScore, parseQuery, type QueryTerms } from './keywords';

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Hybrid score for passages whose embeddings are already known (vectors are L2-normalized). */
export function scorePassages(query: string, qVec: Float32Array, chunks: Chunk[], vecs: Float32Array[]): Passage[] {
  const q = parseQuery(query);
  return chunks.map((c, i) => {
    const cos = dot(qVec, vecs[i]);
    const { kw, conflict } = keywordScore(q, c.text);
    let score = W_COS * cos + W_KW * kw;
    if (conflict) score *= CONFLICT_FACTOR;
    return { text: c.text, marks: marksFor(q, c), score, cos, kw };
  });
}

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Preserve exact substrings for DOM matching, splitting even a single large paragraph. */
export function highlightPieces(parts: string[]): string[] {
  return parts.flatMap((part) => [...sentences.segment(part)].flatMap(({ segment }) =>
    segment.split(/[;\n]+/).map((text) => text.trim()).filter(Boolean)));
}

/** Keep only the strongest keyword-bearing sentences. Never fall back to the whole passage. */
function marksFor(q: QueryTerms, c: Chunk): string[] {
  const pieces = highlightPieces(c.parts).map((text) => ({ text, ...keywordScore(q, text) }));
  const best = Math.max(0, ...pieces.filter((piece) => !piece.conflict).map((piece) => piece.kw));
  return pieces.filter((piece) => !piece.conflict && best > 0 && piece.kw === best).map((piece) => piece.text);
}

