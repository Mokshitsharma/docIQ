import logger from '../utils/logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Multipart parser (busboy) errors are client errors, not 500s.
  if (!err.status && /^(Malformed (part header|urlencoded form)|Unexpected end of (form|multipart data)|Multipart: Boundary not found)/i.test(err.message || '')) {
    err.status = 400;
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error(err.stack || err.message);
  if (err.retryAfterSec) res.set('Retry-After', String(err.retryAfterSec));
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large', code: 'too_large' });
  if (err.name === 'MulterError') return res.status(400).json({ error: err.message, code: err.code });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  res.status(status).json({
    // Never leak internals (stack, driver messages) on 5xx.
    error: status >= 500 ? 'Internal server error' : err.message || 'Request failed',
    ...(typeof err.code === 'string' && status < 500 ? { code: err.code } : {}),
    ...(err.details ? { details: err.details } : {}),
  });
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
