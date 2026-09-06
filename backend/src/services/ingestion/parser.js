import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);

/**
 * Parse a document into an ordered list of pages:
 *   { pageNumber: number, text: string }[]
 *
 * PDFs are split on form-feed (\f) which pdf-parse emits between pages.
 * DOCX / TXT have no reliable page markers, so they come back as one page.
 */
export async function parseDocument(filePath, fileType) {
  switch (fileType) {
    case 'pdf':
      return parsePdf(filePath);
    case 'docx':
      return parseDocx(filePath);
    case 'txt':
    case 'md':
      return parseText(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

async function parsePdf(filePath) {
  // pdf-parse's index.js runs test code on import; require the lib module directly.
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const buf = await fs.readFile(filePath);
  const data = await pdfParse(buf);
  const rawPages = (data.text || '').split('\f');
  const pages = rawPages
    .map((t, i) => ({ pageNumber: i + 1, text: t.replace(/\s+\n/g, '\n').trim() }))
    .filter((p) => p.text.length > 0);
  return {
    pages: pages.length ? pages : [{ pageNumber: 1, text: (data.text || '').trim() }],
    pageCount: data.numpages || pages.length || 1,
    ocrUsed: false,
  };
}

async function parseDocx(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return {
    pages: [{ pageNumber: 1, text: (value || '').trim() }],
    pageCount: 1,
    ocrUsed: false,
  };
}

async function parseText(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return {
    pages: [{ pageNumber: 1, text: text.trim() }],
    pageCount: 1,
    ocrUsed: false,
  };
}

export function detectFileType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  if (['pdf', 'docx', 'txt', 'md'].includes(ext)) return ext;
  return null;
}
