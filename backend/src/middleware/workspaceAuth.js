import crypto from 'node:crypto';
import mongoose from 'mongoose';
import config from '../config/index.js';
import Workspace from '../models/Workspace.js';

/**
 * Tenant isolation. A workspace is the tenant boundary; possession of its
 * access key (header `X-Workspace-Key`) is the capability to read or change it.
 *
 * - Keys are 192-bit random, shown once on create, stored only as sha256.
 * - Wrong key and unknown workspace both return 404, so ids cannot be probed.
 * - Every handler that touches a document/chunk/answer resolves the owning
 *   workspace from the stored row (never from the request) and checks the key.
 */

export const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
export const generateKey = () => `dk_${crypto.randomBytes(24).toString('base64url')}`;

const notFound = () => Object.assign(new Error('workspace not found'), { status: 404 });

function keysMatch(provided, storedHash) {
  if (!provided || !storedHash) return false;
  const a = Buffer.from(hashKey(provided), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Load workspace `id` if the request carries its key. Throws 400/401/404. */
export async function authorizeWorkspace(req, id) {
  if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('valid workspaceId is required'), { status: 400 });
  const ws = await Workspace.findById(id).select('+accessKeyHash').lean();
  if (!config.workspaceAuth) {
    if (!ws) throw notFound();
    delete ws.accessKeyHash;
    return ws;
  }
  const key = req.get('x-workspace-key');
  if (!key) throw Object.assign(new Error('X-Workspace-Key header is required'), { status: 401 });
  if (!ws || !keysMatch(key, ws.accessKeyHash)) throw notFound();
  delete ws.accessKeyHash;
  return ws;
}

/** Express middleware for routes with `:id` = workspace id. Sets req.workspace. */
export const requireWorkspaceParam = (param = 'id') => async (req, _res, next) => {
  try {
    req.workspace = await authorizeWorkspace(req, req.params[param]);
    next();
  } catch (err) {
    next(err);
  }
};
