// On-device sentence embeddings: bundled fp16 on WebGPU, with a WASM q8 fallback.
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { MemoryCache, MiB } from './memory';
import { EMBEDDING_MODEL as MODEL, MAX_EMBED_TOKENS, infer, localDevice } from './model-runtime';
import { splitToFit, type TokenCount } from './chunk';
import { checkpoint } from './inference';

const DIM = 384;
const BATCH = 16;
const MAX_TOKENS = MAX_EMBED_TOKENS;

let extractor: Promise<FeatureExtractionPipeline> | null = null;
let backend = `${localDevice}/q8`;

async function createExtractor(): Promise<FeatureExtractionPipeline> {
  let model: FeatureExtractionPipeline | undefined;
  if ('gpu' in navigator) {
    try {
      model = await pipeline('feature-extraction', MODEL, { dtype: 'fp16', device: 'webgpu' });
      backend = 'webgpu/fp16';
    } catch (error) {
      console.warn('[ctrlf++] WebGPU load failed; falling back to WASM q8', error);
    }
  }
  model ??= await pipeline('feature-extraction', MODEL, { dtype: 'q8', device: localDevice });
  model.tokenizer._tokenizerConfig.model_max_length = MAX_TOKENS;
  console.log(`[ctrlf++] loaded ${backend}, max ${MAX_TOKENS} tokens, batch ${BATCH}`);
  return model;
}

export function loadModel(): Promise<FeatureExtractionPipeline> {
  extractor ??= createExtractor().catch((error: unknown) => {
    extractor = null;
    throw error;
  });
  return extractor;
}

const cache = new MemoryCache<Float32Array>(7 * MiB);

/** Count special tokens too, using exactly the tokenizer used for inference. */
export async function tokenCounter(): Promise<TokenCount> {
  const model = await loadModel();
  return (text) => model.tokenizer.encode(text).length;
}

export function embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  return infer(() => embedBatch(texts, signal), signal);
}

async function embedBatch(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
  await checkpoint(signal);
  // Similar lengths reduce padding; the text-keyed cache preserves the caller's order.
  const hits = new Map<string, Float32Array>();
  for (const text of texts) { const hit = cache.get(text); if (hit) hits.set(text, hit); }
  const todo = [...new Set(texts.filter((t) => !hits.has(t)))].sort((a, b) => a.length - b.length);
  const fresh = new Map<string, Float32Array>();
  if (todo.length) {
    const model = await loadModel();
    await checkpoint(signal);
    const start = performance.now();
    const windows = todo.map((text) => splitToFit(text, (piece) => model.tokenizer.encode(piece).length <= MAX_TOKENS));
    const flat = windows.flat();
    const vectors: Float32Array[] = [];
    for (let i = 0; i < flat.length; i += BATCH) {
      await checkpoint(signal);
      const out = await model(flat.slice(i, i + BATCH), { pooling: 'mean', normalize: true });
      signal?.throwIfAborted();
      const data = out.data as Float32Array;
      for (let j = 0; j < Math.min(BATCH, flat.length - i); j++) vectors.push(data.slice(j * DIM, (j + 1) * DIM));
    }
    let offset = 0;
    todo.forEach((text, i) => {
      const vector = new Float32Array(DIM);
      for (let j = 0; j < windows[i].length; j++) {
        const next = vectors[offset++];
        for (let k = 0; k < DIM; k++) vector[k] += next[k];
      }
      const norm = Math.hypot(...vector) || 1;
      fresh.set(text, vector.map((value) => value / norm));
    });
    const ms = performance.now() - start;
    console.log(`[ctrlf++] ${backend}: embedded ${todo.length} passages in ${Math.round(ms)} ms (${(ms / todo.length).toFixed(1)} ms/passage)`);
  }
  const result = texts.map((t) => fresh.get(t) ?? hits.get(t)!);
  for (const [t, v] of fresh) cache.set(t, v);
  return result;
}
