'use client';
import { useState } from 'react';

export default function WorkspaceBar({ workspaces, current, onSelect, onCreate }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
      <span className="label mb-0">Workspace</span>
      <select
        className="input max-w-xs"
        value={current || ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>
          Select a workspace…
        </option>
        {workspaces.map((w) => (
          <option key={w._id} value={w._id}>
            {w.name}
          </option>
        ))}
      </select>
      <div className="ml-auto flex items-center gap-2">
        <input
          className="input w-48"
          placeholder="New workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
          Create
        </button>
      </div>
    </div>
  );
}
