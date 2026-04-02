import { useState, useEffect } from 'react';
import { Play, Plus, Edit, Trash2, X, Globe, Users, Server, ChevronDown } from 'lucide-react';
import type { Snippet, Host, HostGroup } from '../lib/types';

interface Props {
  hostId: string;
  groupId: string | null;
  hosts: Host[];
  groups: HostGroup[];
  onExecute: (command: string) => void;
  onClose: () => void;
}

export function SnippetPanel({ hostId, groupId, hosts, groups, onExecute, onClose }: Props) {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editing, setEditing] = useState<Partial<Snippet> | null>(null);

  useEffect(() => { loadSnippets(); }, [hostId, groupId]);

  async function loadSnippets() {
    const list = await window.anssh.snippets.listForHost(hostId, groupId);
    setSnippets(list);
  }

  async function handleSave() {
    if (!editing?.name || !editing?.command) return;
    await window.anssh.snippets.save(editing as any);
    setEditing(null);
    await loadSnippets();
  }

  async function handleDelete(id: string) {
    await window.anssh.snippets.delete(id);
    await loadSnippets();
  }

  function scopeLabel(s: Snippet): string {
    if (s.scope === 'host') {
      const h = hosts.find((h) => h.id === s.scopeId);
      return h?.name || 'host';
    }
    if (s.scope === 'group') {
      const g = groups.find((g) => g.id === s.scopeId);
      return g?.name || 'group';
    }
    return 'global';
  }

  function scopeIcon(s: Snippet) {
    if (s.scope === 'host') return <Server className="w-3 h-3" />;
    if (s.scope === 'group') return <Users className="w-3 h-3" />;
    return <Globe className="w-3 h-3" />;
  }

  return (
    <div className="w-72 h-full bg-surface border-l border-border flex flex-col flex-shrink-0">
      <div className="h-9 flex items-center justify-between px-3 border-b border-border flex-shrink-0">
        <span className="text-xs font-medium text-text">Quick commands</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing({ name: '', command: '', scope: 'global', scopeId: null })}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted hover:text-text"
            title="New command"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted hover:text-text"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor */}
      {editing && (
        <div className="p-3 border-b border-border space-y-2">
          <input
            type="text"
            value={editing.name || ''}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            className="w-full h-7 px-2 bg-bg border border-border rounded text-xs text-text placeholder:text-text-faint focus:outline-none focus:border-primary"
            placeholder="Name"
            autoFocus
          />
          <textarea
            value={editing.command || ''}
            onChange={(e) => setEditing({ ...editing, command: e.target.value })}
            className="w-full h-16 px-2 py-1 bg-bg border border-border rounded text-xs text-text font-mono placeholder:text-text-faint focus:outline-none focus:border-primary resize-none"
            placeholder="systemctl status nginx"
          />
          <div className="flex items-center gap-1">
            <select
              value={editing.scope || 'global'}
              onChange={(e) => {
                const scope = e.target.value as 'global' | 'group' | 'host';
                setEditing({
                  ...editing,
                  scope,
                  scopeId: scope === 'host' ? hostId : scope === 'group' ? groupId : null,
                });
              }}
              className="flex-1 h-7 px-2 bg-bg border border-border rounded text-xs text-text focus:outline-none focus:border-primary"
            >
              <option value="global">Global</option>
              <option value="group">Group</option>
              <option value="host">Host</option>
            </select>
          </div>
          <div className="flex items-center gap-1 justify-end">
            <button
              onClick={() => setEditing(null)}
              className="h-6 px-2 rounded text-xs text-text-muted hover:bg-bg"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!editing.name || !editing.command}
              className="h-6 px-3 bg-primary hover:bg-primary-hover text-white rounded text-xs disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Snippet list */}
      <div className="flex-1 overflow-y-auto">
        {snippets.length === 0 && !editing && (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-text-muted">No commands yet</p>
            <button
              onClick={() => setEditing({ name: '', command: '', scope: 'global', scopeId: null })}
              className="mt-2 text-xs text-primary hover:text-primary-hover"
            >
              Create one
            </button>
          </div>
        )}

        {snippets.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-2)] group border-b border-border"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-text-faint">{scopeIcon(s)}</span>
                <span className="text-xs font-medium text-text truncate">{s.name}</span>
              </div>
              <div className="text-[10px] text-text-muted font-mono truncate mt-0.5">
                {s.command}
              </div>
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={() => onExecute(s.command + '\n')}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-primary"
                title="Run"
              >
                <Play className="w-3 h-3" />
              </button>
              <button
                onClick={() => setEditing(s)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted"
                title="Edit"
              >
                <Edit className="w-3 h-3" />
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted hover:text-error"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
