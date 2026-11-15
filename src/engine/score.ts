import { RELEVANT, W_COS, W_KW, type Passage } from '../shared/types';
import type { Chunk } from './chunk';
import { keywordScore, parseQuery, type QueryTerms } from './keywords';

/** Penalty when a passage names the same thing with a different number. Pushes it under RELEVANT. */
const CONFLICT_FACTOR = 0.4;

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

/** In a merged passage, highlight only the pieces that mention the query; otherwise the whole thing. */
function marksFor(q: QueryTerms, c: Chunk): string[] {
  if (c.parts.length < 2) return c.parts;
  const hit = c.parts.filter((p) => {
    const r = keywordScore(q, p);
    return r.kw > 0 && !r.conflict;
  });
  return hit.length ? hit : c.parts;
}

export const isRelevant = (p: Passage): boolean => p.score >= RELEVANT;
