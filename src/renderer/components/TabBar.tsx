import { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  HardDrive,
  X,
  Radio,
  Zap,
  ArrowRightLeft,
  Copy,
  FolderGit2,
  GripVertical,
  MoreHorizontal,
} from 'lucide-react';
import type { Tab } from '../lib/types';

const DND_KEY = 'text/plain';
const DND_PREFIX = 'anssh-tab:';

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onReorderTabs: (fromIndex: number, toIndex: number) => void;
  onCloseOtherTabs: (keepId: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToRight: (tabId: string) => void;
  onCloseTabsToLeft: (tabId: string) => void;
  showBroadcast: boolean;
  onToggleBroadcast: () => void;
  onToggleSnippets: () => void;
  onOpenTunnels: () => void;
  onOpenDevOps?: () => void;
}

function tabIndexFromPoint(clientX: number, clientY: number): number | null {
  const el = document.elementFromPoint(clientX, clientY)?.closest('[data-tab-index]');
  if (!el) return null;
  const v = parseInt(el.getAttribute('data-tab-index') ?? '', 10);
  return Number.isNaN(v) ? null : v;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onDuplicate,
  onReorderTabs,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  showBroadcast,
  onToggleBroadcast,
  onToggleSnippets,
  onOpenTunnels,
  onOpenDevOps,
}: Props) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mouseDragRef = useRef<{ fromIndex: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  useEffect(() => {
    if (!tabMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setTabMenu(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setTabMenu(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [tabMenu]);

  function endDrag() {
    mouseDragRef.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
    document.body.style.removeProperty('cursor');
  }

  /**
   * Mouse-based reorder (mousedown/move/up on document).
   * More reliable than PointerEvent on macOS Electron + trackpad.
   */
  function handleTabMouseDown(e: React.MouseEvent, index: number) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    if ((e.target as HTMLElement).closest('[data-tab-handle]')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    mouseDragRef.current = { fromIndex: index };

    function onMove(me: MouseEvent) {
      if (!mouseDragRef.current) return;
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (!dragging && dx * dx + dy * dy < 16) return;
      if (!dragging) {
        dragging = true;
        setDraggingIndex(index);
        setDragOverIndex(index);
        document.body.style.cursor = 'grabbing';
        me.preventDefault();
      }
      const over = tabIndexFromPoint(me.clientX, me.clientY);
      if (over !== null) setDragOverIndex(over);
    }

    function onUp(me: MouseEvent) {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);

      const from = mouseDragRef.current?.fromIndex ?? index;
      const to = tabIndexFromPoint(me.clientX, me.clientY);
      mouseDragRef.current = null;

      if (dragging && to !== null && to !== from) {
        suppressNextClickRef.current = true;
        onReorderTabs(from, to);
      }
      endDrag();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }

  function parseDragPayload(raw: string): number | null {
    if (!raw.startsWith(DND_PREFIX)) return null;
    const n = parseInt(raw.slice(DND_PREFIX.length), 10);
    return Number.isNaN(n) ? null : n;
  }

  return (
    <div className="h-9 flex items-center bg-bg border-b border-border flex-shrink-0 relative">
      <div className="flex items-end flex-1 overflow-x-auto h-full min-w-0">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isOver = dragOverIndex === index && draggingIndex !== null;
          const isDragging = draggingIndex === index;
          return (
            <div
              key={tab.id}
              role="tab"
              data-tab-index={index}
              onMouseDown={(e) => handleTabMouseDown(e, index)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DND_KEY)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw = e.dataTransfer.getData(DND_KEY);
                const from = parseDragPayload(raw);
                setDragOverIndex(null);
                setDraggingIndex(null);
                if (from !== null && from !== index) {
                  suppressNextClickRef.current = true;
                  onReorderTabs(from, index);
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverIndex(null);
                }
              }}
              onClick={() => {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  return;
                }
                onSelect(tab.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTabMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
              className={`flex items-center gap-1 h-full px-2 pl-1.5 cursor-pointer border-r border-border text-xs select-none max-w-[200px] transition-colors ${
                isActive
                  ? 'bg-surface text-text'
                  : 'bg-bg text-text-muted hover:bg-[var(--color-surface-2)] hover:text-text'
              } ${isOver ? 'ring-1 ring-inset ring-primary/60' : ''} ${
                isDragging ? 'opacity-60' : ''
              }`}
              title="Drag to reorder · ⋯ or right-click for tab actions"
            >
              <span
                data-tab-handle
                draggable
                onMouseDown={(e) => e.stopPropagation()}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_KEY, `${DND_PREFIX}${index}`);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingIndex(index);
                  setDragOverIndex(index);
                }}
                onDragEnd={() => {
                  endDrag();
                }}
                className="flex-shrink-0 text-text-faint hover:text-text-muted cursor-grab active:cursor-grabbing p-0.5 rounded"
                aria-hidden
              >
                <GripVertical className="w-3 h-3" />
              </span>
              {tab.type === 'terminal' ? (
                <Terminal className="w-3 h-3 flex-shrink-0" />
              ) : (
                <HardDrive className="w-3 h-3 flex-shrink-0" />
              )}
              <span className="truncate flex-1 min-w-0">{tab.title}</span>
              <button
                type="button"
                title="Tab actions — close others, close all, …"
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-bg text-text-faint hover:text-text ml-0.5 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setTabMenu({ tabId: tab.id, x: r.left, y: r.bottom + 4 });
                }}
              >
                <MoreHorizontal className="w-3 h-3" />
              </button>
              {onDuplicate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(tab.id);
                  }}
                  className="w-4 h-4 flex items-center justify-center rounded hover:bg-bg text-text-faint hover:text-text ml-0.5 flex-shrink-0"
                  title="Duplicate tab"
                  type="button"
                >
                  <Copy className="w-2.5 h-2.5" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="w-4 h-4 flex items-center justify-center rounded hover:bg-bg text-text-faint hover:text-text ml-1 flex-shrink-0"
                type="button"
                title="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {tabMenu && tabs.some((t) => t.id === tabMenu.tabId) && (
        <TabContextMenu
          tabMenu={tabMenu}
          tabs={tabs}
          menuRef={menuRef}
          onClose={() => setTabMenu(null)}
          onCloseTab={onClose}
          onCloseOtherTabs={onCloseOtherTabs}
          onCloseAllTabs={onCloseAllTabs}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onDuplicate={onDuplicate}
        />
      )}

      <div className="flex items-center gap-0.5 px-2 flex-shrink-0 border-l border-border h-full">
        <button
          onClick={onToggleBroadcast}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            showBroadcast
              ? 'text-error bg-[rgba(209,99,167,0.1)]'
              : 'text-text-faint hover:text-text-muted hover:bg-[var(--color-surface-2)]'
          }`}
          title="Broadcast — send to all sessions"
          type="button"
        >
          <Radio className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onToggleSnippets}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-faint hover:text-text-muted hover:bg-[var(--color-surface-2)]"
          title="Quick commands (snippets)"
          type="button"
        >
          <Zap className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onOpenTunnels}
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-faint hover:text-text-muted hover:bg-[var(--color-surface-2)]"
          title="SSH Tunnels"
          type="button"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
        </button>
        {onOpenDevOps && (
          <button
            onClick={onOpenDevOps}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-faint hover:text-text-muted hover:bg-[var(--color-surface-2)]"
            title="Ansible & inventory (git sync, playbooks, health)"
            type="button"
          >
            <FolderGit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function TabContextMenu({
  tabMenu,
  tabs,
  menuRef,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onCloseTabsToLeft,
  onDuplicate,
}: {
  tabMenu: { tabId: string; x: number; y: number };
  tabs: Tab[];
  menuRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToRight: (id: string) => void;
  onCloseTabsToLeft: (id: string) => void;
  onDuplicate?: (id: string) => void;
}) {
  const menuTabIdx = tabs.findIndex((t) => t.id === tabMenu.tabId);
  if (menuTabIdx < 0) return null;
  const menuClass =
    'w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-2)] text-text';

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Tab actions"
      className="fixed z-[100] min-w-[220px] py-1 rounded-lg border border-border bg-surface shadow-lg text-xs"
      style={{
        left: Math.min(tabMenu.x, typeof window !== 'undefined' ? Math.max(8, window.innerWidth - 228) : tabMenu.x),
        top: Math.min(tabMenu.y, typeof window !== 'undefined' ? Math.max(8, window.innerHeight - 320) : tabMenu.y),
      }}
    >
      <button type="button" role="menuitem" className={menuClass} onClick={() => { onCloseTab(tabMenu.tabId); onClose(); }}>
        Close
      </button>
      {tabs.length > 1 && (
        <button
          type="button"
          role="menuitem"
          className={menuClass}
          onClick={() => {
            onCloseOtherTabs(tabMenu.tabId);
            onClose();
          }}
        >
          Close other tabs
        </button>
      )}
      {menuTabIdx < tabs.length - 1 && (
        <button type="button" role="menuitem" className={menuClass} onClick={() => { onCloseTabsToRight(tabMenu.tabId); onClose(); }}>
          Close tabs to the right
        </button>
      )}
      {menuTabIdx > 0 && (
        <button type="button" role="menuitem" className={menuClass} onClick={() => { onCloseTabsToLeft(tabMenu.tabId); onClose(); }}>
          Close tabs to the left
        </button>
      )}
      <div className="h-px bg-border my-1 mx-1" role="separator" />
      <button
        type="button"
        role="menuitem"
        className={menuClass}
        onClick={() => {
          onCloseAllTabs();
          onClose();
        }}
      >
        Close all tabs
      </button>
      {onDuplicate && (
        <>
          <div className="h-px bg-border my-1 mx-1" role="separator" />
          <button
            type="button"
            role="menuitem"
            className={menuClass}
            onClick={() => {
              onDuplicate(tabMenu.tabId);
              onClose();
            }}
          >
            Duplicate
          </button>
        </>
      )}
    </div>
  );
}
