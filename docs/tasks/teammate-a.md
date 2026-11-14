# Teammate A (Neil): scaffold, sources, crawler, integration

You own the skeleton everyone else builds on, the Canvas and HTML sources, the crawler, and putting the pieces together. B and C are blocked on Task 0, so do it first and push it fast. Read CLAUDE.md and docs/PRD.md before starting.

## Task 0: scaffold and contracts (first hour, push as soon as it builds)

1. **Repo skeleton.** Create the folder layout from the ownership table in CLAUDE.md, with an empty index file in each source folder so imports resolve.
2. **Extension build.** extension/ is a Manifest V3 extension built with Vite and TypeScript. Separate entry points for background (service worker), offscreen, content, sidepanel and pdfviewer. `npm run build` outputs to extension/dist/, which loads with "Load unpacked."
3. **manifest.json.**
   - Permissions: storage, sidePanel, offscreen, scripting, activeTab.
   - host_permissions: https://canvas.wisc.edu/*
   - optional_host_permissions: <all_urls> (requested at runtime for other sites)
   - A content script on all frames for http and https pages
   - Side panel default path
   - A command "open-search" with suggested key Ctrl+Shift+F (Command+Shift+F on Mac)
   - web_accessible_resources for the PDF viewer and engine files
4. **shared/contracts.ts.** Copy the types from the PRD's contracts (Locator, Passage, LinkRef, SourceDoc, Hit, NodeState, TreeEvent, DigLog). Add:
   - `LinkWeights = { version: string; bias: number; relevance: number; depth: number; isPdf: number; isSyllabus: number; keywordHits: number; minScore: number; hitScore: number }`. Link score = sigmoid(bias + the weighted sum of the features).
   - `TestQuery = { id: string; question: string; answerText: string; url: string; pdfPage: number | null; depth: number; phase: 1 | 2; demo: boolean }`
   - `DigSettings = { scope: 'same-site' | 'any'; maxDepth: number; pageBudget: number }`, defaults `{ 'same-site', 5, 60 }`
   - A discriminated union `Msg` for every runtime message: SEARCH_PAGE, SEARCH_RESULTS, OPEN_LOCATOR, START_DIG, STOP_DIG, RESUME_DIG, TREE_EVENT, DIG_DONE, EXPORT_DIGLOGS, DIGLOGS_FILE, ENGINE_READY.
5. **shared/engine-api.ts and shared/engine-stub.ts.** The engine interface:
   - `init()`
   - `chunk(text) -> string[]`
   - `embed(texts) -> Float32Array[]`
   - `indexAdd(passages, vectors)`
   - `search(query, k) -> Hit[]`
   - `scoreLinks(query, links, depth) -> number[]`
   - `loadWeights(w: LinkWeights)`

   The stub implements the same interface with plain keyword overlap, so A, C and D can run everything before B is done.
6. **Synthetic fixtures** in shared/fixtures/synthetic/:
   - a saved Canvas-style syllabus page (HTML)
   - a fake course as SourceDoc[] (modules, pages, one PDF with page numbers)
   - tree-events.json: a 20-second dig with millisecond timestamps, covering all six node states
   - diglogs-sample.json: about 300 synthetic DigLog rows, so D can start Databricks
   - link-weights.default.json: hand-set weights
7. **Status files.** Create docs/status/teammate-a.md through teammate-d.md from the template (Works now / Next / Needs from others / Notes).
8. **Verify, then merge.** `npm run build` passes, the extension loads in Chrome, and the side panel opens with a placeholder. Push it on a branch (`a/scaffold`), open a PR titled `[A] scaffold, contracts, stub engine, fixtures`, and merge it. Tell your human to tell B and C to start.

## Task A2: sources (extension/src/sources/, except pdf.ts)

- `fromHtml(html, url): SourceDoc`. Readable text (skip nav, scripts and footers), passages of one to three sentences, and links with context: anchor text, title attribute, URL path words, and the nearest heading and sentence.
- `fromCanvas(courseId, origin): AsyncIterable<SourceDoc>`. Uses the Canvas API endpoints in the PRD with `credentials: 'include'`. GET only. Strip a `while(1);` prefix. Follow Link-header pagination. Module items become links, so the tree mirrors the course. PDF files become links that pdf.ts handles.
- The skip list from the PRD lives here as one exported function, `isSafeToFetch(url, linkText)`.
- **Test the very first Canvas API call from the extension in your first 15 minutes on this task.** If the login cookie doesn't carry over, tell your human right away; it's the biggest project risk.
- Use D's real captures in shared/fixtures/canvas/ for tests as soon as they land.

## Task A3: offscreen engine host and crawler

- **Offscreen document** (extension/src/offscreen/): loads the engine (B's real one when its status says ready, the stub until then), handles SEARCH_PAGE from the content script, and does all fetching and parsing for the crawl.
- **Service worker** (extension/src/background/): creates the offscreen document, routes messages, and runs the best-first crawl:
  - a priority queue keyed by link score
  - DigSettings defaults; 4 fetches at once; an 8-second timeout
  - stops after 3 strong hits and asks to keep digging
  - emits a TreeEvent on every node state change
  - records a DigLog for every scored link
- Handle EXPORT_DIGLOGS by returning the session's logs as a JSON file download (D uploads it to Databricks).
- Load weights in this order: databricks/link-weights.json (copied into the build), then the synthetic default.

## Task A4: integration (6 PM and midnight checkpoints)

- At each checkpoint: pull, build, load in Chrome, and run D's test queries end to end. Write the results in your status file, and post what's broken to the relevant teammate's "Needs from others."
- Swap the stub for B's real engine when B's status says it's ready.
- After the Sunday 6 AM freeze: bug fixes only.

## Done when

All of the PRD's demo checklist runs end to end on the demo course from a fresh "Load unpacked."
