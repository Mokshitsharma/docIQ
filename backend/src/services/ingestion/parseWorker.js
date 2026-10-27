// Worker-thread entry for PDF/DOCX parsing (see parseInWorker in parser.js).
import { parentPort, workerData } from 'node:worker_threads';
import { parseRaw } from './parser.js';

const { buf, fileType, limits } = workerData;
parseRaw(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), fileType, limits)
  .then((result) => parentPort.postMessage({ ok: true, result }))
  .catch((err) => parentPort.postMessage({ ok: false, error: { message: err.message, status: err.status, code: err.code } }));
