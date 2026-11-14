// Side panel. Owner: C. A's scaffold placeholder: shows raw TREE_EVENTs. Replace freely.
import type { Msg } from '../../../shared/contracts';

const log = document.getElementById('log')!;
document.getElementById('replay')!.addEventListener('click', () => {
  log.innerHTML = '';
  chrome.runtime.sendMessage({ type: 'START_DIG', query: 'calculator on midterm', url: 'fixture' } satisfies Msg);
});
chrome.runtime.onMessage.addListener((msg: Msg) => {
  if (msg.type === 'TREE_EVENT') {
    const li = document.createElement('li');
    li.textContent = `${msg.event.t}ms ${msg.event.state} ${msg.event.title} (${msg.event.score.toFixed(2)})`;
    log.append(li);
  } else if (msg.type === 'DIG_DONE') {
    const li = document.createElement('li');
    li.textContent = `DONE: ${msg.reason}, ${msg.pagesSearched} pages, ${msg.hits.length} hits`;
    log.append(li);
  }
});
