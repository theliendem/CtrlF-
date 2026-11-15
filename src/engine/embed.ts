// On-device sentence embeddings: all-MiniLM-L6-v2 (q8) via transformers.js, bundled in the extension.
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
const BATCH = 32;

let extractor: Promise<FeatureExtractionPipeline> | null = null;

export function loadModel(): Promise<FeatureExtractionPipeline> {
  // LATER: try WebGPU first (needs an fp32/fp16 model; q8 ops are mostly CPU-only on WebGPU).
  extractor ??= pipeline('feature-extraction', MODEL, { dtype: 'q8', device: 'wasm' }) as Promise<FeatureExtractionPipeline>;
  return extractor;
}

// Embedding cache keyed by text. Same passage on a second search costs nothing.
// LATER: persist to IndexedDB so the cache survives a browser restart.
const cache = new Map<string, Float32Array>();

export async function embed(texts: string[]): Promise<Float32Array[]> {
  const todo = [...new Set(texts.filter((t) => !cache.has(t)))];
  if (todo.length) {
    const model = await loadModel();
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const out = await model(batch, { pooling: 'mean', normalize: true });
      const data = out.data as Float32Array;
      batch.forEach((t, j) => cache.set(t, data.slice(j * DIM, (j + 1) * DIM)));
    }
  }
  return texts.map((t) => cache.get(t)!);
}
