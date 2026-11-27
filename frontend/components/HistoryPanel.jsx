'use client';
import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function HistoryPanel({ workspaceId, refreshKey }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!workspaceId) return;
    api.history(workspaceId).then(setLogs).catch(() => setLogs([]));
  }, [workspaceId, refreshKey]);

  if (!workspaceId) return null;

  return (
    <div className="card p-4">
      <h2 className="mb-2 text-xl font-semibold">Past questions</h2>
      {logs.length === 0 && <p className="text-sm text-slate-600">Questions you ask in this workspace show up here.</p>}
      <ul className="divide-y divide-rule">
        {logs.map((l) => (
          <li key={l._id} className="py-2.5 text-sm">
            <p className="font-serif font-semibold">{l.question}</p>
            <p className="mt-0.5 line-clamp-2 font-serif text-slate-700">{l.answer}</p>
            <p className="mt-1 text-xs text-slate-500">
              {new Date(l.createdAt).toLocaleString()}. {l.grounded ? 'Backed by the documents' : 'Not found in the documents'},
              {' '}{l.citedChunkIds?.length || 0} sources, confidence {Number(l.confidence ?? 0).toFixed(2)}, {l.latencyMs} ms
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
