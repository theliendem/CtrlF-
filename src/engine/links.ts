import type { CanvasContext, DigLink } from '../shared/types';

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
    const prefix = `/courses/${context.courseId}`;
    if (!(path === prefix || path.startsWith(prefix + '/'))) return null;
    const route = path.slice(prefix.length).replace(/\/$/, '');
    if (!/^(?:|\/assignments(?:\/\d+|\/syllabus)?|\/pages(?:\/[^/]+)?|\/modules|\/announcements|\/discussion_topics\/\d+)$/.test(route)) {
      // LATER: file nodes are added in milestone 4; other sites in milestone 6.
      return null;
    }
    const hash = route === '/modules' && /^#context_module_\d+$/.test(url.hash) ? url.hash : '';
    const canonical = `${url.origin}${url.pathname.replace(/\/$/, '')}${hash}`;
    const parent = new URL(base);
    if (url.hash && !hash && url.pathname === parent.pathname) return null;
    return canonical;
  } catch {
    return null;
  }
}

export function filterLinks(links: DigLink[], base: string, context: CanvasContext): DigLink[] {
  const unique = new Map<string, DigLink>();
  for (const link of links) {
    const url = safeLink(link.url, base, context);
    if (url && url !== base && !unique.has(url)) unique.set(url, { ...link, url });
  }
  return [...unique.values()];
}
