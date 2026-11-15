// Semantic match rules and index-page hops. Pure, so tests and the replay harness use the same code.
import { MAX_INDEX_HOPS, NEAR_BEST, relevantScore, SEMANTIC_RELEVANT, type Passage, type SearchMode, type TreeNode } from '../shared/types';

/**
 * The bar a passage must reach to count as a match. In semantic mode it rises with the best match found
 * so far in the search (best − NEAR_BEST), so pages that only share a word with the query drop out
 * once a real match turns up. Exact mode uses its fixed bar.
 */
export class MatchBar {
  private best = 0;
  private readonly mode: SearchMode;
  constructor(mode: SearchMode) {
    this.mode = mode;
  }

  floor(): number {
    return this.mode === 'semantic' ? Math.max(SEMANTIC_RELEVANT, this.best - NEAR_BEST) : relevantScore(this.mode);
  }

  /** A page's matches, best first. raised: the bar went up, so earlier matches should be re-checked. */
  matches(passages: Passage[]): { matches: Passage[]; raised: boolean } {
    const candidates = passages.filter((p) => p.score >= relevantScore(this.mode) && p.marks.length > 0);
    let raised = false;
    if (this.mode === 'semantic' && candidates.length) {
      const before = this.floor();
      this.best = Math.max(this.best, ...candidates.map((p) => p.score));
      raised = this.floor() > before;
    }
    return { matches: candidates.filter((p) => p.score >= this.floor()), raised };
  }

  /** Earlier matches that still clear the current bar. */
  keep(hits: Passage[]): Passage[] {
    return hits.filter((p) => p.score >= this.floor());
  }
}

/** Index hops for a child index page of parent, or null when that would be too many in a row. */
export function indexHops(parent: TreeNode): number | null {
  const hops = (parent.index ? parent.indexHops ?? 1 : 0) + 1;
  return hops <= MAX_INDEX_HOPS ? hops : null;
}
