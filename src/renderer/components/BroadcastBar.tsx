import { useState, useRef, useEffect } from 'react';
import { Radio, X, Send, Check } from 'lucide-react';
import type { Tab } from '../lib/types';

interface Props {
  tabs: Tab[];
  onClose: () => void;
}

export function BroadcastBar({ tabs, onClose }: Props) {
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(
    new Set(tabs.filter((t) => t.type === 'terminal' && t.connected).map((t) => t.id))
  );
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const terminalTabs = tabs.filter((t) => t.type === 'terminal' && t.connected);

  function toggleTab(tabId: string) {
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
      return next;
    });
  }

  function toggleAll() {
    if (selectedTabs.size === terminalTabs.length) {
      setSelectedTabs(new Set());
    } else {
      setSelectedTabs(new Set(terminalTabs.map((t) => t.id)));
    }
  }

  function sendCommand() {
    if (!input.trim() || selectedTabs.size === 0) return;
    const ids = Array.from(selectedTabs);
    window.anssh.broadcast.write(ids, input + '\n');
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendCommand();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div className="bg-surface border-b border-border flex-shrink-0">
      {/* Broadcast header */}
      <div className="h-8 flex items-center gap-2 px-3 border-b border-border">
        <Radio className="w-3.5 h-3.5 text-error animate-pulse" />
        <span className="text-xs font-medium text-text">
          Broadcast — {selectedTabs.size}/{terminalTabs.length} sessions
        </span>
        <div className="flex-1" />
        <button
          onClick={toggleAll}
          className="text-[10px] text-primary hover:text-primary-hover"
        >
          {selectedTabs.size === terminalTabs.length ? 'Clear all' : 'Select all'}
        </button>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg text-text-muted"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Session checkboxes */}
      <div className="flex flex-wrap gap-1 px-3 py-1.5">
        {terminalTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => toggleTab(tab.id)}
            className={`h-6 flex items-center gap-1 px-2 rounded text-[10px] transition-colors ${
              selectedTabs.has(tab.id)
                ? 'bg-primary text-white'
                : 'bg-bg border border-border text-text-muted hover:text-text'
            }`}
          >
            {selectedTabs.has(tab.id) && <Check className="w-2.5 h-2.5" />}
            {tab.hostName}
          </button>
        ))}
        {terminalTabs.length === 0 && (
          <span className="text-[10px] text-text-faint">No active SSH sessions</span>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex-1 relative">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-8 px-3 pr-8 bg-bg border border-border rounded-md text-xs text-text font-mono placeholder:text-text-faint focus:outline-none focus:border-primary"
            placeholder="Command for all selected sessions… (Enter to send)"
          />
          <button
            onClick={sendCommand}
            disabled={!input.trim() || selectedTabs.size === 0}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-text-faint hover:text-primary disabled:opacity-30"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
