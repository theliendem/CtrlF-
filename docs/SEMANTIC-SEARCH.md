# Semantic search and accuracy checks

Semantic search retrieves candidates with all-MiniLM-L6-v2, then scores query/passage pairs with the bundled quantized ms-marco-MiniLM-L-6-v2 cross encoder. Both models run locally. Exact search loads neither model.

## Scoring

1. Split page text into passages of at most 80 words and 256 embedding tokens, counting special tokens with the actual bundled tokenizer. Retain the document title, an inferred nearby heading, and the preceding sentence when the budget permits. Short blocks without sentence punctuation are treated as headings. Repeated context is excluded from highlight targets.
2. Retrieve the best 20 passages **within each page or file section** using `0.7 * cosine + 0.3 * keyword overlap`. This is not a global 20-passage cap across the crawl. Candidates below the display cutoff can still be reranked.
3. Run the cross encoder on each query/passage pair. Its raw logit is converted with a sigmoid into a bounded relevance score, not a calibrated probability of correctness.
4. Final score: `0.8 * retrieval + 0.2 * reranker`. Conflicting numbers multiply both components by 0.4. Short topic queries get a 0.1 title boost when the title exactly matches the normalized topic, allowing an optional Overview/Introduction/Guide prefix. Questions and numbered queries do not get that boost. Scores are capped at 1.
5. Display passages scoring at least 0.30. Choose original sentences for highlighting, then rank pages by their best passage as before. The crawler's link scoring remains 70% meaning and 30% keywords, with its existing traversal limits.

Long queries and link descriptions are embedded through token-sized windows and their vectors are averaged and normalized, so their tail is not silently truncated. The reranker splits oversized passage pairs too, with no tokenizer truncation. Queries exceeding 128 reranker tokens get an explicit error. Ordinary search queries are far shorter.

Search caches are memory-only and use estimated retained-data budgets: 8 MiB shared by page/file reads and prepared passages, 7 MiB for embeddings, and 1 MiB for reranker scores. Entries are evicted least recently used first. These budgets include estimated keys and entry overhead but do not cap model memory, temporary inference allocations, or the JavaScript heap. Oversized entries are searched without being retained.

Linked-page reads and course maps expire five minutes after fetching. Each search re-extracts the current page. Prepared passages use SHA-256 keys covering the title, blocks, and preparation version; reranker keys cover the query, passage, model and scoring version. Embeddings are keyed by exact text within the running model session. Refresh content repeats the query after clearing reads and prepared passages, retaining reusable embeddings and pair scores. Legacy persistent demo caches are deleted when the next search configures the engine.

## Reproduce the evaluation

```bash
npm test
npm run test:models
npm run eval:semantic -- --output docs/semantic-evaluation.json
npm run build:all
```

`test:models` loads the actual bundled q8 weights and forbids network requests. It checks dense-code chunk sizes, tail preservation, pair scoring, and an optional private Canvas regression. Regular unit tests inject deterministic models to check ranking, highlighting, candidate limits, conflicting numbers, and token boundaries.

The benchmark has 30 handwritten queries against 26 synthetic CS/course pages. All dates and policies are fictional. It includes topic searches, paraphrases, conflicting assignment/exam numbers, and six no-answer queries. Twenty queries form the calibration split, with ten held out. Related paraphrases stay in the same split. Labels identify the preferred answer page, not every page that might be tangentially relevant.

The calibration grid varies reranker weight and display cutoff. Selection uses only the 20 calibration queries: `0.5 * Hit@3 + 0.25 * MRR + 0.25 * no-answer accuracy`. Ties prefer the current reranker weight, then the lower cutoff. The original 70/30 retrieval weighting is retained. Chosen settings: reranker weight 0.20 and cutoff 0.30.

| Held-out metric | Previous search | Improved search |
| --- | --- | --- |
| Preferred page first | 7/8 | 7/8 |
| Preferred page in top three | 8/8 | 8/8 |
| Correctly returns no match | 0/2 | 2/2 |

The baseline runs the previous chunker and actual 128-token embedding truncation. The report also includes a chunking-only comparison. These small synthetic results support tuning, not a claim of accuracy on every course. The benchmark ranks supplied page text; it does not measure crawl completeness, Canvas session/network failures, or browser latency.

## Add real course examples

Pass a JSON dataset with `pages` (`id`, `title`, `blocks`, optional `url`) and `queries` (`query`, `expected` page IDs, `split` as `train` or `test`, and `kind`). Use an empty `expected` array for a query with no answer in that corpus.

```bash
npm run eval:semantic -- --dataset tests/fixtures/canvas.local/linked-list.json --output tests/fixtures/canvas.local/report.json
```

Keep course snapshots inside a `*.local` directory, which git ignores. The local linked-list regression uses overview text read from the signed-in course and the user-provided preferred page label. The competing announcement, program, and LLM practice page currently contain only their observed titles. The overview ranks first in this limited fixture; a full course crawl with all competing page bodies remains necessary to verify the end-to-end ranking.

No course-specific URL, page name, or query is hardcoded into production ranking.

Model reference: [MiniLM cross encoder](https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2). The download script pins its model revision and bundles weights at build time. The added q8 weights are approximately 23 MB.
