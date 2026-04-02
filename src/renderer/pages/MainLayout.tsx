import { useState, lazy, Suspense } from 'react';
import { Sidebar } from '../components/Sidebar';
import { TabBar } from '../components/TabBar';
import { TerminalView } from '../components/TerminalView';
import { EmptyState } from '../components/EmptyState';
import type { Host, HostGroup, Credential, Tab } from '../lib/types';

const SftpView = lazy(() =>
  import('../components/SftpView').then((m) => ({ default: m.SftpView }))
);
const HostEditor = lazy(() =>
  import('../components/HostEditor').then((m) => ({ default: m.HostEditor }))
);
const CredentialEditor = lazy(() =>
  import('../components/CredentialEditor').then((m) => ({ default: m.CredentialEditor }))
);
const SnippetPanel = lazy(() =>
  import('../components/SnippetPanel').then((m) => ({ default: m.SnippetPanel }))
);
const BroadcastBar = lazy(() =>
  import('../components/BroadcastBar').then((m) => ({ default: m.BroadcastBar }))
);
const TunnelDialog = lazy(() =>
  import('../components/TunnelDialog').then((m) => ({ default: m.TunnelDialog }))
);
const DevOpsPanel = lazy(() =>
  import('../components/DevOpsPanel').then((m) => ({ default: m.DevOpsPanel }))
);

function ModalFallback() {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/60 text-text-muted text-sm">
      Loading…
    </div>
  );
}

interface Props {
  hosts: Host[];
  groups: HostGroup[];
  credentials: Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[];
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onOpenTab: (host: Host, type: 'terminal' | 'sftp') => void;
  onCloseTab: (id: string) => void;
  onDuplicateTab?: (id: string) => void;
  onReorderTabs: (fromIndex: number, toIndex: number) => void;
  onCloseOtherTabs: (keepId: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToRight: (tabId: string) => void;
  onCloseTabsToLeft: (tabId: string) => void;
  onUpdateTab: (id: string, updates: Partial<Tab>) => void;
  onRefreshData: () => Promise<void>;
}

type Modal =
  | { type: 'host'; host?: Host }
  | { type: 'credential'; credential?: Partial<Credential> }
  | { type: 'tunnels' }
  | { type: 'devops' }
  | null;

export function MainLayout({
  hosts,
  groups,
  credentials,
  tabs,
  activeTabId,
  onSelectTab,
  onOpenTab,
  onCloseTab,
  onDuplicateTab,
  onReorderTabs,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onUpdateTab,
  onRefreshData,
}: Props) {
  const [modal, setModal] = useState<Modal>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSnippets, setShowSnippets] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeHost = activeTab ? hosts.find((h) => h.id === activeTab.hostId) : null;

  const sftpTabOptions = tabs
    .filter((t) => t.type === 'sftp')
    .map((t) => ({ sessionId: t.id, label: t.hostName }));

  /** Send a command to the active terminal session */
  function executeSnippet(command: string) {
    if (activeTab && activeTab.type === 'terminal') {
      window.anssh.ssh.write(activeTab.id, command);
    }
  }

