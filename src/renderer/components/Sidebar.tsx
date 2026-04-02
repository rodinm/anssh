import { useState, type ReactNode } from 'react';
import {
  Search, Plus, Server, FolderOpen, Key, ChevronRight, ChevronDown,
  Terminal, HardDrive, Edit, Trash2, Download, Upload, FileJson, ListChecks,
  Sun, Moon, FolderGit2, MoreVertical, Unplug,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import type { Host, HostGroup, Credential } from '../lib/types';

interface Props {
  hosts: Host[];
  groups: HostGroup[];
  credentials: Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onConnectTerminal: (host: Host) => void;
  onConnectSftp: (host: Host) => void;
  onEditHost: (host: Host) => void;
  onNewHost: () => void;
  onNewCredential: () => void;
  onEditCredential: (cred: Partial<Credential>) => void;
  onRefreshData: () => Promise<void>;
  onOpenDevOps?: () => void;
  onOpenTabsForHosts: (hosts: Host[], type: 'terminal' | 'sftp') => void;
  onCloseTabsForHosts: (hosts: Host[]) => void;
}

export function Sidebar({
  hosts,
  groups,
  credentials,
  searchQuery,
  onSearchChange,
  onConnectTerminal,
  onConnectSftp,
  onEditHost,
  onNewHost,
  onNewCredential,
  onEditCredential,
  onRefreshData,
  onOpenDevOps,
  onOpenTabsForHosts,
  onCloseTabsForHosts,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__ungrouped__']));
  const [activeSection, setActiveSection] = useState<'hosts' | 'credentials'>('hosts');
  const [contextMenu, setContextMenu] = useState<{ hostId: string; x: number; y: number } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<
    | { kind: 'group'; groupId: string; x: number; y: number }
    | { kind: 'ungrouped'; x: number; y: number }
    | null
  >(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<'off' | 'hosts' | 'groups'>('off');
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredHosts = hosts.filter(
    (h) =>
      h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const ungroupedHosts = filteredHosts.filter((h) => !h.groupId);
  const rootGroups = groups
    .filter((g) => g.parentId === null)
    .sort((a, b) => a.order - b.order);

  function childGroupsOf(parentId: string) {
    return groups
      .filter((g) => g.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }

  function collectDescendantGroupIds(groupId: string): Set<string> {
    const ids = new Set<string>([groupId]);
    const walk = (id: string) => {
      for (const g of groups) {
        if (g.parentId === id) {
          ids.add(g.id);
          walk(g.id);
        }
      }
    };
    walk(groupId);
    return ids;
  }

  function countHostsInGroupSubtree(groupId: string, hostList: Host[]) {
    const gids = collectDescendantGroupIds(groupId);
    return hostList.filter((h) => h.groupId !== null && gids.has(h.groupId)).length;
  }

  function groupVisibleInSearch(groupId: string): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const grp = groups.find((x) => x.id === groupId);
    if (grp?.name.toLowerCase().includes(q)) return true;
    if (countHostsInGroupSubtree(groupId, filteredHosts) > 0) return true;
    for (const c of childGroupsOf(groupId)) {
      if (groupVisibleInSearch(c.id)) return true;
    }
    return false;
  }

  function handleContextMenu(e: React.MouseEvent, hostId: string) {
    e.preventDefault();
    setGroupContextMenu(null);
    setContextMenu({ hostId, x: e.clientX, y: e.clientY });
  }

  function openGroupContextMenu(
    e: React.MouseEvent,
    spec: { kind: 'group'; groupId: string } | { kind: 'ungrouped' }
  ) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null);
    setGroupContextMenu({ ...spec, x: e.clientX, y: e.clientY });
  }

  function hostsForGroupActions(groupId: string): Host[] {
    const gids = collectDescendantGroupIds(groupId);
    return hosts.filter((h) => h.groupId !== null && gids.has(h.groupId));
  }

  function hostsForUngroupedActions(): Host[] {
    return hosts.filter((h) => !h.groupId);
  }

  function showNotification(msg: string) {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  }

  async function handleAnsibleImport() {
    const result = await window.anssh.ansible.import();
    if (result.success) {
      await onRefreshData();
      showNotification(
        `Import: ${result.imported} hosts, ${result.skipped} skipped, ${result.groups} groups`
      );
    } else if (result.error !== 'Cancelled') {
      showNotification(`Error: ${result.error}`);
    }
  }

  async function handleExportProfiles() {
    const result = await window.anssh.profiles.export();
    if (result.success) {
      showNotification(`Exported: ${result.hostsCount} hosts, ${result.groupsCount} groups`);
    } else if (result.error !== 'Cancelled') {
      showNotification(`Error: ${result.error}`);
    }
  }

  function exitBulkMode() {
    setBulkMode('off');
    setSelectedHostIds(new Set());
    setSelectedGroupIds(new Set());
  }

  function toggleHostSelected(id: string) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroupSelected(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisibleHosts() {
    setSelectedHostIds(new Set(filteredHosts.map((h) => h.id)));
  }

  function selectAllGroups() {
    setSelectedGroupIds(new Set(groups.map((g) => g.id)));
  }

  async function handleBulkDeleteHosts() {
    if (selectedHostIds.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedHostIds.size} host(s)? This cannot be undone.`
      )
    ) {
      return;
    }
    await window.anssh.hosts.deleteMany([...selectedHostIds]);
    await onRefreshData();
    showNotification(`Deleted hosts: ${selectedHostIds.size}`);
    exitBulkMode();
  }

  async function handleBulkDeleteGroups() {
    if (selectedGroupIds.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedGroupIds.size} group(s)? Hosts in those groups will become ungrouped.`
      )
    ) {
      return;
    }
    const n = await window.anssh.groups.deleteMany([...selectedGroupIds]);
    await onRefreshData();
    showNotification(`Deleted groups: ${n}`);
    exitBulkMode();
  }

  async function handleImportProfiles() {
    const result = await window.anssh.profiles.import();
    if (result.success) {
      await onRefreshData();
      showNotification(
        `Import: ${result.importedHosts} hosts, ${result.skippedHosts} skipped, new groups: ${result.importedGroups}`
      );
    } else if (result.error !== 'Cancelled') {
      showNotification(`Error: ${result.error}`);
    }
  }

  async function deleteGroupSingle(group: HostGroup, e: React.MouseEvent) {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete group “${group.name}”?\n\nHosts in this group will become ungrouped.`
      )
    ) {
      return;
    }
    await window.anssh.groups.delete(group.id);
    await onRefreshData();
    showNotification(`Group “${group.name}” deleted`);
  }

  async function deleteHostSingle(host: Host, e: React.MouseEvent) {
    e.stopPropagation();
    if (
      !window.confirm(
        `Delete host “${host.name}” (${host.hostname}:${host.port})?\n\nThis cannot be undone.`
      )
    ) {
      return;
    }
    await window.anssh.hosts.delete(host.id);
    await onRefreshData();
    showNotification(`Host “${host.name}” deleted`);
  }

  function renderGroupNode(group: HostGroup, depth: number): ReactNode {
    if (!groupVisibleInSearch(group.id)) return null;
    const directHosts = filteredHosts.filter((h) => h.groupId === group.id);
    const badgeCount = searchQuery.trim()
      ? countHostsInGroupSubtree(group.id, filteredHosts)
      : countHostsInGroupSubtree(group.id, hosts);
    const kids = childGroupsOf(group.id);

    return (
      <div key={group.id} className="mb-0.5" style={{ marginLeft: depth === 0 ? 0 : 8 }}>
        <div
          className={`flex items-center gap-0.5 w-full rounded-md px-1 transition-colors ${
            bulkMode === 'groups' && selectedGroupIds.has(group.id)
              ? 'bg-sidebar-selected hover:bg-sidebar-hover-on-selected'
              : 'hover:bg-sidebar-hover'
          }`}
        >
          {bulkMode === 'groups' && (
            <input
              type="checkbox"
              className="rounded border-border w-3.5 h-3.5 flex-shrink-0 accent-primary"
              checked={selectedGroupIds.has(group.id)}
              onChange={() => toggleGroupSelected(group.id)}
              title="Select group"
            />
          )}
          <div
            className="flex-1 flex items-center min-w-0"
            onContextMenu={(e) => openGroupContextMenu(e, { kind: 'group', groupId: group.id })}
          >
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="flex-1 flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-xs min-w-0 text-left"
            >
              {expandedGroups.has(group.id) ? (
                <ChevronDown className="w-3 h-3 text-text-faint flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-text-faint flex-shrink-0" />
              )}
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: group.color }}
              />
              <span className="text-text-muted font-medium truncate">{group.name}</span>
              <span className="text-text-faint ml-auto text-[10px] flex-shrink-0">{badgeCount}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={(e) => openGroupContextMenu(e, { kind: 'group', groupId: group.id })}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-sidebar-hover"
            title={`Actions for all hosts under “${group.name}”`}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => deleteGroupSingle(group, e)}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-error/80 hover:text-error hover:bg-error/10"
            title={`Delete group “${group.name}”`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        {expandedGroups.has(group.id) && (
          <div className="min-w-0">
            {kids.map((c) => renderGroupNode(c, depth + 1))}
            {directHosts.length > 0 && (
              <div className="ml-3">
                {directHosts.map((host) => (
                  <HostItem
                    key={host.id}
                    host={host}
                    bulkHosts={bulkMode === 'hosts'}
                    hostSelected={selectedHostIds.has(host.id)}
                    onToggleHostSelect={() => toggleHostSelected(host.id)}
                    onConnect={() => onConnectTerminal(host)}
                    onSftp={() => onConnectSftp(host)}
                    onDelete={(e) => deleteHostSingle(host, e)}
                    onContextMenu={(e) => handleContextMenu(e, host.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-64 h-full bg-surface border-r border-border flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-semibold text-text tracking-tight">AnSSH</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-surface-2)] text-text-muted hover:text-text"
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              if (bulkMode !== 'off') exitBulkMode();
              else setBulkMode('hosts');
            }}
            className={`flex items-center gap-1 h-8 px-2 rounded-md border transition-colors ${
              bulkMode !== 'off'
                ? 'border-error/50 bg-error/10 text-error'
                : 'border-border hover:bg-[var(--color-surface-2)] text-text-muted hover:text-text'
            }`}
            title="Selection mode: pick hosts or groups and delete in bulk"
            type="button"
          >
            <ListChecks className="w-4 h-4 flex-shrink-0" />
            <span className="text-[10px] font-medium hidden min-[280px]:inline">Bulk delete</span>
          </button>
          <button
            onClick={onNewHost}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--color-surface-2)] text-text-muted hover:text-text"
            title="Add host"
            type="button"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="flex border-b border-border flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveSection('hosts')}
          className={`flex-1 h-9 text-xs font-medium transition-colors ${
            activeSection === 'hosts'
              ? 'text-primary border-b-2 border-primary'
              : 'text-text-muted hover:text-text hover:bg-sidebar-hover'
          }`}
        >
          Hosts
        </button>
        <button
          type="button"
          onClick={() => {
            exitBulkMode();
            setActiveSection('credentials');
          }}
          className={`flex-1 h-9 text-xs font-medium transition-colors ${
            activeSection === 'credentials'
              ? 'text-primary border-b-2 border-primary'
              : 'text-text-muted hover:text-text hover:bg-sidebar-hover'
          }`}
        >
          Credentials
        </button>
      </div>

      {/* Search */}
      <div className="p-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="w-full h-8 pl-8 pr-3 bg-bg border border-border rounded-md text-xs text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
          />
        </div>
        {activeSection === 'hosts' && bulkMode === 'off' && (
          <p className="px-2 pt-1.5 text-[10px] text-text-muted leading-snug">
            To <span className="text-error font-medium">delete multiple</span> hosts or groups, use{' '}
            <span className="font-medium text-text">Bulk delete</span> above.
          </p>
        )}
        {activeSection === 'hosts' && bulkMode !== 'off' && (
          <div className="mx-2 mt-1.5 p-2 rounded-lg border-2 border-error/35 bg-error/[0.07] flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold text-error uppercase tracking-wide">Delete</div>
            <div className="flex gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => {
                  setBulkMode('hosts');
                  setSelectedGroupIds(new Set());
                }}
                className={`px-2 py-0.5 rounded ${bulkMode === 'hosts' ? 'bg-primary/20 text-primary' : 'text-text-muted hover:text-text'}`}
              >
                Hosts
              </button>
              <button
                type="button"
                onClick={() => {
                  setBulkMode('groups');
                  setSelectedHostIds(new Set());
                }}
                className={`px-2 py-0.5 rounded ${bulkMode === 'groups' ? 'bg-primary/20 text-primary' : 'text-text-muted hover:text-text'}`}
              >
                Groups
              </button>
              <button type="button" onClick={exitBulkMode} className="ml-auto text-text-faint hover:text-text">
                Cancel
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {bulkMode === 'hosts' && (
                <>
                  <span className="text-[10px] text-text-muted">Selected: {selectedHostIds.size}</span>
                  <button
                    type="button"
                    onClick={selectAllVisibleHosts}
                    className="text-[10px] text-primary hover:underline"
                  >
                    All visible
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteHosts}
                    disabled={selectedHostIds.size === 0}
                    className="text-[10px] px-2.5 py-1 rounded-md font-medium bg-error text-white hover:bg-error/90 disabled:opacity-40 shadow-sm"
                  >
                    Delete hosts
                  </button>
                </>
              )}
              {bulkMode === 'groups' && (
                <>
                  <span className="text-[10px] text-text-muted">Selected: {selectedGroupIds.size}</span>
                  <button
                    type="button"
                    onClick={selectAllGroups}
                    className="text-[10px] text-primary hover:underline"
                  >
                    All groups
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkDeleteGroups}
                    disabled={selectedGroupIds.size === 0}
                    className="text-[10px] px-2.5 py-1 rounded-md font-medium bg-error text-white hover:bg-error/90 disabled:opacity-40 shadow-sm"
                  >
                    Delete groups
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {activeSection === 'hosts' && (
          <>
            {/* Group tree (inventory roots + nested Ansible groups) */}
            {rootGroups.map((g) => renderGroupNode(g, 0))}

            {/* Ungrouped hosts */}
            {ungroupedHosts.length > 0 && (
              <div className="mb-0.5">
                <div className="flex items-center gap-0.5 w-full rounded-md px-1 transition-colors hover:bg-sidebar-hover">
                  <div
                    className="flex-1 flex items-center min-w-0"
                    onContextMenu={(e) => openGroupContextMenu(e, { kind: 'ungrouped' })}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup('__ungrouped__')}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-left"
                    >
                      {expandedGroups.has('__ungrouped__') ? (
                        <ChevronDown className="w-3 h-3 text-text-faint flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-text-faint flex-shrink-0" />
                      )}
                      <FolderOpen className="w-3 h-3 text-text-faint flex-shrink-0" />
                      <span className="text-text-muted font-medium">Ungrouped</span>
                      <span className="text-text-faint ml-auto text-[10px] flex-shrink-0">
                        {ungroupedHosts.length}
                      </span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => openGroupContextMenu(e, { kind: 'ungrouped' })}
                    className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-sidebar-hover"
                    title="Actions for all ungrouped hosts"
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                </div>
                {expandedGroups.has('__ungrouped__') && (
                  <div className="ml-3">
                    {ungroupedHosts.map((host) => (
                      <HostItem
                        key={host.id}
                        host={host}
                        bulkHosts={bulkMode === 'hosts'}
                        hostSelected={selectedHostIds.has(host.id)}
                        onToggleHostSelect={() => toggleHostSelected(host.id)}
                        onConnect={() => onConnectTerminal(host)}
                        onSftp={() => onConnectSftp(host)}
                        onDelete={(e) => deleteHostSingle(host, e)}
                        onContextMenu={(e) => handleContextMenu(e, host.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {filteredHosts.length === 0 && (
              <div className="px-3 py-8 text-center">
                <Server className="w-8 h-8 text-text-faint mx-auto mb-2" />
                <p className="text-xs text-text-muted">
                  {searchQuery ? 'No matches' : 'No hosts'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={onNewHost}
                    className="mt-2 text-xs text-primary hover:text-primary-hover"
                  >
                    Add your first host
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {activeSection === 'credentials' && (
          <>
            {credentials.map((cred) => (
              <button
                key={cred.id}
                onClick={() => onEditCredential(cred)}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-sidebar-hover text-left group transition-colors"
              >
                <Key className="w-3.5 h-3.5 text-text-faint flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-text truncate">{cred.name}</div>
                  <div className="text-[10px] text-text-muted truncate">
                    {cred.username} · {cred.authType === 'password' ? 'password' : cred.authType === 'key' ? 'key' : 'key + password'}
                  </div>
                </div>
              </button>
            ))}
            {credentials.length === 0 && (
              <div className="px-3 py-8 text-center">
                <Key className="w-8 h-8 text-text-faint mx-auto mb-2" />
                <p className="text-xs text-text-muted">No credentials</p>
              </div>
            )}
            <button
              onClick={onNewCredential}
              className="w-full flex items-center gap-2 px-2 py-2 mt-1 rounded-md hover:bg-[var(--color-surface-2)] text-xs text-primary"
            >
              <Plus className="w-3.5 h-3.5" />
              Add credential
            </button>
          </>
        )}
      </div>

      {/* Bottom toolbar — Import / Export */}
      <div className="border-t border-border px-2 py-2 flex flex-col gap-1 flex-shrink-0">
        <div className="flex gap-1">
          {onOpenDevOps && (
            <button
              onClick={onOpenDevOps}
              className="flex-1 h-7 flex items-center justify-center gap-1 rounded-md hover:bg-[var(--color-surface-2)] text-[10px] text-text-muted hover:text-text"
              title="Git inventory sync, playbooks, browse, profiles, health"
              type="button"
            >
              <FolderGit2 className="w-3 h-3" /> Ansible+
            </button>
          )}
          <button
            onClick={handleAnsibleImport}
            className="flex-1 h-7 flex items-center justify-center gap-1 rounded-md hover:bg-[var(--color-surface-2)] text-[10px] text-text-muted hover:text-text"
            title="Import hosts from an Ansible inventory file (YAML / INI)"
            type="button"
          >
            <FileJson className="w-3 h-3 flex-shrink-0" /> Inventory
          </button>
          <button
            onClick={handleImportProfiles}
            className="flex-1 h-7 flex items-center justify-center gap-1 rounded-md hover:bg-[var(--color-surface-2)] text-[10px] text-text-muted hover:text-text"
            title="Import AnSSH profile backup (replaces hosts, groups, credentials in this vault)"
            type="button"
          >
            <Upload className="w-3 h-3 flex-shrink-0" /> Profiles
          </button>
          <button
            onClick={handleExportProfiles}
            className="flex-1 h-7 flex items-center justify-center gap-1 rounded-md hover:bg-[var(--color-surface-2)] text-[10px] text-text-muted hover:text-text"
            title="Export AnSSH profiles"
          >
            <Download className="w-3 h-3" /> Export
          </button>
        </div>
      </div>

      {/* Toast notification */}
      {notification && (
        <div className="absolute bottom-14 left-3 right-3 z-50 bg-surface-2 border border-border rounded-lg px-3 py-2 text-xs text-text shadow-lg animate-[fadeIn_200ms_ease]">
          {notification}
        </div>
      )}

      {/* Group / ungrouped bulk actions */}
      {groupContextMenu && (
        <GroupContextMenuOverlay
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          title={
            groupContextMenu.kind === 'group'
              ? groups.find((g) => g.id === groupContextMenu.groupId)?.name ?? 'Group'
              : 'Ungrouped'
          }
          hosts={
            groupContextMenu.kind === 'group'
              ? hostsForGroupActions(groupContextMenu.groupId)
              : hostsForUngroupedActions()
          }
          onClose={() => setGroupContextMenu(null)}
          onOpenAllTerminal={(list) => {
            onOpenTabsForHosts(list, 'terminal');
            setGroupContextMenu(null);
          }}
          onOpenAllSftp={(list) => {
            onOpenTabsForHosts(list, 'sftp');
            setGroupContextMenu(null);
          }}
          onCloseAllTabs={(list) => {
            onCloseTabsForHosts(list);
            setGroupContextMenu(null);
          }}
          onOpenDevOps={onOpenDevOps}
        />
      )}

      {/* Context menu overlay */}
      {contextMenu && (
        <ContextMenuOverlay
          x={contextMenu.x}
          y={contextMenu.y}
          host={hosts.find((h) => h.id === contextMenu.hostId)!}
          onClose={() => setContextMenu(null)}
          onConnectTerminal={() => {
            const host = hosts.find((h) => h.id === contextMenu.hostId)!;
            onConnectTerminal(host);
            setContextMenu(null);
          }}
          onConnectSftp={() => {
            const host = hosts.find((h) => h.id === contextMenu.hostId)!;
            onConnectSftp(host);
            setContextMenu(null);
          }}
          onEdit={() => {
            const host = hosts.find((h) => h.id === contextMenu.hostId)!;
            onEditHost(host);
            setContextMenu(null);
          }}
          onDelete={async () => {
            const h = hosts.find((x) => x.id === contextMenu.hostId);
            if (
              !window.confirm(
                h
                  ? `Delete host “${h.name}” (${h.hostname})?\n\nThis cannot be undone.`
                  : 'Delete this host? This cannot be undone.'
              )
            ) {
              setContextMenu(null);
              return;
            }
            await window.anssh.hosts.delete(contextMenu.hostId);
            await onRefreshData();
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}

function HostItem({
  host,
  bulkHosts,
  hostSelected,
  onToggleHostSelect,
  onConnect,
  onSftp,
  onDelete,
  onContextMenu,
}: {
  host: Host;
  bulkHosts: boolean;
  hostSelected: boolean;
  onToggleHostSelect: () => void;
  onConnect: () => void;
  onSftp: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md group cursor-default transition-colors ${
        bulkHosts && hostSelected
          ? 'bg-sidebar-selected hover:bg-sidebar-hover-on-selected'
          : 'hover:bg-sidebar-hover'
      }`}
      onContextMenu={onContextMenu}
      onDoubleClick={bulkHosts ? undefined : onConnect}
    >
      {bulkHosts && (
        <input
          type="checkbox"
          className="rounded border-border w-3.5 h-3.5 flex-shrink-0 accent-primary"
          checked={hostSelected}
          onChange={onToggleHostSelect}
          onClick={(e) => e.stopPropagation()}
          title="Select host"
        />
      )}
      <Server className="w-3.5 h-3.5 text-text-faint flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text truncate">{host.name}</div>
        <div className="text-[10px] text-text-muted truncate">{host.hostname}:{host.port}</div>
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          onClick={onDelete}
          className="w-6 h-6 flex items-center justify-center rounded text-error/70 hover:text-error hover:bg-error/10"
          title="Delete host"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onConnect();
          }}
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-sidebar-hover hover:text-primary"
          title="SSH"
        >
          <Terminal className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSftp();
          }}
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-sidebar-hover hover:text-primary"
          title="SFTP"
        >
          <HardDrive className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function GroupContextMenuOverlay({
  x,
  y,
  title,
  hosts: hostList,
  onClose,
  onOpenAllTerminal,
  onOpenAllSftp,
  onCloseAllTabs,
  onOpenDevOps,
}: {
  x: number;
  y: number;
  title: string;
  hosts: Host[];
  onClose: () => void;
  onOpenAllTerminal: (hosts: Host[]) => void;
  onOpenAllSftp: (hosts: Host[]) => void;
  onCloseAllTabs: (hosts: Host[]) => void;
  onOpenDevOps?: () => void;
}) {
  const n = hostList.length;
  const disabled = n === 0;
  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50 w-56 bg-surface border border-border rounded-lg shadow-lg py-1"
        style={{ left: x, top: y }}
      >
        <div className="px-3 py-1.5 text-[10px] text-text-muted border-b border-border truncate" title={title}>
          <span className="font-medium text-text">{title}</span>
          <span className="text-text-faint"> · {n} host{n === 1 ? '' : 's'}</span>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpenAllTerminal(hostList)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:pointer-events-none text-left"
        >
          <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
          Open SSH for all
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpenAllSftp(hostList)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:pointer-events-none text-left"
        >
          <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />
          Open SFTP for all
        </button>
        <div className="h-px bg-border my-1" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCloseAllTabs(hostList)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)] disabled:opacity-40 disabled:pointer-events-none text-left"
        >
          <Unplug className="w-3.5 h-3.5 flex-shrink-0" />
          Close all tabs (group)
        </button>
        {onOpenDevOps && (
          <>
            <div className="h-px bg-border my-1" />
            <button
              type="button"
              onClick={() => {
                onOpenDevOps();
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)] text-left"
            >
              <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" />
              Ansible+ (git, playbooks…)
            </button>
          </>
        )}
      </div>
    </>
  );
}

function ContextMenuOverlay({
  x,
  y,
  host: _host,
  onClose,
  onConnectTerminal,
  onConnectSftp,
  onEdit,
  onDelete,
}: {
  x: number;
  y: number;
  host: Host;
  onClose: () => void;
  onConnectTerminal: () => void;
  onConnectSftp: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50 w-48 bg-surface border border-border rounded-lg shadow-lg py-1"
        style={{ left: x, top: y }}
      >
        <button onClick={onConnectTerminal} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)]">
          <Terminal className="w-3.5 h-3.5" /> SSH terminal
        </button>
        <button onClick={onConnectSftp} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)]">
          <HardDrive className="w-3.5 h-3.5" /> SFTP
        </button>
        <div className="h-px bg-border my-1" />
        <button onClick={onEdit} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text hover:bg-[var(--color-surface-2)]">
          <Edit className="w-3.5 h-3.5" /> Edit
        </button>
        <button onClick={onDelete} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-error hover:bg-[var(--color-surface-2)]">
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
      </div>
    </>
  );
}
