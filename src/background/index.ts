// Service worker: routes messages and (later) runs the dig queue. No parsing or model here.
import type { Msg } from '../shared/types';

// Toolbar icon click opens the side panel too.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-search' || tab?.windowId === undefined) return;
  // Must run synchronously inside the shortcut's user gesture, so no await before it.
  chrome.sidePanel
    .open({ windowId: tab.windowId })
    .then(() => {
      // If the panel was already open, this refocuses the box. A freshly opened panel
      // focuses itself on load, so a missing receiver here is fine.
      const msg: Msg = { type: 'focus-search' };
      return chrome.runtime.sendMessage(msg);
    })
    .catch(() => {});
});
