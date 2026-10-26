import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import config from '../../config/index.js';
import { UploadError } from './fileGuard.js';

const require = createRequire(import.meta.url);

/**
 * Parse a document into an ordered list of pages:
 *   { pageNumber: number, text: string }[]
 *
 * `source` is a Buffer (uploads, any storage driver) or a file path (eval, legacy rows).
 * PDFs are split on form-feed (\f) when pdf-parse emits them.
 * DOCX / TXT have no reliable page markers, so they come back as one page.
 *
 * Bomb limits: PDFs over `maxPdfPages` are rejected, extracted text over
 * `maxTextChars` is rejected, and parsing is abandoned after `parseTimeoutMs`.
 */
export async function parseDocument(source, fileType, limits = config.uploads) {
  const buf = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  let parsed;
  const work = (async () => {
    switch (fileType) {
      case 'pdf':
        return parsePdf(buf, limits);
      case 'docx':
        return parseDocx(buf);
      case 'txt':
      case 'md':
        return parseText(buf);
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  })();
  let timer;
  try {
    parsed = await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new UploadError(`Parsing exceeded ${limits.parseTimeoutMs} ms`, 422, 'parse_timeout')), limits.parseTimeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const chars = parsed.pages.reduce((n, p) => n + p.text.length, 0);
  if (chars > limits.maxTextChars) {
    throw new UploadError(`Extracted text too large (${chars} > ${limits.maxTextChars} chars)`, 413, 'text_too_large');
  }
  return parsed;
}

async function parsePdf(buf, limits) {
  // pdf-parse's index.js runs test code on import; require the lib module directly.
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  // `max` caps how many pages pdf.js renders, so an oversized PDF costs at most maxPdfPages pages of work.
  const data = await pdfParse(buf, { max: limits.maxPdfPages + 1 });
  if ((data.numpages || 0) > limits.maxPdfPages) {
    throw new UploadError(`PDF has ${data.numpages} pages (limit ${limits.maxPdfPages})`, 413, 'too_many_pages');
  }
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

async function parseDocx(buf) {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return {
    pages: [{ pageNumber: 1, text: (value || '').trim() }],
    pageCount: 1,
    ocrUsed: false,
  };
}

async function parseText(buf) {
  const text = buf.toString('utf8').replace(/^﻿/, '');
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