  return (
    <div className="flex h-full">
      <Sidebar
        hosts={hosts}
        groups={groups}
        credentials={credentials}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onConnectTerminal={(host) => onOpenTab(host, 'terminal')}
        onConnectSftp={(host) => onOpenTab(host, 'sftp')}
        onEditHost={(host) => setModal({ type: 'host', host })}
        onNewHost={() => setModal({ type: 'host' })}
        onNewCredential={() => setModal({ type: 'credential' })}
        onEditCredential={(cred) => setModal({ type: 'credential', credential: cred })}
        onRefreshData={onRefreshData}
        onOpenDevOps={() => setModal({ type: 'devops' })}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {showBroadcast && (
          <Suspense fallback={null}>
            <BroadcastBar tabs={tabs} onClose={() => setShowBroadcast(false)} />
          </Suspense>
        )}

        {tabs.length > 0 && (
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={onSelectTab}
            onClose={onCloseTab}
            onDuplicate={onDuplicateTab}
            onReorderTabs={onReorderTabs}
            onCloseOtherTabs={onCloseOtherTabs}
            onCloseAllTabs={onCloseAllTabs}
            onCloseTabsToRight={onCloseTabsToRight}
            onCloseTabsToLeft={onCloseTabsToLeft}
            showBroadcast={showBroadcast}
            onToggleBroadcast={() => setShowBroadcast(!showBroadcast)}
            onToggleSnippets={() => setShowSnippets(!showSnippets)}
            onOpenTunnels={() => setModal({ type: 'tunnels' })}
            onOpenDevOps={() => setModal({ type: 'devops' })}
          />
        )}

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 relative overflow-hidden">
            {tabs.length === 0 && <EmptyState />}

            {/* SSH: keep all terminal tabs mounted so xterm scrollback survives tab switches */}
            {tabs.map((tab) => {
              if (tab.type !== 'terminal') return null;
              const host = hosts.find((h) => h.id === tab.hostId);
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`absolute inset-0 ${isActive ? 'z-10' : 'z-0 invisible pointer-events-none'}`}
                  aria-hidden={!isActive}
                >
                  {!host ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4 bg-bg text-text-muted px-6 text-center">
                      <p>
                        Host “{tab.hostName}” not found (it may have been removed from the list).
                      </p>
                      <button
                        type="button"
                        className="px-4 py-2 rounded-lg bg-accent text-bg text-sm hover:opacity-90"
                        onClick={() => onCloseTab(tab.id)}
                      >
                        Close tab
                      </button>
                    </div>
                  ) : (
                    <TerminalView tab={tab} host={host} onUpdateTab={onUpdateTab} />
                  )}
                </div>
              );
            })}

            {/* SFTP: one heavy panel, lazy-loaded; only mounted while this tab is active */}
            {activeTab?.type === 'sftp' &&
              (() => {
                const host = hosts.find((h) => h.id === activeTab.hostId);
                return (
                  <div className="absolute inset-0 z-10 bg-bg">
                    {!host ? (
                      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted px-6 text-center">
                        <p>
                          Host “{activeTab.hostName}” not found (it may have been removed from the list).
                        </p>
                        <button
                          type="button"
                          className="px-4 py-2 rounded-lg bg-accent text-bg text-sm hover:opacity-90"
                          onClick={() => onCloseTab(activeTab.id)}
                        >
                          Close tab
                        </button>
                      </div>
                    ) : (
                      <Suspense
                        fallback={
                          <div className="flex h-full items-center justify-center text-text-muted text-sm">
                            Loading SFTP…
                          </div>
                        }
                      >
                        <SftpView
                          tab={activeTab}
                          host={host}
                          onUpdateTab={onUpdateTab}
                          sftpTabs={sftpTabOptions}
                        />
                      </Suspense>
                    )}
                  </div>
                );
              })()}
          </div>

          {showSnippets && activeHost && activeTab?.type === 'terminal' && (
            <Suspense fallback={null}>
              <SnippetPanel
                hostId={activeHost.id}
                groupId={activeHost.groupId}
                hosts={hosts}
                groups={groups}
                onExecute={executeSnippet}
                onClose={() => setShowSnippets(false)}
              />
            </Suspense>
          )}
        </div>
      </div>

      <Suspense fallback={modal ? <ModalFallback /> : null}>
        {modal?.type === 'host' && (
          <HostEditor
            host={modal.host}
            groups={groups}
            allHosts={hosts}
            credentials={credentials}
            onCreateGroup={async (name, color, ansibleGroupName) => {
              const g = await window.anssh.groups.save({
                name,
                color: color || '#4f98a3',
                ansibleGroupName: ansibleGroupName || null,
              });
              await onRefreshData();
              return g;
            }}
            onSave={async (host) => {
              await window.anssh.hosts.save(host);
              await onRefreshData();
              setModal(null);
            }}
            onDelete={
              modal.host
                ? async () => {
                    await window.anssh.hosts.delete(modal.host!.id);
                    await onRefreshData();
                    setModal(null);
                  }
                : undefined
            }
            onClose={() => setModal(null)}
          />
        )}

        {modal?.type === 'credential' && (
          <CredentialEditor
            credential={modal.credential}
            onSave={async (cred) => {
              await window.anssh.credentials.save(cred);
              await onRefreshData();
              setModal(null);
            }}
            onDelete={
              modal.credential?.id
                ? async () => {
                    await window.anssh.credentials.delete(modal.credential!.id!);
                    await onRefreshData();
                    setModal(null);
                  }
                : undefined
            }
            onClose={() => setModal(null)}
          />
        )}

        {modal?.type === 'tunnels' && (
          <TunnelDialog tabs={tabs} onClose={() => setModal(null)} />
        )}

        {modal?.type === 'devops' && (
          <DevOpsPanel hosts={hosts} onClose={() => setModal(null)} onRefresh={onRefreshData} />
        )}
      </Suspense>
    </div>
  );
}
