import { allowedApi, type CanvasFetch } from '../shared/canvas-api';
import type { CanvasApiResponse, ContentMsg } from '../shared/types';

/** Keep cookies in the source tab. Only the response body and pagination link cross the boundary. */
export function createCanvasFetch(send: (tabId: number, msg: ContentMsg) => Promise<unknown>): CanvasFetch {
  return async (url, context, signal) => {
    if (!allowedApi(new URL(url), context)) throw new Error('Blocked unsafe Canvas API URL');
    const tabId = context.sourceTabId;
    if (tabId === undefined) throw new Error('Open the Canvas course in a tab and start the search again.');
    signal.throwIfAborted();
    const requestId = crypto.randomUUID();
    return new Promise<Response>((resolve, reject) => {
      const abort = () => {
        void send(tabId, { type: 'canvas-api-cancel', requestId }).catch(() => {});
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      void send(tabId, { type: 'canvas-api-get', requestId, url, context }).then((value) => {
        signal.throwIfAborted();
        const result = value as CanvasApiResponse | undefined;
        if (!result) throw new Error('Reload the Canvas tab, then start the search again.');
        if ('error' in result) throw new Error(result.error);
        // Only the headers consumed by the Canvas reader are forwarded.
        resolve(new Response(result.status === 204 || result.status === 304 ? null : result.body, {
          status: result.status, headers: result.link ? { Link: result.link } : {},
        }));
      }, () => {
        throw new Error('Cannot reach the original Canvas tab. Keep it open, reload it, and try again.');
      }).catch(reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };
}
