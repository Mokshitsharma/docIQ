'use client';
import { useRef, useState } from 'react';
import api from '../lib/api';

// Starter prompts shown before the first question — cover the clause types
// DocIQ auto-extracts, so they work well on most contracts.
const RECOMMENDED_QUESTIONS = [
  'What are the payment terms and when are invoices due?',
  'How much notice is required to terminate for convenience?',
  'What is the limitation of liability cap, and what is excluded from it?',
  'Does the contract auto-renew? What is the opt-out notice window?',
  'How long do confidentiality obligations survive termination?',
  'Which state or jurisdiction governs this agreement?',
];

export default function ChatPanel({ workspaceId }) {
  const [turns, setTurns] = useState([]); // {question, result?}
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [openCite, setOpenCite] = useState(null); // citation object
  const scrollRef = useRef(null);

  const ask = async (override) => {
    const question = (typeof override === 'string' ? override : q).trim();
    if (!question || !workspaceId || busy) return;
    setQ('');
    setTurns((t) => [...t, { question }]);
    setBusy(true);
    try {
      const result = await api.query(workspaceId, question);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)));
    } catch (e) {
      setTurns((t) =>
        t.map((x, i) => (i === t.length - 1 ? { ...x, result: { answer: `Error: ${e.message}`, citations: [] } } : x))
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight));
    }
  };

  return (
    <div className="card flex h-[70vh] flex-col p-4">
      <h2 className="mb-2 font-semibold">Ask your documents</h2>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <p className="text-sm text-slate-500">
            Ask a natural-language question, or pick a recommended one below. Answers are grounded in
            retrieved passages and cite their source page.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
              {t.question}
            </div>
            {t.result ? (
              <div className="max-w-[92%] rounded-lg bg-slate-100 px-3 py-2 text-sm">
                <Answer result={t.result} onCite={setOpenCite} />
              </div>
            ) : (
              <div className="max-w-[92%] animate-pulse rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-400">
                Retrieving & reasoning…
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Recommended questions — always available, above the input */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Recommended questions
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {RECOMMENDED_QUESTIONS.map((rq) => (
            <button
              key={rq}
              disabled={!workspaceId || busy}
              onClick={() => ask(rq)}
              title={rq}
              className="shrink-0 whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
            >
              {rq}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="input"
          placeholder={workspaceId ? 'e.g. What is the termination notice period?' : 'Select a workspace first'}
          value={q}
          disabled={!workspaceId || busy}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button className="btn-primary" onClick={() => ask()} disabled={!workspaceId || busy || !q.trim()}>
          Ask
        </button>
      </div>

      {openCite && <SourceViewer citation={openCite} onClose={() => setOpenCite(null)} />}
    </div>
  );
}

function Answer({ result, onCite }) {
  const cites = result.citations || [];
  const byMarker = new Map(cites.map((c) => [String(c.marker), c]));

  // Render [n] markers as clickable chips.
  const parts = String(result.answer).split(/(\[\d+\])/g);

  return (
    <div>
      <p className="whitespace-pre-wrap leading-relaxed">
        {parts.map((p, i) => {
          const m = p.match(/^\[(\d+)\]$/);
          if (m && byMarker.has(m[1])) {
            return (
              <button
                key={i}
                className="mx-0.5 rounded bg-brand-100 px-1 text-xs font-semibold text-brand-700 hover:bg-brand-200"
                onClick={() => onCite(byMarker.get(m[1]))}
              >
                {m[1]}
              </button>
            );
          }
          return <span key={i}>{p}</span>;
        })}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            result.grounded ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}
        >
          {result.grounded ? 'grounded' : 'not grounded'}
        </span>
        <span>confidence {Number(result.confidence ?? 0).toFixed(2)}</span>
        {result.llmProvider && <span>· {result.llmProvider}</span>}
      </div>

      {cites.length > 0 && (
        <div className="mt-2 space-y-1">
          {cites.map((c) => (
            <button
              key={c.chunkId}
              onClick={() => onCite(c)}
              className="block w-full truncate rounded border border-slate-200 bg-white px-2 py-1 text-left text-xs hover:border-brand-300"
            >
              <span className="font-semibold text-brand-700">[{c.marker}]</span> {c.filename} · p.
              {c.pageNumber} · sim {Number(c.score).toFixed(2)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceViewer({ citation, onClose }) {
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card max-h-[80vh] w-full max-w-lg overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">
            {citation.filename} — page {citation.pageNumber}
          </h3>
          <button className="text-slate-400 hover:text-slate-700" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="text-xs text-slate-500">
          citation [{citation.marker}] · similarity {Number(citation.score).toFixed(3)}
        </p>
        <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-relaxed">
          {citation.excerpt}
        </div>
      </div>
    </div>
  );
}
