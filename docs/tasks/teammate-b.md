# Teammate B: the engine

You own the part that makes Ctrl+F++ smart: the embedding model, the vector index, search scoring, link scoring, and PDF text extraction. Read CLAUDE.md and docs/PRD.md before starting. You own engine/, extension/src/engine/ and extension/src/sources/pdf.ts.

You can start step 1 before Teammate A's scaffold lands, since it only needs a scratch folder. Commit it under engine/bench/.

## Step 1: benchmark (hard cap of 30 minutes)

Embed the same 500 passages (any real text; a syllabus repeated is fine) with both options, in a browser page on this laptop:

- (a) all-MiniLM-L6-v2 through Candle compiled to WASM, on CPU
- (b) all-MiniLM-L6-v2 through transformers.js on WebGPU, with its WASM fallback

Record for each: model load time, ms per passage, and total time for 500. Put the numbers and the winner at the top of docs/status/teammate-b.md and push right away. Pick the winner and don't revisit the decision.

## Step 2: the engine (Rust crate in engine/, built with wasm-pack --target web)

Implement the interface in shared/engine-api.ts. The JS wrapper in extension/src/engine/ exposes the exact same functions as shared/engine-stub.ts, so A can swap it in with one line.

- `chunk(text)`: split into passages of one to three sentences, about 25 to 80 words, never splitting mid-sentence.
- `embed(texts)`: via whichever option won the benchmark. If transformers.js won, the wrapper calls it from JS and Rust handles everything else.
- `indexAdd` and `search(query, k)`:
  - cosine similarity over normalized vectors, plus a small boost when exact query words appear
  - returns Hit[] sorted by score, dropping anything under LinkWeights.minScore
- `scoreLinks(query, links, depth)`: embed each link's context, compute relevance, then sigmoid(bias + the weighted features) using LinkWeights (relevance, depth, isPdf, isSyllabus, keywordHits). Also return the feature values, so the crawler can log them as DigLogs.
- `loadWeights(w)`: swap in new LinkWeights at runtime.
- Bundle the quantized model files inside extension/src/engine/ so nothing downloads at runtime.
- Commit the built WASM package to extension/src/engine/pkg/ every time you change Rust code, so nobody else needs a Rust toolchain.

**Test:** an engine test page or script that runs every query in shared/fixtures/queries.json (once D adds it; use the synthetic fixtures until then). It should print whether the expected answer lands in the top 3, plus the timing. Write the pass rate in your status file after every push.

**Done when:**
- at least 80% of the Phase 1 test queries put the right passage in the top 3
- search takes under 300 ms on an indexed page
- the status file says "READY: swap the stub"

## Step 3: PDF text (extension/src/sources/pdf.ts)

`fromPdf(url): Promise<SourceDoc>`. Fetch with credentials, extract text with pdf.js page by page, chunk it, and give each passage a `pdf` Locator with the page number and character offsets. Test on the real PDFs D puts in shared/fixtures/canvas/pdfs/. Tell C the exact Locator offsets you use, since the PDF viewer highlights from them.

## Step 4: learned weights

When D pushes databricks/link-weights.json, load it at startup (A copies it into the build) and confirm scoreLinks uses it. Help D run the before-and-after comparison: the same demo question with default vs. learned weights, counting pages visited before the first hit.

## Push rhythm

Push after the benchmark, after chunk plus search work, after scoreLinks, after the PDF work, and any time the test pass rate improves.
