import { MemoryCache, MiB, contentKey } from './memory';
const cache = new MemoryCache<number>(MiB);
// Query and passage are encoded together by a small bundled cross encoder.
import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';
import { infer, localDevice, RERANK_MODEL } from './model-runtime';
import { splitToFit } from './chunk';
import { checkpoint } from './inference';

export type Rerank = (query: string, texts: string[], signal?: AbortSignal) => Promise<number[]>;
const BATCH = 8;
const MAX_PAIR_TOKENS = 512;
let loaded: Promise<{ model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> }> | undefined;

export function loadReranker() {
  loaded ??= Promise.all([
    AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: 'q8', device: localDevice }),
    AutoTokenizer.from_pretrained(RERANK_MODEL),
  ]).then(([model, tokenizer]) => ({ model, tokenizer })).catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

const scoreUncached: Rerank = async (query, texts, signal) => {
  if (!texts.length) return [];
  const { model, tokenizer } = await loadReranker();
  await checkpoint(signal);
  // Reserve ample space for passage text; unusually long queries receive an explicit error.
  if (tokenizer.encode(query).length > 128) throw new Error('Search is too long. Use a query under 128 tokens.');
  const windows = texts.map((text) => splitToFit(text,
    (piece) => tokenizer.encode(query, { text_pair: piece }).length <= MAX_PAIR_TOKENS));
  const flat = windows.flat();
  const scores: number[] = [];
  for (let i = 0; i < flat.length; i += BATCH) {
    await checkpoint(signal);
    const batch = flat.slice(i, i + BATCH);
    const inputs = tokenizer(batch.map(() => query), { text_pair: batch, padding: true, truncation: false });
    const output = await model(inputs);
    signal?.throwIfAborted();
    for (const logit of output.logits.data) scores.push(1 / (1 + Math.exp(-Number(logit))));
  }
  let offset = 0;
  return windows.map((parts) => {
    const score = Math.max(...scores.slice(offset, offset + parts.length));
    offset += parts.length;
    return score;
  });
};

export const rerank: Rerank = (query, texts, signal) => infer(async () => {
  const keys = await Promise.all(texts.map(text => contentKey(`rerank-q8-v1:${RERANK_MODEL}`, [query, text])));
  await checkpoint(signal);
  const values = new Map<string, number>();
  const missing = new Map<string, string>();
  keys.forEach((key, i) => {
    const hit = cache.get(key);
    if (hit !== undefined) values.set(key, hit);
    else missing.set(key, texts[i]);
  });
  if (missing.size) {
    const scores = await scoreUncached(query, [...missing.values()], signal);
    signal?.throwIfAborted();
    [...missing.keys()].forEach((key, i) => {
      values.set(key, scores[i]);
      cache.set(key, scores[i]);
    });
  }
  return keys.map(key => values.get(key)!);
}, signal);
