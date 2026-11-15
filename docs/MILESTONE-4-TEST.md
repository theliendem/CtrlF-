# File search: Chrome check

## What changed

Canvas PDF, PPTX and DOCX links now enter the search queue. PDF pages and PowerPoint slides are read in order; a file turns green as soon as a section matches. Its result can update if a later section scores higher. Word reads body paragraphs and tables.

Clicking a file result opens the Canvas page or module where it was found and highlights the file link. PDF results also have an **Open at page N** button. Scans, images, old `.ppt`/`.doc` files, locked files and files over 50 MB are skipped. The **Show unreadable files** setting controls their gray nodes.

## Reload

1. At `chrome://extensions`, reload **Ctrl F++**.
2. Refresh the MATH345 tab, then open the panel with **Cmd+Shift+F**.
3. In settings, keep the page limit at **200**, depth at **5**, and enable **Show unreadable files** for this test. Save.

## PDF

1. On **MATH345 → Modules**, select Exact mode and search a literal phrase inside a text-based PDF. The file title does not need to match: Exact mode follows every safe supported content link within the page/depth limits.
2. Expect a PDF icon, a green node, a snippet from inside the file, and **Page N** in the result. A later page may replace the first result if it scores higher.
3. Click the result body. Expect a new Canvas tab showing the parent module/page, scrolling to the file link with its text highlighted yellow. The surrounding module text should remain uncolored.
4. Click **Open at page N**. Expect the PDF viewer to open at the numbered page. Confirm the snippet is actually on that page. If Chrome downloads the file instead, report that explicitly.

## PowerPoint and Word

- For a `.pptx`, search a phrase shared by its title and a slide. Expect the PowerPoint icon, a snippet, and **Slide N**. Check that number against the deck's actual slide order. Clicking the result should highlight the file link on its parent Canvas page.
- For a `.docx`, search a phrase shared by its title and body. Expect a Word icon and the matching text, without an invented page number. Clicking the result should highlight its parent-page link.
- If the course has no PPTX or DOCX, report that. Automated tests cover both formats; no course upload is needed for this check.

## Stop and unreadable files

- Stop a dig while a file is being read. Results already found should remain, and stopped work must not add later matches.
- A discovered scanned/unsupported file should appear gray with an explanation on hover. Turn **Show unreadable files** off, save, and repeat: the failed file node should disappear once the read attempt finishes.

Send the query, file type, displayed page/slide, whether the snippet was correct, and whether clicking highlighted the file link. For a failed file, include its hover error. Do not send signed download URLs, cookies or tokens.
