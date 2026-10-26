import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let h;
before(async () => {
  h = await startApp({ RATE_LIMIT_GLOBAL: '1000', RATE_LIMIT_QUERY: '3' });
});
after(() => h?.stop());

test('query route is rate limited per tenant: 429 + Retry-After after the limit', async () => {
  const ws = await h.workspace('rl');
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await h.query(ws, 'anything?')).status);
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
  const r = await h.query(ws, 'anything?');
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers['retry-after']) > 0);
});
