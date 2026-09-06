'use client';
import { useEffect, useState } from 'react';
import api from '../lib/api';
import WorkspaceBar from '../components/WorkspaceBar';
import DocumentPanel from '../components/DocumentPanel';
import ChatPanel from '../components/ChatPanel';
import SettingsPanel from '../components/SettingsPanel';
import HistoryPanel from '../components/HistoryPanel';
import RisksModal from '../components/RisksModal';

const TABS = ['Documents', 'Settings', 'History'];

export default function Page() {
  const [workspaces, setWorkspaces] = useState([]);
  const [current, setCurrent] = useState('');
  const [tab, setTab] = useState('Documents');
  const [risksDoc, setRisksDoc] = useState(null);
  const [error, setError] = useState('');

  const loadWorkspaces = async () => {
    try {
      const list = await api.listWorkspaces();
      setWorkspaces(list);
      setCurrent((c) => c || list[0]?._id || '');
    } catch (e) {
      setError(`Backend unreachable: ${e.message}`);
    }
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const createWorkspace = async (name) => {
    const ws = await api.createWorkspace(name);
    setWorkspaces((w) => [ws, ...w]);
    setCurrent(ws._id);
  };

  return (
    <main>
      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error} — is the API running on :4000?
        </div>
      )}

      <WorkspaceBar
        workspaces={workspaces}
        current={current}
        onSelect={setCurrent}
        onCreate={createWorkspace}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="flex gap-2">
            {TABS.map((t) => (
              <button
                key={t}
                className={`btn ${tab === t ? 'bg-slate-800 text-white' : 'btn-ghost'}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'Documents' && (
            <DocumentPanel workspaceId={current} onOpenRisks={setRisksDoc} />
          )}
          {tab === 'Settings' && <SettingsPanel workspaceId={current} />}
          {tab === 'History' && <HistoryPanel workspaceId={current} refreshKey={tab} />}
        </div>

        <ChatPanel workspaceId={current} />
      </div>

      {risksDoc && <RisksModal doc={risksDoc} onClose={() => setRisksDoc(null)} />}
    </main>
  );
}
