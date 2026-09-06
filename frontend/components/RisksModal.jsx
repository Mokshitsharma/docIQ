'use client';
import { useEffect, useState } from 'react';
import api from '../lib/api';

export default function RisksModal({ doc, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.docRisks(doc._id).then(setData).catch((e) => setErr(e.message));
  }, [doc]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Clause &amp; risk summary — {doc.filename}</h3>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}>
            ✕
          </button>
        </div>

        {err && <p className="text-sm text-rose-600">{err}</p>}
        {!data && !err && <p className="text-sm text-slate-500">Loading…</p>}

        {data?.risks?.items?.map((it) => (
          <div key={it.key} className="mb-3 rounded-lg border border-slate-200 p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium">{it.label}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  it.present ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {it.present ? 'found' : 'not found'}
              </span>
              {it.pages?.length > 0 && (
                <span className="text-xs text-slate-400">p. {it.pages.join(', ')}</span>
              )}
            </div>
            <p className="text-sm text-slate-700">{it.summary}</p>
          </div>
        ))}

        {data && !data.risks && (
          <p className="text-sm text-slate-500">No risk data was generated for this document.</p>
        )}
        {data?.risks?.generatedAt && (
          <p className="mt-2 text-xs text-slate-400">
            generated {new Date(data.risks.generatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
