import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import config from '../../config/index.js';

/**
 * Blob storage for uploaded originals.
 *
 *   local (default)  backend/uploads/ — single-instance dev / demo
 *   s3               S3_BUCKET — required for >1 instance (stateless web tier); downloads via
 *                    short-lived pre-signed GET URLs, so the API never proxies file bytes
 *
 * A stored reference is a string: an absolute path (local) or `s3://bucket/key`.
 * Object keys are random (`<workspaceId>/<uuid>.<ext>`); the user's filename is
 * never part of a path.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

export const newObjectKey = (workspaceId, ext) => `${workspaceId}/${crypto.randomUUID()}.${ext}`;

class LocalStorage {
  get name() {
    return 'local';
  }

  async put(key, buffer) {
    const file = path.join(UPLOAD_DIR, key.replace(/[\/]/g, '_'));
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(file, buffer, { flag: 'wx' });
    return file;
  }

  async get(ref) {
    return fs.readFile(this._safe(ref));
  }

  async remove(ref) {
    await fs.unlink(this._safe(ref)).catch(() => {});
  }

  async signedUrl() {
    return null; // served by the API itself (GET /api/documents/:id/download)
  }

  _safe(ref) {
    const resolved = path.resolve(ref);
    // Legacy rows and the demo seed also live in UPLOAD_DIR; refuse anything outside it.
    if (!resolved.startsWith(UPLOAD_DIR + path.sep)) throw Object.assign(new Error('path outside upload dir'), { status: 400 });
    return resolved;
  }
}

class S3Storage {
  constructor({ bucket, region, prefix, ttl }) {
    if (!bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
    this.bucket = bucket;
    this.region = region;
    this.prefix = prefix;
    this.ttl = ttl;
    this._sdk = null;
  }

  get name() {
    return 's3';
  }

  async _client() {
    if (this._sdk) return this._sdk;
    const s3 = await import('@aws-sdk/client-s3');
    const presigner = await import('@aws-sdk/s3-request-presigner');
    // Credentials come from the default provider chain (ECS task role in AWS); never from code.
    const client = new s3.S3Client({ region: this.region, maxAttempts: 3, requestHandler: { requestTimeout: 15_000 } });
    this._sdk = { s3, presigner, client };
    return this._sdk;
  }

  _parse(ref) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(ref);
    if (!m || m[1] !== this.bucket) throw Object.assign(new Error('invalid s3 reference'), { status: 400 });
    return m[2];
  }

  async put(key, buffer, ext) {
    const { s3, client } = await this._client();
    const Key = `${this.prefix}${key}`;
    await client.send(
      new s3.PutObjectCommand({
        Bucket: this.bucket,
        Key,
        Body: buffer,
        ContentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        ServerSideEncryption: 'AES256',
      })
    );
    return `s3://${this.bucket}/${Key}`;
  }

  async get(ref) {
    const { s3, client } = await this._client();
    const out = await client.send(new s3.GetObjectCommand({ Bucket: this.bucket, Key: this._parse(ref) }));
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async remove(ref) {
    const { s3, client } = await this._client();
    await client.send(new s3.DeleteObjectCommand({ Bucket: this.bucket, Key: this._parse(ref) }));
  }

  async signedUrl(ref, filename) {
    const { s3, presigner, client } = await this._client();
    const cmd = new s3.GetObjectCommand({
      Bucket: this.bucket,
      Key: this._parse(ref),
      ResponseContentDisposition: `attachment; filename="${String(filename).replace(/["\\r\n]/g, '_')}"`,
    });
    return presigner.getSignedUrl(client, cmd, { expiresIn: this.ttl });
  }
}

let instance = null;

export function getStorage() {
  if (instance) return instance;
  instance =
    config.storage.driver === 's3'
      ? new S3Storage({
          bucket: config.storage.s3Bucket,
          region: config.storage.s3Region,
          prefix: config.storage.s3Prefix,
          ttl: config.storage.signedUrlTtlSec,
        })
      : new LocalStorage();
  return instance;
}

export const _setStorageForTests = (s) => {
  instance = s;
};

export { LocalStorage, S3Storage, CONTENT_TYPES };
