// Chrome's offscreen document hosts the same engine Firefox calls directly.
import { extensionApi } from '../shared/browser';
import { handleEngineMessage } from './index';

extensionApi.runtime.onMessage.addListener((msg, _sender, sendResponse) =>
  handleEngineMessage(msg, sendResponse, (progress) => {
    void extensionApi.runtime.sendMessage(progress).catch(() => {});
  }),
);
