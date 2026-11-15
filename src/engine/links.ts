import type { CanvasContext, DigContext, DigLink, NodeKind, SearchSettings, SiteContext } from '../shared/types';
import type { SkippedLink } from '../shared/types';

export function canvasContext(raw: string): CanvasContext | null {
  const url = new URL(raw);
  const match = url.pathname.match(/^\/courses\/(\d+)(?:\/|$)/);
  if (!match || !/(^|\.)canvas\.|\.instructure\.com$/i.test(url.hostname)) return null;
  return { origin: url.origin, courseId: match[1] };
}

/** Only known read-only course routes survive. Drop arbitrary query strings and anchors. */
export function safeLink(raw: string, base: string, context: CanvasContext): string | null {
  try {
    const url = new URL(raw, base);
    if (url.origin !== context.origin || url.username || url.password) return null;
    const path = decodeURIComponent(url.pathname);
    if (/(?:^|[\W_])(logout|delete|submit|submissions?|quizzes?|grades?|inbox|people|users|accounts?|help)(?:$|[\W_])/i.test(path)) return null;
    const fileId = path.match(new RegExp(`^(?:/courses/${context.courseId})?/files/(\\d+)(?:/(?:download|preview|file_preview))?$`));
    const prefix = `/courses/${context.courseId}`;
    if (path === `${prefix}/files` && /^\d+$/.test(url.searchParams.get('preview') ?? '')) return `${context.origin}${prefix}/files/${url.searchParams.get('preview')}`;
    if (fileId) return `${context.origin}${prefix}/files/${fileId[1]}`;
    if (!(path === prefix || path.startsWith(prefix + '/'))) return null;
    const route = path.slice(prefix.length).replace(/\/$/, '');
    if (!/^(?:|\/assignments(?:\/\d+|\/syllabus)?|\/pages(?:\/[^/]+)?|\/modules|\/announcements|\/discussion_topics\/\d+)$/.test(route)) return null;
    const hash = route === '/modules' && /^#context_module_\d+$/.test(url.hash) ? url.hash : '';
    const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}${hash}`;
    const parent = new URL(base);
    if (url.hash && !hash && url.pathname === parent.pathname) return null;
    return canonical;
  } catch {
    return null;
  }
}

export const isCanvas = (context: DigContext): context is CanvasContext => context.courseId !== undefined;

/** Account, auth, state-changing and help routes on any site. */
const SITE_BLOCKED = /(?:^|[\W_])(log-?out|sign-?out|log-?in|sign-?in|sign-?up|register|auth|oauth|sso|account|accounts|profile|settings|preferences|cart|checkout|basket|delete|remove|unsubscribe|submit|edit|admin|wp-admin|wp-login|help|support|faq|share|print|feed|rss)(?:$|[\W_])/i;
/** Files and media we can't read. PDFs, .pptx and .docx are files we can. */
const NOT_A_PAGE = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|tiff?|mp[34]|m4a|wav|ogg|webm|mov|avi|zip|gz|tgz|rar|7z|tar|dmg|exe|msi|pkg|apk|iso|css|js|mjs|json|xml|ics|csv|xlsx?|xlsm|docm?|pptm?|ppt|rtf|txt|epub|woff2?|ttf|otf)$/i;
const TRACKING = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src)$/i;
/** Wiki revision and diff views: other versions of a page, not new content. */
const REVISION_PARAM = /^(?:diff|oldid|curid|veaction)$/i;
/** On MediaWiki's index.php these are history/edit/print views of the same article. */
const WIKI_VIEW_PARAM = /^(?:action|printable|redirect|direction)$/i;
/** MediaWiki namespaces that aren't articles (talk pages, special pages, files, templates…). */
const WIKI_NAMESPACE = /\/(?:Special|Talk|User|User_talk|Wikipedia|Wikipedia_talk|Project|File|File_talk|Image|Template|Template_talk|Help|Help_talk|Category|Category_talk|Portal|Draft|MediaWiki|Module|TimedText):/i;

export function siteFileKind(raw: string): Exclude<NodeKind, 'page'> | null {
  try {
    const ext = new URL(raw).pathname.match(/\.(pdf|pptx|docx)$/i)?.[1].toLowerCase();
    return (ext as Exclude<NodeKind, 'page'> | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Same-origin pages and supported files on a non-Canvas site. Query strings stay; anchors and tracking params go. */
export function siteLink(raw: string, base: string, context: SiteContext): string | null {
  try {
    const url = new URL(raw, base);
    if (!/^https?:$/.test(url.protocol) || url.origin !== context.origin || url.username || url.password) return null;
    const path = decodeURIComponent(url.pathname);
    if (SITE_BLOCKED.test(path) || SITE_BLOCKED.test(decodeURIComponent(url.search)) || NOT_A_PAGE.test(path)) return null;
    if (WIKI_NAMESPACE.test(path) || WIKI_NAMESPACE.test(`/${url.searchParams.get('title') ?? ''}`)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => REVISION_PARAM.test(key)) || (/\/index\.php$/i.test(path) && keys.some((key) => WIKI_VIEW_PARAM.test(key)))) return null;
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.hash = '';
    // Trailing slashes stay: /notes and /notes/ can be different pages, and relative links depend on it.
    return url.href;
  } catch {
    return null;
  }
}

/** The one free filter, for whichever kind of site the dig started on. */
export function digLink(raw: string, base: string, context: DigContext): string | null {
  return isCanvas(context) ? safeLink(raw, base, context) : siteLink(raw, base, context);
}

export function filterLinks(links: DigLink[], base: string, context: DigContext): DigLink[] {
  const unique = new Map<string, DigLink>();
  const self = digLink(base, base, context) ?? base;
  for (const link of links) {
    const url = digLink(link.url, base, context);
    if (url && url !== base && url !== self && !unique.has(url)) unique.set(url, { ...link, url });
  }
  return [...unique.values()];
}

/** Display-only stubs. These URLs never enter the fetch queue. */
export function skippedLinks(links: DigLink[], base: string, context: DigContext, settings: SearchSettings): SkippedLink[] {
  const out = new Map<string, SkippedLink>();
  for (const link of links) {
    try {
      const url = new URL(link.url, base);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) continue;
      const offsite = url.origin !== context.origin;
      const extension = url.pathname.match(/\.(pdf|pptx|docx)$/i)?.[1].toLowerCase();
      const file = /\/files\/\d+(?:\/|$)/.test(url.pathname) || !!extension;
      if ((offsite && settings.showOffsite) || (!offsite && file && !digLink(link.url, base, context) && settings.showUnreadable)) {
        out.set(url.href, { url: url.href, title: link.title || url.href, state: offsite ? 'not-followed' : 'unreadable', kind: extension as 'pdf' | 'pptx' | 'docx' | undefined ?? 'page' });
      }
    } catch { /* Malformed links do not become stubs. */ }
  }
  return [...out.values()];
}
