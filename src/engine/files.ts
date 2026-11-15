import JSZip from 'jszip';
import type { CanvasContext, CanvasFile, FileData, FileSection } from '../shared/types';
import { canvasGet } from './canvas';

export const MAX_BYTES = 50 * 1024 * 1024;

export function fileKind(filename: string, mime: string): FileData['kind'] | null {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (extension === 'pptx' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (extension === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return null;
}

export async function downloadCanvasFile(url: string, context: CanvasContext, signal: AbortSignal): Promise<FileData> {
  const id = new URL(url).pathname.match(/\/files\/(\d+)$/)?.[1];
  if (!id) throw new Error('Invalid Canvas file link');
  const file = await canvasGet<CanvasFile>(`/api/v1/courses/${context.courseId}/files/${id}`, context, signal);
  if (file.locked_for_user || file.hidden_for_user) throw new Error('File locked or hidden');
  const kind = fileKind(file.filename, file['content-type']);
  // LATER: OCR, images, legacy .ppt/.doc and password-protected files.
  if (!kind) throw new Error('Unsupported file type');
  // LATER: stream or cache larger documents instead of retaining their bytes in memory.
  if (file.size > MAX_BYTES) throw new Error('File exceeds the 50 MB demo limit');
  const download = new URL(file.url);
  if (download.protocol !== 'https:' || download.username || download.password || /\/(quizzes|submissions|grades|people|users|conversations)(\/|$)/i.test(download.pathname)) throw new Error('Unsafe file download URL');
  // Only the authenticated file API can supply this URL. Its redirects may lead to Canvas file storage.
  const response = await fetch(download.href, { method: 'GET', credentials: download.origin === context.origin ? 'include' : 'omit', signal });
  if (!response.ok) throw new Error(`File download HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('File exceeds the 50 MB demo limit');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error('File exceeds the 50 MB demo limit');
  return { bytes, kind, title: file.display_name || file.filename };
}

function xml(text: string): Document {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.getElementsByTagName('parsererror').length) throw new Error('Invalid document XML');
  return document;
}

/** Join adjacent text runs without adding spaces inside words. Paragraphs retain their boundaries. */
export function xmlParagraphs(text: string): string[] {
  const document = xml(text);
  return Array.from(document.getElementsByTagNameNS('*', 'p')).map((paragraph) => {
    const walk = (node: Node): string => {
      if (node.nodeType !== 1) return '';
      const element = node as Element;
      if (element.localName === 't') return element.textContent ?? '';
      if (element.localName === 'tab' || element.localName === 'br') return ' ';
      return Array.from(node.childNodes).map(walk).join('');
    };
    return walk(paragraph).replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

async function zipText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`Missing document part: ${path}`);
  return entry.async('string');
}

export async function* officeSections(bytes: Uint8Array, kind: 'pptx' | 'docx', signal: AbortSignal): AsyncGenerator<FileSection> {
  const zip = await JSZip.loadAsync(bytes);
  signal.throwIfAborted();
  if (kind === 'docx') {
    const blocks = xmlParagraphs(await zipText(zip, 'word/document.xml'));
    // LATER: Word headers, footnotes, tracked changes and embedded objects.
    yield { blocks };
    return;
  }
  const presentation = xml(await zipText(zip, 'ppt/presentation.xml'));
  const relationships = xml(await zipText(zip, 'ppt/_rels/presentation.xml.rels'));
  const targets = new Map(Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))
    .filter((rel) => rel.getAttribute('TargetMode') !== 'External')
    .map((rel) => [rel.getAttribute('Id'), rel.getAttribute('Target')!]));
  let number = 0;
  for (const slide of Array.from(presentation.getElementsByTagNameNS('*', 'sldId'))) {
    signal.throwIfAborted();
    const id = slide.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = targets.get(id);
    if (!target) throw new Error('Missing slide relationship');
    const path = new URL(target, 'https://document.invalid/ppt/presentation.xml').pathname.slice(1);
    if (!/^ppt\/slides\/[^/]+\.xml$/.test(path)) throw new Error('Invalid slide path');
    number++;
    yield { blocks: xmlParagraphs(await zipText(zip, path)), location: `Slide ${number}` };
  }
}
