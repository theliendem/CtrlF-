# Teammate B status

*Newest first. Update in every PR.*

## Benchmark (Step 1): Candle, all-MiniLM-L6-v2, M1 Pro

500 passages from course slides + a textbook (avg 34.5 words, 27,693 tokens, max 128 tokens each). WASM = Chrome, SIMD128, one thread. WASM vectors match native exactly.

| | Load | Query embed | ms/passage (batch 1) | 500 passages | Memory |
| --- | --- | --- | --- | --- | --- |
| Candle WASM | 220 ms | 11.5 ms | **46.1** | **23.0 s** | 175 MB WASM heap (272 MB after batch 32) |
| Candle native (reference) | 40 ms | n/a | 21.6 | 10.8 s | n/a |

- Batching makes it slower (batch 8: 72.5 ms, batch 32: 86.4 ms per passage), because every passage is padded to the batch's longest one. Use batch 1, or batch similar lengths together.
- Model files: 90 MB fp32 safetensors + 3.4 MB engine `.wasm`.
- What this means: search (one query embed) is easily under 300 ms. Indexing is slow: a 100-passage page takes ~4.6 s (target 3 s), and a 60-page dig (~3,000 passages) takes ~2.3 min (target 20 s).
- transformers.js (WebGPU/WASM) is **not benchmarked yet**, so no winner is picked. Reproduce: engine/bench/README.md.

## Works now

- `engine/bench/candle-bench`: Candle MiniLM embedder (Rust, native + WASM), mean pooling, normalized 384-d vectors.

## Next

- Pick the embedder, then the Rust engine: chunk, keyword tokenizer, index, search.

## Needs from others

- (none)

## Notes

- Sample PDFs in `engine/benchmarking_src/` and the model in `engine/bench/model/` stay local (gitignored). Don't commit them.
