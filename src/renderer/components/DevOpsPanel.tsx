import { useState, useEffect } from 'react';
import { X, RefreshCw, Play, Loader2, Activity, FolderOpen, Trash2, Plus } from 'lucide-react';
import type { Host, AppSettings, ConnectionProfile, AnsibleCommandPreset } from '../lib/types';

type TabId = 'sync' | 'run' | 'browse' | 'profiles' | 'health';

interface Props {
  hosts: Host[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function DevOpsPanel({ hosts, onClose, onRefresh }: Props) {
  const [tab, setTab] = useState<TabId>('sync');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState('');
  const [msg, setMsg] = useState('');

  const [diffText, setDiffText] = useState('');
  const [createGroups, setCreateGroups] = useState(true);
  const [deleteRemoved, setDeleteRemoved] = useState(false);

  const [playbook, setPlaybook] = useState('site.yml');
  const [invPath, setInvPath] = useState('');
  const [cwd, setCwd] = useState('');
  const [limit, setLimit] = useState('');
  const [checkMode, setCheckMode] = useState(false);
  const [runOut, setRunOut] = useState('');

  const [browseRoot, setBrowseRoot] = useState('');
  const [treeText, setTreeText] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<{ path: string; line: number; preview: string }[]>([]);

  const [newProfName, setNewProfName] = useState('');
  const [newProfJump, setNewProfJump] = useState('');

  const [presetName, setPresetName] = useState('');
  const [presetCmd, setPresetCmd] = useState('');

  const [healthSel, setHealthSel] = useState<Set<string>>(new Set());
  const [healthRes, setHealthRes] = useState<{ host: string; port: number; ok: boolean; latencyMs?: number; error?: string }[]>([]);

  async function load() {
    const s = await window.anssh.settings.get();
    setSettings(s);
    const src0 = s.inventorySync.inventorySources?.[0];
    setInvPath(src0?.relativePath ?? s.inventorySync.inventoryRelativePath);
    setCwd(s.ansibleBrowseRoot || s.inventorySync.repoPath || '');
    setBrowseRoot(s.ansibleBrowseRoot || s.inventorySync.repoPath || '');
  }

  useEffect(() => {
    load();
  }, []);

  function treeToText(n: any, indent = 0): string {
    if (!n) return '';
    const pad = '  '.repeat(indent);
    if (n.type === 'file') return `${pad}${n.name}\n`;
    let o = `${pad}${n.name}/\n`;
    for (const c of n.children || []) o += treeToText(c, indent + 1);
    return o;
  }

  async function handlePull() {
    if (!settings) return;
    setLoading('pull');
    setMsg('');
    await window.anssh.settings.update({ inventorySync: settings.inventorySync });
    const r = await window.anssh.inventory.pull();
    setLoading('');
    if (r.success) setMsg(`Pulled. HEAD: ${r.head || '—'}`);
    else setMsg(`Error: ${r.error}`);
    await load();
  }

  async function handleDiff() {
    if (!settings) return;
    setLoading('diff');
    setMsg('');
    await window.anssh.settings.update({ inventorySync: settings.inventorySync });
    const r = await window.anssh.inventory.diff();
    setLoading('');
    if (!r.success || !r.diff) {
      setDiffText(r.error || 'Failed');
      return;
    }
    const d = r.diff;
    const lines: string[] = [];
    lines.push(`Parsed hosts: ${d.parsedCount}`);
    lines.push(`Added (${d.added.length}):`);
    d.added.forEach((a) =>
      lines.push(
        `  + ${a.name} ${a.hostname}:${a.port} [${a.group}]${a.inventory ? ` · ${a.inventory}` : ''}`
      )
    );
    lines.push(`Removed (${d.removed.length}):`);
    d.removed.forEach((x) => lines.push(`  - ${x.name} (${x.ansibleHostKey})`));
    lines.push(`Updated (${d.updated.length}):`);
    d.updated.forEach((u) => lines.push(`  ~ ${u.name}: ${u.changes.join(', ')}`));
    setDiffText(lines.join('\n'));
  }

  async function handleApply() {
    setLoading('apply');
    const r = await window.anssh.inventory.apply({
      createMissingGroups: createGroups,
      deleteRemovedHosts: deleteRemoved,
    });
    setLoading('');
    if (r.success) {
      setMsg(`Applied: +${r.imported ?? 0} ~${r.updated ?? 0} -${r.deleted ?? 0}`);
      await onRefresh();
    } else setMsg(`Error: ${r.error}`);
  }

  async function handleRunPlaybook() {
    if (!settings) return;
    const repo = settings.inventorySync.repoPath;
    const base = cwd || repo;
    const inventoryAbs = invPath.startsWith('/') ? invPath : `${repo.replace(/\/$/, '')}/${invPath || settings.inventorySync.inventoryRelativePath}`;
    setLoading('ansible');
    setRunOut('');
    const r = await window.anssh.ansible.runPlaybook({
      cwd: base,
      playbookPath: playbook,
      inventoryPath: inventoryAbs,
      limit: limit.trim() || undefined,
      check: checkMode,
    });
    setLoading('');
    if (r.success) setRunOut(`exit ${r.code}\n${r.stdout || ''}\n${r.stderr || ''}`);
    else setRunOut(r.error || 'failed');
  }

  async function pickRepo() {
    const p = await window.anssh.dialog.openDirectory();
    if (p && settings) {
      const next = { ...settings.inventorySync, repoPath: p };
      setSettings({ ...settings, inventorySync: next });
    }
  }

  async function pickCwd() {
    const p = await window.anssh.dialog.openDirectory();
    if (p) {
      setCwd(p);
      if (settings) await window.anssh.settings.update({ ansibleBrowseRoot: p });
    }
  }

  async function saveSettingsPatch(patch: Partial<AppSettings>) {
    const s = await window.anssh.settings.update(patch);
    setSettings(s);
  }

  async function loadTree() {
    const root = browseRoot || settings?.inventorySync.repoPath;
    if (!root) return;
    setLoading('tree');
    const r = await window.anssh.ansible.tree(root);
    setLoading('');
    if (r.success && r.tree) setTreeText(treeToText(r.tree));
    else setTreeText(r.error || 'failed');
  }

  async function doSearch() {
    const root = browseRoot || settings?.inventorySync.repoPath;
    if (!root || !searchQ.trim()) return;
    setLoading('search');
    const r = await window.anssh.ansible.search(root, searchQ.trim());
    setLoading('');
    if (r.success && r.hits) setSearchHits(r.hits);
  }

  async function runHealth() {
    const targets = hosts
      .filter((h) => healthSel.has(h.id))
      .map((h) => ({ host: h.hostname, port: h.port }));
    if (targets.length === 0) return;
    setLoading('health');
    const r = await window.anssh.health.probe(targets);
    setLoading('');
    setHealthRes(r);
  }

  if (!settings) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const inv = settings.inventorySync;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-surface border border-border rounded-xl shadow-lg flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Ansible & inventory</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-bg text-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-border px-2 gap-1 flex-wrap">
          {(
            [
              ['sync', 'Git sync'],
              ['run', 'Playbooks'],
              ['browse', 'Browse repo'],
              ['profiles', 'Profiles'],
              ['health', 'Health'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`px-3 py-2 text-xs font-medium rounded-t-md ${
                tab === id ? 'bg-bg text-primary border border-b-0 border-border' : 'text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-xs space-y-3">
          {msg && <p className="text-primary">{msg}</p>}

          {tab === 'sync' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={inv.enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      inventorySync: { ...inv, enabled: e.target.checked },
                    })
                  }
                />
                Periodic git pull (interval below)
              </label>
              <div className="grid gap-2">
                <div className="flex gap-2">
                  <input
                    className="flex-1 h-8 px-2 bg-bg border border-border rounded"
                    value={inv.repoPath}
                    placeholder="Local clone path"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        inventorySync: { ...inv, repoPath: e.target.value },
                      })
                    }
                  />
                  <button type="button" onClick={pickRepo} className="h-8 px-2 border border-border rounded flex items-center gap-1">
                    <FolderOpen className="w-3 h-3" /> Browse
                  </button>
                </div>
                <input
                  className="h-8 px-2 bg-bg border border-border rounded"
                  value={inv.branch}
                  placeholder="branch"
                  onChange={(e) =>
                    setSettings({ ...settings, inventorySync: { ...inv, branch: e.target.value } })
                  }
                />
                <div className="space-y-2">
                  <p className="text-[10px] text-text-muted leading-snug">
                    Multiple inventory files (Hadoop, Greenplum, …). Each <strong className="text-text">name</strong>{' '}
                    is a top-level group; Ansible groups nest underneath. Tab titles use the name for hosts imported
                    from git sync.
                  </p>
                  {(inv.inventorySources ?? []).map((src, i) => (
                    <div key={src.id} className="flex flex-wrap gap-2 items-center">
                      <input
                        className="w-36 h-8 px-2 bg-bg border border-border rounded text-xs"
                        placeholder="Display name"
                        value={src.name}
                        onChange={(e) => {
                          const arr = [...(inv.inventorySources ?? [])];
                          arr[i] = { ...src, name: e.target.value };
                          setSettings({
                            ...settings,
                            inventorySync: {
                              ...inv,
                              inventorySources: arr,
                              inventoryRelativePath: arr[0]?.relativePath ?? inv.inventoryRelativePath,
                            },
                          });
                        }}
                      />
                      <input
                        className="flex-1 min-w-[160px] h-8 px-2 bg-bg border border-border rounded text-xs font-mono"
                        placeholder="path/inside/repo.ini"
                        value={src.relativePath}
                        onChange={(e) => {
                          const arr = [...(inv.inventorySources ?? [])];
                          arr[i] = { ...src, relativePath: e.target.value };
                          setSettings({
                            ...settings,
                            inventorySync: {
                              ...inv,
                              inventorySources: arr,
                              inventoryRelativePath: arr[0]?.relativePath ?? inv.inventoryRelativePath,
                            },
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="h-8 px-2 text-error border border-border rounded disabled:opacity-40"
                        disabled={(inv.inventorySources?.length ?? 0) <= 1}
                        title="At least one inventory file required"
                        onClick={() => {
                          const arr = (inv.inventorySources ?? []).filter((_, j) => j !== i);
                          setSettings({
                            ...settings,
                            inventorySync: {
                              ...inv,
                              inventorySources: arr,
                              inventoryRelativePath: arr[0]?.relativePath ?? inv.inventoryRelativePath,
                            },
                          });
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="h-8 px-2 border border-dashed border-border rounded text-[10px] text-text-muted flex items-center gap-1"
                    onClick={() => {
                      const arr = [...(inv.inventorySources ?? [])];
                      arr.push({
                        id: crypto.randomUUID(),
                        name: 'New inventory',
                        relativePath: 'inventory/hosts.ini',
                      });
                      setSettings({
                        ...settings,
                        inventorySync: {
                          ...inv,
                          inventorySources: arr,
                          inventoryRelativePath: arr[0]?.relativePath ?? inv.inventoryRelativePath,
                        },
                      });
                    }}
                  >
                    <Plus className="w-3 h-3" /> Add inventory file
                  </button>
                </div>
                <input
                  type="number"
                  min={0}
                  className="h-8 px-2 bg-bg border border-border rounded"
                  value={inv.intervalMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      inventorySync: { ...inv, intervalMinutes: parseInt(e.target.value, 10) || 0 },
                    })
                  }
                  placeholder="Interval minutes (0 = off)"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="h-8 px-2 bg-bg border border-border rounded"
                    value={inv.hostVarsRelative}
                    placeholder="host_vars dir"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        inventorySync: { ...inv, hostVarsRelative: e.target.value },
                      })
                    }
                  />
                  <input
                    className="h-8 px-2 bg-bg border border-border rounded"
                    value={inv.groupVarsRelative}
                    placeholder="group_vars dir"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        inventorySync: { ...inv, groupVarsRelative: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => saveSettingsPatch({ inventorySync: inv })}
                  className="h-8 px-3 bg-primary text-white rounded"
                >
                  Save settings
                </button>
                <button type="button" onClick={handlePull} disabled={!!loading} className="h-8 px-3 border border-border rounded flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Git pull
                </button>
                <button type="button" onClick={handleDiff} disabled={!!loading} className="h-8 px-3 border border-border rounded">
                  Preview diff
                </button>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={createGroups} onChange={(e) => setCreateGroups(e.target.checked)} />
                Create missing groups on apply
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={deleteRemoved} onChange={(e) => setDeleteRemoved(e.target.checked)} />
                Delete hosts removed from inventory (matched by inventory alias)
              </label>
              <button
                type="button"
                onClick={handleApply}
                disabled={!!loading}
                className="h-8 px-3 bg-error/90 text-white rounded"
              >
                Apply inventory to hosts
              </button>
              <pre className="text-[10px] bg-bg p-2 rounded border border-border whitespace-pre-wrap max-h-48 overflow-auto">
                {diffText || 'Run Preview diff after Save.'}
              </pre>
              <p className="text-text-faint text-[10px]">
                Last sync: {inv.lastSyncedAt || '—'} · HEAD: {inv.lastGitHead || '—'}
              </p>
            </div>
          )}

          {tab === 'run' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  className="flex-1 h-8 px-2 bg-bg border border-border rounded"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="Working directory (ansible root)"
                />
                <button type="button" onClick={pickCwd} className="h-8 px-2 border rounded">
                  Browse
                </button>
              </div>
              <input
                className="w-full h-8 px-2 bg-bg border border-border rounded"
                value={playbook}
                onChange={(e) => setPlaybook(e.target.value)}
                placeholder="playbook.yml"
              />
              <input
                className="w-full h-8 px-2 bg-bg border border-border rounded"
                value={invPath}
                onChange={(e) => setInvPath(e.target.value)}
                placeholder="Inventory path (relative to repo or absolute)"
              />
              <input
                className="w-full h-8 px-2 bg-bg border border-border rounded"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder="Limit (group/host pattern)"
              />
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={checkMode} onChange={(e) => setCheckMode(e.target.checked)} />
                Dry-run (--check)
              </label>
              <button
                type="button"
                onClick={handleRunPlaybook}
                disabled={!!loading}
                className="h-8 px-3 bg-primary text-white rounded flex items-center gap-1"
              >
                <Play className="w-3 h-3" /> Run ansible-playbook
              </button>
              <div className="border border-border rounded p-2 space-y-2">
                <div className="font-medium text-[10px] text-text-muted">Saved commands</div>
                {settings.ansibleCommands.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <button
                      type="button"
                      className="text-error"
                      onClick={async () => {
                        const next = settings.ansibleCommands.filter((x) => x.id !== c.id);
                        await saveSettingsPatch({ ansibleCommands: next });
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1">
                  <input
                    className="flex-1 h-7 px-1 border border-border rounded"
                    placeholder="Name"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                  />
                  <input
                    className="flex-[2] h-7 px-1 border border-border rounded font-mono"
                    placeholder="ansible-playbook args…"
                    value={presetCmd}
                    onChange={(e) => setPresetCmd(e.target.value)}
                  />
                  <button
                    type="button"
                    className="h-7 px-2 bg-bg border rounded"
                    onClick={async () => {
                      if (!presetName.trim() || !presetCmd.trim()) return;
                      const p: AnsibleCommandPreset = {
                        id: crypto.randomUUID(),
                        name: presetName.trim(),
                        command: presetCmd.trim(),
                        cwd: cwd || settings.inventorySync.repoPath,
                        order: settings.ansibleCommands.length,
                      };
                      await saveSettingsPatch({ ansibleCommands: [...settings.ansibleCommands, p] });
                      setPresetName('');
                      setPresetCmd('');
                    }}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <pre className="text-[10px] bg-bg p-2 rounded border border-border whitespace-pre-wrap max-h-56 overflow-auto">
                {runOut}
              </pre>
            </div>
          )}

          {tab === 'browse' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  className="flex-1 h-8 px-2 bg-bg border border-border rounded"
                  value={browseRoot}
                  onChange={(e) => setBrowseRoot(e.target.value)}
                  placeholder="Repository root"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const p = await window.anssh.dialog.openDirectory();
                    if (p) setBrowseRoot(p);
                  }}
                  className="h-8 px-2 border rounded"
                >
                  Browse
                </button>
                <button type="button" onClick={loadTree} className="h-8 px-2 border rounded">
                  Load tree
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-8 px-2 bg-bg border border-border rounded"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Search in .yml .yaml .ini…"
                />
                <button type="button" onClick={doSearch} className="h-8 px-2 border rounded">
                  Search
                </button>
              </div>
              <pre className="text-[10px] bg-bg p-2 rounded border max-h-40 overflow-auto">{treeText}</pre>
              <ul className="space-y-1 max-h-40 overflow-auto">
                {searchHits.map((h, i) => (
                  <li key={i} className="font-mono text-[10px] text-text-muted">
                    {h.path}:{h.line} — {h.preview}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === 'profiles' && (
            <div className="space-y-3">
              <p className="text-text-muted text-[10px]">
                Connection profiles supply default jump host and tunnel presets. Host-specific jump overrides the profile.
              </p>
              {settings.connectionProfiles.map((p) => (
                <div key={p.id} className="flex items-center justify-between border border-border rounded p-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-text-faint text-[10px]">
                      Jump: {hosts.find((h) => h.id === p.jumpHostId)?.name || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-error"
                    onClick={async () => {
                      const next = settings.connectionProfiles.filter((x) => x.id !== p.id);
                      await saveSettingsPatch({ connectionProfiles: next });
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 flex-wrap">
                <input
                  className="h-8 px-2 border border-border rounded flex-1 min-w-[120px]"
                  placeholder="Profile name"
                  value={newProfName}
                  onChange={(e) => setNewProfName(e.target.value)}
                />
                <select
                  className="h-8 px-2 border border-border rounded"
                  value={newProfJump}
                  onChange={(e) => setNewProfJump(e.target.value)}
                >
                  <option value="">Jump host</option>
                  {hosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="h-8 px-3 bg-primary text-white rounded"
                  onClick={async () => {
                    if (!newProfName.trim()) return;
                    const p: ConnectionProfile = {
                      id: crypto.randomUUID(),
                      name: newProfName.trim(),
                      jumpHostId: newProfJump || null,
                      tunnelPresets: [],
                      order: settings.connectionProfiles.length,
                    };
                    await saveSettingsPatch({ connectionProfiles: [...settings.connectionProfiles, p] });
                    setNewProfName('');
                    setNewProfJump('');
                  }}
                >
                  Add profile
                </button>
              </div>
            </div>
          )}

          {tab === 'health' && (
            <div className="space-y-2">
              <p className="text-text-muted text-[10px]">TCP connect to port 22 (no SSH login).</p>
              <div className="flex gap-2 flex-wrap max-h-32 overflow-y-auto border border-border rounded p-2">
                {hosts.map((h) => (
                  <label key={h.id} className="flex items-center gap-1 text-[10px]">
                    <input
                      type="checkbox"
                      checked={healthSel.has(h.id)}
                      onChange={(e) => {
                        const n = new Set(healthSel);
                        if (e.target.checked) n.add(h.id);
                        else n.delete(h.id);
                        setHealthSel(n);
                      }}
                    />
                    {h.name}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setHealthSel(new Set(hosts.map((h) => h.id)))}
                  className="text-[10px] text-primary"
                >
                  Select all
                </button>
                <button type="button" onClick={() => setHealthSel(new Set())} className="text-[10px] text-primary">
                  Clear
                </button>
              </div>
              <button
                type="button"
                onClick={runHealth}
                disabled={!!loading || healthSel.size === 0}
                className="h-8 px-3 bg-primary text-white rounded flex items-center gap-1"
              >
                <Activity className="w-3 h-3" /> Probe
              </button>
              <table className="w-full text-[10px] border border-border">
                <thead>
                  <tr className="bg-bg">
                    <th className="text-left p-1">Host:port</th>
                    <th className="text-left p-1">OK</th>
                    <th className="text-left p-1">ms</th>
                    <th className="text-left p-1">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {healthRes.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-1 font-mono">
                        {r.host}:{r.port}
                      </td>
                      <td className="p-1">{r.ok ? 'yes' : 'no'}</td>
                      <td className="p-1">{r.latencyMs ?? '—'}</td>
                      <td className="p-1 text-error">{r.error || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60 rounded-xl">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
