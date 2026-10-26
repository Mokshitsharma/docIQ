import path from 'node:path';
import JSZip from 'jszip';
import config from '../../config/index.js';

/**
 * Upload hardening. Everything here works on the raw bytes, never on what the
 * client claims (extension / Content-Type):
 *
 *   sniffFileType(buf)        magic-byte detection: pdf | docx | text | null
 *   sanitizeFilename(name)    display-safe basename (no paths, control chars, reserved names)
 *   validateUpload({buffer, originalname})  → { fileType, filename } or throws 4xx
 *   inspectDocx(buf)          zip-bomb limits on entry count, total size and ratio
 */

export class UploadError extends Error {
  constructor(message, status = 400, code = 'invalid_upload') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ALLOWED_EXT = { pdf: 'pdf', docx: 'docx', txt: 'text', md: 'text' };
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function sanitizeFilename(name) {
  let base = String(name ?? '')
    .normalize('NFKC')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  if (!base) base = 'upload';
  if (base.length > 120) {
    const ext = path.extname(base).slice(0, 10);
    base = base.slice(0, 120 - ext.length) + ext;
  }
  return base;
}

export function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase().replace('.', '');
}

export function sniffFileType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return null;
  // PDF header may be preceded by junk, but must appear in the first 1 KB.
  if (buf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  if (looksLikeText(buf)) return 'text';
  return null;
}

function looksLikeText(buf) {
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Zip-bomb guard + structure check for .docx (an OOXML zip). */
export async function inspectDocx(buf, limits = config.uploads) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: false });
  } catch {
    throw new UploadError('Corrupt .docx (not a readable zip archive)');
  }
  const entries = Object.values(zip.files);
  if (entries.length > limits.maxZipEntries) {
    throw new UploadError(`.docx has too many entries (${entries.length} > ${limits.maxZipEntries})`, 413, 'zip_bomb');
  }
  let total = 0;
  for (const e of entries) {
    // eslint-disable-next-line no-underscore-dangle
    const size = e._data?.uncompressedSize ?? 0;
    if (size < 0) throw new UploadError('Corrupt .docx entry size', 400);
    total += size;
  }
  if (total > limits.maxUncompressedBytes) {
    throw new UploadError(`.docx expands to ${total} bytes (limit ${limits.maxUncompressedBytes})`, 413, 'zip_bomb');
  }
  if (buf.length > 0 && total / buf.length > limits.maxCompressionRatio) {
    throw new UploadError(`.docx compression ratio ${Math.round(total / buf.length)}:1 exceeds ${limits.maxCompressionRatio}:1`, 413, 'zip_bomb');
  }
  if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) {
    throw new UploadError('Zip archive is not a Word document (.docx)');
  }
  return { entries: entries.length, uncompressedBytes: total };
}

/**
 * Validate an in-memory upload. Returns the app file type and a safe display name.
 * Throws UploadError (4xx) on any mismatch.
 */
export async function validateUpload({ buffer, originalname }, limits = config.uploads) {
  const filename = sanitizeFilename(originalname);
  const ext = extensionOf(filename);
  const expected = ALLOWED_EXT[ext];
  if (!expected) throw new UploadError('Unsupported file type (pdf, docx, txt, md only)', 415, 'unsupported_type');
  if (!buffer?.length) throw new UploadError('Empty file');
  if (buffer.length > limits.maxBytes) throw new UploadError(`File exceeds ${limits.maxBytes} bytes`, 413, 'too_large');

  const sniffed = sniffFileType(buffer);
  const actual = sniffed === 'zip' ? 'docx' : sniffed;
  if (actual !== expected) {
    throw new UploadError(
      `File content (${sniffed || 'binary/unknown'}) does not match its .${ext} extension`,
      415,
      'type_mismatch'
    );
  }
  if (ext === 'docx') await inspectDocx(buffer, limits);
  return { fileType: ext, filename };
}
