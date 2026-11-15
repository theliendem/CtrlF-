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
  /** The exact pieces to highlight on the page (just the matching blocks of a merged passage). */
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
  /** Relevant passages, best first, for on-page highlighting. */
  hits?: Passage[];
}

/** What the content script reads off a page. */
export interface PageText {
  url: string;
  title: string;
  blocks: string[];
}

export interface HighlightPassage {
  /** Pieces of page text to highlight; together they make one passage. */
  texts: string[];
  best: boolean;
}

// ---------- Side panel -> service worker ----------

/** windowId: the browser window the panel is attached to, so the SW reads the right tab. */
export interface SearchMsg { to: 'sw'; type: 'search'; query: string; windowId: number }
export interface ClearMsg { to: 'sw'; type: 'clear' }
export interface OpenResultMsg { to: 'sw'; type: 'open-result'; nodeId: string }

// ---------- Service worker -> side panel ----------

export interface FocusSearchMsg { to: 'panel'; type: 'focus-search' }
export interface ResetMsg { to: 'panel'; type: 'reset'; query: string }
export interface StatusMsg { to: 'panel'; type: 'status'; text: string; running: boolean }
export interface NodeMsg { to: 'panel'; type: 'node'; node: TreeNode }

// ---------- Service worker -> offscreen engine ----------

export interface WarmupMsg { to: 'offscreen'; type: 'warmup' }
export interface ScorePageMsg { to: 'offscreen'; type: 'score-page'; query: string; url: string; blocks: string[] }
export interface ScorePageResult { passages: Passage[]; ms: number }

export type RuntimeMsg =
  | SearchMsg
  | ClearMsg
  | OpenResultMsg
  | FocusSearchMsg
  | ResetMsg
  | StatusMsg
  | NodeMsg
  | WarmupMsg
  | ScorePageMsg;

// ---------- Service worker -> content script (chrome.tabs.sendMessage) ----------

export interface ExtractMsg { type: 'extract' }
export interface HighlightMsg { type: 'highlight'; passages: HighlightPassage[] }
export interface ClearHighlightsMsg { type: 'clear-highlights' }
export interface PingMsg { type: 'ping' }

export type ContentMsg = ExtractMsg | HighlightMsg | ClearHighlightsMsg | PingMsg;

// ---------- Tuning (PRD starting values) ----------

export const RELEVANT = 0.45;
export const STRONG = 0.6;
export const W_COS = 0.7;
export const W_KW = 0.3;
