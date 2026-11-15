# Later

Skipped for the MadHacks demo. Each item has a `// LATER:` comment at the spot in the code where it would go.

- Settings toggle: stop digging when the current page already has a strong match
- OCR for scanned PDFs and images
- Old .ppt and .doc formats
- Following off-site links (Google Docs, Box, publisher sites) with their own logins
- In-extension PDF viewer with in-file highlighting
- Rust/WASM port of scoring and the index
- Databricks-trained link scorer and analytics dashboard
- Contradiction finder
- Persist the embedding cache to IndexedDB so it survives a browser restart
- Fuzzy highlight matching when a passage was cut mid-word or the page changed after extraction
- Smarter boilerplate removal on non-Canvas sites (only nav/header/footer are skipped today)
- Huge pages: extraction stops at 30,000 words
- Crawling other sites and direct non-Canvas file URLs (milestone 6)
- Password-protected files, Word headers/footnotes/tracked changes, and embedded objects
- Documents over 50 MB; stream or cache their bytes instead of keeping the entire file in memory
- Canvas external-tool launches and discussion module items are excluded; announcements use the read-only announcements API
