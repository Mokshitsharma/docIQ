import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseDocument, detectFileType } from '../src/services/ingestion/parser.js';

const LIMITS = { maxPdfPages: 5, maxTextChars: 10_000, parseTimeoutMs: 10_000 };

/** Minimal valid PDF with one text line per page (offsets computed, so the xref table is exact). */
function makePdf(pageTexts) {
  const objs = [];
  const n = pageTexts.length;
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pageTexts.forEach((t, i) => {
    const content = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('pdf: text extracted, page count reported', async () => {
  const r = await parseDocument(makePdf(['Payment is due within thirty days', 'Second page text']), 'pdf', LIMITS);
  assert.equal(r.pageCount, 2);
  assert.match(r.pages.map((p) => p.text).join(' '), /thirty days/);
  assert.equal(r.ocrUsed, false);
});

test('pdf: more pages than the limit → 413 too_many_pages (PDF bomb guard)', async () => {
  const pdf = makePdf(['a', 'b', 'c']);
  await assert.rejects(parseDocument(pdf, 'pdf', { ...LIMITS, maxPdfPages: 2 }), (e) => e.status === 413 && e.code === 'too_many_pages');
});

test('docx: raw text extracted as one page', async () => {
  const r = await parseDocument(await makeDocx('Termination requires 30 days notice'), 'docx', LIMITS);
  assert.equal(r.pages.length, 1);
  assert.match(r.pages[0].text, /30 days notice/);
});

test('txt/md: BOM stripped; extracted text over the cap → 413', async () => {
  const r = await parseDocument(Buffer.from('﻿hello world'), 'txt', LIMITS);
  assert.equal(r.pages[0].text, 'hello world');
  const md = await parseDocument(Buffer.from('# Title'), 'md', LIMITS);
  assert.equal(md.pages[0].text, '# Title');
  await assert.rejects(parseDocument(Buffer.from('x'.repeat(50)), 'txt', { ...LIMITS, maxTextChars: 10 }), (e) => e.status === 413 && e.code === 'text_too_large');
});

test('parse timeout → 422 parse_timeout; unsupported type rejected', async () => {
  const pdf = makePdf(Array.from({ length: 300 }, (_, i) => `page ${i}`));
  await assert.rejects(parseDocument(pdf, 'pdf', { ...LIMITS, maxPdfPages: 500, parseTimeoutMs: 1 }), (e) => e.status === 422 && e.code === 'parse_timeout');
  await assert.rejects(parseDocument(Buffer.from('x'), 'exe', LIMITS), /Unsupported file type/);
});

test('detectFileType by extension', () => {
  assert.equal(detectFileType('a.PDF'), 'pdf');
  assert.equal(detectFileType('b.docx'), 'docx');
  assert.equal(detectFileType('c.md'), 'md');
  assert.equal(detectFileType('d.exe'), null);
});
