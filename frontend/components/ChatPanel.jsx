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
      <h2 className="mb-3 text-xl font-semibold">Ask your documents</h2>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
        {turns.length === 0 && (
          <p className="max-w-prose font-serif text-[15px] leading-relaxed text-slate-600">
            Ask in plain words, or start with one of the questions below. Each answer is built only from
            passages in your documents, and the marked numbers open the page they came from.
          </p>
        )}
        {turns.map((t, i) => (
          <article key={i} className="border-t border-rule pt-3 first:border-t-0 first:pt-0">
            <h3 className="text-[17px] font-semibold leading-snug">{t.question}</h3>
            {t.result ? (
              <div className="mt-1.5 font-serif text-[15px]">
                <Answer result={t.result} onCite={setOpenCite} />
              </div>
            ) : (
              <p className="mt-1.5 text-sm text-slate-500">Reading the documents…</p>
            )}
          </article>
        ))}
      </div>

      {/* Recommended questions — always available, above the input */}
      <div className="mt-3 min-w-0 border-t border-rule pt-3">
        <p className="mb-1.5 text-sm text-slate-600">Try one of these</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {RECOMMENDED_QUESTIONS.map((rq) => (
            <button
              key={rq}
              disabled={!workspaceId || busy}
              onClick={() => ask(rq)}
              title={rq}
              className="shrink-0 whitespace-nowrap rounded border border-rule bg-paper px-3 py-1.5 text-xs text-ink hover:border-brand-400 disabled:opacity-50"
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
                className="cite"
                aria-label={`Open source ${m[1]}`}
                onClick={() => onCite(byMarker.get(m[1]))}
              >
                {m[1]}
              </button>
            );
          }
          return <span key={i}>{p}</span>;
        })}
      </p>

      <p className="mt-2 font-sans text-xs text-slate-500">
        <span className={result.grounded ? 'font-medium text-emerald-700' : 'font-medium text-brand-600'}>
          {result.grounded ? 'Backed by the documents' : 'Not found in the documents'}
        </span>
        {', '}confidence {Number(result.confidence ?? 0).toFixed(2)}
        {result.llmProvider === 'extractive' ? ', quoted from the text' : result.llmProvider && `, written by ${result.llmProvider}`}
      </p>

      {cites.length > 0 && (
        <div className="mt-2 space-y-1">
          {cites.map((c) => (
            <button
              key={c.chunkId}
              onClick={() => onCite(c)}
              className="block w-full truncate rounded border border-rule bg-white px-2 py-1 text-left font-sans text-xs hover:border-ink/40"
            >
              <span className="cite ml-0">{c.marker}</span> {c.filename}, page {c.pageNumber}
              <span className="text-slate-500"> (match {Number(c.score).toFixed(2)})</span>
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
      className="fixed inset-0 z-20 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="card max-h-[80vh] w-full max-w-lg overflow-y-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">
            {citation.filename}, page {citation.pageNumber}
          </h3>
          <button className="text-sm text-slate-500 hover:text-ink" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Source {citation.marker}, match {Number(citation.score).toFixed(3)}
        </p>
        <blockquote className="mt-3 whitespace-pre-wrap border-l-4 border-mark bg-paper p-3 font-serif text-[15px] leading-relaxed">
          {citation.excerpt}
        </blockquote>
      </div>
    </div>
  );
}
