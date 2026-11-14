// Ctrl+F++ shared contracts. Owner: Teammate A.
// Everyone codes against these types. Need a change? Ask A via your status file.

// ---------- Text and locations ----------

/** Where a passage lives, so it can be highlighted later. */
export type Locator =
  | { kind: 'dom'; xpath: string; start: number; end: number }
  | { kind: 'pdf'; url: string; page: number; start: number; end: number };

export type Passage = {
  id: string;
  /** Page (or PDF) this passage came from. Used to scope search to one page. */
  url: string;
  text: string;
  locator: Locator;
};

export type LinkRef = {
  url: string;
  /** Anchor text (or Canvas item title). */
  text: string;
  /** Title attribute, URL path words, nearest heading and sentence, joined. */
  context: string;
};

export type SourceDoc = {
  url: string;
  title: string;
  kind: 'html' | 'canvas' | 'pdf';
  passages: Passage[];
  links: LinkRef[];
};

/** A search result. Carries text + locator so the UI never needs a second lookup. */
export type Hit = {
  passageId: string;
  url: string;
  score: number;
  text: string;
  locator: Locator;
};

// ---------- The dig ----------

export type NodeState = 'skipped' | 'queued' | 'digging' | 'dead' | 'relevant' | 'hit';

export type TreeEvent = {
  nodeId: string;
  parentId: string | null;
  url: string;
  title: string;
  state: NodeState;
  score: number;
  snippet?: string;
  /** Best hit on this node, present for 'relevant' and 'hit'. Click target. */
  hit?: Hit;
  /** ms since the dig started. */
  t: number;
};

export type LinkFeatures = {
  relevance: number;
  depth: number;
  isPdf: number; // 0 or 1
  isSyllabus: number; // 0 or 1
  keywordHits: number;
};

export type LinkScore = { score: number; features: LinkFeatures };

export type DigLog = {
  query: string;
  url: string;
  depth: number;
  relevance: number;
  isPdf: boolean;
  isSyllabus: boolean;
  keywordHits: number;
  outcome: 'dead' | 'relevant' | 'hit';
};

/** Link score = sigmoid(bias + sum of weight * feature). */
export type LinkWeights = {
  version: string;
  bias: number;
  relevance: number;
  depth: number;
  isPdf: number;
  isSyllabus: number;
  keywordHits: number;
  /** Passages and links under this are dropped / never opened. */
  minScore: number;
  /** Passages at or above this are strong hits. */
  hitScore: number;
};

export type DigSettings = {
  scope: 'same-site' | 'any';
  maxDepth: number;
  pageBudget: number;
};

export const DEFAULT_DIG_SETTINGS: DigSettings = { scope: 'same-site', maxDepth: 5, pageBudget: 60 };

/** Fixed crawl constants (not user-changeable). */
export const CRAWL = { concurrency: 4, timeoutMs: 8000, strongHitsBeforeAsk: 3 } as const;

export type TestQuery = {
  id: string;
  question: string;
  answerText: string;
  url: string;
  pdfPage: number | null;
  depth: number;
  phase: 1 | 2;
  demo: boolean;
};

// ---------- Runtime messages ----------
// Every chrome.runtime / chrome.tabs message is one of these. Don't invent shapes inline.

export type Msg =
  /** background -> content (tabs.sendMessage) when the open-search command fires. */
  | { type: 'OPEN_SEARCH' }
  /** content -> background -> offscreen: index this page's passages and search them. */
  | { type: 'SEARCH_PAGE'; query: string; url: string; passages: Passage[]; k?: number }
  /** offscreen -> content (as the reply to SEARCH_PAGE). */
  | { type: 'SEARCH_RESULTS'; query: string; url: string; hits: Hit[] }
  /** sidepanel -> background: open a hit (page via text fragment, PDF via our viewer). */
  | { type: 'OPEN_LOCATOR'; url: string; locator: Locator; text: string }
  /** content or sidepanel -> background. tabId is filled in by background if missing. */
  | { type: 'START_DIG'; query: string; url: string; tabId?: number; settings?: Partial<DigSettings> }
  | { type: 'STOP_DIG' }
  | { type: 'RESUME_DIG' }
  /** background -> sidepanel, one per node state change. */
  | { type: 'TREE_EVENT'; digId: string; event: TreeEvent }
  /** background -> sidepanel. reason 'ask' = hit strongHitsBeforeAsk; RESUME_DIG keeps going. */
  | { type: 'DIG_DONE'; digId: string; reason: 'budget' | 'exhausted' | 'stopped' | 'ask'; pagesSearched: number; hits: Hit[] }
  /** sidepanel -> background. */
  | { type: 'EXPORT_DIGLOGS' }
  /** background -> sidepanel (reply to EXPORT_DIGLOGS). */
  | { type: 'DIGLOGS_FILE'; filename: string; json: string; count: number }
  /** offscreen -> background, once the engine has loaded. */
  | { type: 'ENGINE_READY'; engine: 'stub' | 'real'; weightsVersion: string };

/**
 * Background wraps messages it forwards to the offscreen document, so the offscreen page
 * ignores the raw copies it also receives. Only background and offscreen use this.
 */
export type OffscreenEnvelope = { target: 'offscreen'; msg: Msg };

export type MsgType = Msg['type'];
export type MsgOf<T extends MsgType> = Extract<Msg, { type: T }>;
