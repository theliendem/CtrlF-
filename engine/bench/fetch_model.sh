#!/usr/bin/env bash
# Downloads all-MiniLM-L6-v2 (Apache-2.0) into engine/bench/model/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p model
BASE=https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main
for f in config.json tokenizer.json model.safetensors; do
  [ -s "model/$f" ] || curl -fsSL "$BASE/$f" -o "model/$f"
done
ls -la model
