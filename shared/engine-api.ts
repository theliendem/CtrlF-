// The engine interface. Owner: Teammate A. Implemented by shared/engine-stub.ts (keyword
// overlap, for development) and by Teammate B's real engine in extension/src/engine/.
// Swapping between them is one import line in extension/src/offscreen/engine.ts.

import type { Hit, LinkRef, LinkScore, LinkWeights, Passage } from './contracts';

export interface Engine {
  /** Load model + weights. Safe to call more than once. */
  init(): Promise<void>;

  /** Split text into passages of 1 to 3 sentences (~25-80 words), never mid-sentence. */
  chunk(text: string): Promise<string[]>;

  /** One normalized vector per text. */
  embed(texts: string[]): Promise<Float32Array[]>;

  /** Add passages to the index. vectors[i] belongs to passages[i]. Re-adding an id replaces it. */
  indexAdd(passages: Passage[], vectors: Float32Array[]): Promise<void>;

  /** Drop every passage from this url (for re-indexing a changed page). */
  remove(url: string): Promise<void>;

  /**
   * Top-k hits by score (meaning + exact-word boost), sorted descending,
   * dropping anything under weights.minScore. url limits the search to one page.
   */
  search(query: string, k: number, url?: string): Promise<Hit[]>;

  /** One LinkScore per link, in order. score = sigmoid(bias + weighted features). */
  scoreLinks(query: string, links: LinkRef[], depth: number): Promise<LinkScore[]>;

  /** Swap in new LinkWeights at runtime. */
  loadWeights(w: LinkWeights): void;

  /** The weights currently in use. */
  weights(): LinkWeights;
}
