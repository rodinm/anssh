import { useState, useEffect } from 'react';
import { X, Trash2, Server, Plus, Trash, Route } from 'lucide-react';
import type { Host, HostGroup, Credential, HostTunnelPreset, ConnectionProfile } from '../lib/types';

function flattenGroupsForSelect(groups: HostGroup[]): { id: string; label: string }[] {
  const childrenOf = (pid: string | null) =>
    [...groups].filter((g) => (g.parentId ?? null) === pid).sort((a, b) => a.order - b.order);
  const out: { id: string; label: string }[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const g of childrenOf(pid)) {
      const pad = depth > 0 ? `${'— '.repeat(depth)}` : '';
      out.push({ id: g.id, label: `${pad}${g.name}` });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

interface Props {
  host?: Host;
  groups: HostGroup[];
  allHosts: Host[];
  credentials: Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[];
  /** Create a group from the host form and select it */
  onCreateGroup?: (name: string, color?: string, ansibleGroupName?: string) => Promise<HostGroup | null>;
  onSave: (host: Partial<Host>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function newPreset(): HostTunnelPreset {
  return {
    id: crypto.randomUUID(),
    type: 'local',
    localHost: '127.0.0.1',
    localPort: 0,
    remoteHost: '127.0.0.1',
    remotePort: 0,
  };
}

export function HostEditor({
  host,
  groups,
  allHosts,
  credentials,
  onCreateGroup,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [name, setName] = useState(host?.name || '');
  const [hostname, setHostname] = useState(host?.hostname || '');
  const [port, setPort] = useState(host?.port?.toString() || '22');
  const [groupId, setGroupId] = useState(host?.groupId || '');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#4f98a3');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [credentialId, setCredentialId] = useState(host?.credentialId || '');
  const [jumpHostId, setJumpHostId] = useState(host?.jumpHostId || '');
  const [tunnelPresets, setTunnelPresets] = useState<HostTunnelPreset[]>(
    host?.tunnelPresets?.length ? host.tunnelPresets : []
  );
  const [tags, setTags] = useState(host?.tags?.join(', ') || '');
  const [connectionProfileId, setConnectionProfileId] = useState(host?.connectionProfileId || '');
  const [newGroupAnsible, setNewGroupAnsible] = useState('');
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.anssh.settings.get().then((s) => setProfiles(s.connectionProfiles));
  }, []);

  const jumpCandidates = allHosts.filter((h) => !host?.id || h.id !== host.id);

  async function handleSave() {
    if (!name.trim() || !hostname.trim()) return;
    setSaving(true);
    await onSave({
      ...(host?.id ? { id: host.id } : {}),
      name: name.trim(),
      hostname: hostname.trim(),
      port: parseInt(port, 10) || 22,
      groupId: groupId || null,
      credentialId: credentialId || null,
      jumpHostId: jumpHostId || null,
      tunnelPresets,
      connectionProfileId: connectionProfileId || null,
      ansibleHostKey: host?.ansibleHostKey ?? null,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setSaving(false);
  }

  function updatePreset(id: string, patch: Partial<HostTunnelPreset>) {
    setTunnelPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePreset(id: string) {
    setTunnelPresets((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleCreateGroup() {
    if (!onCreateGroup || !newGroupName.trim()) return;
    setCreatingGroup(true);
    try {
      const g = await onCreateGroup(newGroupName.trim(), newGroupColor, newGroupAnsible.trim() || undefined);
      if (g) {
        setGroupId(g.id);
        setShowNewGroup(false);
        setNewGroupName('');
        setNewGroupColor('#4f98a3');
      }
    } finally {
      setCreatingGroup(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-surface border border-border rounded-xl shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-text">
              {host ? 'Edit host' : 'New host'}
            </h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
                placeholder="Production Web"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Hostname</label>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
                placeholder="192.168.1.100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Group</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">No group</option>
              {flattenGroupsForSelect(groups).map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {onCreateGroup && (
              <>
                {!showNewGroup ? (
                  <button
                    type="button"
                    onClick={() => setShowNewGroup(true)}
                    className="mt-1.5 text-[10px] text-primary hover:text-primary-hover"
                  >
                    + Create group
                  </button>
                ) : (
                  <div className="mt-2 p-3 rounded-lg border border-border bg-bg space-y-2">
                    <input
                      type="text"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="New group name"
                      className="w-full h-8 px-2 bg-surface border border-border rounded text-xs text-text focus:outline-none focus:border-primary"
                      autoFocus
                    />
                    <input
                      type="text"
                      value={newGroupAnsible}
                      onChange={(e) => setNewGroupAnsible(e.target.value)}
                      placeholder="Ansible inventory group name (optional)"
                      className="w-full h-8 px-2 bg-surface border border-border rounded text-xs text-text focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="text-[10px] text-text-muted flex items-center gap-1.5">
                        <span>Color</span>
                        <input
                          type="color"
                          value={newGroupColor}
                          onChange={(e) => setNewGroupColor(e.target.value)}
                          className="w-8 h-7 rounded border border-border cursor-pointer bg-transparent"
                          title="Group label color"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleCreateGroup}
                        disabled={creatingGroup || !newGroupName.trim()}
                        className="h-7 px-2 rounded text-[10px] bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                      >
                        {creatingGroup ? '…' : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewGroup(false);
                          setNewGroupName('');
                          setNewGroupAnsible('');
                        }}
                        className="h-7 px-2 rounded text-[10px] text-text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Credential</label>
            <select
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">None selected</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.username})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
              <Route className="w-3.5 h-3.5" /> Jump host (ProxyJump)
            </label>
            <select
              value={jumpHostId}
              onChange={(e) => setJumpHostId(e.target.value)}
              className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">None — direct connection</option>
              {jumpCandidates.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.hostname}:{h.port})
                </option>
              ))}
            </select>
            <p className="text-[10px] text-text-faint mt-1">
              Connect to the jump host first, then the target. The jump host needs its own credential.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Connection profile</label>
            <select
              value={connectionProfileId}
              onChange={(e) => setConnectionProfileId(e.target.value)}
              className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text focus:outline-none focus:border-primary"
            >
              <option value="">None — use host jump/tunnels only</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-text-faint mt-1">
              Profile defaults (jump + tunnels) apply when the host does not set its own jump.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-muted">SSH tunnel presets</span>
              <button
                type="button"
                onClick={() => setTunnelPresets((p) => [...p, newPreset()])}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {tunnelPresets.length === 0 && (
                <p className="text-[10px] text-text-faint">Tunnels start automatically after the terminal connects.</p>
              )}
              {tunnelPresets.map((p) => (
                <div
                  key={p.id}
                  className="p-2 rounded-lg border border-border bg-bg space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <select
                      value={p.type}
                      onChange={(e) =>
                        updatePreset(p.id, { type: e.target.value as HostTunnelPreset['type'] })
                      }
                      className="flex-1 h-7 px-2 bg-surface border border-border rounded text-[11px] text-text"
                    >
                      <option value="local">Local</option>
                      <option value="remote">Remote</option>
                      <option value="dynamic">SOCKS</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removePreset(p.id)}
                      className="w-7 h-7 flex items-center justify-center rounded text-text-faint hover:text-error"
                      title="Remove"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      placeholder="Local address"
                      value={p.localHost}
                      onChange={(e) => updatePreset(p.id, { localHost: e.target.value })}
                      className="h-7 px-2 bg-surface border border-border rounded text-[11px]"
                    />
                    <input
                      type="number"
                      placeholder="Local port"
                      value={p.localPort || ''}
                      onChange={(e) =>
                        updatePreset(p.id, { localPort: parseInt(e.target.value, 10) || 0 })
                      }
                      className="h-7 px-2 bg-surface border border-border rounded text-[11px]"
                    />
                  </div>
                  {p.type !== 'dynamic' && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        placeholder="Remote host"
                        value={p.remoteHost}
                        onChange={(e) => updatePreset(p.id, { remoteHost: e.target.value })}
                        className="h-7 px-2 bg-surface border border-border rounded text-[11px]"
                      />
                      <input
                        type="number"
                        placeholder="Remote port"
                        value={p.remotePort || ''}
                        onChange={(e) =>
                          updatePreset(p.id, { remotePort: parseInt(e.target.value, 10) || 0 })
                        }
                        className="h-7 px-2 bg-surface border border-border rounded text-[11px]"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full h-9 px-3 bg-bg border border-border rounded-lg text-sm text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
              placeholder="production, web, nginx"
            />
          </div>

          {host?.ansibleHostKey && (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-text-muted">Inventory alias</label>
              <p className="text-xs font-mono text-text-muted bg-bg border border-border rounded px-2 py-1.5">
                {host.ansibleHostKey}
              </p>
            </div>
          )}
          {(host?.ansibleVarTags?.length ?? 0) > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Tags from host_vars / group_vars</label>
              <div className="flex flex-wrap gap-1">
                {host!.ansibleVarTags!.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-text-muted">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border flex-shrink-0">
          {onDelete ? (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-error hover:text-[var(--color-error-hover)]"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-8 px-3 rounded-lg text-xs text-text-muted hover:bg-bg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !hostname.trim()}
              className="h-8 px-4 bg-primary hover:bg-primary-hover text-white rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
