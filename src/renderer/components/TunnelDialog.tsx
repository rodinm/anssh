import { useState, useEffect } from 'react';
import { X, Plus, Trash2, ArrowRightLeft, Globe, ArrowUpRight, ArrowDownLeft, Plug } from 'lucide-react';
import type { TunnelConfig, Tab } from '../lib/types';

interface Props {
  tabs: Tab[];
  onClose: () => void;
}

export function TunnelDialog({ tabs, onClose }: Props) {
  const [tunnels, setTunnels] = useState<TunnelConfig[]>([]);
  const [creating, setCreating] = useState(false);

  // Form state
  const [type, setType] = useState<'local' | 'remote' | 'dynamic'>('local');
  const [sessionId, setSessionId] = useState('');
  const [localHost, setLocalHost] = useState('127.0.0.1');
  const [localPort, setLocalPort] = useState('');
  const [remoteHost, setRemoteHost] = useState('');
  const [remotePort, setRemotePort] = useState('');
  const [error, setError] = useState('');

  const connectedTerminals = tabs.filter((t) => t.type === 'terminal' && t.connected);

  useEffect(() => { loadTunnels(); }, []);
  useEffect(() => {
    if (connectedTerminals.length > 0 && !sessionId) {
      setSessionId(connectedTerminals[0].id);
    }
  }, [connectedTerminals.length]);

  async function loadTunnels() {
    const list = await window.anssh.tunnels.list();
    setTunnels(list);
  }

  async function handleCreate() {
    if (!sessionId || !localPort) return;
    setError('');

    const id = `tunnel-${Date.now()}`;
    const config: Partial<TunnelConfig> = {
      id,
      sessionId,
      type,
      localHost,
      localPort: parseInt(localPort),
      remoteHost: type === 'dynamic' ? '' : remoteHost,
      remotePort: type === 'dynamic' ? 0 : parseInt(remotePort),
    };

    const result = await window.anssh.tunnels.open(config);
    if (result.success) {
      setCreating(false);
      setLocalPort('');
      setRemoteHost('');
      setRemotePort('');
      await loadTunnels();
    } else {
      setError(result.error || 'Error');
    }
  }

  async function handleClose(tunnelId: string) {
    await window.anssh.tunnels.close(tunnelId);
    await loadTunnels();
  }

  function typeIcon(t: string) {
    if (t === 'local') return <ArrowDownLeft className="w-3.5 h-3.5 text-primary" />;
    if (t === 'remote') return <ArrowUpRight className="w-3.5 h-3.5 text-warning" />;
    return <Globe className="w-3.5 h-3.5 text-success" />;
  }

  function typeLabel(t: string) {
    if (t === 'local') return 'Local →';
    if (t === 'remote') return '← Remote';
    return 'SOCKS5';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface border border-border rounded-xl shadow-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-text">SSH Tunnels</h2>
          </div>
          <div className="flex items-center gap-1">
            {!creating && (
              <button
                onClick={() => setCreating(true)}
                className="h-7 flex items-center gap-1 px-2 rounded-md hover:bg-bg text-xs text-primary"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-bg text-text-muted">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Create form */}
        {creating && (
          <div className="px-5 py-4 border-b border-border space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(['local', 'remote', 'dynamic'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`h-8 flex items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors ${
                    type === t ? 'bg-primary text-white' : 'bg-bg border border-border text-text-muted hover:text-text'
                  }`}
                >
                  {typeIcon(t)} {t === 'local' ? 'Local' : t === 'remote' ? 'Remote' : 'SOCKS'}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">SSH session</label>
              <select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="w-full h-8 px-2 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary"
              >
                {connectedTerminals.map((t) => (
                  <option key={t.id} value={t.id}>{t.hostName}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-text-muted mb-1">Local address</label>
                <input
                  type="text"
                  value={localHost}
                  onChange={(e) => setLocalHost(e.target.value)}
                  className="w-full h-8 px-2 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Local port</label>
                <input
                  type="number"
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  className="w-full h-8 px-2 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary"
                  placeholder="8080"
                />
              </div>
            </div>

            {type !== 'dynamic' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Remote host</label>
                  <input
                    type="text"
                    value={remoteHost}
                    onChange={(e) => setRemoteHost(e.target.value)}
                    className="w-full h-8 px-2 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary"
                    placeholder="localhost"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Remote port</label>
                  <input
                    type="number"
                    value={remotePort}
                    onChange={(e) => setRemotePort(e.target.value)}
                    className="w-full h-8 px-2 bg-bg border border-border rounded-lg text-xs text-text focus:outline-none focus:border-primary"
                    placeholder="3306"
                  />
                </div>
              </div>
            )}

            {error && <p className="text-xs text-error">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="h-7 px-3 rounded text-xs text-text-muted hover:bg-bg">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!sessionId || !localPort}
                className="h-7 px-4 bg-primary hover:bg-primary-hover text-white rounded text-xs font-medium disabled:opacity-50"
              >
                Open tunnel
              </button>
            </div>
          </div>
        )}

        {/* Active tunnels */}
        <div className="px-5 py-3 max-h-64 overflow-y-auto">
          {tunnels.length === 0 && !creating && (
            <div className="text-center py-6">
              <Plug className="w-8 h-8 text-text-faint mx-auto mb-2" />
              <p className="text-xs text-text-muted">No active tunnels</p>
            </div>
          )}

          {tunnels.map((t) => {
            const tab = tabs.find((tab) => tab.id === t.sessionId);
            return (
              <div key={t.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                {typeIcon(t.type)}
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text font-mono">
                    {t.type === 'dynamic'
                      ? `${t.localHost}:${t.localPort} (SOCKS5)`
                      : `${t.localHost}:${t.localPort} → ${t.remoteHost}:${t.remotePort}`
                    }
                  </div>
                  <div className="text-[10px] text-text-muted">
                    via {tab?.hostName || 'unknown'} · {t.connections || 0} connections
                  </div>
                </div>
                <button
                  onClick={() => handleClose(t.id)}
                  className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted hover:text-error"
                  title="Close tunnel"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
