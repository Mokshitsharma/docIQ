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
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Key clauses in {doc.filename}</h3>
          <button className="text-sm text-slate-500 hover:text-ink" onClick={onClose}>
            Close
          </button>
        </div>

        {err && <p className="text-sm text-brand-600">{err}</p>}
        {!data && !err && <p className="text-sm text-slate-500">Loading…</p>}

        {data?.risks?.items?.map((it) => (
          <div key={it.key} className="border-t border-rule py-3 first:border-t-0">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium">{it.label}</span>
              <span className={`text-xs font-medium ${it.present ? 'text-emerald-700' : 'text-slate-500'}`}>
                {it.present ? 'Found' : 'Not in this document'}
              </span>
              {it.pages?.length > 0 && (
                <span className="text-xs text-slate-500">
                  {it.pages.length > 1 ? 'pages' : 'page'} {it.pages.join(', ')}
                </span>
              )}
            </div>
            <p className="font-serif text-[15px] leading-relaxed text-slate-700">{it.summary}</p>
          </div>
        ))}

        {data && !data.risks && (
          <p className="text-sm text-slate-500">No risk data was generated for this document.</p>
        )}
        {data?.risks?.generatedAt && (
          <p className="mt-2 text-xs text-slate-500">
            Checked {new Date(data.risks.generatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
