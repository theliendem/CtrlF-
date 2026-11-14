// Dev-only helpers on the offscreen console: chrome://extensions -> Ctrl+F++ -> "Inspect views: offscreen".
//   await ctrlfpp.loadDoc('https://canvas.wisc.edu/courses/<id>/assignments/syllabus')
//   await ctrlfpp.walk('<courseId>')          // fromCanvas over the whole course, prints a summary
//   await ctrlfpp.probePdf('<courseId>')      // finds a PDF via modules and checks its download works
import { canvasDoc, canvasGet, canvasGetAll, fromCanvas, loadDoc, safeGet } from '../sources';

const ORIGIN = 'https://canvas.wisc.edu';

async function walk(courseId: string, origin = ORIGIN, max = 40) {
  const rows: { url: string; title: string; passages: number; links: number }[] = [];
  for await (const d of fromCanvas(courseId, origin)) {
    rows.push({ url: d.url.replace(origin, ''), title: d.title, passages: d.passages.length, links: d.links.length });
    if (rows.length >= max) break;
  }
  console.table(rows);
  return rows;
}

/** Find a PDF in the course (module File items, then /files/ links inside docs) and check its download works. */
async function probePdf(courseId: string, origin = ORIGIN, maxDocs = 60) {
  const fileIds = new Set<string>();
  type Item = { type: string; content_id?: number };
  const mods = await canvasGetAll<{ items?: Item[] }>(`${origin}/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`);
  for (const it of mods.flatMap((m) => m.items ?? [])) if (it.type === 'File' && it.content_id) fileIds.add(String(it.content_id));
  if (fileIds.size === 0) {
    let n = 0;
    for await (const d of fromCanvas(courseId, origin)) {
      for (const l of d.links) {
        const m = new URL(l.url).pathname.match(/\/files\/(\d+)/);
        if (m) fileIds.add(m[1]);
      }
      if (fileIds.size >= 5 || ++n >= maxDocs) break;
    }
  }
  console.log(`probePdf: ${fileIds.size} file link(s) found`);
  for (const id of fileIds) {
    let f: { url: string; filename: string; 'content-type': string };
    try {
      f = await canvasGet(`${origin}/api/v1/courses/${courseId}/files/${id}`);
    } catch (e) {
      console.log('file', id, 'not readable:', String(e));
      continue;
    }
    if (f['content-type'] !== 'application/pdf') continue;
    try {
      const res = await safeGet(f.url, { timeoutMs: 20000 });
      const bytes = (await res.arrayBuffer()).byteLength;
      const out = { file: f.filename, status: res.status, finalHost: new URL(res.url).host, type: res.headers.get('content-type'), bytes, ok: res.ok && bytes > 1000 ? 'PASS' : 'FAIL' };
      console.log(out);
      return out;
    } catch (e) {
      const out = { file: f.filename, downloadUrl: f.url, ok: 'FAIL', error: String(e) };
      console.log(out, '(a TypeError "Failed to fetch" here = redirect host needs a host permission)');
      return out;
    }
  }
  console.log('no readable PDF found in this course');
  return null;
}

Object.assign(globalThis, { ctrlfpp: { loadDoc, canvasDoc, fromCanvas, walk, probePdf } });
