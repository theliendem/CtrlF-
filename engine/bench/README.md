# Engine benchmark (Teammate B, Step 1)

Embeds 500 passages with all-MiniLM-L6-v2 through Candle, natively and as WASM in Chrome.

Inputs are local only (gitignored): PDFs in `engine/benchmarking_src/`, the model in `model/`.

```
python3 -m venv .venv && .venv/bin/pip install pypdf
.venv/bin/python extract_passages.py          # -> data/passages.json (250 slide + 250 textbook passages)
./fetch_model.sh                              # -> model/ (config, tokenizer, 90 MB safetensors)

cd candle-bench
cargo run --release --bin native [batch]      # native reference
RUSTFLAGS='-C target-feature=+simd128 --cfg getrandom_backend="wasm_js"' \
  wasm-pack build --release --target web --out-dir pkg
cd .. && python3 -m http.server 8765          # open http://localhost:8765/bench.html, click Run
```

Results are in docs/status/teammate-b.md.
