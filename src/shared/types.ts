// Shared message and data types. Every message shape lives here.
// Runtime messages carry `to` so each extension page only answers its own.

// ---------- Data ----------

export type NodeKind = 'page' | 'pdf' | 'pptx' | 'docx';

export type NodeState =
  | 'queued'
  | 'reading'
  | 'hit' // relevant: bright green with a label
  | 'trail' // ancestor of a hit
  | 'ruled-out'
  | 'not-followed'
  | 'unreadable';

/** One scored passage. */
export interface Passage {
  text: string;
  /** Exact relevant sentences or clauses to highlight, without surrounding passage text. */
  marks: string[];
  score: number; // hybrid: 0.7 * cos + 0.3 * kw (after number penalty)
  cos: number;
  kw: number;
}

/** A node in the dig tree. */
export interface TreeNode {
  id: string;
  parentId: string | null;
  url: string;
  title: string;
  kind: NodeKind;
  state: NodeState;
  depth: number;
  /** Best passage score on this node (0 if not read yet). */
  best: number;
  snippet?: string;
  /** "Page 4" / "Slide 14" for files. */
  location?: string;
  pageNumber?: number;
  parentUrl?: string;
  fileId?: string;
  linkTitle?: string;
  hidden?: boolean;
  /** Waiting in the real queue, but not yet revealed in the graph. */
  deferred?: boolean;
  /** Semantic: a link the model judged and rejected, flashed in the tree then forgotten. Never read or counted. */
  glimpse?: boolean;
  exactQuery?: string;
  /** Relevant passages, best first, for on-page highlighting. */
  hits?: Passage[];
  /** For hits: 0 = just over the cutoff (red), 1 = as close as it gets (green). */
  strength?: number;
}

/** What the content script reads off a page. */
export interface PageText {
  url: string;
  /** The page's <link rel="canonical">, if it names one (Wikipedia redirects, ?title= aliases). */
  canonical?: string;
  title: string;
  blocks: string[];
  links: DigLink[];
}

export interface DigLink { url: string; title: string; heading: string; score?: number }
export type SearchMode = 'exact' | 'semantic';
export interface ExactMatch { start: number; end: number; text: string }
export interface SearchSettings { mode: SearchMode; pageBudget: number; maxDepth: number; showOffsite: boolean; showUnreadable: boolean }
export interface SkippedLink { url: string; title: string; state: 'not-followed' | 'unreadable'; kind: NodeKind }
export interface CanvasContext { origin: string; courseId: string }
/** Any other site: same-origin links only. */
export interface SiteContext { origin: string; courseId?: undefined }
export type DigContext = CanvasContext | SiteContext;
export interface CanvasItem {
  id: number; title: string; type: string; page_url?: string; content_id?: number; external_url?: string;
}
export interface CanvasModule { id: number; name: string; items?: CanvasItem[]; items_count: number; state?: string }
export interface CanvasPage { title: string; url?: string; body?: string; locked_for_user?: boolean }
export interface CanvasAssignment {
  id: number; name: string; description?: string; locked_for_user?: boolean; is_quiz_assignment?: boolean; quiz_id?: number;
}
export interface CanvasAnnouncement { id: number; title: string; message?: string }
export interface CanvasCourse { name: string; syllabus_body?: string }
export interface CanvasFile { id: number; display_name: string; filename: string; url: string; size: number; 'content-type': string; locked_for_user?: boolean; hidden_for_user?: boolean }
export interface FileSection { blocks: string[]; location?: string; pageNumber?: number; links?: DigLink[] }
export interface FileData { bytes: Uint8Array; kind: Exclude<NodeKind, 'page'>; title: string }
export interface DigReadResult {
  title: string; passages: Passage[]; links: DigLink[]; skipped?: SkippedLink[]; error?: string; kind?: NodeKind; location?: string; pageNumber?: number;
  /** The fetched HTML had almost no text (a JavaScript-built page): read it in a real tab instead. */
  needsTab?: boolean;
  /** Where the fetch landed after same-site redirects. */
  finalUrl?: string;
  /** Identity of what was read (canonical URL, text fingerprint), so aliases of a read page are dropped. */
  identity?: string[];
  /** Semantic: the best links the model judged and didn't follow, best first (shown briefly in the tree). */
  rejected?: DigLink[];
}
export interface DigEntry { node: TreeNode; priority: number }
export interface DigRun { id: number; query: string; context: DigContext; queue: DigEntry[]; seen: Set<string>; started: number; failed: number; settings: SearchSettings }
export interface EngineAck { ok: boolean; error?: string }

export interface HighlightPassage {
  /** Pieces of page text to highlight; together they make one passage. */
  texts: string[];
  best: boolean;
}

// ---------- Side panel -> service worker ----------

