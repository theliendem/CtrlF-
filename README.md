# Ctrl+F++

Ctrl+F rebuilt. Type what you're looking for ("info on midterm 2"). Ctrl+F++ highlights matches on the page you're on, then digs through the relevant links, subpages and files (PDF, PPTX, DOCX) behind it. The dig plays out live as a tree in Chrome's side panel.

Everything runs on your laptop: a small sentence-embedding model (all-MiniLM-L6-v2) scores the text, with no LLM and no page text sent to a server. The crawler is read-only and only makes GET requests.

Built at MadHacks 2026. The spec is [docs/PRD.md](docs/PRD.md).

## Run it

```bash
npm install
npm run build
```

Then go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and choose the `dist/` folder. Press Ctrl+Shift+F (Cmd+Shift+F on Mac) to open the side panel.
