# Teammate A status

*Newest first. Update in every PR.*

## Works now

- **Canvas API works from the extension with the browser's login** (tested on a real course: 200, course JSON). No content-script fallback needed.
- `extension/src/sources/`: `loadDoc(url)` routes any URL (Canvas API / PDF / plain HTML). `canvasDoc(webUrl)` maps Canvas web URLs (home, syllabus, modules, module, pages, page, assignments, assignment, announcements, discussion topic, files) to API calls; links stay web URLs so the tree mirrors the course. `fromCanvas(courseId, origin)` walks a whole course. `fromHtml(html, url)`, `isSafeToFetch(url, text)`, `safeGet(url)` (GET-only, 8 s timeout, skip list).
- Offscreen console helpers: `await ctrlfpp.walk('<courseId>')`, `await ctrlfpp.probePdf('<courseId>')`, `await ctrlfpp.loadDoc(url)`.
- **Task 0 merged.** `cd extension && npm install && npm run build`, then Load unpacked on `extension/dist`.
- `shared/contracts.ts`, `shared/engine-api.ts`, `shared/engine-stub.ts` (keyword overlap, same interface as the real engine).
- Message routing: content -> `SEARCH_PAGE` -> background -> offscreen (stub engine) -> `SEARCH_RESULTS` reply. Ctrl+Shift+F (Cmd+Shift+F) sends `OPEN_SEARCH` to the tab.
- `START_DIG` replays `shared/fixtures/synthetic/tree-events.json` as live `TREE_EVENT`s, then `DIG_DONE` (stand-in until the crawler lands).
- Synthetic fixtures in `shared/fixtures/synthetic/`: `syllabus.html`, `course.json` (SourceDoc[], incl. a PDF with page locators), `tree-events.json` (20 s, all six states), `diglogs-sample.json` (300 rows, for D), `link-weights.default.json`. Regenerate with `node gen-fixtures.mjs .`.

## Next

- Check Canvas PDF downloads from the extension (redirect host), then A3: best-first crawler + TREE_EVENTs + DigLogs.

## Needs from others

- (none)

## Notes

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
