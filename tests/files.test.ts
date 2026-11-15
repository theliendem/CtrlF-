import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { downloadCanvasFile, fileKind, officeSections, xmlParagraphs } from '../src/engine/files.ts';
import { pdfSections } from '../src/engine/pdf.ts';
import { safeLink } from '../src/engine/links.ts';
import { exactPassages } from '../src/engine/exact';

Object.assign(globalThis, { DOMParser });
const signal = new AbortController().signal;
const context = { origin: 'https://canvas.wisc.edu', courseId: '123' };
const base = `${context.origin}/courses/123`;
const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';

test('file types accept supported formats and reject legacy formats and images', () => {
  assert.equal(fileKind('NOTES.PDF', ''), 'pdf');
  assert.equal(fileKind('slides.pptx', ''), 'pptx');
  assert.equal(fileKind('notes.docx', ''), 'docx');
  for (const name of ['notes.doc', 'slides.ppt', 'scan.png']) assert.equal(fileKind(name, ''), null);
});

test('Canvas file URLs deduplicate preview, download, and global file routes', () => {
  for (const path of ['/files/42/download?download_frd=1', '/courses/123/files/42/preview', '/courses/123/files/42', '/courses/123/files?preview=42']) {
    assert.equal(safeLink(path, base, context), `${base}/files/42`);
  }
  assert.equal(safeLink('/courses/999/files/42', base, context), null);
  assert.equal(safeLink('/courses/123/quizzes/1/files/42', base, context), null);
});

test('Word preserves split words and separates paragraphs, tabs and table cells', async () => {
  const xml = `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Mid</w:t></w:r><w:r><w:t>term 2</w:t><w:tab/><w:t>Friday</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Room 205</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
  assert.deepEqual(xmlParagraphs(xml), ['Midterm 2 Friday', 'Room 205']);
  const zip = new JSZip().file('word/document.xml', xml);
  const sections = [];
  for await (const section of officeSections(await zip.generateAsync({ type: 'uint8array' }), 'docx', signal)) sections.push(section);
  assert.deepEqual(sections, [{ blocks: ['Midterm 2 Friday', 'Room 205'] }]);
});

test('PowerPoint uses presentation order, not slide filenames', async () => {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="urn:p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', `<a:p xmlns:a="${a}"><a:r><a:t>Second slide</a:t></a:r></a:p>`);
  zip.file('ppt/slides/slide2.xml', `<a:p xmlns:a="${a}"><a:r><a:t>First slide</a:t></a:r></a:p>`);
  const sections = [];
  for await (const section of officeSections(await zip.generateAsync({ type: 'uint8array' }), 'pptx', signal)) sections.push(section);
  assert.deepEqual(sections, [{ blocks: ['First slide'], location: 'Slide 1' }, { blocks: ['Second slide'], location: 'Slide 2' }]);
});

test('file download uses the course API and GET, with no off-site credentials', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit) => {
    calls.push(String(input));
    assert.equal(init.method, 'GET');
    if (calls.length === 1) {
      assert.equal(init.credentials, 'include');
      return new Response(JSON.stringify({ id: 42, filename: 'notes.pdf', display_name: 'Notes', size: 4, 'content-type': 'application/pdf', url: 'https://storage.example/notes.pdf' }));
    }
    assert.equal(init.credentials, 'omit');
    return new Response('test');
  });
  const file = await downloadCanvasFile(`${base}/files/42`, context, signal);
  assert.equal(calls[0], `${context.origin}/api/v1/courses/123/files/42`);
  assert.equal(file.kind, 'pdf');
  assert.equal(file.bytes.length, 4);
});

test('locked files are rejected before downloading bytes', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return new Response(JSON.stringify({ locked_for_user: true }));
  });
  await assert.rejects(downloadCanvasFile(`${base}/files/42`, context, signal), /locked/);
  assert.equal(count, 1);
});

test('unsupported file metadata never triggers a binary download', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return new Response(JSON.stringify({ filename: 'old-slides.ppt', 'content-type': 'application/vnd.ms-powerpoint' }));
  });
  await assert.rejects(downloadCanvasFile(`${base}/files/42`, context, signal), /Unsupported/);
  assert.equal(count, 1);
});

function samplePdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...['Course overview', 'Midterm 2 is Friday'].map((text) => { const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`; return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`; }),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

test('PDF extraction preserves page numbers and finds text on the second page', async () => {
  const sections = [];
  for await (const section of pdfSections(samplePdf(), signal)) sections.push(section);
  assert.equal(sections.length, 2);
  assert.equal(sections[1].pageNumber, 2);
  assert.equal(sections[1].location, 'Page 2');
  assert.match(sections[1].blocks.join(' '), /Midterm 2 is Friday/);
  assert.equal(exactPassages('midterm 2', sections[0].blocks).length, 0);
  assert.deepEqual(exactPassages('midterm 2', sections[1].blocks)[0].marks, ['Midterm 2']);
});

test('cancelled file parsing yields no sections', async () => {
  const controller = new AbortController();
  controller.abort();
  const zip = new JSZip().file('word/document.xml', '<document/>');
  await assert.rejects(async () => {
    for await (const _section of officeSections(await zip.generateAsync({ type: 'uint8array' }), 'docx', controller.signal)) assert.fail('Should not yield');
  }, /abort/i);
  await assert.rejects(async () => {
    for await (const _section of pdfSections(samplePdf(), controller.signal)) assert.fail('Should not yield');
  }, /abort/i);
});
