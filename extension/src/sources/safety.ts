// Read-only guardrails for everything the crawler fetches. Owner: A.
// Rule: GET only, never anything that changes state, never Canvas quizzes/submissions/grades/inbox/people.

const SKIP_WORDS = /\b(log ?out|sign ?out|delete|remove|submit|unsubscribe|take (the )?quiz|start (the )?quiz|resume quiz|begin quiz)\b/i;

// Path patterns we never fetch, on Canvas or anywhere else.
const SKIP_PATHS: RegExp[] = [
  /\/logout\b/i,
  /\/login\b/i,
  /\/quizzes\b/i,
  /\/quiz_submissions\b/i,
  /\/submissions\b/i,
  /\/grades\b/i,
  /\/gradebook\b/i,
  /\/conversations\b/i, // inbox
  /\/inbox\b/i,
  /\/users\b/i, // people lists and profiles
  /\/people\b/i,
  /\/groups\/\d+\/users\b/i,
  /\/profile\b/i,
  /\/delete\b/i,
  /\/destroy\b/i,
  /\/(take|start|submit)\b/i,
  /\/external_tools\b/i, // LTI launches can POST
  /\/lti\b/i,
];

/** True if the crawler may GET this URL. linkText is the anchor text (may be empty). */
export function isSafeToFetch(url: string, linkText = ''): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (SKIP_WORDS.test(linkText)) return false;
  const path = decodeURIComponent(u.pathname);
  if (SKIP_PATHS.some((re) => re.test(path))) return false;
  if (SKIP_WORDS.test(path.replace(/[-_/]/g, ' '))) return false;
  // Query strings that look like actions.
  if (/[?&](action|_method|do)=/i.test(u.search)) return false;
  return true;
}

export class UnsafeUrlError extends Error {}

/**
 * The only way sources and the crawler touch the network. Always GET, always with the
 * browser's cookies, always time-limited, always checked against the skip list.
 */
export async function safeGet(url: string, opts: { timeoutMs?: number; linkText?: string; accept?: string } = {}): Promise<Response> {
  if (!isSafeToFetch(url, opts.linkText)) throw new UnsafeUrlError(`refusing to fetch ${url}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    return await fetch(url, {
      method: 'GET',
      credentials: 'include',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: opts.accept ? { Accept: opts.accept } : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
}
