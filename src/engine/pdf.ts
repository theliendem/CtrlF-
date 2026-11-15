import { getDocument, GlobalWorkerOptions, PDFWorker, VerbosityLevel } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DigLink, FileSection } from '../shared/types';

GlobalWorkerOptions.workerSrc = workerUrl;
// Font and colour warnings are noise for text extraction and clutter chrome://extensions; keep real errors.
const verbosity = VerbosityLevel.ERRORS;

export async function* pdfSections(bytes: Uint8Array, signal: AbortSignal): AsyncGenerator<FileSection> {
  signal.throwIfAborted();
  // PDF.js otherwise wraps extension URLs in a blob worker, which MV3's CSP blocks.
  const port = typeof Worker === 'undefined' ? undefined : new Worker(new URL(workerUrl, import.meta.url), { type: 'module' });
  const worker = port ? PDFWorker.create({ port, verbosity }) : undefined;
  const task = getDocument({ data: bytes, worker, useSystemFonts: true, disableFontFace: true, useWasm: false, verbosity });
  // Never show a password prompt in the offscreen document.
  task.onPassword = () => { void task.destroy(); };
  const abort = (): void => { void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const document = await task.promise;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      signal.throwIfAborted();
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const lines: string[] = [];
      let line = '';
      for (const item of text.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) { lines.push(line.trim()); line = ''; }
        else if (!line.endsWith(' ')) line += ' ';
      }
      if (line.trim()) lines.push(line.trim());
      const links: DigLink[] = (await page.getAnnotations()).flatMap((annotation) =>
        annotation.subtype === 'Link' && typeof annotation.url === 'string'
          ? [{ url: annotation.url, title: annotation.url, heading: '' }] : []);
      yield { blocks: lines.filter(Boolean), location: `Page ${pageNumber}`, pageNumber, links };
      page.cleanup();
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
    worker?.destroy();
    port?.terminate();
  }
}
