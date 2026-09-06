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
      <h2 className="mb-2 font-semibold">Query history</h2>
      {logs.length === 0 && <p className="text-sm text-slate-500">No queries yet.</p>}
      <ul className="space-y-2">
        {logs.map((l) => (
          <li key={l._id} className="rounded-lg border border-slate-100 p-2 text-sm">
            <p className="font-medium">{l.question}</p>
            <p className="mt-0.5 line-clamp-2 text-slate-600">{l.answer}</p>
            <p className="mt-1 text-xs text-slate-400">
              {new Date(l.createdAt).toLocaleString()} · {l.grounded ? 'grounded' : 'ungrounded'} ·
              conf {Number(l.confidence ?? 0).toFixed(2)} · {l.citedChunkIds?.length || 0} cites ·{' '}
              {l.latencyMs}ms
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
