// Visible-text walk shared by extraction and highlighting, so both see the same text nodes in the same order.

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
// Site chrome, not content. LATER: smarter boilerplate removal for non-Canvas sites.
const SKIP_SELECTOR = 'nav, header, footer, [role="navigation"], [role="banner"], [aria-hidden="true"], #ctrlf-skip';
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'TD', 'TH', 'TR', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION',
  'ARTICLE', 'MAIN', 'ASIDE', 'BLOCKQUOTE', 'PRE', 'DT', 'DD', 'DL', 'FIGCAPTION', 'CAPTION', 'BODY', 'FORM', 'FIELDSET',
]);

function blockOf(el: Element): Element {
  let e: Element | null = el;
  while (e && !BLOCK_TAGS.has(e.tagName)) e = e.parentElement;
  return e ?? document.body;
}

/** Visible text nodes in document order, each with the block element it belongs to. */
export function visibleTextNodes(): { node: Text; block: Element }[] {
  const ok = new Map<Element, boolean>();
  const allowed = (el: Element): boolean => {
    let v = ok.get(el);
    if (v === undefined) {
      v = !SKIP_TAGS.has(el.tagName.toUpperCase()) && !el.closest(SKIP_SELECTOR) && el.checkVisibility({ visibilityProperty: true });
      ok.set(el, v);
    }
    return v;
  };
  const out: { node: Text; block: Element }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const parent = t.parentElement;
    if (!parent || !t.data.trim() || !allowed(parent)) continue;
    out.push({ node: t, block: blockOf(parent) });
  }
  return out;
}
