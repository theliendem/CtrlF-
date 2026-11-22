import { contentCache, contentKey } from './memory';
// Semantic mode: rank passages and links by meaning (MiniLM) plus exact query words.
// The embedder is a parameter so tests can run without the model.
import { CONFLICT_FACTOR, LINK_DEPTH_PENALTY, LINK_MIN, LINK_PEEK, SEMANTIC_RELEVANT, W_COS, W_KW, type DigLink, type Passage } from '../shared/types';
import { chunk, type Chunk, type TokenCount } from './chunk';
import type { Rerank } from './rerank';
import { SEMANTIC_TUNING } from './tuning';
import { keywordScore, parseQuery } from './keywords';
import { dot, highlightPieces, scorePassages } from './score';
import { siteFileKind } from './links';
import { linkText } from './link-text';
import { checkpoint } from './inference';
export { linkText } from './link-text';

export type Embed = (texts: string[], signal?: AbortSignal) => Promise<Float32Array[]>;

/** The model is imported on first use, so Exact mode never loads transformers.js. */
export const loadModel = async (): Promise<void> => {
  await (await import('./embed')).loadModel();
  await (await import('./rerank')).loadReranker();
};
const modelEmbed: Embed = async (texts, signal) => {
  signal?.throwIfAborted();
  return (await import('./embed')).embed(texts, signal);
};

/** Hits sent to the page for highlighting; only these get sentence-level marks. */
const MAX_MARKED = 30;

/** A short topic query favors a page explicitly named for that topic, including an overview. */
export function topicTitleBoost(query: string, title: string): number {
  if (/^(?:who|what|when|where|why|how|can|does|do|is|are|should)\b/i.test(query.trim())) return 0;
  const terms = parseQuery(query);
  if (!terms.words.length || terms.words.length > 3 || terms.pairs.size || terms.loneNums.length) return 0;
  const topic = title.replace(/^(?:overview|introduction|intro|guide)(?:\s*:\s*|\s+to\s+)/i, '');
  const words = parseQuery(topic).words;
  return words.length === terms.words.length && terms.words.every((word) => words.includes(word))
    ? SEMANTIC_TUNING.topicTitleBoost : 0;
}

export interface SemanticOptions {
  signal?: AbortSignal;
  title?: string;
  embed?: Embed;
  countTokens?: TokenCount;
  /** null is used by retrieval-only evaluation and deterministic unit tests. */
  rerank?: Rerank | null;
  chunks?: Chunk[];
  rerankWeight?: number;
}

/** Retrieve at most 20 candidates per page/file section, then compare query/passage pairs. */
export async function semanticPassages(query: string, blocks: string[], options: SemanticOptions = {}): Promise<Passage[]> {
  const signal = options.signal;
  await checkpoint(signal);
  if (!blocks.some((block) => block.trim())) return [];
  const embed = options.embed ?? modelEmbed;
  // Custom token counters are used by evaluation and must not share production chunks.
  const key = !options.chunks && !options.countTokens
    ? await contentKey('chunks-v1-minilm256', [options.title ?? '', blocks]) : undefined;
  let chunks = options.chunks ?? (key ? contentCache.get(key) as Chunk[] | undefined : undefined);
  if (!chunks) {
    const count = options.countTokens ?? await (await import('./embed')).tokenCounter();
    await checkpoint(signal);
    chunks = chunk(blocks, { countTokens: count, title: options.title });
    if (key) contentCache.set(key, chunks);
  }
  if (!chunks.length) return [];
  const [qVec, ...vecs] = await embed([query, ...chunks.map((c) => c.text)], signal);
  await checkpoint(signal);
  let scored = scorePassages(query, qVec, chunks, vecs).map((passage, i) => ({ passage, chunk: chunks[i] }));
  scored.sort((a, b) => b.passage.score - a.passage.score);

  const rerank = options.rerank === undefined ? (await import('./rerank')).rerank : options.rerank;
  if (rerank) {
    scored = scored.slice(0, SEMANTIC_TUNING.candidates);
    await checkpoint(signal);
    const scores = await rerank(query, scored.map(({ passage }) => passage.text), signal);
    await checkpoint(signal);
    if (scores.length !== scored.length || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new Error('Reranker returned invalid scores');
    }
    const q = parseQuery(query);
    const weight = options.rerankWeight ?? SEMANTIC_TUNING.rerankWeight;
    scored.forEach(({ passage }, i) => {
      passage.retrievalScore = passage.score;
      passage.rerankScore = scores[i];
      // Retrieval already applies the number penalty. Apply it to the reranker term too.
      const penalty = keywordScore(q, passage.text).conflict ? CONFLICT_FACTOR : 1;
      passage.score = Math.min(1, (1 - weight) * passage.score + weight * scores[i] * penalty
        + topicTitleBoost(query, options.title ?? ''));
    });
    scored.sort((a, b) => b.passage.score - a.passage.score);
  }

  // A pure meaning match has no keyword sentence to mark. Mark its closest sentence instead.
  const blind = scored.filter(({ passage }) => passage.score >= SEMANTIC_RELEVANT && !passage.marks.length).slice(0, MAX_MARKED);
  const pieces = blind.map(({ chunk: c }) => highlightPieces(c.parts));
  const toEmbed = [...new Set(pieces.filter((p) => p.length > 1).flat())];
  const pieceVec = new Map<string, Float32Array>();
  if (toEmbed.length) (await embed(toEmbed, signal)).forEach((v, i) => pieceVec.set(toEmbed[i], v));
  const closeness = (piece: string): number => dot(qVec, pieceVec.get(piece)!);
  blind.forEach(({ passage }, i) => {
    const candidates = pieces[i];
    passage.marks = candidates.length <= 1 ? candidates : [candidates.reduce((a, b) => (closeness(b) > closeness(a) ? b : a))];
  });
  signal?.throwIfAborted();
  return scored.map(({ passage }) => passage);
}

