'use client';
import { useEffect, useRef, useState } from 'react';
import api from '../lib/api';

const STATUS_COLOR = {
  processing: 'text-amber-700',
  ready: 'text-emerald-700',
  failed: 'text-brand-600',
};

export default function DocumentPanel({ workspaceId, onOpenRisks }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const refresh = async () => {
    if (!workspaceId) return;
    try {
      setDocs(await api.listDocuments(workspaceId));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // Poll while anything is still processing.
  useEffect(() => {
    const anyProcessing = docs.some((d) => d.status === 'processing');
    clearInterval(pollRef.current);
    if (anyProcessing) pollRef.current = setInterval(refresh, 2000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, workspaceId]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await api.uploadDocument(workspaceId, file);
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this document and its chunks?')) return;
    await api.deleteDocument(id);
    refresh();
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Documents</h2>
        <label className="btn-ghost cursor-pointer">
          {uploading ? 'Uploading…' : 'Upload a file'}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={upload}
            disabled={!workspaceId || uploading}
          />
        </label>
      </div>

      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}

      {docs.length === 0 && (
        <p className="text-sm text-slate-600">No documents here yet. Upload a PDF, Word file or text file to start asking.</p>
      )}

      <ul className="divide-y divide-rule">
        {docs.map((d) => (
          <li key={d._id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{d.filename}</p>
              <p className="text-xs text-slate-500">
                {d.pageCount || 0} {d.pageCount === 1 ? 'page' : 'pages'}, {d.chunkCount || 0} passages
                {d.ocrUsed ? ', scanned (OCR)' : ''}
                {d.error ? `. ${d.error}` : ''}
              </p>
            </div>
            <span
              className={`text-xs font-medium ${STATUS_COLOR[d.status] || 'text-slate-600'}`}
            >
              {d.status}
            </span>
            {d.status === 'ready' && (
              <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onOpenRisks(d)}>
                Risks
              </button>
            )}
            <button
              className="text-xs text-slate-500 hover:text-brand-600"
              onClick={() => remove(d._id)}
              aria-label={`Delete ${d.filename}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
