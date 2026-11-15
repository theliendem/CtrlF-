# Ctrl+F++ PRD (v2)

Nov 14, 2026 · Neil Dembla · MadHacks 2026 · Replaces the earlier two-phase PRD

**Search modes:** Semantic is the default. It scores passages by meaning (on-device MiniLM) plus the query's exact words, and digs best-first through the links closest to the question, as described below. Exact is a settings option: it searches literal phrases (case-insensitive, whitespace-tolerant) and recursively follows every safe supported content link, including files, without relevance filtering or the 15-link cap. Both modes keep the page/depth limits, same-site restrictions and blocked routes.

**Traversal/display update (Neil's request):** Read random groups of 1–3 sibling links, switching parents between groups when another branch is available. Keep up to four reads in flight. Reveal nodes as their reads begin, not when all links are queued; invisible waiting children still protect their ancestors from graph cleanup.

## What it is

Ctrl+F++ is Ctrl+F rebuilt. You type what you're looking for ("info on midterm 2"), and it searches the page you're on, then digs recursively through the relevant links, files and subpages behind it. The whole dig plays out live as a tree in Chrome's side panel. Everything runs on your laptop with a lightweight ML model, so there's no LLM and no page text sent to a server.

**Theme fit ("Let's Dig In"):** Ctrl+F stops at the page. Ctrl+F++ digs.

**Demo-first rule:** this build exists to win a live demo on a known Canvas course. Edge cases get skipped, not solved. Every skipped case is marked in code with `// LATER:` and listed in docs/LATER.md, so it can be added after the hackathon.

## The flow, end to end

1. The user presses Ctrl+Shift+F (Cmd+Shift+F on Mac). The side panel opens with the cursor in the search box.
2. They type a phrase and press Enter.
3. **Current page first.** The page's text is extracted, split into passages and scored. Relevant passages are highlighted on the page right away, and the page appears as the root node of the tree.
4. **Always dig.** Even if the current page has matches, the dig continues. (LATER: a settings toggle for "stop if the current page has a strong match.")
5. **Choosing links.**
   - Every link on the page passes a free filter first (no nav, account or logout links, no help pages, nothing already visited, no same-page anchors, no off-site links).
   - The survivors get a quick peek: title and headings only, capped at the top 15 links per page.
   - Links that score high enough after the peek join the queue.
   - Exception: every link on the start page, and every item on a Canvas module or list page, joins the queue regardless of score or the cap, because titles like "U2 homework" don't say what's inside. They're still ordered by score.
6. **Digging.** The queue is best-first: the highest-scoring unvisited link anywhere in the tree goes next. Each opened page is extracted, scored and highlighted in the tree, and its links go through step 5.
   - **Stopping early (Semantic).** Once 3 pages below the start page have a strong hit (score 0.45 or more), no new reads start and the status says it stopped early. A "Keep searching" link next to the status resumes the same queue to the end, with no further early stops. Exact always runs to the end.
7. **Files.** PDF, PowerPoint (.pptx) and Word (.docx) files found on a page become child nodes. They're read page by page or slide by slide, and the node turns green as soon as any part matches.
8. **Stopping.** The dig stops when it hits the page budget, when no unvisited link scores high enough, or when the user presses Stop.
9. **Results.** Green nodes appear in the tree and in a small scrollable list under it. Clicking one opens it with the relevant parts highlighted.

## The engine

- **Model:** all-MiniLM-L6-v2 (a small sentence-embedding model, 384 dimensions), quantized and bundled in the extension. It runs through transformers.js in an offscreen document, on WebGPU with a WASM fallback. No downloads at runtime.
- **Language:** TypeScript for the whole engine in this build. LATER: port scoring and the index to Rust compiled to WebAssembly if it turns out to be a bottleneck.
- **Passages:** text split into one to three sentences, about 25 to 80 words.
- **Passage score (hybrid):** 0.7 × cosine similarity + 0.3 × keyword score. The keyword score counts exact query terms, and numbers must match exactly, so "midterm 2" never matches "midterm 1". Tune the weights against the demo questions.
- **Thresholds:**
  - **relevant:** passage score ≥ 0.45. The node is green and the passage gets highlighted.
  - **strong:** passage score ≥ 0.6. Used to rank the results list.

  Starting values; tune on the demo course.
- **Link score:** the same hybrid score, run on the link's anchor text, URL path words and nearest heading, plus the peeked title and headings, with a small penalty per level of depth. Links under 0.3 are dropped.
- **Embedding cache:** embeddings are cached per URL, so a second search on the same course is fast.

## Opening and reading pages

| Where | How | Notes |
| --- | --- | --- |
| Canvas (canvas.wisc.edu) | Canvas REST API, with the browser's login (credentials: 'include') | Strip a `while(1);` prefix; follow Link-header pagination |
| Other sites | Fetch the HTML from the offscreen document | If the extracted text is nearly empty (a JavaScript-built page), fall back to a real tab in a minimized window, read it, close it |
| Off-site links | Not followed | Settings toggle: hide them, or show them as gray "not followed" stubs |

**Canvas endpoints (all GET):**
- syllabus: /api/v1/courses/:id?include[]=syllabus_body
- modules and items: /api/v1/courses/:id/modules?include[]=items&per_page=100
- pages: /api/v1/courses/:id/pages/:url
- announcements: /api/v1/announcements?context_codes[]=course_:id
- assignments: /api/v1/courses/:id/assignments
- files: /api/v1/courses/:id/files/:file_id (gives the download URL)

Module and item titles count as the peek on Canvas, so no extra fetch is needed.

**Read-only, always:** GET requests only. Never click buttons, submit forms, or open anything that changes state. Never fetch quizzes, submissions, grades, the inbox or people pages. Skip links containing logout, delete, submit, take or start quiz.

## Files

| Type | How it's read | Clicking a green file node |
| --- | --- | --- |
| PDF | pdf.js, page by page | Opens the PDF itself: a Canvas file opens on its preview page in Canvas's viewer; other PDFs open in Chrome's viewer at the hit's page (#page=4). The sidebar card shows "Page 4" plus the snippet. Neither viewer can be scripted, so the passage isn't highlighted inside the file |
| PowerPoint (.pptx) | Unzip (JSZip), read slide XML in order | Same, with "Slide 14" plus the snippet |
| Word (.docx) | Unzip (JSZip), read document XML | Same, with the snippet |

- **Skipped:** PDFs with no text (scans), images, the old .ppt and .doc formats.
- **Settings toggle:** hide unreadable files, or show them as gray "can't read" nodes.
- LATER: OCR for scans, an in-extension PDF viewer with in-file highlighting.

## The side panel

**Layout, top to bottom:**
1. Search box, with a Stop button while a dig runs and a settings gear.
2. A counter line: pages searched, pages ruled out, green found.
3. The live graph, taking most of the height.
4. A small scrollable results list: each green node's title, type icon, a one-line snippet and its page or slide number. Click to open.

**The graph:**
- Horizontal. The root is on the left and branches grow to the right, with siblings stacked vertically.
- Nodes are small circles with connecting lines. Only green nodes show labels; every node shows its title and URL on hover.
- The view pans and zooms smoothly to follow wherever the dig is working.
- Constant smooth motion: nodes slide in from their parent, the layout re-flows with easing, and nothing jumps or snaps. It should look busy but stay easy to watch.

| State | Look |
| --- | --- |
| queued | Small hollow circle |
| reading | Yellow, gently pulsing |
| relevant (hit) | Bright green, with a label |
| trail | Faint green: every ancestor of a hit, so you can see the path that found it |
| ruled out | Fades to gray, shrinks and disappears over about a second while the tree re-flows around it |
| not followed / can't read | Gray stub (only if the settings toggles say to show them) |

**Clicking:**
- A green page node opens that page in a new tab and highlights the relevant passages (CSS Custom Highlight API; never edits the page's HTML).
- A green file node works as described in Files.

## On-page highlighting

- Highlights use the CSS Custom Highlight API, so the page's HTML is never edited.
- The best match is brighter and scrolled into view, and the others are lighter.
- This works on the current page and on any page opened from the tree. The content script gets the query and passage texts, finds them in the DOM and highlights them.
- Search again or press Esc in the side panel to clear the highlights.

## Settings

- Depth: 1 to 10, default 5
- Page budget: default 200, adjustable from 1 to 1,000 (updated at Neil's request)
- Off-site links: hidden (default), or shown as "not followed"
- Unreadable files: hidden (default), or shown as gray

Fixed in code: 15 peeks per page, 4 pages fetched at once, an 8-second timeout per page.

## Architecture

```
 Content script                 Service worker                  Side panel
 (reads page text,     <---->   (routes messages,      <---->   (search box, live graph,
  highlights passages)           best-first queue,               results list, settings)
                                 settings)
                                     ^
                                     v
                     Offscreen document: the engine
                     - model (transformers.js), passage + link scoring, cache
                     - fetch + parse HTML, Canvas API, pdf.js, JSZip
```

Why the offscreen document: Manifest V3 service workers get shut down when idle and can't parse HTML, so the model, parsing and fetching live in the offscreen document.

## Build milestones (commit and push after each, and in between)

1. **Scaffold.** MV3 extension with Vite and TypeScript. Ctrl+Shift+F opens the side panel with the search box focused. Loads with "Load unpacked."
2. **Current page.** Extract, chunk, embed, hybrid-score, highlight on the page, show the root node, list results.
3. **Canvas dig.** API source, peek via titles, best-first queue, node events, a basic graph.
4. **Files.** PDF, PPTX and DOCX reading, file nodes, click behavior.
5. **Graph polish.** Horizontal layout, smooth re-flow, pulsing yellow, trail, fade-out, follow camera, counter.
6. **Other sites.** HTML fetch, empty-page fallback to a minimized tab, the off-site rule.
7. **Settings.** The four settings and both toggles.
8. **Demo hardening.** Run the demo questions on the demo course until they pass every time; warm the cache; record a backup video.

**Deadlines:**
- Feature freeze Sunday 6 AM
- Submit on Devpost by 11 AM Sunday (the hard deadline is 12:00 PM)

## Demo

Run it on one known Canvas course with three or so prepared questions whose answers sit two or more levels deep, at least one inside a PDF or slide deck.

1. Ctrl+Shift+F, then type the question.
2. The current page lights up with highlights.
3. The tree spreads right, yellow nodes pulse, gray ones fade away, and green ones light up with their trails.
4. Click a green PDF node: the PDF opens in Canvas's viewer, and the card says "Page 4".
5. Show the results list.
6. Turn Wi-Fi off and run it again from the cache to prove it's on-device.

## Parked

- **Databricks:** for now it may host the project website only. It plays no part in a search. Decide before Devpost whether to enter the Databricks track at all.

## Later (not this weekend)

- Toggle: stop when the current page already has a strong match
- OCR for scanned PDFs and images; .ppt and .doc formats
- Following off-site links (Google Docs, Box) with their own logins
- An in-extension PDF viewer with in-file highlighting
- Rust/WASM engine
- Databricks-trained link scorer and analytics dashboard
- Contradiction finder (two sources giving different dates for the same thing)
