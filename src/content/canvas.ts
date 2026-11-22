import { allowedApi } from '../shared/canvas-api';
import type { CanvasApiGetMsg, CanvasApiResponse } from '../shared/types';

/** MV3 content-script fetches use this tab's session, including Firefox containers. */
export async function readCanvasApi(msg: CanvasApiGetMsg, pageUrl: string, signal: AbortSignal): Promise<CanvasApiResponse> {
  const page = new URL(pageUrl);
  const url = new URL(msg.url);
  const coursePath = `/courses/${msg.context.courseId}`;
  if (page.origin !== msg.context.origin || !(page.pathname === coursePath || page.pathname.startsWith(`${coursePath}/`))) {
    throw new Error('The original Canvas tab changed. Start the search again from the course page.');
  }
  if (!allowedApi(url, msg.context)) throw new Error('Blocked unsafe Canvas API URL');
  signal.throwIfAborted();
  const response = await fetch(url.href, {
    method: 'GET', credentials: 'same-origin', redirect: 'error', signal,
    headers: { Accept: 'application/json' },
  });
  return { status: response.status, body: await response.text(), link: response.headers.get('Link') };
}

export function createCanvasApiReader(pageUrl: () => string) {
  const requests = new Map<string, AbortController>();
  return {
    async read(msg: CanvasApiGetMsg): Promise<CanvasApiResponse> {
      const controller = new AbortController();
      requests.set(msg.requestId, controller);
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        return await readCanvasApi(msg, pageUrl(), controller.signal);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      } finally {
        clearTimeout(timer);
        requests.delete(msg.requestId);
      }
    },
    cancel(requestId: string): void { requests.get(requestId)?.abort(); },
  };
}
