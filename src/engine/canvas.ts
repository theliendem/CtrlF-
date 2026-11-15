import type { CanvasAnnouncement, CanvasAssignment, CanvasContext, CanvasCourse, CanvasItem, CanvasModule, CanvasPage, DigLink, PageText } from '../shared/types';
import { pageLinks } from '../shared/page-links';

/** Validate every request, including pagination. Never follow HTTP redirects to an unchecked URL. */
export function allowedApi(url: URL, context: CanvasContext): boolean {
  if (url.origin !== context.origin || url.username || url.password) return false;
  for (const [key, value] of url.searchParams) {
    if (!['page', 'per_page', 'include[]', 'context_codes[]', 'start_date', 'end_date'].includes(key)) return false;
    if (key === 'include[]' && !['items', 'syllabus_body'].includes(value)) return false;
  }
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  const root = `/api/v1/courses/${context.courseId}`;
  if (path === '/api/v1/announcements') {
    return url.searchParams.getAll('context_codes[]').join() === `course_${context.courseId}`;
  }
  if (!path.startsWith(root)) return false;
  const route = path.slice(root.length);
  if (/(?:^|[\W_])(logout|delete|submit|submissions?|quizzes?|grades?|inbox|people|users|accounts?|help)(?:$|[\W_])/i.test(route)) return false;
  return /^(?:|\/modules(?:\/\d+\/items)?|\/pages(?:\/[^/]+)?|\/assignments(?:\/\d+)?|\/files\/\d+)$/.test(route);
}

export async function canvasGet<T>(raw: string, context: CanvasContext, signal: AbortSignal): Promise<T> {
  const url = new URL(raw, context.origin);
  if (!allowedApi(url, context)) throw new Error('Blocked unsafe Canvas API URL');
  const response = await fetch(url.href, { method: 'GET', credentials: 'include', redirect: 'error', signal });
  if (!response.ok) throw new Error(`Canvas HTTP ${response.status}`);
  const data: unknown = JSON.parse((await response.text()).replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, ''));
  return data as T;
}

export async function canvasList<T>(raw: string, context: CanvasContext, signal: AbortSignal): Promise<T[]> {
  const result: T[] = [];
  const visited = new Set<string>();
  let next: string | undefined = new URL(raw, context.origin).href;
  const initialPath = new URL(next).pathname;
  while (next) {
    if (visited.has(next)) throw new Error('Canvas pagination loop');
    visited.add(next);
    const url = new URL(next);
    if (!allowedApi(url, context) || url.pathname !== initialPath) throw new Error('Blocked unsafe Canvas pagination URL');
    const response: Response = await fetch(next, { method: 'GET', credentials: 'include', redirect: 'error', signal });
    if (!response.ok) throw new Error(`Canvas HTTP ${response.status}`);
    const data: unknown = JSON.parse((await response.text()).replace(/^\s*while\s*\(\s*1\s*\)\s*;\s*/, ''));
    if (!Array.isArray(data)) throw new Error('Canvas returned a non-list response');
    result.push(...data as T[]);
    const link: string | undefined = response.headers.get('Link')?.split(',').find((part) => /\brel="next"/.test(part));
    const href: string | undefined = link?.match(/<([^>]+)>/)?.[1];
    next = href ? new URL(href, next).href : undefined;
  }
  return result;
}

/** Read inert HTML into blocks that match the content script's block boundaries. */
export function parseHtml(html: string, url: string, title: string): PageText {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  title ||= doc.title?.trim() ?? '';
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href') ?? undefined;
  doc.querySelectorAll('script,style,noscript,iframe,form').forEach((el) => el.remove());
  // Menu links are dig candidates; menu text is not page content.
  const links = pageLinks(doc, title, (a) => a.getAttribute('href')!);
  doc.querySelectorAll('nav,header,footer,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"]').forEach((el) => el.remove());
  const blocks: string[] = title ? [title] : [];
  let current: Element | null = null;
  let text = '';
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const block = node.parentElement?.closest('p,div,li,td,th,h1,h2,h3,h4,h5,h6,section,article,blockquote,pre,dt,dd') ?? doc.body;
    if (block !== current) {
      if (text.trim()) blocks.push(text.trim());
      text = '';
      current = block;
    }
    text += node.textContent.replace(/\s+/g, ' ');
  }
  if (text.trim()) blocks.push(text.trim());
  return { url, canonical, title, blocks, links };
}

function itemLinks(items: CanvasItem[], context: CanvasContext, heading: string): DigLink[] {
  const base = `${context.origin}/courses/${context.courseId}`;
  return items.flatMap((item) => {
    let url: string | undefined;
    if (item.type === 'Page' && item.page_url) url = `${base}/pages/${encodeURIComponent(item.page_url)}`;
    if (item.type === 'Assignment' && item.content_id) url = `${base}/assignments/${item.content_id}`;
    if (item.type === 'File' && item.content_id) url = `${base}/files/${item.content_id}`;
    if (item.type === 'ExternalUrl') url = item.external_url;
    // LATER: tool-launch and discussion module items stay excluded; quizzes are always blocked.
    return url ? [{ url, title: item.title, heading }] : [];
  });
}

