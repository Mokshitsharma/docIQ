const base = '/api';

// Each workspace is opened by its access key (X-Workspace-Key). The server shows a new
// workspace's key once, on create, so the browser keeps it, together with the names of
// the workspaces created here (the server lists only the public demo workspace).
const STORE = 'dociq.workspaces';
let current = '';

function load() {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}

function remember(ws) {
  if (!ws?._id || !ws.accessKey) return;
  const all = load();
  all[ws._id] = { name: ws.name, key: ws.accessKey, isDemo: Boolean(ws.isDemo) };
  window.localStorage.setItem(STORE, JSON.stringify(all));
}

async function req(path, opts = {}, workspaceId = current) {
  const headers = {};
  if (opts.body && !(opts.body instanceof FormData)) headers['content-type'] = 'application/json';
  const key = load()[workspaceId]?.key;
  if (key) headers['x-workspace-key'] = key;
  const res = await fetch(base + path, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  /** Sets the workspace whose key goes with document and query calls. */
  use: (workspaceId) => {
    current = workspaceId || '';
  },

  /** The demo workspace (its key is public) plus the workspaces created in this browser. */
  listWorkspaces: async () => {
    const demo = await req('/workspaces/demo', {}, '').catch(() => null);
    if (demo) remember(demo);
    const mine = Object.entries(load())
      .filter(([id, w]) => !w.isDemo && id !== demo?._id)
      .map(([_id, w]) => ({ _id, name: w.name }));
    return [...mine.reverse(), ...(demo ? [{ _id: demo._id, name: demo.name, isDemo: true }] : [])];
  },
  getWorkspace: (id) => req(`/workspaces/${id}`, {}, id),
  createWorkspace: async (name) => {
    const ws = await req('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }, '');
    remember(ws);
    return ws;
  },
  updateSettings: (id, patch) =>
    req(`/workspaces/${id}/settings`, { method: 'PATCH', body: JSON.stringify(patch) }, id),
  history: (id) => req(`/workspaces/${id}/history`, {}, id),

  listDocuments: (workspaceId) => req(`/documents?workspaceId=${workspaceId}`, {}, workspaceId),
  uploadDocument: (workspaceId, file) => {
    const fd = new FormData();
    fd.append('workspaceId', workspaceId);
    fd.append('file', file);
    return req('/documents/upload', { method: 'POST', body: fd }, workspaceId);
  },
  docStatus: (id) => req(`/documents/${id}/status`),
  docRisks: (id) => req(`/documents/${id}/risks`),
  deleteDocument: (id) => req(`/documents/${id}`, { method: 'DELETE' }),

  query: (workspaceId, question) =>
    req('/query', { method: 'POST', body: JSON.stringify({ workspaceId, question }) }, workspaceId),
};

export default api;
