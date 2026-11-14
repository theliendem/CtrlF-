// HTML -> SourceDoc. Owner: A. Needs DOMParser, so run it in the offscreen document (not the service worker).
import type { LinkRef, Passage, SourceDoc } from '../../../shared/contracts';

const DROP = 'script, style, noscript, template, svg, iframe, nav, header, footer, aside, form, button, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"], #section-tabs, .ic-app-header, #footer, .skip-to-content';
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dd, dt, blockquote, pre, figcaption, caption';
const HEADINGS = 'H1 H2 H3 H4 H5 H6';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Split a block's text into passages of 1 to 3 sentences (~25-80 words), with char offsets. */
export function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*|$)/g;
  const sents: { s: number; e: number; words: number }[] = [];
  for (let m; (m = re.exec(text)); ) {
    if (!m[0].trim()) {
      if (m[0].length === 0) re.lastIndex++;
      continue;
    }
    const lead = m[0].length - m[0].trimStart().length;
    sents.push({ s: m.index + lead, e: m.index + m[0].trimEnd().length, words: m[0].trim().split(/\s+/).length });
  }
  let i = 0;
  while (i < sents.length) {
    let j = i;
    let words = sents[i].words;
    while (j + 1 < sents.length && j - i < 2 && words < 25 && words + sents[j + 1].words <= 80) words += sents[++j].words;
    out.push({ text: text.slice(sents[i].s, sents[j].e), start: sents[i].s, end: sents[j].e });
    i = j + 1;
  }
  return out;
}

function xpathOf(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    let i = 1;
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
    parts.unshift(`${n.tagName.toLowerCase()}[${i}]`);
  }
  return '/' + parts.join('/');
}

function pathWords(u: URL): string {
  return decodeURIComponent(u.pathname)
    .split(/[/\-_.]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^(html?|php|aspx?)$/i.test(w))
    .join(' ');
}

function nearestHeading(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
      if (HEADINGS.includes(s.tagName)) return clean(s.textContent ?? '');
      const h = s.querySelector('h1,h2,h3,h4,h5,h6');
      if (h) return clean(h.textContent ?? '');
    }
  }
  return '';
}

function nearestSentence(a: Element): string {
  const block = a.closest(BLOCKS);
  if (!block) return '';
  const t = clean(block.textContent ?? '');
  return t.length > 240 ? t.slice(0, 240) : t;
}

/** Links with context. Drops same-page anchors, non-http(s), and duplicates. */
export function extractLinks(root: ParentNode, baseUrl: string): LinkRef[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: LinkRef[] = [];
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    u.hash = '';
    const key = u.href;
    if (key === new URL(base.href.split('#')[0]).href || seen.has(key)) continue;
    seen.add(key);
    const text = clean(a.textContent ?? '') || clean(a.getAttribute('aria-label') ?? '');
    const context = [a.getAttribute('title') ?? '', pathWords(u), nearestHeading(a), nearestSentence(a)]
      .map(clean)
      .filter(Boolean)
      .join(' | ');
    links.push({ url: key, text, context });
  }
  return links;
}

/** Passages from every visible text block. idPrefix keeps ids unique across docs. */
export function extractPassages(root: ParentNode, url: string, idPrefix = url): Passage[] {
  const passages: Passage[] = [];
  let n = 0;
  for (const el of root.querySelectorAll(BLOCKS)) {
    // Skip blocks that contain other blocks (e.g. li > p); the inner one is used.
    if (el.querySelector(BLOCKS)) continue;
    const text = el.textContent ?? '';
    if (clean(text).length < 15) continue;
    const xpath = xpathOf(el);
    for (const s of splitSentences(text)) {
      const t = clean(s.text);
      if (t.length < 15) continue;
      passages.push({ id: `${idPrefix}#${n++}`, url, text: t, locator: { kind: 'dom', xpath, start: s.start, end: s.end } });
    }
  }
  return passages;
}

export function parseHtml(html: string): Document {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  return doc;
}

export function fromHtml(html: string, url: string): SourceDoc {
  const raw = new DOMParser().parseFromString(html, 'text/html');
  const title = clean(raw.title || raw.querySelector('h1')?.textContent || '') || url;
  // Links come from the whole page (nav included, so the dig can go there); text skips the chrome.
  const links = extractLinks(raw, url);
  const doc = parseHtml(html);
  const main = doc.querySelector('main, [role="main"], #content, article') ?? doc.body;
  return { url, title, kind: 'html', passages: main ? extractPassages(main, url) : [], links };
}

/** Parse an HTML fragment (e.g. a Canvas API body) without page chrome removal of links. */
export function fromHtmlFragment(html: string, url: string, title: string, idPrefix = url): SourceDoc {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ''}</body>`, 'text/html');
  const links = extractLinks(doc.body, url);
  doc.querySelectorAll('script, style, noscript, iframe').forEach((el) => el.remove());
  return { url, title, kind: 'canvas', passages: extractPassages(doc.body, url, idPrefix), links };
}
