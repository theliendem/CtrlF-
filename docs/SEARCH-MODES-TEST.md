# Search mode test

Reload Ctrl+F++ at `chrome://extensions`, refresh Canvas, and open the side panel.

1. Open the gear. **Search mode** should default to **Exact**, including when upgrading existing saved settings. Keep 200 pages and depth 5, then save.
2. On MATH345 Modules, search a literal phrase you know appears inside a PDF or nested page, even if its link title does not mention that phrase. Use `midterm 2`, for example, only if that exact phrase exists in the text. Do not add conversational words like `info on` unless those words are in the document too.
3. Expect unrelatedly titled links to be read, not dropped. Modules with more than 15 eligible links should queue all of them. The dig can still stop at the saved page/depth limits. Blocked routes, navigation, footer and off-site links remain excluded.
4. A matching page should highlight only the typed phrase, including repeated occurrences and different capitalization. A matching PDF should show its page number. Its filename does not need to match the query.
5. Select **Semantic (coming soon)**, save, and submit a search. Expect **Semantic search is not available yet. Choose Exact in settings.** No page reads, crawling, or model scoring should start.
6. Close and reopen the panel. Confirm Semantic remains selected, then switch back to Exact and save. Searching should work again.

This change applies to the existing Canvas crawler and supported PDF/PPTX/DOCX files. General website crawling is still milestone 6. PDF hyperlinks pointing back to supported same-course Canvas pages/files are also eligible for the queue.

## Graph cleanup

After reloading the extension, run a search with matching and nonmatching branches. Dead gray nodes should fade and disappear after a random 0.5–1 second delay. Gray parents must stay while any descendant is green, yellow or waiting. When the last potentially useful descendant is ruled out, that branch can disappear too. Search counters and result cards must remain unchanged by this visual cleanup. Start a second search while nodes are fading and confirm old timers do not remove its new nodes.

## Branch rotation and gradual reveal

Search from Modules with several modules available. The graph should not display a wall of waiting nodes. Nodes appear when their actual reads start. The queue chooses 1–3 random siblings, then switches to another parent when one is available, with up to four reads in flight. A gray parent with hidden waiting children must stay visible. Stop should keep found results, cancel remaining reads, and never reveal the hidden backlog. Exact search still queues all eligible links; the same page/depth limits apply.
