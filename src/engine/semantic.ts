// Semantic mode: rank passages and links by meaning (MiniLM) plus exact query words.
// The embedder is a parameter so tests can run without the model.
import { LINK_DEPTH_PENALTY, LINK_MIN, LINK_PEEK, SEMANTIC_RELEVANT, W_COS, W_KW, type DigLink, type Passage } from '../shared/types';
import { chunk } from './chunk';
import { keywordScore, parseQuery } from './keywords';
import { dot, highlightPieces, scorePassages } from './score';

export type Embed = (texts: string[]) => Promise<Float32Array[]>;

/** The model is imported on first use, so Exact mode never loads transformers.js. */
export const loadModel = async (): Promise<void> => { await (await import('./embed')).loadModel(); };
const modelEmbed: Embed = async (texts) => (await import('./embed')).embed(texts);

/** Hits sent to the page for highlighting; only these get sentence-level marks. */
const MAX_MARKED = 30;
const CONFLICT_FACTOR = 0.4;

/** Scored passages, best first. Relevant ones always carry marks, even with no shared words. */
export async function semanticPassages(query: string, blocks: string[], embed: Embed = modelEmbed): Promise<Passage[]> {
  const chunks = chunk(blocks);
  if (!chunks.length) return [];
  const [qVec, ...vecs] = await embed([query, ...chunks.map((c) => c.text)]);
  const scored = scorePassages(query, qVec, chunks, vecs).map((passage, i) => ({ passage, chunk: chunks[i] }));
  scored.sort((a, b) => b.passage.score - a.passage.score);

  // A pure meaning match has no keyword sentence to mark. Mark its closest sentence instead.
  const blind = scored.filter(({ passage }) => passage.score >= SEMANTIC_RELEVANT && !passage.marks.length).slice(0, MAX_MARKED);
  const pieces = blind.map(({ chunk: c }) => highlightPieces(c.parts));
  const toEmbed = [...new Set(pieces.filter((p) => p.length > 1).flat())];
  const pieceVec = new Map<string, Float32Array>();
  if (toEmbed.length) (await embed(toEmbed)).forEach((v, i) => pieceVec.set(toEmbed[i], v));
  const closeness = (piece: string): number => dot(qVec, pieceVec.get(piece)!);
  blind.forEach(({ passage }, i) => {
    const options = pieces[i];
    passage.marks = options.length <= 1 ? options : [options.reduce((a, b) => (closeness(b) > closeness(a) ? b : a))];
  });
  return scored.map(({ passage }) => passage);
}

const GENERIC_PATH = /^(?:courses?|api|v\d+|www|html?|php|aspx?|index|default|home|files?|download|preview|pages?)$/i;

/** The words a link offers before it's opened: title, nearest heading, and its URL path. */
export function linkText(link: DigLink): string {
  let path: string[] = [];
  try {
    path = decodeURIComponent(new URL(link.url).pathname)
      .split(/[/_\-.+]+/)
      .filter((w) => w && !/^\d{3,}$/.test(w) && !GENERIC_PATH.test(w)); // Canvas ids and boilerplate say nothing
  } catch { /* keep title and heading */ }
  return [link.title, link.heading, path.join(' ')].map((s) => s?.trim()).filter(Boolean).join(' · ');
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

/**
 * Score links by meaning against the query, best first: drop weak ones and keep the top LINK_PEEK.
 * Canvas hubs are always kept (at least LINK_MIN) and don't count toward the cap.
 * depth is the depth the linked page would sit at.
 */
export async function semanticLinks(query: string, links: DigLink[], depth: number, canvas: boolean, embed: Embed = modelEmbed): Promise<DigLink[]> {
  if (!links.length) return [];
  const texts = links.map(linkText);
  const [qVec, ...vecs] = await embed([query, ...texts]);
  const q = parseQuery(query);
  const scored = links.map((link, i) => {
    const { kw, conflict } = keywordScore(q, texts[i]);
    const score = (W_COS * dot(qVec, vecs[i]) + W_KW * kw) * (conflict ? CONFLICT_FACTOR : 1) - LINK_DEPTH_PENALTY * depth;
    const hub = canvas && isCanvasHub(link.url);
    return { link: { ...link, score: hub ? Math.max(score, LINK_MIN) : score }, hub };
  });
  const byScore = (a: { link: DigLink }, b: { link: DigLink }): number => b.link.score! - a.link.score!;
  const hubs = scored.filter((s) => s.hub);
  const pages = scored.filter((s) => !s.hub && s.link.score! >= LINK_MIN).sort(byScore).slice(0, LINK_PEEK);
  return [...hubs, ...pages].sort(byScore).map((s) => s.link);
}
