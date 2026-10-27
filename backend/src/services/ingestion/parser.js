import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
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
 * `maxTextChars` is rejected, and PDF/DOCX parsing runs in a worker thread that is
 * killed after `parseTimeoutMs` or when it exceeds `parseMaxHeapMb` of heap.
 */
export async function parseDocument(source, fileType, limits = config.uploads) {
  const buf = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  // PDF/DOCX parsing is CPU-bound and synchronous inside pdf.js / mammoth, so a timer in this
  // thread cannot interrupt it. Those formats run in a worker thread that is terminated on
  // timeout and has a heap cap (PDF / decompression bomb guard). Plain text parses inline.
  const parsed = ['pdf', 'docx'].includes(fileType)
    ? await parseInWorker(buf, fileType, limits)
    : await parseRaw(buf, fileType, limits);
  const chars = parsed.pages.reduce((n, p) => n + p.text.length, 0);
  if (chars > limits.maxTextChars) {
    throw new UploadError(`Extracted text too large (${chars} > ${limits.maxTextChars} chars)`, 413, 'text_too_large');
  }
  return parsed;
}

/** Parse in the current thread (used inline for text and inside the worker for pdf/docx). */
export async function parseRaw(buf, fileType, limits = config.uploads) {
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
}

function parseInWorker(buf, fileType, limits) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parseWorker.js', import.meta.url), {
      workerData: { buf: new Uint8Array(buf), fileType, limits },
      resourceLimits: { maxOldGenerationSizeMb: limits.parseMaxHeapMb || 512 },
    });
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(v);
    };
    const timer = setTimeout(
      () => finish(reject, new UploadError(`Parsing exceeded ${limits.parseTimeoutMs} ms`, 422, 'parse_timeout')),
      limits.parseTimeoutMs
    );
    worker.once('message', (m) => {
      if (m.ok) return finish(resolve, m.result);
      const e = m.error;
      finish(reject, e.status ? new UploadError(e.message, e.status, e.code) : new Error(e.message));
    });
    worker.once('error', (err) =>
      finish(
        reject,
        err.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? new UploadError('Document needs too much memory to parse', 413, 'parse_memory')
          : err
      )
    );
    worker.once('exit', (code) => finish(reject, new Error(`parser worker exited (${code})`)));
  });
}

async function parsePdf(buf, limits) {
  // pdf-parse's index.js runs test code on import; require the lib module directly.
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  // `max` caps how many pages pdf.js renders, so an oversized PDF costs at most maxPdfPages pages of work.
  // Pass a plain Uint8Array copy: pdf.js 1.10 misreads small Node Buffers in this ESM process
  // ("bad XRef entry" on valid PDFs; covered by test/parser.test.js).
  const data = await pdfParse(new Uint8Array(buf), { max: limits.maxPdfPages + 1 });
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
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
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
