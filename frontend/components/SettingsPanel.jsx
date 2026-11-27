'use client';
import { useEffect, useState } from 'react';
import api from '../lib/api';

const FIELDS = [
  { key: 'chunkSize', label: 'Chunk size (tokens)', type: 'number', min: 100, max: 4000 },
  { key: 'chunkOverlap', label: 'Chunk overlap (tokens)', type: 'number', min: 0, max: 1000 },
  { key: 'topK', label: 'Retrieved chunks (top-k)', type: 'number', min: 1, max: 25 },
  {
    key: 'confidenceThreshold',
    label: 'Confidence threshold',
    type: 'number',
    step: 0.01,
    min: 0,
    max: 1,
  },
  {
    key: 'retrievalStrategy',
    label: 'Retrieval strategy',
    type: 'select',
    options: ['vector', 'hybrid'],
  },
  {
    key: 'llmProvider',
    label: 'LLM provider',
    type: 'select',
    options: ['extractive', 'gemini', 'groq', 'openai'],
  },
  {
    key: 'embeddingProvider',
    label: 'Embedding provider',
    type: 'select',
    options: ['local', 'gemini'],
  },
];

export default function SettingsPanel({ workspaceId }) {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    api.getWorkspace(workspaceId).then((w) => {
      setSettings(w.settings);
      setDraft(w.settings);
    });
  }, [workspaceId]);

  if (!workspaceId) return null;
  if (!settings) return <div className="card p-4 text-sm text-slate-500">Loading settings…</div>;

  const changed = Object.keys(draft).filter((k) => draft[k] !== settings[k]);

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      const patch = {};
      for (const k of changed) {
        patch[k] = FIELDS.find((f) => f.key === k)?.type === 'number' ? Number(draft[k]) : draft[k];
      }
      const res = await api.updateSettings(workspaceId, patch);
      setSettings(res.settings);
      setDraft(res.settings);
      const rej = Object.keys(res.rejected || {});
      setMsg(rej.length ? `Saved. Rejected: ${rej.join(', ')}` : 'Settings saved.');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <h2 className="mb-1 text-xl font-semibold">Settings</h2>
      <p className="mb-3 text-xs text-slate-500">
        Dynamic config — applied on the next ingestion / query, no redeploy.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            {f.type === 'select' ? (
              <select
                className="input"
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type="number"
                step={f.step || 1}
                min={f.min}
                max={f.max}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy || changed.length === 0}>
          Save {changed.length ? `(${changed.length})` : ''}
        </button>
        {msg && <span className="text-xs text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
