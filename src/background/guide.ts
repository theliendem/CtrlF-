// Semantic dig guidance: which links to queue, in what order, and when to give up.
//
// 1. Depth 1: the starting page's best ROOT_FANOUT links are all read, before anything deeper.
// 2. Deeper: a link's priority mixes its own score with how close its parent page's text was,
//    so links on on-topic pages go first even when their titles are vague.
// 3. Past depth 1, the dig stops once STALL_LIMIT reads in a row neither get closer nor find a
//    match about as good as the best so far.
import { PRIORITY_MIN, STALL_LIMIT, W_LINK_PRIORITY, type DigLink, type Passage } from '../shared/types';

/** Depth-1 links sort ahead of everything deeper, whatever their score. */
const ROOT_BOOST = 1;
/** A read must beat the best page so far by this much to count as getting closer. */
const CLOSER_BY = 0.005;
/**
 * A match only counts as progress if it's about as good as the best page so far. Weak matches
 * (a page that happens to mention one query word) would otherwise keep a hopeless dig alive.
 */
const NEAR_BEST = 0.1;

/** How on-topic a read page is: its best passage, or (for pages with no text, like link lists) its own estimate. */
export function pageRelevance(passages: Passage[], estimate = 0): number {
  return passages.length ? passages[0].score : estimate;
}

/** Queue priority and pre-read estimate for a link, or null to skip it. parentRelevance is ignored at depth 1. */
export function linkPriority(link: DigLink, parentRelevance: number, fromRoot: boolean): { priority: number; estimate: number } | null {
  const score = link.score ?? 0;
  if (fromRoot) return { priority: ROOT_BOOST + score, estimate: score };
  const estimate = W_LINK_PRIORITY * score + (1 - W_LINK_PRIORITY) * parentRelevance;
  if (estimate < PRIORITY_MIN && !link.hub) return null;
  return { priority: estimate, estimate };
}

/** Counts reads past depth 1 that made no progress. */
export class StallWatch {
  private best = 0;
  private since = 0;
  private readonly limit: number;
  constructor(limit = STALL_LIMIT) {
    this.limit = limit;
  }

  /** Record a finished read. Returns true when the dig should stop. */
  record(depth: number, relevance: number, hit: boolean): boolean {
    const closer = relevance > this.best + CLOSER_BY;
    const goodMatch = hit && relevance >= this.best - NEAR_BEST;
    this.best = Math.max(this.best, relevance);
    if (depth <= 1) return false; // the first level is always read in full
    this.since = closer || goodMatch ? 0 : this.since + 1;
    return this.since >= this.limit;
  }
}
