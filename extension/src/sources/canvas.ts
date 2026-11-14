// Canvas source: Canvas web URLs -> SourceDoc via the Canvas REST API (GET only). Owner: A.
// Runs in the offscreen document; the browser's Canvas login cookie carries over (verified).
//
// Every node in the dig tree is a Canvas *web* URL (what the user would click), e.g.
//   /courses/1/assignments/syllabus, /courses/1/modules/7, /courses/1/pages/exam-info, /courses/1/files/9
// canvasDoc(url) maps that to the right API call(s) and returns a SourceDoc whose links are also web URLs.
import type { LinkRef, SourceDoc } from '../../../shared/contracts';
import { fromPdf } from './pdf';
import { fromHtmlFragment, splitSentences } from './html';
import { isSafeToFetch, safeGet } from './safety';

const CANVAS_HOSTS = [/^canvas\.wisc\.edu$/i, /\.instructure\.com$/i];

export function isCanvasHost(host: string): boolean {
  return CANVAS_HOSTS.some((re) => re.test(host));
}

/** { origin, courseId } if url is inside a Canvas course, else null. */
export function canvasCourseOf(url: string): { origin: string; courseId: string } | null {
  try {
    const u = new URL(url);
    if (!isCanvasHost(u.hostname)) return null;
    const m = u.pathname.match(/^\/courses\/(\d+)/);
    return m ? { origin: u.origin, courseId: m[1] } : null;
  } catch {
    return null;
  }
}

// ---------- API plumbing ----------

function parseJson<T>(text: string): T {
  return JSON.parse(text.replace(/^while\(1\);/, '')) as T;
}

