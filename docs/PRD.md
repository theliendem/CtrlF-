# Ctrl+F++ PRD

Nov 14, 2026 · Neil Dembla (Teammate A). Live version: https://claude.ai/artifact/7jLnHtqf3P89o46s9w6Pji

## Summary

Ctrl+F++ is a Chrome extension that finds what you mean, not just what you typed, and then digs through linked pages to find it when it isn't on the page you're on. We ship it in two phases, and Phase 2 is built on Phase 1.

- **Phase 1 (MVP): semantic find.** Type a sentence or loose phrase. Ctrl+F++ highlights the passages on the page that mean the same thing, even if they share no words with your query.
- **Phase 2: the dig.** Ctrl+F++ scores every link on the page for relevance, follows the promising ones, searches each page it lands on, and repeats. A live tree in a sidebar shows where it's going: dead ends gray out and shrink, hits glow.

**Problem.** Information people need is usually one to five clicks away from where they're looking, buried in a PDF, a module, or a page they didn't know existed. Regular Ctrl+F only matches exact letters on the current page. Canvas's own AI search skips uploaded files like PDFs and Word docs entirely.

**Positioning.** Other AI tools answer from what's open. Ctrl+F++ goes and gets what isn't, and shows you the exact line.

**MadHacks goal.** A working Phase 1 plus a working Phase 2 on Canvas, demoed live by Sunday 1:00 PM. Theme fit: "Ctrl+F stops at the page. Ctrl+F++ digs." Sponsor track: Databricks.

## Decision: run the model on-device

On-device is faster for Ctrl+F++, and it isn't close once Phase 2 is running. Cloud only wins on accuracy for hard queries, so it's an optional later add-on, not the core.

- **Every call skips the network.** A small local embedding model turns a sentence into a vector in milliseconds. A cloud call adds a round trip every time, and hackathon Wi-Fi is the worst case.
- **Phase 2 embeds a lot of text.** The dig visits dozens of pages and embeds every passage on each. A cloud API means uploading all of it, rate limits, and per-call cost.
- **Privacy.** Page text, including Canvas content, never leaves the laptop. (Databricks only receives opt-in dig logs, never page text. See the Databricks section.)

**Model:** a small sentence-embedding model such as all-MiniLM-L6-v2 (384-dimension vectors), quantized and bundled inside the extension so there's no download at demo time.

**Rust and WebAssembly.** Rust compiled to WASM handles everything around the model: splitting text into passages, the vector index and top-k search, link scoring, and crawl-queue math. For the model itself there are two options; we don't know yet which is faster on our laptops:

