import { currentRequestId } from './requestContext.js';
import { redactPII } from './pii.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const env = () => ({
  json: (process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json',
  min: LEVELS[process.env.LOG_LEVEL || (process.env.DEBUG ? 'debug' : 'info')] ?? 20,
  redact: ['1', 'true', 'yes', 'on'].includes(String(process.env.REDACT_PII).toLowerCase()),
});

const fmt = (a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a));

function write(level, args) {
  const e = env();
  if (LEVELS[level] < e.min) return;
  let msg = args.map(fmt).join(' ');
  if (e.redact) msg = redactPII(msg);
  const rid = currentRequestId();
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (e.json) {
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(rid ? { requestId: rid } : {}) }));
  } else {
    sink(`[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)}${rid ? ` [${rid.slice(0, 8)}]` : ''}`, msg);
  }
}

export const logger = {
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};

export default logger;
