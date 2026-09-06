const base = '/api';

async function req(path, opts = {}) {
  const res = await fetch(base + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
    ...opts,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  listWorkspaces: () => req('/workspaces'),
  getWorkspace: (id) => req(`/workspaces/${id}`),
  createWorkspace: (name) => req('/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  updateSettings: (id, patch) =>
    req(`/workspaces/${id}/settings`, { method: 'PATCH', body: JSON.stringify(patch) }),
  history: (id) => req(`/workspaces/${id}/history`),

  listDocuments: (workspaceId) => req(`/documents?workspaceId=${workspaceId}`),
  uploadDocument: (workspaceId, file) => {
    const fd = new FormData();
    fd.append('workspaceId', workspaceId);
    fd.append('file', file);
    return req('/documents/upload', { method: 'POST', body: fd });
  },
  docStatus: (id) => req(`/documents/${id}/status`),
  docRisks: (id) => req(`/documents/${id}/risks`),
  deleteDocument: (id) => req(`/documents/${id}`, { method: 'DELETE' }),

  query: (workspaceId, question) =>
    req('/query', { method: 'POST', body: JSON.stringify({ workspaceId, question }) }),
};

export default api;
