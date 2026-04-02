import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon } from 'xterm-addon-search';
import {
  Loader2, RefreshCw, Search, X, ChevronUp, ChevronDown, CaseSensitive, Regex, History,
} from 'lucide-react';
import type { Host, Tab } from '../lib/types';
import { formatSshError } from '../lib/ssh-errors';
import { useTheme } from '../context/ThemeContext';
import { getStoredTheme } from '../lib/theme';
import { XTERM_THEME_DARK, XTERM_THEME_LIGHT } from '../lib/xterm-themes';
import 'xterm/css/xterm.css';

interface Props {
  tab: Tab;
  host: Host;
  onUpdateTab: (id: string, updates: Partial<Tab>) => void;
}

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 32;
const DEFAULT_FONT_SIZE = 14;

/** Coalesce stdin into one IPC per microtask (fewer Electron messages on fast input / IME). */
function createSshWriteBatcher(sessionId: string) {
  let buf = '';
  let scheduled = false;
  function flush() {
    scheduled = false;
    if (!buf) return;
    const chunk = buf;
    buf = '';
    window.anssh.ssh.write(sessionId, chunk);
  }
  return {
    push(data: string) {
      buf += data;
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    },
    flushPending() {
      scheduled = false;
      flush();
    },
  };
}

const HISTORY_STORAGE = (hostId: string) => `anssh-cmd-history-${hostId}`;

