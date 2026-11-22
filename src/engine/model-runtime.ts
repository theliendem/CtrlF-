// Shared local-only configuration and inference queue for both models.
import { env } from '@huggingface/transformers';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

export const EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
export const RERANK_MODEL = 'ms-marco-MiniLM-L-6-v2';
export const MAX_EMBED_TOKENS = 256;
export const localDevice = typeof window === 'undefined' ? 'cpu' : 'wasm';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = typeof location === 'undefined'
  ? new URL('../../public/models/', import.meta.url).pathname : '/models/';
env.useBrowserCache = false;
env.useWasmCache = false;
const ort = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (ort.wasm) {
  ort.wasm.wasmPaths = { wasm: typeof location === 'undefined' ? ortWasmUrl : new URL(ortWasmUrl, location.href).href };
  ort.wasm.numThreads = 1;
}

export { infer } from './inference';
