// Real local inference, no mocks or remote inference. Optional --dataset path.json and --output path.json.
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { chunk } from '../src/engine/chunk.ts';
import { chunk as legacyChunk } from './eval/legacy-chunk.ts';
import { embed, loadModel, tokenCounter } from '../src/engine/embed.ts';
import { rerank } from '../src/engine/rerank.ts';
import { semanticPassages, topicTitleBoost } from '../src/engine/semantic.ts';
import { keywordScore, parseQuery } from '../src/engine/keywords.ts';
import { CONFLICT_FACTOR } from '../src/shared/types.ts';
import { SEMANTIC_TUNING } from '../src/engine/tuning.ts';
import { scorePassages } from '../src/engine/score.ts';
import { metrics } from './eval/metrics.ts';

const arg = (flag, fallback) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback;
const dataset = JSON.parse(await readFile(arg('--dataset', 'tests/fixtures/semantic-benchmark.json'), 'utf8'));
if (!dataset.pages?.length || !dataset.queries?.length) throw new Error('Dataset needs pages and queries');
const ids = new Set(dataset.pages.map((page) => page.id));
if (ids.size !== dataset.pages.length || dataset.queries.some((q) => !['train','test'].includes(q.split) || q.expected.some((id) => !ids.has(id)))) throw new Error('Invalid labels, split, or duplicate page IDs');
const started = performance.now();
const countTokens = await tokenCounter();
const model = await loadModel();
const prepared = dataset.pages.map((page) => ({ ...page, chunks: chunk(page.blocks, { countTokens, title: page.title }), legacy: legacyChunk(page.blocks) }));
const baselineVectors = new Map();
const unique = [...new Set([...dataset.queries.map((q) => q.query), ...prepared.flatMap((page) => page.legacy.map((c) => c.text))])];
// Reproduce the previous 128-token truncation exactly for baseline inference only.
model.tokenizer._tokenizerConfig.model_max_length = 128;
for (let i = 0; i < unique.length; i += 16) {
  const batch = unique.slice(i, i + 16);
  const output = await model(batch, { pooling: 'mean', normalize: true });
  batch.forEach((text, j) => baselineVectors.set(text, output.data.slice(j * 384, (j + 1) * 384)));
}
model.tokenizer._tokenizerConfig.model_max_length = 256;
const baseline = [], retrieval = [], current = [], pairs = [];
for (const [i, item] of dataset.queries.entries()) {
  console.log(`[eval] ${i + 1}/${dataset.queries.length}: ${item.query}`);
  const oldPages = [], newPages = [], currentPages = [], pagePairs = [];
  const queryTerms = parseQuery(item.query);
  for (const page of prepared) {
    const old = scorePassages(item.query, baselineVectors.get(item.query), page.legacy, page.legacy.map((c) => baselineVectors.get(c.text)));
    oldPages.push({ id: page.id, score: Math.max(0, ...old.map((p) => p.score)) });
    const [qVec, ...vecs] = await embed([item.query, ...page.chunks.map((c) => c.text)]);
    const raw = scorePassages(item.query, qVec, page.chunks, vecs).sort((a,b) => b.score-a.score);
    newPages.push({ id: page.id, score: raw[0]?.score ?? 0 });
    const scores = await semanticPassages(item.query, page.blocks, {
      title: page.title, embed, countTokens, chunks: page.chunks, rerank,
    });
    currentPages.push({ id: page.id, score: scores[0]?.score ?? 0 });
    pagePairs.push({ id: page.id, boost: topicTitleBoost(item.query, page.title), candidates: scores.map((p) => ({ retrieval: p.retrievalScore,
      rerank: p.rerankScore * (keywordScore(queryTerms, p.text).conflict ? CONFLICT_FACTOR : 1) })) });
  }
  const sort = (pages) => pages.sort((a,b) => b.score-a.score || a.id.localeCompare(b.id));
  baseline.push({ ...item, pages: sort(oldPages) });
  retrieval.push({ ...item, pages: sort(newPages) });
  current.push({ ...item, pages: sort(currentPages) });
  pairs.push({ ...item, pagePairs });
}
const candidates = [];
const train = pairs.filter((q) => q.split === 'train');
if (train.length) {
  for (const weight of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8]) for (const threshold of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5]) {
    const rows = train.map(({ pagePairs, ...q }) => ({ ...q, pages: pagePairs.map((p) => ({ id: p.id,
      score: Math.max(0, ...p.candidates.map((c) => Math.min(1, (1-weight)*c.retrieval+weight*c.rerank+p.boost))) })).sort((a,b) => b.score-a.score) }));
    const result = metrics(rows, threshold);
    candidates.push({ weight, threshold, ...result, utility: 0.5*result.hitAt3 + 0.25*result.mrr + 0.25*result.noAnswerAccuracy });
  }
  candidates.sort((a,b) => b.utility-a.utility || Math.abs(a.weight-SEMANTIC_TUNING.rerankWeight)-Math.abs(b.weight-SEMANTIC_TUNING.rerankWeight) || a.threshold-b.threshold);
}
const summary = (rows, threshold) => Object.fromEntries(['train','test'].map((split) => [split, metrics(rows.filter((q) => q.split === split), threshold)]));
const report = { description: dataset.description, models: { embedding: 'all-MiniLM-L6-v2 q8', reranker: 'ms-marco-MiniLM-L-6-v2 q8', backend: 'local CPU; browser uses WASM/WebGPU' },
  limits: 'Ranks the supplied pages after reading them; does not measure crawling, signed-in Canvas fetch reliability, or browser latency. User regression competitors are title-only if documented by the dataset.',
  settings: SEMANTIC_TUNING, elapsedMs: Math.round(performance.now()-started),
  baseline: summary(baseline, 0.25), chunkingOnly: summary(retrieval, 0.25), improved: summary(current, SEMANTIC_TUNING.relevant),
  recommendedFromTrain: candidates[0] ?? null, grid: candidates,
  cases: current.map((q,i) => ({ query: q.query, split:q.split, kind:q.kind, expected:q.expected,
    baselineTop3:baseline[i].pages.filter((p)=>p.score>=0.25).slice(0,3),
    improvedTop3:q.pages.filter((p)=>p.score>=SEMANTIC_TUNING.relevant).slice(0,3) })) };
console.log(JSON.stringify({ baseline:report.baseline, chunkingOnly:report.chunkingOnly, improved:report.improved, recommended:report.recommendedFromTrain, elapsedMs:report.elapsedMs },null,2));
const output = arg('--output', undefined);
if (output) await writeFile(output, JSON.stringify(report,null,2)+'\n');
