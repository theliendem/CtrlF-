// Content script: reads the page's visible text and highlights passages with the CSS Custom Highlight API.
// It never edits the page's HTML.
import type { ContentMsg, DigLink, HighlightPassage, PageText } from '../shared/types';
import { visibleTextNodes } from './dom';

declare global {
  interface Window { __ctrlfpp?: boolean }
}

// Everything is top-level on purpose: this ships as a classic script, where functions declared
// inside an if-block get hoisted and the minifier's short names can collide.


const MAX_WORDS = 30000; // LATER: smarter handling of huge pages

function extract(): PageText {
  const blocks: string[] = [];
  let cur = '';
  let curBlock: Element | null = null;
  let words = 0;
  for (const { node, block } of visibleTextNodes()) {
    if (block !== curBlock) {
      if (cur.trim()) blocks.push(cur.trim());
      cur = '';
      curBlock = block;
    }
    cur += node.data.replace(/\s+/g, ' ');
    words += node.data.split(/\s+/).length;
    if (words > MAX_WORDS) break;
  }
  if (cur.trim()) blocks.push(cur.trim());
  return { url: location.href, title: document.title, blocks: blocks.map((b) => b.replace(/\s+/g, ' ')), links: extractLinks() };
}

function extractLinks(): DigLink[] {
  const links: DigLink[] = [];
  let heading = document.title;
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a[href]')) {
    if (el.closest('nav,header,footer,[role="navigation"],[hidden],[aria-hidden="true"]') || !el.checkVisibility({ visibilityProperty: true })) continue;
    if (el.tagName !== 'A') heading = el.textContent?.trim() || document.title;
    else links.push({ url: (el as HTMLAnchorElement).href, title: el.textContent?.trim() || '', heading });
  }
  return links;
}

// ---- Highlighting ----



function clear(): void {
  CSS.highlights.delete('ctrlfpp-best');
  CSS.highlights.delete('ctrlfpp-hit');
}

/** Whitespace-free index of the visible text, so passage text matches across nodes and blocks. */
function buildIndex(): Index {
  const nodes = visibleTextNodes().map((v) => v.node);
  let text = '';
  const node: Text[] = [];
  const off: number[] = [];
  for (const n of nodes) {
    const d = n.data;
    for (let i = 0; i < d.length; i++) {
      const c = d[i];
      if (/\s/.test(c)) continue;
      text += c;
      node.push(n);
      off.push(i);
    }
  }
  return { text, node, off };
}

type Index = { text: string; node: Text[]; off: number[] };

function findRange(idx: Index, text: string): Range | null {
  const key = text.replace(/\s+/g, '');
  const at = key ? idx.text.indexOf(key) : -1;
  // LATER: fuzzy match when a passage was windowed mid-word or the page changed since extraction.
  if (at < 0) return null;
  const end = at + key.length - 1;
  const r = new Range();
  r.setStart(idx.node[at], idx.off[at]);
  r.setEnd(idx.node[end], idx.off[end] + 1);
  return r;
}

function highlight(passages: HighlightPassage[]): number {
  clear();
  if (!passages.length) return 0;
  const idx = buildIndex();
  const best = new Highlight();
  const hits = new Highlight();
  let bestRange: Range | null = null;
  let found = 0;
  for (const p of passages) {
    const ranges = p.texts.map((t) => findRange(idx, t)).filter((r): r is Range => !!r);
    if (!ranges.length) continue;
    found++;
    const isBest = !bestRange; // passages arrive best first; the first one found is the bright one
    if (isBest) bestRange = ranges[0];
    for (const r of ranges) (isBest ? best : hits).add(r);
  }
  CSS.highlights.set('ctrlfpp-hit', hits);
  CSS.highlights.set('ctrlfpp-best', best);
  bestRange?.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return found;
}

function highlightFile(fileId: string, url: string, title: string): number {
  clear();
  const target = new URL(url);
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = new URL(link.href);
    if (href.origin !== target.origin) continue;
    const api = link.getAttribute('data-api-endpoint') ?? '';
    const direct = href.pathname.match(/\/files\/(\d+)(?:\/|$)/)?.[1] === fileId || href.searchParams.get('preview') === fileId || api.match(/\/files\/(\d+)(?:\/|$)/)?.[1] === fileId;
    const moduleTitle = /\/modules\/items\/\d+$/.test(href.pathname) && link.textContent?.trim() === title;
    if (!direct && !moduleTitle) continue;
    if (!link.checkVisibility({ visibilityProperty: true })) continue;
    const range = new Range();
    range.selectNodeContents(link);
    CSS.highlights.set('ctrlfpp-best', new Highlight(range));
    link.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return 1;
  }
  return 0;
}

function init(): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    ::highlight(ctrlfpp-best) { background-color: #ffcf33; color: #111; }
    ::highlight(ctrlfpp-hit) { background-color: rgba(255, 207, 51, 0.38); }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  chrome.runtime.onMessage.addListener((msg: ContentMsg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'ping':
        sendResponse(true);
        break;
      case 'extract':
        sendResponse(extract());
        break;
      case 'highlight':
        sendResponse(highlight(msg.passages));
        break;
      case 'highlight-file':
        sendResponse(highlightFile(msg.fileId, msg.url, msg.title));
        break;
      case 'clear-highlights':
        clear();
        sendResponse(true);
        break;
    }
    return false;
  });
}

if (!window.__ctrlfpp) {
  window.__ctrlfpp = true;
  init();
}
