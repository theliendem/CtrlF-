import { RELEVANT, W_COS, W_KW, type Passage } from '../shared/types';
import { keywordScore, parseQuery } from './keywords';

/** Penalty when a passage names the same thing with a different number. Pushes it under RELEVANT. */
const CONFLICT_FACTOR = 0.4;

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Hybrid score for passages whose embeddings are already known (vectors are L2-normalized). */
export function scorePassages(query: string, qVec: Float32Array, texts: string[], vecs: Float32Array[]): Passage[] {
  const q = parseQuery(query);
  return texts.map((text, i) => {
    const cos = dot(qVec, vecs[i]);
    const { kw, conflict } = keywordScore(q, text);
    let score = W_COS * cos + W_KW * kw;
    if (conflict) score *= CONFLICT_FACTOR;
    return { text, score, cos, kw };
  });
}

export const isRelevant = (p: Passage): boolean => p.score >= RELEVANT;