function loadCmdHistory(hostId: string): string[] {
  try {
    let raw = localStorage.getItem(HISTORY_STORAGE(hostId));
    if (!raw) raw = localStorage.getItem(`nexterm-cmd-history-${hostId}`);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushCmdHistory(hostId: string, cmd: string) {
  const t = cmd.trim();
  if (!t) return;
  const prev = loadCmdHistory(hostId).filter((c) => c !== t);
  prev.unshift(t);
  try {
    localStorage.setItem(HISTORY_STORAGE(hostId), JSON.stringify(prev.slice(0, 50)));
  } catch { /* quota */ }
}

export function TerminalView({ tab, host, onUpdateTab }: Props) {
  const { theme: appTheme } = useTheme();
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const [error, setError] = useState('');
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const connectedRef = useRef(false);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchMatchCount, setSearchMatchCount] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const lineBufferRef = useRef('');
  const statusRef = useRef(status);
  const searchOpenRef = useRef(searchOpen);
  const reconnectRef = useRef<() => Promise<void>>(async () => {});
  statusRef.current = status;
  searchOpenRef.current = searchOpen;

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Focus the search input after render
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchMatchCount('');
    searchRef.current?.clearDecorations();
    // Refocus the terminal
    xtermRef.current?.focus();
  }, []);

  const doSearch = useCallback((query: string, direction: 'next' | 'prev' = 'next') => {
    if (!searchRef.current || !query) {
      setSearchMatchCount('');
      return;
    }

    const opts = {
      caseSensitive: searchCaseSensitive,
      regex: searchRegex,
      incremental: direction === 'next',
    };

    let found: boolean;
    if (direction === 'prev') {
      found = searchRef.current.findPrevious(query, opts);
    } else {
      found = searchRef.current.findNext(query, opts);
    }

    setSearchMatchCount(found ? '' : 'No matches');
  }, [searchCaseSensitive, searchRegex]);

  // Re-run search when options change
  useEffect(() => {
    if (searchOpen && searchQuery) {
      doSearch(searchQuery, 'next');
    }
  }, [searchCaseSensitive, searchRegex]);

  useEffect(() => {
    if (!termRef.current || connectedRef.current) return;
    connectedRef.current = true;

    const initialLight = (getStoredTheme() ?? 'dark') === 'light';
    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: "'JetBrains Mono', 'Consolas', monospace",
      lineHeight: 1.2,
      scrollback: 5000,
      smoothScrollDuration: 0,
      allowProposedApi: true,
      theme: initialLight ? XTERM_THEME_LIGHT : XTERM_THEME_DARK,
      /** Improve TUI readability when apps pick low-contrast ANSI pairs on light canvas */
      minimumContrastRatio: initialLight ? 4.5 : 1,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.loadAddon(searchAddon);
    xterm.open(termRef.current);

    xtermRef.current = xterm;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {
        /* */
      }
    }, 50);

    let fitRaf = 0;
    const observer = new ResizeObserver(() => {
      if (fitRaf) cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(() => {
        fitRaf = 0;
        try {
          fitAddon.fit();
        } catch {
          /* */
        }
      });
    });
    observer.observe(termRef.current);

    // --- Hotkeys ---
    xterm.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      // R reconnects when no session; Ctrl+Shift+R always
      if (ev.type === 'keydown' && ev.code === 'KeyR' && !ev.repeat) {
        if (searchOpenRef.current) return true;
        if (ev.ctrlKey && ev.shiftKey) {
          ev.preventDefault();
          void reconnectRef.current();
          return false;
        }
        if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && statusRef.current !== 'connected') {
          ev.preventDefault();
          void reconnectRef.current();
          return false;
        }
      }

      if (ev.ctrlKey && ev.shiftKey && ev.type === 'keydown') {
        switch (ev.code) {
          case 'KeyC': {
            const sel = xterm.getSelection();
            if (sel) {
              navigator.clipboard.writeText(sel);
              xterm.clearSelection();
            }
            return false;
          }
          case 'KeyV': {
            navigator.clipboard.readText().then((text) => {
              if (text) window.anssh.ssh.write(tab.id, text);
            });
            return false;
          }
          case 'Equal':
          case 'NumpadAdd': {
            changeFontSize(xterm, fitAddon, 1);
            return false;
          }
          case 'Minus':
          case 'NumpadSubtract': {
            changeFontSize(xterm, fitAddon, -1);
            return false;
          }
          case 'Digit0':
          case 'Numpad0': {
            xterm.options.fontSize = DEFAULT_FONT_SIZE;
            setFontSize(DEFAULT_FONT_SIZE);
            fitAddon.fit();
            return false;
          }
          case 'KeyK': {
            xterm.clear();
            return false;
          }
          case 'KeyN': {
            xterm.clearSelection();
            return false;
          }
          case 'KeyF': {
            // Open search
            openSearch();
            return false;
          }
        }
      }

      // Ctrl+C smart copy
      if (ev.ctrlKey && !ev.shiftKey && ev.code === 'KeyC' && ev.type === 'keydown') {
        const sel = xterm.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel);
          xterm.clearSelection();
          return false;
        }
      }

      // Escape closes search
      if (ev.code === 'Escape' && ev.type === 'keydown' && searchOpen) {
        closeSearch();
        return false;
      }

      return true;
    });

    connectSsh(xterm, fitAddon);

    const sshWrite = createSshWriteBatcher(tab.id);
    xterm.onData((data) => {
      sshWrite.push(data);
      for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (c === '\r' || c === '\n') {
          const line = lineBufferRef.current.trim();
          lineBufferRef.current = '';
          if (line) {
            const hid = host.id;
            const save = () => pushCmdHistory(hid, line);
            if (typeof window.requestIdleCallback === 'function') {
              window.requestIdleCallback(save, { timeout: 1500 });
            } else {
              setTimeout(save, 0);
            }
          }
        } else if (c === '\x7f' || c === '\b') {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
        } else if (c >= ' ' || c === '\t') {
          lineBufferRef.current += c;
        }
      }
    });

    xterm.onResize(({ cols, rows }) => {
      window.anssh.ssh.resize(tab.id, cols, rows);
    });

    const removeData = window.anssh.ssh.onData((sessionId, data) => {
      if (sessionId === tab.id) xterm.write(data);
    });

    const removeClose = window.anssh.ssh.onClose((sessionId) => {
      if (sessionId === tab.id) {
        setStatus('closed');
        onUpdateTab(tab.id, { connected: false });
        xterm.write('\r\n\x1b[33m--- Connection closed. Press R or Reconnect ---\x1b[0m\r\n');
      }
    });

    const removeError = window.anssh.ssh.onError((sessionId, err) => {
      if (sessionId === tab.id) {
        const msg = formatSshError(err);
        setStatus('error');
        setError(msg);
        xterm.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
        onUpdateTab(tab.id, { connected: false });
      }
    });

    return () => {
      sshWrite.flushPending();
      removeData();
      removeClose();
      removeError();
      observer.disconnect();
      if (fitRaf) cancelAnimationFrame(fitRaf);
      xterm.dispose();
    };
  }, []);

  useEffect(() => {
    const x = xtermRef.current;
    if (!x) return;
    const light = appTheme === 'light';
    x.options.theme = light ? XTERM_THEME_LIGHT : XTERM_THEME_DARK;
    x.options.minimumContrastRatio = light ? 4.5 : 1;
  }, [appTheme]);

  function changeFontSize(xterm: XTerm, fitAddon: FitAddon, delta: number) {
    const current = xterm.options.fontSize || DEFAULT_FONT_SIZE;
    const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, current + delta));
    xterm.options.fontSize = next;
    setFontSize(next);
    fitAddon.fit();
  }

  async function applyTunnelPresets() {
    const eff = await window.anssh.hosts.effective(host.id);
    const presets = eff?.tunnelPresets?.length ? eff.tunnelPresets : host.tunnelPresets || [];
    for (const p of presets) {
      if (!p.localPort) continue;
      if (p.type !== 'dynamic' && (!p.remoteHost || !p.remotePort)) continue;
      const id = `preset-${p.id}-${Date.now()}`;
      const r = await window.anssh.tunnels.open({
        id,
        sessionId: tab.id,
        type: p.type,
        localHost: p.localHost || '127.0.0.1',
        localPort: p.localPort,
        remoteHost: p.type === 'dynamic' ? '' : p.remoteHost,
        remotePort: p.type === 'dynamic' ? 0 : p.remotePort,
      });
      if (!r.success) {
        try {
          window.anssh.logs.report('warn', 'Tunnel preset failed', { preset: p.id, error: r.error });
        } catch { /* */ }
      }
    }
  }

  async function connectSsh(xterm: XTerm, fitAddon: FitAddon) {
    const reuse = await window.anssh.ssh.hasSession(tab.id);
    if (reuse) {
      setStatus('connected');
      onUpdateTab(tab.id, { connected: true });
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      window.anssh.ssh.resize(tab.id, dims?.cols || 80, dims?.rows || 24);
      return;
    }

    setStatus('connecting');
    const via = host.jumpHostId ? ' (via jump)' : '';
    xterm.write(`Connecting to ${host.hostname}:${host.port}${via}...\r\n`);

    const result = await window.anssh.ssh.connect(tab.id, {
      hostId: host.id,
      host: host.hostname,
      port: host.port,
      credentialId: host.credentialId,
      jumpHostId: host.jumpHostId || undefined,
    });

    if (result.success) {
      setStatus('connected');
      onUpdateTab(tab.id, { connected: true });
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      window.anssh.ssh.resize(tab.id, dims?.cols || 80, dims?.rows || 24);
      await applyTunnelPresets();
    } else {
      const msg = formatSshError(result.error || 'Could not connect');
      setStatus('error');
      setError(msg);
      xterm.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
      try {
        window.anssh.logs.report('error', 'SSH connect failed', { host: host.hostname, error: result.error });
      } catch { /* */ }
    }
  }

  async function reconnect() {
    if (!xtermRef.current || !fitRef.current) return;
    setError('');
    setStatus('connecting');
    await window.anssh.ssh.disconnect(tab.id);
    onUpdateTab(tab.id, { connected: false });
    await connectSsh(xtermRef.current, fitRef.current);
  }

  reconnectRef.current = reconnect;

  function sendHistoryLine(cmd: string) {
    window.anssh.ssh.write(tab.id, `${cmd}\r`);
    setHistoryOpen(false);
    xtermRef.current?.focus();
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        doSearch(searchQuery, 'prev');
      } else {
        doSearch(searchQuery, 'next');
      }
    }
    if (e.key === 'Escape') {
      closeSearch();
    }
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearchQuery(q);
    // Incremental search
    doSearch(q, 'next');
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Status bar */}
      <div className="h-7 flex items-center justify-between px-3 bg-surface border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <div
            className={`w-2 h-2 rounded-full ${
              status === 'connected'
                ? 'bg-success'
                : status === 'connecting'
                ? 'bg-warning animate-pulse'
                : 'bg-error'
            }`}
          />
          <span className="text-text-muted truncate max-w-[40vw]">
            {host.hostname}:{host.port}
            {host.jumpHostId ? ' · jump' : ''}
          </span>
          {status === 'connecting' && (
            <Loader2 className="w-3 h-3 text-text-faint animate-spin" />
          )}
          {fontSize !== DEFAULT_FONT_SIZE && (
            <span className="text-text-faint text-[10px]">{fontSize}px</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className={`w-6 h-6 flex items-center justify-center rounded hover:bg-bg transition-colors ${
              historyOpen ? 'text-primary' : 'text-text-faint hover:text-text-muted'
            }`}
            title="Command history (local)"
            type="button"
          >
            <History className="w-3 h-3" />
          </button>
          {/* Search toggle button */}
          <button
            onClick={() => searchOpen ? closeSearch() : openSearch()}
            className={`w-6 h-6 flex items-center justify-center rounded hover:bg-bg transition-colors ${
              searchOpen ? 'text-primary' : 'text-text-faint hover:text-text-muted'
            }`}
            title="Search (Ctrl+Shift+F)"
          >
            <Search className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-text-faint hidden lg:inline">
            R / Ctrl+Shift+R · Ctrl+Shift: C/V · +/- · K · F
          </span>
          <button
            onClick={reconnect}
            disabled={status === 'connecting'}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover disabled:opacity-50"
            type="button"
            title="Reconnect (Ctrl+Shift+R always; R when no active SSH session)"
          >
            <RefreshCw className="w-3 h-3" /> Reconnect
          </button>
        </div>
      </div>

      {status === 'error' && error && (
        <div className="px-3 py-1.5 text-[11px] text-error bg-[rgba(209,99,167,0.08)] border-b border-border leading-snug">
          {error}
        </div>
      )}

      {historyOpen && (
        <div className="max-h-32 overflow-y-auto border-b border-border bg-surface px-2 py-1">
          {loadCmdHistory(host.id).length === 0 ? (
            <p className="text-[10px] text-text-faint px-1 py-1">History appears after you run commands (Enter).</p>
          ) : (
            loadCmdHistory(host.id).map((cmd, i) => (
              <button
                key={`${i}-${cmd.slice(0, 20)}`}
                type="button"
                onClick={() => sendHistoryLine(cmd)}
                className="block w-full text-left text-[11px] font-mono px-2 py-0.5 rounded hover:bg-bg text-text-muted hover:text-text truncate"
                title={cmd}
              >
                {cmd.length > 120 ? `${cmd.slice(0, 120)}…` : cmd}
              </button>
            ))
          )}
        </div>
      )}

      {/* Search panel */}
      {searchOpen && (
        <div className="h-9 flex items-center gap-2 px-3 bg-surface border-b border-border flex-shrink-0">
          <Search className="w-3.5 h-3.5 text-text-faint flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            className="flex-1 h-6 px-2 bg-bg border border-border rounded text-xs text-text placeholder:text-text-faint focus:outline-none focus:border-primary min-w-0"
            placeholder="Search in terminal… (Enter next, Shift+Enter previous)"
            autoFocus
          />

          {/* Match indicator */}
          {searchMatchCount && (
            <span className="text-[10px] text-warning whitespace-nowrap">{searchMatchCount}</span>
          )}

          {/* Case sensitivity toggle */}
          <button
            onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
            className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
              searchCaseSensitive
                ? 'bg-primary text-white'
                : 'text-text-faint hover:text-text-muted hover:bg-bg'
            }`}
            title="Match case"
          >
            <CaseSensitive className="w-3.5 h-3.5" />
          </button>

          {/* Regex toggle */}
          <button
            onClick={() => setSearchRegex(!searchRegex)}
            className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
              searchRegex
                ? 'bg-primary text-white'
                : 'text-text-faint hover:text-text-muted hover:bg-bg'
            }`}
            title="Regular expression"
          >
            <Regex className="w-3.5 h-3.5" />
          </button>

          {/* Prev / Next */}
          <button
            onClick={() => doSearch(searchQuery, 'prev')}
            className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted hover:bg-bg"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => doSearch(searchQuery, 'next')}
            className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted hover:bg-bg"
            title="Next (Enter)"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          {/* Close */}
          <button
            onClick={closeSearch}
            className="w-6 h-6 flex items-center justify-center rounded text-text-faint hover:text-text-muted hover:bg-bg"
            title="Close (Escape)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Terminal */}
      <div ref={termRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
