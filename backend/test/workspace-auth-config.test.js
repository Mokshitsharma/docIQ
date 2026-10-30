import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

// src/ modules read env at import time, so the app is started (env set) before any is imported.
const h = await startApp();
const { assertValidConfig } = await import('../src/index.js');
const config = (await import('../src/config/index.js')).default;

test.after(() => h.stop());

test('config.workspaceAuth defaults to true when WORKSPACE_AUTH is unset', () => {
  assert.equal(config.workspaceAuth, true);
});

test('assertValidConfig refuses to start when NODE_ENV=production and workspaceAuth=false', () => {
  assert.throws(
    () => assertValidConfig({ env: 'production', workspaceAuth: false }),
    /Refusing to start: WORKSPACE_AUTH cannot be disabled in production/
  );
});

test('assertValidConfig succeeds when NODE_ENV=production and workspaceAuth=true', () => {
  assert.doesNotThrow(() => assertValidConfig({ env: 'production', workspaceAuth: true }));
});

test('assertValidConfig succeeds when NODE_ENV=development and workspaceAuth=false', () => {
  assert.doesNotThrow(() => assertValidConfig({ env: 'development', workspaceAuth: false }));
});

test('key rotation: rotates workspace key and immediately invalidates previous key', async () => {
  const ws = await h.workspace('rotate-test-ws');
  const rotateRes = await h.api.post(`/api/workspaces/${ws.id}/rotate-key`).set('x-workspace-key', ws.key);
  assert.equal(rotateRes.status, 200);
  assert.ok(rotateRes.body.accessKey);
  assert.notEqual(rotateRes.body.accessKey, ws.key);

  const oldKeyRes = await h.api.get(`/api/workspaces/${ws.id}`).set('x-workspace-key', ws.key);
  assert.equal(oldKeyRes.status, 404); // wrong key looks like an unknown workspace (no id probing)
  const newKeyRes = await h.api.get(`/api/workspaces/${ws.id}`).set('x-workspace-key', rotateRes.body.accessKey);
  assert.equal(newKeyRes.status, 200);
});
