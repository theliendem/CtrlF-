# Teammate C: everything the user sees

You own the search bar and highlights on the page, the live dig tree in the side panel, and the PDF viewer. The dig tree is the centerpiece of the demo, so it has to look great. Read CLAUDE.md and docs/PRD.md (Phase 1 and "The live dig tree") before starting. You own extension/src/content/, extension/src/sidepanel/ and extension/src/pdfviewer/.

Start after Teammate A pushes Task 0. Build everything against the fixtures and the stub engine, so you never wait on A or B.

## Step 1: search bar and highlights (extension/src/content/)

- The "open-search" command (Ctrl+Shift+F) opens a small floating search bar at the top right of the page, styled so it can't be confused with the site's own UI. It's isolated in a shadow DOM so page CSS can't break it.
- Walk the visible text, send it to the engine through the SEARCH_PAGE message, and receive Hit[] with dom Locators.
- Highlight with the CSS Custom Highlight API. Never edit the page's HTML.
  - The best hit is bright and scrolled into view.
  - Other hits get lighter by score.
- Up and Down arrows (and Enter / Shift+Enter) move between hits with a "2 of 7" counter.
- Show "No close matches" when nothing clears the minimum score. Esc closes the bar and clears highlights.
- A "Dig deeper" button under the results sends START_DIG. It pulses when the best score is low.
- Handle OPEN_LOCATOR: scroll to the passage and highlight it (used when the side panel opens a hit).
- **Test** on shared/fixtures/synthetic/ (the saved syllabus page) and on a real Canvas page once A's sources are in.

## Step 2: the live dig tree (extension/src/sidepanel/)

Build it against shared/fixtures/synthetic/tree-events.json, replayed with its real timing, behind a "Replay demo" dev button. That way it's done before the crawler exists.

- A top-down tree with the start page as the root. New nodes animate in from their parent.
- The six node states, exactly as the PRD's table describes:
  - **skipped:** a faint stub
  - **queued:** an outlined circle
  - **digging:** pulsing
  - **dead:** grays out, shrinks to a dot, collapses after about 1.5 s
  - **relevant:** a warm glow that grows with score
  - **hit:** a bright glow with a one-line snippet
- Hover any node for its title, URL and best passage. Click a hit to send OPEN_LOCATOR. Pages open in a tab with the passage highlighted; PDFs open in your PDF viewer.
- A ranked hit list under the tree, plus Stop, Resume, a "Show dead ends" toggle, and a counter (pages searched, budget left, hits).
- An "Export dig logs" button that sends EXPORT_DIGLOGS (D uploads the file to Databricks).
- Settings: scope (same site or any site), depth (1 to 10, default 5), page budget (default 60).
- It has to stay smooth with 60 or more nodes. Collapse dead ends and keep labels only on hits by default.

## Step 3: PDF viewer (extension/src/pdfviewer/)

- An extension page that opens a PDF URL with pdf.js and renders the text layer.
- It accepts a pdf Locator (page plus character offsets, coordinated with B) and scrolls to and highlights that passage.
- It works with the same Ctrl+Shift+F search bar, so Phase 1 works inside PDFs too.

## Merge rhythm

Merge a PR after the search bar opens, after highlights work, after the tree replays from the fixture, and after every visual improvement. Put a GIF or a short description of what changed in your status file so A and D can see progress without pulling.

## Done when

- Replaying tree-events.json looks good enough to show judges.
- The search bar highlights fixture hits on a real Canvas page.
- Clicking a PDF hit opens the viewer on the right page with the passage highlighted.
