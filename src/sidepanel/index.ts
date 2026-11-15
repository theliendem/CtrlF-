// Side panel: search box, live graph, results list, settings.
import type { Msg } from '../shared/types';

const q = document.getElementById('q') as HTMLInputElement;
const form = document.getElementById('search-form') as HTMLFormElement;

function focusSearch(): void {
  window.focus();
  q.focus();
  q.select();
}

focusSearch();
// Some opens land before the panel has focus; retry once it does.
window.addEventListener('focus', () => q.focus(), { once: true });

chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type === 'focus-search') focusSearch();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = q.value.trim();
  if (!query) return;
  // Milestone 2 wires this to the current-page search.
  console.log('[ctrlf++] search:', query);
});
