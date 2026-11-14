// Keyword-overlap stand-in for the real engine. Same interface as Teammate B's engine.
// Not semantic at all: it only matches shared (lightly stemmed) words. Good enough to build
// and test UI, crawler and logging against.

import type { Hit, LinkRef, LinkScore, LinkWeights, Passage } from './contracts';
import type { Engine } from './engine-api';
import defaultWeights from './fixtures/synthetic/link-weights.default.json';

const DIM = 384;
const STOP = new Set(
  'a an and are as at be but by can do does for from has have how i if in is it its me my of on or our so than that the their them then there these they this to us was we what when where which who will with you your'.split(
    ' ',
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, '') || w);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function vec(text: string): Float32Array {
  const v = new Float32Array(DIM);
  for (const t of tokens(text)) v[hash(t) % DIM] += 1;
  let n = 0;
  for (let i = 0; i < DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= n;
  return v;
}

/** Fraction of query words found in text, 0..1. */
function overlap(query: string, text: string): number {
  const q = new Set(tokens(query));
  if (q.size === 0) return 0;
  const t = new Set(tokens(text));
  let n = 0;
  for (const w of q) if (t.has(w)) n++;
  return n / q.size;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function createStubEngine(): Engine {
  let w: LinkWeights = { ...(defaultWeights as LinkWeights) };
  const index = new Map<string, Passage>();

  return {
    async init() {},

    async chunk(text) {
      const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
      const out: string[] = [];
      let cur: string[] = [];
      let words = 0;
      for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
        const n = s.split(' ').length;
        if (cur.length && (cur.length >= 3 || words + n > 80)) {
          out.push(cur.join(' '));
          cur = [];
          words = 0;
        }
        cur.push(s);
        words += n;
        if (words >= 25) {
          out.push(cur.join(' '));
          cur = [];
          words = 0;
        }
      }
      if (cur.length) out.push(cur.join(' '));
      return out;
    },

    async embed(texts) {
      return texts.map(vec);
    },

    async indexAdd(passages) {
      for (const p of passages) index.set(p.id, p);
    },

    async remove(url) {
      for (const [id, p] of index) if (p.url === url) index.delete(id);
    },

    async search(query, k, url) {
      const hits: Hit[] = [];
      for (const p of index.values()) {
        if (url && p.url !== url) continue;
        const score = overlap(query, p.text);
        if (score >= w.minScore) hits.push({ passageId: p.id, url: p.url, score, text: p.text, locator: p.locator });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, k);
    },

    async scoreLinks(query, links: LinkRef[], depth): Promise<LinkScore[]> {
      const q = new Set(tokens(query));
      return links.map((l) => {
        const ctx = `${l.text} ${l.context} ${l.url}`;
        const lt = new Set(tokens(ctx));
        let keywordHits = 0;
        for (const x of q) if (lt.has(x)) keywordHits++;
        const features = {
          relevance: overlap(query, ctx),
          depth,
          isPdf: /\.pdf($|\?)/i.test(l.url) || /\bpdf\b/i.test(l.text) ? 1 : 0,
          isSyllabus: /syllabus/i.test(ctx) ? 1 : 0,
          keywordHits,
        };
        const z =
          w.bias +
          w.relevance * features.relevance +
          w.depth * features.depth +
          w.isPdf * features.isPdf +
          w.isSyllabus * features.isSyllabus +
          w.keywordHits * features.keywordHits;
        return { score: sigmoid(z), features };
      });
    },

    loadWeights(nw) {
      w = { ...nw };
    },

    weights() {
      return w;
    },
  };
}