/** windowId: the browser window the panel is attached to, so the SW reads the right tab. */
export interface SearchMsg { to: 'sw'; type: 'search'; query: string; windowId: number }
export interface ClearMsg { to: 'sw'; type: 'clear' }
export interface StopMsg { to: 'sw'; type: 'stop' }
/** Carries the whole node: the service worker may have been restarted and lost its tree since the dig. */
export interface OpenResultMsg { to: 'sw'; type: 'open-result'; node: TreeNode; openFile?: boolean }
export interface FileProgressMsg { to: 'sw'; type: 'file-progress'; run: number; url: string; result: DigReadResult }

// ---------- Service worker -> side panel ----------

export interface FocusSearchMsg { to: 'panel'; type: 'focus-search' }
export interface ResetMsg { to: 'panel'; type: 'reset'; query: string }
export interface StatusMsg { to: 'panel'; type: 'status'; text: string; running: boolean }
export interface NodeMsg { to: 'panel'; type: 'node'; node: TreeNode }

// ---------- Service worker -> offscreen engine ----------

export interface WarmupMsg { to: 'offscreen'; type: 'warmup' }
export interface ScorePageMsg { to: 'offscreen'; type: 'score-page'; mode: SearchMode; query: string; url: string; blocks: string[] }
export interface ScorePageResult { passages: Passage[]; ms: number; error?: string }
export interface DigReadMsg { to: 'offscreen'; type: 'dig-read'; run: number; query: string; context: DigContext; url: string; depth: number; settings: SearchSettings; visited: string[]; seed?: DigLink[] }
export interface CancelDigMsg { to: 'offscreen'; type: 'cancel-dig'; run: number }
/** Pick which links to follow (pages read in a tab). Replies with DigLink[], best first. depth = the links' own depth. */
export interface ScoreLinksMsg { to: 'offscreen'; type: 'score-links'; mode: SearchMode; query: string; links: DigLink[]; depth: number; context: DigContext }

export type RuntimeMsg =
  | SearchMsg
  | ClearMsg
  | StopMsg
  | OpenResultMsg
  | FileProgressMsg
  | FocusSearchMsg
  | ResetMsg
  | StatusMsg
  | NodeMsg
  | WarmupMsg
  | DigReadMsg
  | CancelDigMsg
  | ScorePageMsg
  | ScoreLinksMsg;

// ---------- Service worker -> content script (chrome.tabs.sendMessage) ----------

export interface ExtractMsg { type: 'extract' }
export interface HighlightMsg { type: 'highlight'; passages: HighlightPassage[] }
export interface HighlightExactMsg { type: 'highlight-exact'; query: string }
export interface ClearHighlightsMsg { type: 'clear-highlights' }
export interface PingMsg { type: 'ping' }
export interface HighlightFileMsg { type: 'highlight-file'; fileId?: string; url: string; title: string }

export type ContentMsg = ExtractMsg | HighlightMsg | ClearHighlightsMsg | PingMsg | HighlightFileMsg | HighlightExactMsg;

// ---------- Tuning (PRD starting values) ----------

export const RELEVANT = 0.45;
export const STRONG = 0.6;
export const W_COS = 0.7;
export const W_KW = 0.3;
/** Penalty when a passage or link names the same thing with a different number. Pushes it under the cutoff. */
export const CONFLICT_FACTOR = 0.4;

// Semantic mode. MiniLM ranks well but scores paraphrases low: a no-shared-words match
// ("is working with friends allowed" -> the collaboration policy) scored 0.26 hybrid; unrelated
// passages with no shared words stayed at or under 0.24. Measured on syllabus-style text with the
// bundled q8 model; tune on the demo course.
export const SEMANTIC_RELEVANT = 0.25;
/** Links under this are not followed (Canvas hubs get this as a floor, see engine/semantic.ts). */
export const LINK_MIN = 0.25;
/** At most this many links per page enter the queue (the PRD's "peek" cap). */
export const LINK_PEEK = 15;
/** Subtracted from a link's score per level of depth. */
export const LINK_DEPTH_PENALTY = 0.02;
/** Semantic: kept links shown as waiting dots as soon as they're scored (the rest appear when read). */
export const SHOW_WAITING = 5;
/** Semantic: at most this many waiting dots on screen at once, so they never pile up into a wall. */
export const MAX_WAITING_SHOWN = 24;
/** Semantic: rejected links flashed per page, best first. */
export const SHOW_REJECTED = 10;

export const relevantScore = (mode: SearchMode): number => (mode === 'semantic' ? SEMANTIC_RELEVANT : RELEVANT);

/** Semantic scores at or above this count as full strength (fully green). */
const SEMANTIC_TOP = 0.65;

/** How far a hit clears the cutoff, 0..1. Exact matches are all-or-nothing, so always 1. */
export function hitStrength(mode: SearchMode, score: number): number {
  if (mode === 'exact') return 1;
  const t = (score - SEMANTIC_RELEVANT) / (SEMANTIC_TOP - SEMANTIC_RELEVANT);
  return Math.max(0, Math.min(1, t));
}