export async function discoverCourse(context: CanvasContext, signal: AbortSignal): Promise<DigLink[]> {
  const base = `${context.origin}/courses/${context.courseId}`;
  const modules = await canvasList<CanvasModule>(`/api/v1/courses/${context.courseId}/modules?include[]=items&per_page=100`, context, signal);
  return [
    ...modules.filter((m) => m.state !== 'locked').map((m) => ({
      url: `${base}/modules#context_module_${m.id}`, title: m.name,
      heading: itemLinks(m.items ?? [], context, m.name).map((item) => item.title).join(' · '),
    })),
    { url: `${base}/assignments/syllabus`, title: 'Course syllabus', heading: '' },
    { url: `${base}/assignments`, title: 'Assignments homework deadlines', heading: '' },
    { url: `${base}/announcements`, title: 'Course announcements updates', heading: '' },
    // Pages that no module links to are only reachable from the course's page list.
    { url: `${base}/pages`, title: 'Course pages', heading: '' },
  ];
}

export async function readCanvas(url: string, context: CanvasContext, signal: AbortSignal): Promise<PageText> {
  const base = `${context.origin}/courses/${context.courseId}`;
  const api = `/api/v1/courses/${context.courseId}`;
  const parsed = new URL(url);
  const route = parsed.pathname.slice(`/courses/${context.courseId}`.length);
  let page: PageText;
  if (route === '/modules' && parsed.hash) {
    const id = parsed.hash.match(/^#context_module_(\d+)$/)?.[1];
    if (!id) throw new Error('Invalid module URL');
    const items = await canvasList<CanvasItem>(`${api}/modules/${id}/items?per_page=100`, context, signal);
    page = { url, title: '', blocks: [], links: itemLinks(items, context, '') };
  } else if (route === '/modules') {
    page = { url, title: 'Modules', blocks: [], links: await discoverCourse(context, signal) };
  } else if (route === '/pages') {
    const pages = await canvasList<CanvasPage>(`${api}/pages?per_page=100`, context, signal);
    page = { url, title: 'Pages', blocks: [], links: pages.filter((p) => p.url && !p.locked_for_user).map((p) => ({ url: `${base}/pages/${encodeURIComponent(p.url!)}`, title: p.title, heading: '' })) };
  } else if (route.startsWith('/pages/')) {
    const data = await canvasGet<CanvasPage>(`${api}${route}`, context, signal);
    if (data.locked_for_user) throw new Error('Page locked');
    page = parseHtml(data.body ?? '', url, data.title);
  } else if (/^\/assignments\/\d+$/.test(route)) {
    const data = await canvasGet<CanvasAssignment>(`${api}${route}`, context, signal);
    if (data.locked_for_user || data.is_quiz_assignment || data.quiz_id) throw new Error('Locked or quiz assignment skipped');
    page = parseHtml(data.description ?? '', url, data.name);
  } else if (route === '/assignments') {
    const assignments = await canvasList<CanvasAssignment>(`${api}/assignments?per_page=100`, context, signal);
    page = { url, title: 'Assignments', blocks: [], links: assignments.filter((a) => !a.locked_for_user && !a.is_quiz_assignment && !a.quiz_id).map((a) => ({ url: `${base}/assignments/${a.id}`, title: a.name, heading: '' })) };
  } else if (route === '/announcements' || /^\/discussion_topics\/\d+$/.test(route)) {
    // Read announcement bodies from the announcements endpoint, never discussion replies.
    const announcements = await canvasList<CanvasAnnouncement>(`/api/v1/announcements?context_codes[]=course_${context.courseId}&per_page=100&start_date=2000-01-01&end_date=${new Date().toISOString().slice(0, 10)}`, context, signal);
    if (route === '/announcements') {
      page = { url, title: 'Announcements', blocks: [], links: announcements.map((a) => ({ url: `${base}/discussion_topics/${a.id}`, title: a.title, heading: '' })) };
    } else {
      const data = announcements.find((a) => String(a.id) === route.split('/').pop());
      if (!data) throw new Error('Not an announcement; skipped');
      page = parseHtml(data.message ?? '', url, data.title);
    }
  } else if (route === '' || route === '/assignments/syllabus') {
    const data = await canvasGet<CanvasCourse>(`${api}?include[]=syllabus_body`, context, signal);
    page = parseHtml(data.syllabus_body ?? '', url, `${data.name} syllabus`);
  } else {
    throw new Error('Unsupported Canvas page');
  }
  // Filtering happens in the engine so settings can expose skipped URLs as display-only stubs.
  return page;
}
