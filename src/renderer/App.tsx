import { useState, useEffect, useCallback, useRef } from 'react';
import { VaultScreen } from './pages/VaultScreen';
import { VaultIncompatibleScreen } from './pages/VaultIncompatibleScreen';
import { MainLayout } from './pages/MainLayout';
import type { Host, HostGroup, Credential, Tab } from './lib/types';

export default function App() {
  const [vaultState, setVaultState] = useState<
    'loading' | 'create' | 'unlock' | 'unlocked' | 'vault-incompatible' | 'vault-error'
  >('loading');
  const [vaultIncompatibleDetail, setVaultIncompatibleDetail] = useState('');
  const [userDataPath, setUserDataPath] = useState('');
  const [vaultBootstrapError, setVaultBootstrapError] = useState('');
  const [hosts, setHosts] = useState<Host[]>([]);
  const [groups, setGroups] = useState<HostGroup[]>([]);
  const [credentials, setCredentials] = useState<Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const closeTabRef = useRef<(id: string) => void>(() => {});

  useEffect(() => {
    checkVault();
  }, []);

  // ── Global keyboard shortcuts (refs avoid stale closures and nested setState) ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;

      // Ctrl+W → close active tab
      if (isMod && e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        const id = activeTabIdRef.current;
        if (id) closeTabRef.current(id);
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab → next / prev tab
      if (isMod && e.key === 'Tab') {
        e.preventDefault();
        setTabs((currentTabs) => {
          if (currentTabs.length < 2) return currentTabs;
          const currentActive = activeTabIdRef.current;
          const idx = currentTabs.findIndex((t) => t.id === currentActive);
          if (idx === -1) return currentTabs;
          const dir = e.shiftKey ? -1 : 1;
          const nextIdx = (idx + dir + currentTabs.length) % currentTabs.length;
          const nextId = currentTabs[nextIdx].id;
          queueMicrotask(() => setActiveTabId(nextId));
          return currentTabs;
        });
        return;
      }

      // Ctrl+1..9 → switch to tab N
      if (isMod && e.key >= '1' && e.key <= '9' && !e.shiftKey) {
        e.preventDefault();
        const n = parseInt(e.key, 10) - 1;
        setTabs((currentTabs) => {
          if (n < currentTabs.length) {
            const id = currentTabs[n].id;
            queueMicrotask(() => setActiveTabId(id));
          }
          return currentTabs;
        });
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  async function checkVault() {
    setVaultBootstrapError('');
    try {
      if (!window.anssh?.vault?.bootstrap) {
        throw new Error(
          'The secure bridge to the app (preload) did not load. Reinstall AnSSH, or run a fresh build — clearing data files does not fix this.'
        );
      }
      const boot = await window.anssh.vault.bootstrap();
      if (boot.unlocked) {
        setVaultState('unlocked');
        await loadData();
      } else if (boot.vaultIncompatible) {
        setVaultIncompatibleDetail(
          boot.vaultIncompatibleDetail ?? 'This vault file uses an unsupported format.'
        );
        setUserDataPath(boot.userDataPath);
        setVaultState('vault-incompatible');
      } else if (!boot.exists) {
        setVaultState('create');
      } else {
        setVaultState('unlock');
      }
    } catch (e) {
      setVaultBootstrapError(e instanceof Error ? e.message : 'Could not initialize vault.');
      setVaultState('vault-error');
    }
  }

  async function loadData() {
    const [h, g, c] = await Promise.all([
      window.anssh.hosts.list(),
      window.anssh.groups.list(),
      window.anssh.credentials.list(),
    ]);
    setHosts(h);
    setGroups(g);
    setCredentials(c);
  }

  async function handleVaultCreate(password: string) {
    await window.anssh.vault.create(password);
    setVaultState('unlocked');
    await loadData();
  }

  async function handleVaultUnlock(password: string): Promise<boolean> {
    const ok = await window.anssh.vault.unlock(password);
    if (!ok) {
      return false;
    }
    setVaultState('unlocked');
    try {
      await loadData();
    } catch {
      await window.anssh.vault.lock();
      setVaultState('unlock');
      throw new Error('loadData failed');
    }
    return true;
  }

  const openTab = useCallback((host: Host, type: 'terminal' | 'sftp') => {
    const id = `${host.id}-${type}-${Date.now()}`;
    const tab: Tab = {
      id,
      type,
      hostId: host.id,
      hostName: host.name,
      title: `${host.name} (${type === 'terminal' ? 'SSH' : 'SFTP'})`,
      connected: false,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    window.anssh.ssh.disconnect(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabIdRef.current === tabId) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, []);

  /** Close several tabs and pick a sensible active tab if the current one closes */
  const closeTabIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    for (const id of ids) {
      window.anssh.ssh.disconnect(id);
    }
    setTabs((prev) => {
      const next = prev.filter((t) => !idSet.has(t.id));
      const cur = activeTabIdRef.current;
      if (cur && idSet.has(cur)) {
        const oldIdx = prev.findIndex((t) => t.id === cur);
        let newActive: string | null = null;
        for (let i = oldIdx - 1; i >= 0; i--) {
          if (!idSet.has(prev[i].id)) {
            newActive = prev[i].id;
            break;
          }
        }
        if (!newActive) {
          for (let i = oldIdx + 1; i < prev.length; i++) {
            if (!idSet.has(prev[i].id)) {
              newActive = prev[i].id;
              break;
            }
          }
        }
        setActiveTabId(newActive);
      }
      return next;
    });
  }, []);

  const closeOtherTabs = useCallback(
    (keepId: string) => {
      const toClose = tabs.filter((t) => t.id !== keepId).map((t) => t.id);
      closeTabIds(toClose);
    },
    [tabs, closeTabIds]
  );

  const closeAllTabs = useCallback(() => {
    closeTabIds(tabs.map((t) => t.id));
  }, [tabs, closeTabIds]);

  const closeTabsToRight = useCallback(
    (tabId: string) => {
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const toClose = tabs.slice(idx + 1).map((t) => t.id);
      closeTabIds(toClose);
    },
    [tabs, closeTabIds]
  );

  const closeTabsToLeft = useCallback(
    (tabId: string) => {
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const toClose = tabs.slice(0, idx).map((t) => t.id);
      closeTabIds(toClose);
    },
    [tabs, closeTabIds]
  );

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setTabs((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }, []);

  closeTabRef.current = closeTab;

  const updateTab = useCallback((tabId: string, updates: Partial<Tab>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)));
  }, []);

  const duplicateTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const h = hosts.find((x) => x.id === tab.hostId);
      if (!h) return;
      openTab(h, tab.type);
    },
    [tabs, hosts, openTab]
  );

  if (vaultState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full bg-bg">
        <div className="text-text-muted">Loading…</div>
      </div>
    );
  }

  if (vaultState === 'create' || vaultState === 'unlock') {
    return (
      <VaultScreen
        mode={vaultState}
        onCreate={handleVaultCreate}
        onUnlock={handleVaultUnlock}
      />
    );
  }

  if (vaultState === 'vault-incompatible') {
    return (
      <VaultIncompatibleScreen
        detail={vaultIncompatibleDetail}
        userDataPath={userDataPath}
        onRetry={() => void checkVault()}
      />
    );
  }

  if (vaultState === 'vault-error') {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-bg gap-4 px-6">
        <p className="text-error text-sm text-center max-w-md">{vaultBootstrapError}</p>
        <button
          type="button"
          onClick={() => void checkVault()}
          className="h-10 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <MainLayout
      hosts={hosts}
      groups={groups}
      credentials={credentials}
      tabs={tabs}
      activeTabId={activeTabId}
      onSelectTab={setActiveTabId}
      onOpenTab={openTab}
      onCloseTab={closeTab}
      onDuplicateTab={duplicateTab}
      onReorderTabs={reorderTabs}
      onCloseOtherTabs={closeOtherTabs}
      onCloseAllTabs={closeAllTabs}
      onCloseTabsToRight={closeTabsToRight}
      onCloseTabsToLeft={closeTabsToLeft}
      onUpdateTab={updateTab}
      onRefreshData={loadData}
    />
  );
}
