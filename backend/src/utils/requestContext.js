import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

export const requestContext = new AsyncLocalStorage();

/** Express middleware: assigns/propagates X-Request-Id and stores it for the logger. */
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.set('X-Request-Id', id);
  requestContext.run({ requestId: id }, next);
}

export const currentRequestId = () => requestContext.getStore()?.requestId;
