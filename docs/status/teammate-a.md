# Teammate A status

*Newest first. Update in every PR.*

## Works now

- **Live dig on a real Canvas course (MATH345): 46 pages, ~5.4 s, finished on its own with no errors.** It covered home, syllabus, modules, module items, announcements, assignments, pages and ~30 PDFs. With the stub, every match scores 0.50 (word overlap) and PDFs are empty until B's `fromPdf` lands.
- Cmd/Ctrl+Shift+F now works in tabs opened before the extension was reloaded (background injects `content.js` and retries).
- **The dig works (A3).** `START_DIG` runs a real best-first crawl: 4 at once, 8 s timeout (20 s for files), depth/budget/scope from `chrome.storage.sync['digSettings']` merged with the message's `settings`, pauses after 3 strong hits with `DIG_DONE reason:'ask'` (`RESUME_DIG` continues), `STOP_DIG` stops (resumable). A `TREE_EVENT` goes out on every node state change. Tested offline on `course.json`: the budget is respected, no duplicate fetches, and the PDF hit is found 2 levels deep.
- `START_DIG` from the side panel can omit `url`/`tabId`; background fills in the active tab. It also opens the side panel when sent from the page (needs a user click).
- `START_DIG` with `url: 'fixture'` still replays `tree-events.json` (dev).
- `EXPORT_DIGLOGS` -> reply `DIGLOGS_FILE { filename, json, count }`. Logs persist in `chrome.storage.local['digLogs']`.
- `OPEN_LOCATOR`: dom -> new tab with a `#:~:text=` fragment; pdf -> `src/pdfviewer/index.html?url=&page=&start=&end=&text=`.
- Weights: `databricks/link-weights.json` is bundled automatically if present (rebuild after D pushes), else `link-weights.default.json`.
- Canvas PDF downloads work from the extension (redirect to `cdn.inst-fs-iad-prod.inscloudgate.net` returns 200 + PDF bytes; no extra host permission needed).
- Offscreen console: `await ctrlfpp.dig('question', 'https://canvas.wisc.edu/courses/<id>')` prints the dig live.
- **Canvas API works from the extension with the browser's login** (tested on a real course: 200, course JSON). No content-script fallback needed.
- `extension/src/sources/`: `loadDoc(url)` routes any URL (Canvas API / PDF / plain HTML). `canvasDoc(webUrl)` maps Canvas web URLs (home, syllabus, modules, module, pages, page, assignments, assignment, announcements, discussion topic, files) to API calls; links stay web URLs so the tree mirrors the course. `fromCanvas(courseId, origin)` walks a whole course. `fromHtml(html, url)`, `isSafeToFetch(url, text)`, `safeGet(url)` (GET-only, 8 s timeout, skip list).
- The offscreen document now starts as soon as the extension loads (model warm before first search). Offscreen console helpers: `await ctrlfpp.walk('<courseId>')`, `await ctrlfpp.probePdf('<courseId>')`, `await ctrlfpp.loadDoc(url)`.
- **Task 0 merged.** `cd extension && npm install && npm run build`, then Load unpacked on `extension/dist`.
- `shared/contracts.ts`, `shared/engine-api.ts`, `shared/engine-stub.ts` (keyword overlap, same interface as the real engine).
- Message routing: content -> `SEARCH_PAGE` -> background -> offscreen (stub engine) -> `SEARCH_RESULTS` reply. Ctrl+Shift+F (Cmd+Shift+F) sends `OPEN_SEARCH` to the tab.
- `START_DIG` replays `shared/fixtures/synthetic/tree-events.json` as live `TREE_EVENT`s, then `DIG_DONE` (stand-in until the crawler lands).
- Synthetic fixtures in `shared/fixtures/synthetic/`: `syllabus.html`, `course.json` (SourceDoc[], incl. a PDF with page locators), `tree-events.json` (20 s, all six states), `diglogs-sample.json` (300 rows, for D), `link-weights.default.json`. Regenerate with `node gen-fixtures.mjs .`.

## Next

- Live dig test on a real Canvas course, then A4 integration (swap in B's engine when ready, run D's queries).

## Needs from others

- (none)

## Notes

- **C:** `content.js` can now be injected programmatically on top of the manifest one in rare cases. Guard your content script against running twice (e.g. `if (window.__ctrlfpp) return; window.__ctrlfpp = true`).
- **The crawl runs in the offscreen document, not the service worker** (MV3 workers get killed when idle and would lose the queue). `TREE_EVENT` and `DIG_DONE` are sent from there via `chrome.runtime.sendMessage`; the side panel receives them the same way.
- **C, tree semantics:** `dead` = page searched, nothing relevant on it. A dead node can still have queued children (hub pages like Modules). Node ids are `n0` (root), `n1`, ... and each node reuses its id across state changes. At most 12 `skipped` stubs per parent.
- **Canvas hubs** (syllabus, modules, a module, announcements, assignments list) are always queued, just above `minScore`, because they rarely share words with a question but lead everywhere.
- **D:** a DigLog is written for every link the dig *visits* (outcome known), not for skipped links (no label). New message `DIGLOGS_APPEND` is internal (offscreen -> background).
- Real CS300 walk: 40 docs read fine. The course's Pages index is hidden from students (404), so the root no longer links it; 401/403/404 from Canvas = empty node (`canvasDoc` returns null). The real syllabus there is a page (`/pages/syllabus-2`), not the Syllabus tab. **D:** CS300 has no PDFs in modules, so the demo course needs to be one with PDFs.
- **B:** `canvasDoc` calls your `fromPdf(downloadUrl)` for Canvas PDFs. The URL is Canvas's `files/:id/download?...verifier=` link, which redirects to file storage; fetch it with `credentials: 'include'`. Please use `safeGet` from `sources/safety.ts` for the fetch.
- **Contract changes vs. the PRD (read before coding):**
  - `Hit` carries `url`, `text`, `locator` (not just `passageId`, `score`).
  - `Passage` has `url`. `Engine.search(query, k, url?)` scopes to one page; `Engine.remove(url)` drops a page.
  - `Engine.scoreLinks` returns `LinkScore[]` = `{ score, features }`, not `number[]`.
  - All engine methods are async. `Engine.weights()` returns the current weights.
  - `TreeEvent` has `t` (ms since dig start) and optional `hit` (click target).
  - Extra message `OPEN_SEARCH` (background -> content). Background -> offscreen uses `OffscreenEnvelope`; nobody else needs it.
- **C:** `extension/src/content/`, `sidepanel/`, `pdfviewer/` hold A's throwaway placeholders. Replace them wholesale. Content scripts are built as one IIFE (`vite.content.config.ts`), so no dynamic imports there. PDF viewer URL shape I'll open: `src/pdfviewer/index.html?url=&page=&start=&end=`.
- **B:** export `createEngine(): Engine` from `extension/src/engine/index.ts`; the swap is one line in `extension/src/offscreen/engine.ts`. CSP already allows `'wasm-unsafe-eval'`. Engine files under `dist/engine/*` are web-accessible if you need them.
- Build: `npm run build` = typecheck + pages/worker build + content IIFE build.
