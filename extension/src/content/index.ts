// Content script. Owner: C. This is A's scaffold placeholder: replace freely.
// It proves the pipeline: Ctrl+Shift+F -> prompt -> SEARCH_PAGE -> stub engine -> hits in console.
import type { Msg, MsgOf, Passage } from '../../../shared/contracts';

function xpathOf(node: Node): string {
  const parts: string[] = [];
  for (let n: Node | null = node; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentNode) {
    const el = n as Element;
    let i = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) i++;
    parts.unshift(`${el.tagName.toLowerCase()}[${i}]`);
  }
  return '/' + parts.join('/');
}

function collectPassages(): Passage[] {
  const els = document.querySelectorAll('p, li, h1, h2, h3, h4, td');
  return [...els]
    .map((el, i) => ({ el, text: (el as HTMLElement).innerText?.trim() ?? '', i }))
    .filter((x) => x.text.length > 20)
    .map(({ el, text, i }) => ({ id: `p${i}`, url: location.href, text, locator: { kind: 'dom', xpath: xpathOf(el), start: 0, end: text.length } }));
}

chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type !== 'OPEN_SEARCH' || window !== window.top) return;
  const query = prompt('Ctrl+F++ (scaffold placeholder): what are you looking for?');
  if (!query) return;
  const req: Msg = { type: 'SEARCH_PAGE', query, url: location.href, passages: collectPassages() };
  chrome.runtime.sendMessage(req).then((res: MsgOf<'SEARCH_RESULTS'>) => console.log('[ctrlfpp] hits', res.hits));
});
