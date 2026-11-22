import type { CanvasContext } from './types';

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

/** A browser-specific transport for read-only Canvas API requests. */
export type CanvasFetch = (url: string, context: CanvasContext, signal: AbortSignal) => Promise<Response>;

export const directCanvasFetch: CanvasFetch = (url, _context, signal) =>
  fetch(url, { method: 'GET', credentials: 'include', redirect: 'error', signal });
