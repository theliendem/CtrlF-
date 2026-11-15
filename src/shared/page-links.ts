// Links on a page, each with a heading for context. Shared by the content script (the live page)
// and the engine (fetched HTML), so both pick the same links.
import type { DigLink } from './types';

/** Menus count: a textbook's table of contents is how you reach its sections. Their text still isn't page content. */
const NAV = 'nav,header,[role="navigation"],[role="banner"]';
/** Footers are legal and social boilerplate; hidden links aren't on the page. */
const SKIP = 'footer,[role="contentinfo"],[hidden],[aria-hidden="true"]';

/** A menu link's context: the entry it's nested under (a chapter, for a section), if any. */
function navHeading(a: Element): string {
  const label = a.closest('li')?.parentElement?.closest('li')?.querySelector('a')?.textContent?.trim();
  return label && label !== a.textContent?.trim() ? label : '';
}

/**
 * hrefOf: the live page passes the resolved href; fetched HTML passes the raw attribute (resolved later
 * against where the page landed). visible: the live page skips content links the reader can't see.
 */
export function pageLinks(root: ParentNode, title: string, hrefOf: (a: Element) => string, visible: (el: Element) => boolean = () => true): DigLink[] {
  const links: DigLink[] = [];
  let heading = title;
  for (const el of root.querySelectorAll('h1,h2,h3,h4,h5,h6,a[href]')) {
    if (el.closest(SKIP)) continue;
    // Collapsed menu entries are still options (a textbook's table of contents folds its sections).
    const inNav = el.closest(NAV) !== null;
    if (!inNav && !visible(el)) continue;
    if (el.tagName !== 'A') {
      if (!inNav) heading = el.textContent?.trim() || title;
      continue;
    }
    links.push({ url: hrefOf(el), title: el.textContent?.trim() || '', heading: inNav ? navHeading(el) : heading });
  }
  return links;
}
