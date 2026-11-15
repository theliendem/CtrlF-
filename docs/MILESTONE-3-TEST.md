# Canvas dig: Chrome check

## What changed

- Search continues past the current page into Canvas modules, pages, assignment descriptions, syllabus and announcements.
- The tree shows queued (hollow), reading (yellow), matching (green) and ruled-out (gray) nodes. Hover a node for its URL and state. Scroll the graph to see branches outside the panel.
- The queue reads up to four pages concurrently, stops at 60 pages including the root or depth 5, and times out a page's fetch after eight seconds.
- Green nodes open a new tab and highlight matching passages. Stop keeps results; Escape clears highlights.
- Files are still skipped until milestone 4. Graph animation comes in milestone 5.

## Test steps

1. Open `chrome://extensions`, find **Ctrl+F++**, and click its reload button. Refresh the MATH345 tab too, then reopen the side panel with **Cmd+Shift+F**.
2. In Canvas, open **MATH345 → Modules**. Choose an unlocked **Page** item, not a file, quiz or external tool. Copy its exact title into the extension and press Enter. This gives the test a known destination instead of relying on a guessed phrase.
3. Watch the tree. It should continue beyond the root even if the current page has a match. The page count should grow, nodes should change from hollow to yellow to green/gray, and the chosen page should appear as a green result. Fast reads may make yellow brief. At the end, the status should say **Dig complete** or **60-page limit reached**, and Stop should disappear.
4. Click that green page's result. Expect a **new tab**, the correct Canvas page, a bright yellow best match, and scrolling to that match. Other matches may be lighter yellow. No quiz, submission or external-tool page should open.
5. Go back to Modules, run the search again, and click **Stop** while it is digging. Expect **Stopped. Results kept.**, no new results afterward, and the results already found to remain clickable. If cached results finish too fast, use another module item's title.
6. Start one search, then immediately replace it with another page title and press Enter. The graph should reset, and results from the old search should not reappear. Press **Escape** in the panel: the dig should stop and highlights should disappear from tabs opened through results.

## If something fails

Send the query, the final status text, whether the expected page appeared, and whether its new tab highlighted text. For a read error, hover the gray node to see its error. For an engine error, open `chrome://extensions` → Ctrl+F++ → **service worker** and copy the first red error. Do not send authentication cookies or tokens.

Automated checks: `npm test` covers safe URL filtering, GET-only API requests, prefix stripping, pagination, quiz exclusion, best-first order, concurrency, page budget and stopping. `npm run build` checks TypeScript and builds `dist/`. These checks do not replace the signed-in Canvas test above.
