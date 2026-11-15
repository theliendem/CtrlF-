// On-device sentence embeddings: bundled fp16 on WebGPU, with a WASM q8 fallback.
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
// Vite emits this file into the extension; the JS loader for it is already inside the ORT bundle.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.useBrowserCache = false;
// transformers.js points the runtime at a CDN by default. Use the bundled copy instead
// (and skip its blob-URL cache, which the extension CSP blocks).
env.useWasmCache = false;
const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (ort.wasm) {
  ort.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, location.href).href };
  ort.wasm.numThreads = 1; // offscreen docs aren't cross-origin isolated, so no threads
}

const MODEL = 'all-MiniLM-L6-v2';
const DIM = 384;
const BATCH = 16;
const MAX_TOKENS = 128;

let extractor: Promise<FeatureExtractionPipeline> | null = null;
let backend = 'wasm/q8';

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
  model ??= await pipeline('feature-extraction', MODEL, { dtype: 'q8', device: 'wasm' });
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

// Embedding cache keyed by text. Same passage on a second search costs nothing.
// LATER: persist to IndexedDB so the cache survives a browser restart.
const cache = new Map<string, Float32Array>();

let pending: Promise<unknown> = Promise.resolve();

// Four page fetches can finish together. ORT sessions must not run overlapping inference.
export function embed(texts: string[]): Promise<Float32Array[]> {
  const result = pending.then(() => embedBatch(texts));
  pending = result.catch(() => {});
  return result;
}

async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  // Similar lengths reduce padding; the text-keyed cache preserves the caller's order.
  const todo = [...new Set(texts.filter((t) => !cache.has(t)))].sort((a, b) => a.length - b.length);
  if (todo.length) {
    const model = await loadModel();
    const start = performance.now();
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const out = await model(batch, { pooling: 'mean', normalize: true });
      const data = out.data as Float32Array;
      batch.forEach((t, j) => cache.set(t, data.slice(j * DIM, (j + 1) * DIM)));
    }
    const ms = performance.now() - start;
    console.log(`[ctrlf++] ${backend}: embedded ${todo.length} passages in ${Math.round(ms)} ms (${(ms / todo.length).toFixed(1)} ms/passage)`);
  }
  return texts.map((t) => cache.get(t)!);
}
