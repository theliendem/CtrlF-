# Ctrl F++

Ctrl+F rebuilt. Type what you're looking for ("info on midterm 2"). Ctrl F++ highlights matches on the page you're on, then digs through the relevant links, subpages and files (PDF, PPTX, DOCX) behind it. The dig plays out live as a tree in the browser's sidebar.

Everything runs on your laptop: a sentence-embedding model (all-MiniLM-L6-v2) finds candidate passages, then a local cross encoder (ms-marco-MiniLM-L-6-v2) reranks them, with no LLM and no page text sent to a server. The crawler is read-only and only makes GET requests.

Built at MadHacks 2026. The spec is [docs/PRD.md](docs/PRD.md).

## Run it in Firefox

Firefox is the main development target (Firefox 140 or newer).

```bash
npm install
npm run build
```

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Click the extension's toolbar icon or press Ctrl+Shift+F (Cmd+Shift+F on Mac) to open the sidebar. Allow access to the sites you want to search if Firefox asks.

In Firefox and Zen, Canvas API requests use the signed-in session of the course tab where you started the search, including container tabs. Keep that tab open while the dig runs. After updating or reloading the extension, reload the Canvas tab too.

Temporary add-ons are removed when Firefox closes. Load the manifest again next time. A permanent installation requires a Mozilla-signed release.

## Develop and build

| Command | Target | Output |
| --- | --- | --- |
| `npm run dev` | Firefox, rebuild on save | `dist/firefox/` |
| `npm run dev:chrome` | Chrome with live reload | `dist/chrome/` |
| `npm run build` | Firefox production build | `dist/firefox/` |
| `npm run build:chrome` | Chrome production build | `dist/chrome/` |
| `npm run build:all` | Both production builds | Both folders |

For Firefox, `npm run dev` downloads the model if needed and rebuilds when you save. Click **Reload** for Ctrl F++ in `about:debugging` after a rebuild, then reload the web page you are testing.

For Chrome, run a production build once to download the model before starting the dev server. Keep the server running while using a development build. Reload the extension after changing its manifest.

For Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose `dist/chrome/`.

The source is shared. Firefox uses its native sidebar and runs the engine in a background event page. Chrome uses its side panel and an offscreen engine document. Both use the same on-device models, parsers, and search logic.

Run `npm test`, `npm run test:models`, and `npm run build:all` before releasing changes to either browser.

Semantic search preserves nearby context and sizes passages with the actual tokenizer. Run `npm run eval:semantic` for the 30-query accuracy benchmark. See [semantic search scoring and evaluation](docs/SEMANTIC-SEARCH.md) for measured results, calibration, and adding private course examples.

### Search caching

Search content stays in memory, with a 16 MiB estimated data budget split across content, embeddings, and reranker scores. Linked content expires after five minutes. Use **Refresh content** to fetch updates and repeat your query. The active page is extracted on every search. The mode selector beside the search box switches between Semantic and Exact for the next search.