function nextLink(res: Response): string | null {
  const h = res.headers.get('Link');
  if (!h) return null;
  for (const part of h.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export class CanvasApiError extends Error {
  constructor(public status: number, public url: string) {
    super(`Canvas API ${status} for ${url}`);
  }
}

/** GET one Canvas API object. */
export async function canvasGet<T>(url: string): Promise<T> {
  const res = await safeGet(url, { accept: 'application/json' });
  if (!res.ok) throw new CanvasApiError(res.status, url);
  return parseJson<T>(await res.text());
}

/** GET a Canvas API list, following Link-header pagination (capped so a huge course can't run away). */
export async function canvasGetAll<T>(url: string, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  for (let i = 0; next && i < maxPages; i++) {
    const res = await safeGet(next, { accept: 'application/json' });
    if (!res.ok) throw new CanvasApiError(res.status, next);
    out.push(...parseJson<T[]>(await res.text()));
    next = nextLink(res);
  }
  return out;
}

// ---------- Canvas API shapes (only the fields we use) ----------

type Course = { id: number; name: string; default_view?: string; syllabus_body?: string | null };
type Page = { url: string; title: string; body?: string | null; html_url?: string };
type Assignment = { id: number; name: string; description?: string | null; html_url: string; due_at?: string | null; is_quiz_assignment?: boolean; submission_types?: string[] };
type Topic = { id: number; title: string; message?: string | null; html_url: string; posted_at?: string | null };
type ModuleItem = { id: number; title: string; type: string; content_id?: number; page_url?: string; external_url?: string; html_url?: string };
type Module = { id: number; name: string; items?: ModuleItem[] };
type CanvasFile = { id: number; display_name: string; filename: string; url: string; 'content-type': string; size: number };

// ---------- helpers ----------

const link = (url: string, text: string, context: string): LinkRef => ({ url, text, context });

/** Plain-text passages for things that aren't HTML (titles, dates). */
function textDoc(url: string, title: string, text: string): SourceDoc {
  const passages = splitSentences(text).map((s, i) => ({
    id: `${url}#t${i}`,
    url,
    text: s.text.trim(),
    locator: { kind: 'dom' as const, xpath: '/html[1]/body[1]', start: s.start, end: s.end },
  }));
  return { url, title, kind: 'canvas', passages, links: [] };
}

/** HTML body -> doc; falls back to plain text when the body has no block elements. */
function bodyDoc(url: string, title: string, html: string | null | undefined): SourceDoc {
  const doc = fromHtmlFragment(html ?? '', url, title);
  if (doc.passages.length === 0 && html) {
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
    doc.passages = textDoc(url, title, text.replace(/\s+/g, ' ')).passages;
  }
  doc.links = doc.links.filter((l) => isSafeToFetch(l.url, l.text));
  return doc;
}

function moduleItemLink(origin: string, cid: string, mod: Module, it: ModuleItem): LinkRef | null {
  const ctx = `module ${mod.name} | ${it.type}`;
  const C = `${origin}/courses/${cid}`;
  switch (it.type) {
    case 'Page':
      return it.page_url ? link(`${C}/pages/${it.page_url}`, it.title, ctx) : null;
    case 'File':
      return it.content_id ? link(`${C}/files/${it.content_id}`, it.title, `${ctx} file ${/\.pdf$/i.test(it.title) ? 'pdf' : ''}`) : null;
    case 'Assignment':
      return it.content_id ? link(`${C}/assignments/${it.content_id}`, it.title, ctx) : null;
    case 'Discussion':
      return it.content_id ? link(`${C}/discussion_topics/${it.content_id}`, it.title, ctx) : null;
    case 'ExternalUrl':
      return it.external_url && isSafeToFetch(it.external_url, it.title) ? link(it.external_url, it.title, `${ctx} external link`) : null;
    default:
      return null; // Quiz, SubHeader, ExternalTool: never followed.
  }
}

// Modules come back in one call; cache per course so module nodes don't refetch.
const moduleCache = new Map<string, Promise<Module[]>>();
function modules(origin: string, cid: string): Promise<Module[]> {
  const key = `${origin}/${cid}`;
  if (!moduleCache.has(key)) {
    const p = canvasGetAll<Module>(`${origin}/api/v1/courses/${cid}/modules?include[]=items&per_page=50`);
    p.catch(() => moduleCache.delete(key));
    moduleCache.set(key, p);
  }
  return moduleCache.get(key)!;
}

// ---------- the router ----------

/**
 * Load one Canvas web URL as a SourceDoc via the API. Returns null if the URL isn't a Canvas
 * course URL we know how to read (the caller may fall back to fromHtml, or skip it).
 */
export async function canvasDoc(url: string): Promise<SourceDoc | null> {
  const u = new URL(url);
  const origin = u.origin;
  const path = u.pathname.replace(/\/+$/, '');
  const api = `${origin}/api/v1`;

  // /files/:id or /files/:id/download outside a course (links inside page bodies)
  let m = path.match(/^\/files\/(\d+)/);
  if (m) return fileDoc(url, `${api}/files/${m[1]}`);

  m = path.match(/^\/courses\/(\d+)(\/.*)?$/);
  if (!m) return null;
  const cid = m[1];
  const rest = m[2] ?? '';
  const C = `${origin}/courses/${cid}`;
  const A = `${api}/courses/${cid}`;

  if (rest === '' || rest === '/home') {
    const course = await canvasGet<Course>(`${A}?include[]=syllabus_body`);
    const doc: SourceDoc = { url: C, title: course.name, kind: 'canvas', passages: [], links: [] };
    if (course.default_view === 'wiki') {
      try {
        const front = await canvasGet<Page>(`${A}/front_page`);
        Object.assign(doc, { passages: bodyDoc(C, course.name, front.body).passages, links: bodyDoc(C, course.name, front.body).links });
      } catch {
        /* no front page */
      }
    }
    doc.links.unshift(
      link(`${C}/assignments/syllabus`, 'Syllabus', 'syllabus course policies grading late work exams'),
      link(`${C}/modules`, 'Modules', 'modules weekly materials files pages'),
      link(`${C}/announcements`, 'Announcements', 'announcements news updates'),
      link(`${C}/assignments`, 'Assignments', 'assignments homework due dates'),
      link(`${C}/pages`, 'Pages', 'course pages'),
    );
    return doc;
  }

  if (rest === '/assignments/syllabus') {
    const course = await canvasGet<Course>(`${A}?include[]=syllabus_body`);
    return bodyDoc(url, `Syllabus: ${course.name}`, course.syllabus_body);
  }

  if (rest === '/modules') {
    const mods = await modules(origin, cid);
    return {
      url,
      title: 'Modules',
      kind: 'canvas',
      passages: [],
      links: mods.map((md) => link(`${C}/modules/${md.id}`, md.name, `module ${md.name} | ${(md.items ?? []).map((i) => i.title).join(', ').slice(0, 300)}`)),
    };
  }

  m = rest.match(/^\/modules\/(\d+)$/);
  if (m) {
    const md = (await modules(origin, cid)).find((x) => String(x.id) === m![1]);
    if (!md) return null;
    const links = (md.items ?? []).map((it) => moduleItemLink(origin, cid, md, it)).filter((l): l is LinkRef => !!l);
    return { url, title: md.name, kind: 'canvas', passages: [], links };
  }

  m = rest.match(/^\/modules\/items\/(\d+)$/);
  if (m) {
    const itemId = Number(m[1]);
    for (const md of await modules(origin, cid)) {
      const it = md.items?.find((i) => i.id === itemId);
      const l = it && moduleItemLink(origin, cid, md, it);
      if (l) return canvasDoc(l.url);
    }
    return null;
  }

  if (rest === '/pages' || rest === '/wiki') {
    const pages = await canvasGetAll<Page>(`${A}/pages?per_page=100&sort=title`);
    return { url, title: 'Pages', kind: 'canvas', passages: [], links: pages.map((p) => link(`${C}/pages/${p.url}`, p.title, 'course page')) };
  }

  m = rest.match(/^\/(?:pages|wiki)\/([^/]+)$/);
  if (m) {
    const page = await canvasGet<Page>(`${A}/pages/${m[1]}`);
    return bodyDoc(url, page.title, page.body);
  }

  if (rest === '/assignments') {
    const as = await canvasGetAll<Assignment>(`${A}/assignments?per_page=100&order_by=due_at`);
    const listText = as.map((a) => `${a.name}${a.due_at ? ` is due ${new Date(a.due_at).toLocaleString()}` : ''}.`).join(' ');
    const doc = textDoc(url, 'Assignments', listText);
    doc.links = as
      .filter((a) => !a.is_quiz_assignment && !(a.submission_types ?? []).includes('online_quiz'))
      .map((a) => link(`${C}/assignments/${a.id}`, a.name, `assignment ${a.due_at ? `due ${a.due_at.slice(0, 10)}` : ''}`));
    return doc;
  }

  m = rest.match(/^\/assignments\/(\d+)$/);
  if (m) {
    const a = await canvasGet<Assignment>(`${A}/assignments/${m[1]}`);
    const doc = bodyDoc(url, a.name, a.description);
    if (a.due_at) doc.passages.unshift(...textDoc(url, a.name, `${a.name} is due ${new Date(a.due_at).toLocaleString()}.`).passages);
    return doc;
  }

  if (rest === '/announcements') {
    const items = await canvasGetAll<Topic>(`${api}/announcements?context_codes[]=course_${cid}&per_page=50`, 2);
    // One doc for the whole list (budget-friendly); each passage points at its own announcement.
    const doc: SourceDoc = { url, title: 'Announcements', kind: 'canvas', passages: [], links: [] };
    for (const t of items) {
      const tUrl = `${C}/discussion_topics/${t.id}`;
      const sub = bodyDoc(tUrl, t.title, `<h2>${escapeHtml(t.title)}</h2>${t.message ?? ''}`);
      doc.passages.push(...sub.passages);
      doc.links.push(...sub.links);
    }
    return doc;
  }

  m = rest.match(/^\/(?:discussion_topics|announcements)\/(\d+)$/);
  if (m) {
    // Topic body only. Never replies (they're other students' posts).
    const t = await canvasGet<Topic>(`${A}/discussion_topics/${m[1]}`);
    return bodyDoc(url, t.title, t.message);
  }

  m = rest.match(/^\/files\/(\d+)/);
  if (m) return fileDoc(url, `${A}/files/${m[1]}`);

  return null;
}

async function fileDoc(webUrl: string, apiUrl: string): Promise<SourceDoc | null> {
  const f = await canvasGet<CanvasFile>(apiUrl);
  const isPdf = f['content-type'] === 'application/pdf' || /\.pdf$/i.test(f.filename);
  if (!isPdf) return { url: webUrl, title: f.display_name, kind: 'canvas', passages: [], links: [] };
  const doc = await fromPdf(f.url);
  return { ...doc, title: doc.title && doc.title !== f.url ? doc.title : f.display_name };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * Walk a whole course breadth-first: home, syllabus, modules, every module item, announcements.
 * For caching / full-course indexing. The dig itself uses canvasDoc() best-first instead.
 */
export async function* fromCanvas(courseId: string, origin: string): AsyncIterable<SourceDoc> {
  const seen = new Set<string>();
  const queue = [`${origin}/courses/${courseId}`];
  while (queue.length) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    let doc: SourceDoc | null = null;
    try {
      doc = await canvasDoc(url);
    } catch (e) {
      console.warn('[ctrlfpp canvas]', url, e);
    }
    if (!doc) continue;
    yield doc;
    for (const l of doc.links) {
      const c = canvasCourseOf(l.url);
      if (c && c.courseId === courseId && !seen.has(l.url) && isSafeToFetch(l.url, l.text)) queue.push(l.url);
    }
  }
}