| Option | How it runs | Tradeoff |
| --- | --- | --- |
| Candle (Hugging Face's Rust ML library) compiled to WASM | CPU, with WASM SIMD | All Rust, one toolchain; CPU only |
| transformers.js (ONNX Runtime Web) called from JS | WebGPU, falls back to WASM | Can use the laptop GPU; mixed Rust and JS |

**Decision rule:** Teammate B spends at most 30 minutes benchmarking both (time to embed 500 passages). Use the winner for the model; Rust/WASM handles the index, scoring and crawl logic either way.

**Chrome detail:** Manifest V3 service workers get shut down when idle and have no DOMParser. The model, index, fetching and parsing run in an offscreen document (chrome.offscreen) so they stay loaded.

## Users and demo scope

Ctrl+F++ is built to work on any website, but Canvas has to work 100% before anything else gets polish.

| Priority | User | Example question |
| --- | --- | --- |
| 1 (demo) | A student in a Canvas course | "Can I use a calculator on the midterm?" |
| 2 | Anyone reading a long or nested site (docs, government pages, apartment portals) | "How do I appeal a parking ticket?" |

**Rule:** when a choice comes up between "works great on Canvas" and "works okay everywhere," pick Canvas until Sunday 6 AM.

## Phase 1 MVP: semantic in-page find

The user types a sentence or loose phrase, and Ctrl+F++ highlights the passages on the current page that mean the same thing, ranked, even with zero shared words. Example: "can I turn stuff in late" finds "Assignments submitted after the deadline lose 10% per day."

**How it works:**

1. The user opens the search bar with a shortcut. Chrome doesn't let extensions take over plain Ctrl+F, so the default is Ctrl+Shift+F (Cmd+Shift+F on Mac), changeable by the user.
2. A content script walks the page's visible text, splits it into passages of one to three sentences, and remembers where each one sits.
3. Passages get embedded and cached for that URL. If the page changes, only new or edited passages get re-embedded.
4. On Enter (and as the user types, after a short pause), the query gets embedded and compared against every passage.
5. Score = meaning similarity plus a small boost for exact word matches, so typing a literal word still behaves like normal Ctrl+F.
6. Matches above a minimum score get highlighted. The best one is bright and scrolled into view, weaker ones are lighter, and arrow keys move between them ("2 of 7").

| ID | Requirement | Priority |
| --- | --- | --- |
| P1-1 | Search bar opens with a shortcut; Esc closes and clears highlights | P0 |
| P1-2 | Finds passages by meaning with no shared words required | P0 |
| P1-3 | Highlights without editing the page's HTML (CSS Custom Highlight API), so sites don't break | P0 |
| P1-4 | Results ranked by score; next and previous navigation with a match counter | P0 |
| P1-5 | Shows "No close matches" instead of weak junk when nothing clears the minimum score | P0 |
| P1-6 | Works on Canvas pages, syllabus, announcements and assignment descriptions | P0 |
| P1-7 | Exact-word matches still rank at the top | P1 |
| P1-8 | Re-indexes when the page changes | P1 |
| P1-9 | Searches inside frames on the page | P1 |
| P1-10 | PDFs open in a Ctrl+F++ viewer (pdf.js) so they can be searched and highlighted; Chrome's built-in PDF viewer can't be scripted by extensions | P1 |
| P1-11 | Hover a highlight to see its match score | P2 |

**Targets:** results within 300 ms of Enter on an indexed page; a typical Canvas page indexed within 3 seconds.

**Done when:** on three real Canvas pages, five questions with no word overlap each put the right passage in the top 3.

## Phase 2: the dig

When the answer isn't on the current page, Ctrl+F++ scores every link for relevance, follows the most promising ones, searches each page it lands on, and repeats, while a live tree in the sidebar shows what it's doing. It reuses Phase 1's model, chunking and scoring.

### Starting a dig

- A "Dig deeper" button sits under the Phase 1 results.
- If the best match on the current page scores low, the button pulses as a hint. It never starts a dig on its own.

### Deciding which links are worth opening

The "lightweight ML model" is the same embedding model from Phase 1, plus a small learned weighting (see Databricks).

1. Collect every link on the page; drop duplicates and same-page anchors.
2. Build each link's context: anchor text, title attribute, words in the URL path, and the nearest heading and sentence.
3. Embed that context and compare it to the query: a relevance score from 0 to 1.
4. Combine with features using weights from link-weights.json: PDF bonus, syllabus bonus, keyword hits, depth penalty. Until Databricks produces learned weights, use hand-set defaults.
5. Links under the minimum score are never opened. They show in the tree as faint stubs.

### Crawl rules

| Setting | Default | User can change? |
| --- | --- | --- |
| Scope | Same site only | Yes: any site |
| Depth | 5 levels | Yes: 1 to 10 |
| Page budget | 60 pages | Yes |
| Pages fetched at once | 4 | No |
| Timeout per page | 8 seconds | No |
| Stop early | After 3 strong hits, ask "Keep digging?" | Yes |

- **Order:** best-first. The highest-scoring unvisited link anywhere in the tree goes next.
- **Read-only, always:** GET requests only. Never click buttons, submit forms, or open anything that changes state. Skip links containing logout, delete, submit, take, or start quiz.
- Depth 5 can mean thousands of links, so the page budget is the real limit.

### Searching each page

- Fetch with the user's existing login, extract readable text, split and embed like Phase 1.
- A page's score is its best passage's score.
- JavaScript-built pages come back nearly empty from a plain fetch. On Canvas, use the Canvas API. Elsewhere, fall back to a hidden background tab (P1).

### The live dig tree (side panel)

The tree lives in Chrome's side panel and updates in real time. The starting page is the root at the top.

| Node state | Looks like | Trigger |
| --- | --- | --- |
| skipped | Faint short stub, no label | Link scored under the minimum, never opened |
| queued | Outlined circle | Scored high enough, waiting its turn |
| digging | Pulsing circle, label shown | Being fetched and searched now |
| dead | Fades to gray, shrinks to a dot, collapses after about 1.5 s | Searched, nothing relevant, no good links left |
| relevant | Warm glow, size grows with score | Has a passage above the minimum score |
| hit | Bright glow plus a one-line passage preview | Passage above the strong-hit score |

**Interactions:** hover a node for title, URL and best passage; click a hit to open it scrolled to the passage and highlighted (text-fragment links for pages, the Ctrl+F++ PDF viewer for PDFs); a ranked hit list under the tree; Stop and Resume; a "Show dead ends" toggle; a counter of pages searched, budget left, and hits found.

| ID | Requirement | Priority |
| --- | --- | --- |
| P2-1 | Links scored by relevance; best-first crawl with depth, budget and scope settings | P0 |
| P2-2 | Read-only crawling with the skip list | P0 |
| P2-3 | Live tree showing all six node states with animated transitions | P0 |
| P2-4 | Clicking a hit opens the page with the passage highlighted | P0 |
| P2-5 | Works across a full Canvas course: modules, pages, announcements, syllabus, PDFs | P0 |
| P2-6 | Ranked hit list under the tree | P1 |
| P2-7 | Stop, Resume and "Show dead ends" controls | P1 |
| P2-8 | Hidden-tab fallback for JavaScript-built pages outside Canvas | P1 |
| P2-9 | Results cached per course | P1 |
| P2-10 | Contradiction finder: flags when two hits give different dates or rules for the same thing | P2 |

**Done when:** from a Canvas course home page, three questions whose answers sit two or more levels deep (at least one inside a PDF) each end with the right hit glowing within 20 seconds.

### Databricks (sponsor track)

Every dig logs which links it followed and whether they paid off. Databricks trains a better link scorer from those logs, and the extension ships with the learned weights. A dashboard on the same data shows where people get lost.

1. **Dig logs.** For each scored link, log a DigLog (see contracts). Opt-in. For the demo, only the team's own digs.
2. **Delta table.** The extension exports logs as a JSON file; Teammate D uploads it into a Delta table in Databricks Free Edition. Live push via REST API is P1 (needs a token in the extension).
3. **Train the link scorer.** A notebook fits a logistic regression predicting "will this link lead to a hit?" and exports databricks/link-weights.json, which the engine loads.
4. **"Where students get lost" dashboard.** Most-asked questions, average depth to an answer, most common dead-end pages, PDFs that hold the most answers.

**Privacy line:** the search stays on the laptop. Only opt-in dig logs (queries, scores and link features, never full page text) go to Databricks.

| ID | Requirement | Priority |
| --- | --- | --- |
| DB-1 | Extension exports dig logs as JSON | P0 |
| DB-2 | Logs in a Delta table; notebook trains the scorer and exports weights | P0 |
| DB-3 | Engine loads the exported weights | P0 |
| DB-4 | "Where students get lost" dashboard | P0 |
| DB-5 | Live log upload from the extension | P1 |

**Done when:** a before-and-after on the same demo question shows the learned scorer reaching the hit in fewer pages than the hand-set one.

## Architecture

```
 Content script            Service worker              Side panel
 (search bar,      <---->  (routes messages,   <---->  (live dig tree,
  highlights,               crawl queue,                hit list,
  reads page text)          settings)                   Stop/Resume)
                                 ^
                                 |
                                 v
                 Offscreen document: the engine
                 - fetches and parses pages, pdf.js for PDFs
                 - model + Rust/WASM: chunk, embed, index, score
                       ^            ^            ^
                       |            |            |
                Canvas REST API  Same-site pages  PDF files
```

Pages, Canvas API responses and PDFs all go into the engine; only scores, passages and tree updates come out.

## Contracts

The source of truth is shared/contracts.ts (message types, Passage, Hit, TreeEvent, DigLog, LinkWeights) and shared/engine-api.ts (the engine interface). The live PRD doc's type sketch is older than those files; where they differ, the code wins.

## Canvas specifics

On Canvas, dig through the Canvas REST API instead of scraping pages. It works with the browser's existing login, returns clean text, and the course structure (modules, items, files) maps straight onto the dig tree.

| Content | Endpoint (all GET) |
| --- | --- |
| Syllabus | /api/v1/courses/:id?include[]=syllabus_body |
| Modules and items | /api/v1/courses/:id/modules?include[]=items |
| Pages | /api/v1/courses/:id/pages/:url |
| Announcements | /api/v1/announcements?context_codes[]=course_:id |
| Assignments | /api/v1/courses/:id/assignments |
| Files (PDFs) | /api/v1/courses/:id/files/:file_id (gives the download URL) |

- Detect Canvas by the /courses/:id URL pattern and switch to API mode.
- Strip a `while(1);` prefix from JSON responses if present.
- Follow pagination links in the Link response header.
- PDFs: download with the session, extract text with pdf.js, record the page number for each passage.
- Never fetched: quizzes, submissions, grades, inbox, people lists.

## Non-goals and risks

**Not building this weekend:** AI-written answers or chat, browsers other than Chrome, mobile, accounts or sync, anything that writes to a site.

| Risk | Mitigation |
| --- | --- |
| Model too slow in the browser | 30-minute benchmark; quantized model; WebGPU if it wins; cache embeddings |
| Canvas API calls fail from the extension | Test one call in hour one before building on it |
| JavaScript-built pages come back empty | Canvas API on Canvas; hidden-tab fallback elsewhere (P1) |
| Crawl runs away | Page budget, best-first, minimum link score, Stop |
| Crawler triggers something | GET only, skip list, Canvas no-go list |
| Wrong passage with confidence | Minimum score, "No close matches", always show the real passage |
| Permission prompt scares users | Site access only where the user turns it on, Canvas first |
| Tree too busy | Dead ends collapse, skipped links faint, only hits labeled by default |
| Demo Wi-Fi dies | Runs locally, warm cache, backup video |

## Team and build plan

| Teammate | Tools | Tasks, in order |
| --- | --- | --- |
| A (Neil) | Claude Code | Scaffold and contracts; HTML and Canvas sources; offscreen engine host and crawler; integration and dig-log export |
| B | Claude Code | Model benchmark; Rust/WASM engine; PDF text extraction; loading link weights |
| C | Claude Code | Search bar and highlights; live dig tree; PDF viewer |
| D | Browser, GitHub web, Databricks | Real Canvas captures and the test question set; Databricks pipeline and dashboard; testing; Devpost, pitch, backup video |

Task details: docs/tasks/teammate-a.md through teammate-d.md. Team rules: CLAUDE.md.

**Timeline:**

1. Saturday, first hour: A's Task 0 merged to main; B's benchmark result in docs/status/teammate-b.md; D's Canvas captures uploaded.
2. Saturday 6 PM checkpoint: Phase 1 works end to end on a Canvas page.
3. Saturday midnight checkpoint: the crawler finds a PDF answer two levels deep and the tree draws it.
4. Sunday 6 AM: animations, click-to-highlight and the Databricks dashboard done. Feature freeze.
5. Sunday 9 AM: backup video recorded; demo rehearsed at least 10 times.
6. Sunday 11 AM: submitted on Devpost (deadline 12:00 PM).

## Demo checklist

- [ ] Phase 1: a no-shared-words query highlights the right passage on a Canvas page
- [ ] Phase 2: a PDF answer two or more levels deep glows in the tree within 20 seconds
- [ ] Clicking that hit opens the PDF on the right page, highlighted
- [ ] One dig on a non-Canvas site works
- [ ] Works with Wi-Fi off after the cache is warm
- [ ] Databricks before/after and dashboard ready
- [ ] Backup video recorded
- [ ] Devpost submitted by 11 AM Sunday

**60-second demo:** Ctrl+Shift+F on a Canvas page; a loose question finds the passage with no shared words. Ask something not on the page, press Dig deeper, and let judges watch the tree branch, gray out dead ends, and glow on the PDF. Click it, land on the highlighted sentence. Turn Wi-Fi off and do it again.
