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
      setError(`Can't reach the docIQ server (${e.message}). If it was idle it may be waking up: reload in a minute.`);
    }
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  // Document and query calls carry the key of the open workspace.
  api.use(current);

  const createWorkspace = async (name) => {
    const ws = await api.createWorkspace(name);
    setWorkspaces((w) => [ws, ...w]);
    setCurrent(ws._id);
  };

  return (
    <main>
      {error && (
        <div className="mb-4 rounded border border-brand-200 bg-brand-50 p-3 text-sm text-brand-700">
          {error}
        </div>
      )}

      <WorkspaceBar
        workspaces={workspaces}
        current={current}
        onSelect={setCurrent}
        onCreate={createWorkspace}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-4">
          <div className="flex gap-5 border-b border-rule" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`-mb-px border-b-2 pb-2 text-sm font-medium ${
                  tab === t ? 'border-brand-600 text-ink' : 'border-transparent text-slate-500 hover:text-ink'
                }`}
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