/**
 * Canvas pages that only list other content (course home, modules, syllabus, assignment and
 * announcement indexes). Their titles ("Modules", "Week 3") say little about what's inside,
 * so they're never dropped, only ordered behind better links.
 */
export function isCanvasHub(url: string): boolean {
  try {
    const { pathname, hash } = new URL(url);
    return /^\/courses\/\d+(?:\/(?:modules|assignments|assignments\/syllabus|announcements|pages))?\/?$/.test(pathname) || (pathname.endsWith('/modules') && !!hash);
  } catch {
    return false;
  }
}

/** A file link: a Canvas /files/:id, or a .pdf, .pptx or .docx. Names like "Lecture5.pdf" say little about what's inside. */
export function isFileLink(url: string): boolean {
  try {
    return /\/files\/\d+$/.test(new URL(url).pathname) || siteFileKind(url) !== null;
  } catch {
    return false;
  }
}

/**
 * Score links by meaning against the query, best first: drop weak ones and keep the top LINK_PEEK.
 * Canvas hubs and files are always kept (at least LINK_MIN) and don't count toward the cap.
 * keepAll keeps every link the same way: a title like "U2 homework" says nothing about what's inside.
 * depth is the depth the linked page would sit at.
 */
export async function semanticLinks(query: string, links: DigLink[], depth: number, canvas: boolean, embed: Embed = modelEmbed, keepAll = false, signal?: AbortSignal): Promise<DigLink[]> {
  await checkpoint(signal);
  if (!links.length) return [];
  const texts = links.map(linkText);
  const [qVec, ...vecs] = await embed([query, ...texts], signal);
  await checkpoint(signal);
  const q = parseQuery(query);
  const scored = links.map((link, i) => {
    const { kw, conflict } = keywordScore(q, texts[i]);
    const score = (W_COS * dot(qVec, vecs[i]) + W_KW * kw) * (conflict ? CONFLICT_FACTOR : 1) - LINK_DEPTH_PENALTY * depth;
    const kept = keepAll || isFileLink(link.url) || (canvas && isCanvasHub(link.url));
    return { link: { ...link, score: kept ? Math.max(score, LINK_MIN) : score }, kept };
  });
  const byScore = (a: { link: DigLink }, b: { link: DigLink }): number => b.link.score! - a.link.score!;
  const always = scored.filter((s) => s.kept);
  const pages = scored.filter((s) => !s.kept && s.link.score! >= LINK_MIN).sort(byScore).slice(0, LINK_PEEK);
  return [...always, ...pages].sort(byScore).map((s) => s.link);
}
