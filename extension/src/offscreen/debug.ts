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

async function probePdf(courseId: string, origin = ORIGIN) {
  type Item = { type: string; title: string; content_id?: number };
  const mods = await canvasGetAll<{ items?: Item[] }>(`${origin}/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`);
  const files = mods.flatMap((m) => m.items ?? []).filter((i) => i.type === 'File' && i.content_id);
  for (const it of files) {
    const f = await canvasGet<{ url: string; filename: string; 'content-type': string }>(`${origin}/api/v1/courses/${courseId}/files/${it.content_id}`);
    if (f['content-type'] !== 'application/pdf') continue;
    const res = await safeGet(f.url, { timeoutMs: 20000 });
    const bytes = (await res.arrayBuffer()).byteLength;
    const out = { file: f.filename, status: res.status, finalHost: new URL(res.url).host, type: res.headers.get('content-type'), bytes, ok: res.ok && bytes > 1000 ? 'PASS' : 'FAIL' };
    console.log(out);
    return out;
  }
  console.log('no PDF module items found');
  return null;
}

Object.assign(globalThis, { ctrlfpp: { loadDoc, canvasDoc, fromCanvas, walk, probePdf } });
