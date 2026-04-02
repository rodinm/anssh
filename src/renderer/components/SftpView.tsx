import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Folder, File, ArrowUp, RefreshCw, Upload, FolderPlus,
  Download, Trash2, Edit, Loader2, AlertCircle, ChevronRight,
  FileText, FileCode, FileImage, FileArchive, Pause, Play, ListOrdered,
  Copy, CornerDownRight, Laptop, HardDrive,
} from 'lucide-react';
import type { Host, Tab, SftpFile } from '../lib/types';
import { formatSshError } from '../lib/ssh-errors';

export interface SftpTabOption {
  sessionId: string;
  label: string;
}

interface Props {
  tab: Tab;
  host: Host;
  onUpdateTab: (id: string, updates: Partial<Tab>) => void;
  /** Open SFTP tabs — switch left panel to another session */
  sftpTabs: SftpTabOption[];
}

interface TransferJob {
  id: string;
  name: string;
  localPath: string;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
}

type PanelSide = 'left' | 'right';
type LeftMode = 'local' | 'remote';

function joinRemote(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return `${dir.replace(/\/$/, '')}/${name}`;
}

function splitLocalPath(p: string): string[] {
  return p.split(/[/\\]/).filter((s) => s.length > 0);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPermissions(mode: number): string {
  const octal = (mode & 0o777).toString(8);
  return octal.padStart(3, '0');
}

function getFileIcon(file: SftpFile) {
  if (file.isDirectory) return <Folder className="w-4 h-4 text-primary" />;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext))
    return <FileImage className="w-4 h-4 text-warning" />;
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz'].includes(ext))
    return <FileArchive className="w-4 h-4 text-error" />;
  if (['js', 'ts', 'py', 'sh', 'bash', 'yml', 'yaml', 'json', 'xml', 'html', 'css', 'java', 'c', 'cpp', 'go', 'rs'].includes(ext))
    return <FileCode className="w-4 h-4 text-success" />;
  if (['txt', 'md', 'log', 'cfg', 'conf', 'ini', 'env'].includes(ext))
    return <FileText className="w-4 h-4 text-text-muted" />;
  return <File className="w-4 h-4 text-text-faint" />;
}

async function localJoin(a: string, b: string): Promise<string> {
  return window.anssh.localFs.join(a, b);
}

async function buildLocalPath(parts: string[]): Promise<string> {
  if (parts.length === 0) return '';
  let cur = parts[0];
  for (let i = 1; i < parts.length; i++) {
    cur = await localJoin(cur, parts[i]);
  }
  return cur;
}

async function copyLocalToRemoteTree(localPath: string, remotePath: string, sessionId: string): Promise<void> {
  const st = await window.anssh.localFs.stat(localPath);
  if (!st.success) throw new Error(st.error || 'local stat');
  if (st.isFile || st.isSymbolicLink) {
    const r = await window.anssh.sftp.uploadFile(sessionId, localPath, remotePath);
    if (!r.success) throw new Error(r.error || 'upload');
    return;
  }
  if (st.isDirectory) {
    const mk = await window.anssh.sftp.mkdir(sessionId, remotePath);
    if (!mk.success) throw new Error(mk.error || 'mkdir');
    const lr = await window.anssh.localFs.list(localPath);
    if (!lr.success || !lr.files) return;
    for (const f of lr.files) {
      const lf = await localJoin(localPath, f.name);
      const rf = joinRemote(remotePath, f.name);
      await copyLocalToRemoteTree(lf, rf, sessionId);
    }
  }
}

async function copyRemoteToLocalTree(
  sessionId: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  const st = await window.anssh.sftp.stat(sessionId, remotePath);
  if (!st.success) throw new Error(st.error || 'remote stat');
  if (st.isFile || st.isSymbolicLink) {
    const parent = await window.anssh.localFs.dirname(localPath);
    await window.anssh.localFs.mkdirp(parent);
    const r = await window.anssh.sftp.downloadTo(sessionId, remotePath, localPath);
    if (!r.success) throw new Error(r.error || 'download');
    return;
  }
  if (st.isDirectory) {
    await window.anssh.localFs.mkdirp(localPath);
    const lr = await window.anssh.sftp.list(sessionId, remotePath);
    if (!lr.success || !lr.files) return;
    for (const f of lr.files) {
      const rp = joinRemote(remotePath, f.name);
      const lp = await localJoin(localPath, f.name);
      await copyRemoteToLocalTree(sessionId, rp, lp);
    }
  }
}

async function transferBetweenSessions(
  fromSid: string,
  fromPath: string,
  toSid: string,
  toPath: string
): Promise<void> {
  const st = await window.anssh.sftp.stat(fromSid, fromPath);
  if (!st.success) throw new Error(st.error || 'stat');
  if (st.isFile || st.isSymbolicLink) {
    const r = await window.anssh.sftp.transfer(fromSid, fromPath, toSid, toPath);
    if (!r.success) throw new Error(r.error || 'transfer');
    return;
  }
  if (st.isDirectory) {
    const mk = await window.anssh.sftp.mkdir(toSid, toPath);
    if (!mk.success) throw new Error(mk.error || 'mkdir');
    const lr = await window.anssh.sftp.list(fromSid, fromPath);
    if (!lr.success || !lr.files) return;
    for (const f of lr.files) {
      await transferBetweenSessions(
        fromSid,
        joinRemote(fromPath, f.name),
        toSid,
        joinRemote(toPath, f.name)
      );
    }
  }
}

export function SftpView({ tab, host, onUpdateTab, sftpTabs }: Props) {
  const [leftMode, setLeftMode] = useState<LeftMode>('local');
  const [leftRemoteSessionId, setLeftRemoteSessionId] = useState(tab.id);
  const [leftPath, setLeftPath] = useState('');
  const [rightPath, setRightPath] = useState('/');
  const [leftFiles, setLeftFiles] = useState<SftpFile[]>([]);
  const [rightFiles, setRightFiles] = useState<SftpFile[]>([]);
  const [loadingLeft, setLoadingLeft] = useState(false);
  const [loadingRight, setLoadingRight] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelSide>('left');
  const [selLeft, setSelLeft] = useState<Set<string>>(new Set());
  const [selRight, setSelRight] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const leftPathRef = useRef(leftPath);
  const rightPathRef = useRef(rightPath);
  leftPathRef.current = leftPath;
  rightPathRef.current = rightPath;
  const [renaming, setRenaming] = useState<{ side: PanelSide; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderSide, setNewFolderSide] = useState<PanelSide | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOverPanel, setDragOverPanel] = useState<PanelSide | null>(null);
  const [transferQueue, setTransferQueue] = useState<TransferJob[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const queuePausedRef = useRef(false);
  const runnerRef = useRef(0);
  queuePausedRef.current = queuePaused;

  const panelRemoteSession = useCallback(
    (side: PanelSide): string => (side === 'right' ? tab.id : leftRemoteSessionId),
    [tab.id, leftRemoteSessionId]
  );

  const isPanelLocal = useCallback((side: PanelSide) => side === 'left' && leftMode === 'local', [leftMode]);

  const loadPanel = useCallback(
    async (side: PanelSide, dirPath: string) => {
      if (side === 'left') setLoadingLeft(true);
      else setLoadingRight(true);
      setError('');
      if (side === 'left') setSelLeft(new Set());
      else setSelRight(new Set());

      try {
        if (side === 'left' && leftMode === 'local') {
          const result = await window.anssh.localFs.list(dirPath);
          if (result.success && result.files) {
            setLeftFiles(result.files);
            setLeftPath(dirPath);
          } else setError(result.error || 'Failed to read folder');
        } else if (side === 'left' && leftMode === 'remote') {
          const sid = leftRemoteSessionId;
          const ok = await window.anssh.ssh.hasSession(sid);
          if (!ok) {
            setError('Session not found. Open SFTP for this host in a tab.');
          } else {
            const result = await window.anssh.sftp.list(sid, dirPath);
            if (result.success && result.files) {
              setLeftFiles(result.files);
              setLeftPath(dirPath);
            } else setError(result.error || 'Upload failed');
          }
        } else {
          const result = await window.anssh.sftp.list(tab.id, dirPath);
          if (result.success && result.files) {
            setRightFiles(result.files);
            setRightPath(dirPath);
          } else setError(result.error || 'Upload failed');
        }
      } finally {
        if (side === 'left') setLoadingLeft(false);
        else setLoadingRight(false);
      }
    },
    [tab.id, leftMode, leftRemoteSessionId]
  );

  const loadPanelRef = useRef(loadPanel);
  loadPanelRef.current = loadPanel;

  const refreshBoth = useCallback(async () => {
    await loadPanel('left', leftPathRef.current);
    await loadPanel('right', rightPathRef.current);
  }, [loadPanel]);

  const leftModeRef = useRef(leftMode);
  const leftRemoteSessionIdRef = useRef(leftRemoteSessionId);
  leftModeRef.current = leftMode;
  leftRemoteSessionIdRef.current = leftRemoteSessionId;

  const connect = useCallback(async () => {
    setLoadingLeft(true);
    setLoadingRight(true);
    setError('');
    const result = await window.anssh.ssh.connect(tab.id, {
      hostId: host.id,
      host: host.hostname,
      port: host.port,
      credentialId: host.credentialId,
      jumpHostId: host.jumpHostId || undefined,
    });
    if (!result.success) {
      setError(formatSshError(result.error || 'Could not connect'));
      setLoadingLeft(false);
      setLoadingRight(false);
      return;
    }
    onUpdateTab(tab.id, { connected: true });
    await loadPanelRef.current('right', '/');
    if (leftModeRef.current === 'local') {
      const h = await window.anssh.localFs.home();
      if (h.success && h.path) await loadPanelRef.current('left', h.path);
      else {
        setError('Could not get home directory');
        setLoadingLeft(false);
      }
    } else {
      const ok = await window.anssh.ssh.hasSession(leftRemoteSessionIdRef.current);
      if (ok) await loadPanelRef.current('left', '/');
      else setError('Left panel: session unavailable. Choose “This computer” or open an SFTP tab.');
    }
  }, [tab.id, host, onUpdateTab]);

  useEffect(() => {
    void connect();
  }, [connect]);

  async function reconnect() {
    setError('');
    setLoadingLeft(true);
    setLoadingRight(true);
    await window.anssh.ssh.disconnect(tab.id);
    onUpdateTab(tab.id, { connected: false });
    await connect();
  }

  function onLeftModeChange(value: string) {
    if (value === 'local') {
      setLeftMode('local');
      void (async () => {
        const h = await window.anssh.localFs.home();
        if (h.success && h.path) await loadPanel('left', h.path);
      })();
    } else {
      setLeftMode('remote');
      setLeftRemoteSessionId(value);
      void loadPanel('left', '/');
    }
  }

  async function navigateTo(side: PanelSide, dirName: string) {
    const base = side === 'left' ? leftPath : rightPath;
    if (isPanelLocal(side)) {
      const np = await localJoin(base, dirName);
      await loadPanel(side, np);
    } else {
      await loadPanel(side, joinRemote(base, dirName));
    }
  }

  async function navigateUp(side: PanelSide) {
    const base = side === 'left' ? leftPath : rightPath;
    if (isPanelLocal(side)) {
      const np = await window.anssh.localFs.dirname(base);
      if (np === base) return;
      await loadPanel(side, np);
    } else {
      if (base === '/') return;
      const parts = base.split('/').filter(Boolean);
      parts.pop();
      await loadPanel(side, '/' + parts.join('/'));
    }
  }

  function toggleSelect(side: PanelSide, name: string, e: React.MouseEvent) {
    const set = side === 'left' ? setSelLeft : setSelRight;
    const multi = e.metaKey || e.ctrlKey;
    set((prev) => {
      if (!multi) {
        return new Set([name]);
      }
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function pathFor(side: PanelSide): string {
    return side === 'left' ? leftPath : rightPath;
  }

  async function handleDownloadRemote(side: PanelSide, fileName: string) {
    const base = pathFor(side);
    const remotePath = joinRemote(base, fileName);
    const sid = panelRemoteSession(side);
    await window.anssh.sftp.download(sid, remotePath);
  }

  async function runUploadJobs(jobs: TransferJob[], targetPath: string, sessionId: string) {
    const runId = ++runnerRef.current;
    for (const job of jobs) {
      if (runnerRef.current !== runId) return;
      while (queuePausedRef.current) {
        await new Promise((r) => setTimeout(r, 150));
        if (runnerRef.current !== runId) return;
      }
      setTransferQueue((q) => q.map((j) => (j.id === job.id ? { ...j, status: 'running' } : j)));
      const r = await window.anssh.sftp.uploadPath(sessionId, targetPath, job.localPath);
      if (r.success) {
        setTransferQueue((q) => q.map((j) => (j.id === job.id ? { ...j, status: 'done' } : j)));
        await loadPanel('left', leftPathRef.current);
        await loadPanel('right', rightPathRef.current);
      } else {
        setTransferQueue((q) =>
          q.map((j) => (j.id === job.id ? { ...j, status: 'error', error: r.error || 'Error' } : j))
        );
      }
    }
  }

  function enqueueUploadsToRemote(paths: string[], remoteDir: string, sessionId: string) {
    const jobs: TransferJob[] = paths.map((localPath) => ({
      id: crypto.randomUUID(),
      name: localPath.split(/[/\\]/).pop() || localPath,
      localPath,
      status: 'pending' as const,
    }));
    setTransferQueue((q) => [...q, ...jobs]);
    setShowQueue(true);
    void runUploadJobs(jobs, remoteDir, sessionId);
  }

  async function handleUpload() {
    const targetPath = activePanel === 'left' ? leftPath : rightPath;
    const sid =
      activePanel === 'left'
        ? leftMode === 'remote'
          ? leftRemoteSessionId
          : tab.id
        : tab.id;
    if (activePanel === 'left' && leftMode === 'local') {
      await window.anssh.sftp.upload(tab.id, rightPath);
    } else {
      const result = await window.anssh.sftp.upload(sid, targetPath);
      if (result.success) await refreshBoth();
    }
  }

  async function handleRename(side: PanelSide, oldName: string, newName: string) {
    if (!newName || newName === oldName) {
      setRenaming(null);
      return;
    }
    const base = pathFor(side);
    if (isPanelLocal(side)) {
      const oldPath = await localJoin(base, oldName);
      const newPath = await localJoin(base, newName);
      const result = await window.anssh.localFs.rename(oldPath, newPath);
      if (result.success) await loadPanel(side, base);
      else setError(result.error || 'Rename failed');
    } else {
      const sid = panelRemoteSession(side);
      const oldPath = joinRemote(base, oldName);
      const newPath = joinRemote(base, newName);
      const result = await window.anssh.sftp.rename(sid, oldPath, newPath);
      if (result.success) await loadPanel(side, base);
      else setError(result.error || 'Rename failed');
    }
    setRenaming(null);
  }

  async function handleCreateFolder() {
    if (!newFolderSide || !newFolderName.trim()) {
      setNewFolderSide(null);
      return;
    }
    const base = pathFor(newFolderSide);
    const name = newFolderName.trim();
    if (isPanelLocal(newFolderSide)) {
      const p = await localJoin(base, name);
      const result = await window.anssh.localFs.mkdir(p);
      if (result.success) await loadPanel(newFolderSide, base);
    } else {
      const sid = panelRemoteSession(newFolderSide);
      const remotePath = joinRemote(base, name);
      const result = await window.anssh.sftp.mkdir(sid, remotePath);
      if (result.success) await loadPanel(newFolderSide, base);
    }
    setNewFolderSide(null);
    setNewFolderName('');
  }

  const getSelectedInActive = () => (activePanel === 'left' ? selLeft : selRight);

  const copyToOther = useCallback(async () => {
    const srcSide = activePanel;
    const dstSide: PanelSide = srcSide === 'left' ? 'right' : 'left';
    const names = [...(srcSide === 'left' ? selLeft : selRight)];
    if (names.length === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const srcBase = pathFor(srcSide);
      const dstBase = pathFor(dstSide);
      const srcLocal = isPanelLocal(srcSide);
      const dstLocal = isPanelLocal(dstSide);
      const srcSid = panelRemoteSession(srcSide);
      const dstSid = panelRemoteSession(dstSide);

      for (const name of names) {
        if (srcLocal && !dstLocal) {
          const lf = await localJoin(srcBase, name);
          const rf = joinRemote(dstBase, name);
          await copyLocalToRemoteTree(lf, rf, dstSid);
        } else if (!srcLocal && dstLocal) {
          const rf = joinRemote(srcBase, name);
          const lf = await localJoin(dstBase, name);
          await copyRemoteToLocalTree(srcSid, rf, lf);
        } else if (!srcLocal && !dstLocal) {
          const from = joinRemote(srcBase, name);
          const to = joinRemote(dstBase, name);
          if (srcSid === dstSid) {
            const r = await window.anssh.sftp.copyRemote(srcSid, from, to);
            if (!r.success) throw new Error(r.error || 'copy');
          } else {
            await transferBetweenSessions(srcSid, from, dstSid, to);
          }
        }
      }
      await refreshBoth();
    } catch (e: any) {
      setError(e?.message || 'Copy failed');
    } finally {
      setBulkBusy(false);
    }
  }, [
    activePanel,
    selLeft,
    selRight,
    leftPath,
    rightPath,
    leftMode,
    leftRemoteSessionId,
    tab.id,
    isPanelLocal,
    panelRemoteSession,
    refreshBoth,
  ]);

  const moveToOther = useCallback(async () => {
    const srcSide = activePanel;
    const dstSide: PanelSide = srcSide === 'left' ? 'right' : 'left';
    const names = [...(srcSide === 'left' ? selLeft : selRight)];
    if (names.length === 0) return;
    if (!window.confirm(`Move ${names.length} item(s) to the other panel?`)) return;
    setBulkBusy(true);
    setError('');
    try {
      const srcBase = pathFor(srcSide);
      const dstBase = pathFor(dstSide);
      const srcLocal = isPanelLocal(srcSide);
      const dstLocal = isPanelLocal(dstSide);
      const srcSid = panelRemoteSession(srcSide);
      const dstSid = panelRemoteSession(dstSide);

      for (const name of names) {
        if (srcLocal && !dstLocal) {
          const lf = await localJoin(srcBase, name);
          const rf = joinRemote(dstBase, name);
          await copyLocalToRemoteTree(lf, rf, dstSid);
          await window.anssh.localFs.delete(lf);
        } else if (!srcLocal && dstLocal) {
          const rf = joinRemote(srcBase, name);
          const lf = await localJoin(dstBase, name);
          await copyRemoteToLocalTree(srcSid, rf, lf);
          await window.anssh.sftp.delete(srcSid, rf);
        } else if (!srcLocal && !dstLocal) {
          const from = joinRemote(srcBase, name);
          const to = joinRemote(dstBase, name);
          if (srcSid === dstSid) {
            const r = await window.anssh.sftp.rename(srcSid, from, to);
            if (!r.success) throw new Error(r.error || 'rename');
          } else {
            await transferBetweenSessions(srcSid, from, dstSid, to);
            await window.anssh.sftp.delete(srcSid, from);
          }
        }
      }
      await refreshBoth();
    } catch (e: any) {
      setError(e?.message || 'Move failed');
    } finally {
      setBulkBusy(false);
    }
  }, [
    activePanel,
    selLeft,
    selRight,
    leftPath,
    rightPath,
    leftMode,
    leftRemoteSessionId,
    isPanelLocal,
    panelRemoteSession,
    refreshBoth,
  ]);

  const deleteSelected = useCallback(async () => {
    const side = activePanel;
    const names = [...(side === 'left' ? selLeft : selRight)];
    if (names.length === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${names.length} item(s)? Nested folders will be removed entirely.`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setError('');
    try {
      const base = pathFor(side);
      if (isPanelLocal(side)) {
        for (const name of names) {
          const p = await localJoin(base, name);
          const r = await window.anssh.localFs.delete(p);
          if (!r.success) throw new Error(r.error || 'delete');
        }
      } else {
        const sid = panelRemoteSession(side);
        for (const name of names) {
          const rp = joinRemote(base, name);
          const r = await window.anssh.sftp.delete(sid, rp);
          if (!r.success) throw new Error(r.error || 'delete');
        }
      }
      await loadPanel(side, base);
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    } finally {
      setBulkBusy(false);
    }
  }, [activePanel, selLeft, selRight, leftPath, rightPath, leftMode, isPanelLocal, panelRemoteSession, loadPanel]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (e.key === 'Tab') {
        e.preventDefault();
        setActivePanel((p) => (p === 'left' ? 'right' : 'left'));
      }
      if (e.key === 'F5') {
        e.preventDefault();
        void copyToOther();
      }
      if (e.key === 'F6') {
        e.preventDefault();
        void moveToOther();
      }
      if (e.key === 'F8') {
        e.preventDefault();
        void deleteSelected();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copyToOther, moveToOther, deleteSelected]);

  const pendingCount = transferQueue.filter((j) => j.status === 'pending' || j.status === 'running').length;

  function onDragOverPanel(e: React.DragEvent, side: PanelSide) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPanel(side);
  }

  function onDragLeavePanel(e: React.DragEvent) {
    e.preventDefault();
    setDragOverPanel(null);
  }

  async function onDropPanel(e: React.DragEvent, side: PanelSide) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPanel(null);
    setActivePanel(side);
    const fl = e.dataTransfer.files;
    const paths: string[] = [];
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i] as File & { path?: string };
      if (f.path) paths.push(f.path);
    }
    if (paths.length === 0) return;
    const targetPath = pathFor(side);
    if (isPanelLocal(side)) {
      const r = await window.anssh.localFs.importPaths(targetPath, paths);
      if (r.success) await loadPanel(side, targetPath);
      else setError(r.error || 'Import');
      return;
    }
    const sid = panelRemoteSession(side);
    enqueueUploadsToRemote(paths, targetPath, sid);
  }

  function renderBreadcrumb(side: PanelSide, pathStr: string, isLocal: boolean) {
    if (isLocal) {
      const parts = splitLocalPath(pathStr);
      return (
        <div className="flex items-center gap-0.5 text-[10px] min-w-0 flex-1 overflow-x-auto font-mono">
          {parts.map((_, i) => (
            <span key={`${side}-loc-${i}`} className="flex items-center gap-0.5">
              {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-text-faint flex-shrink-0" />}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void (async () => {
                    const sub = parts.slice(0, i + 1);
                    const np = await buildLocalPath(sub);
                    await loadPanel(side, np);
                  })();
                }}
                className="text-text-muted hover:text-text px-0.5 rounded truncate max-w-[100px]"
              >
                {parts[i]}
              </button>
            </span>
          ))}
        </div>
      );
    }
    const parts = pathStr.split('/').filter(Boolean);
    return (
      <div className="flex items-center gap-0.5 text-[10px] min-w-0 flex-1 overflow-x-auto">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void loadPanel(side, '/');
          }}
          className="text-text-muted hover:text-text px-0.5 rounded whitespace-nowrap"
        >
          /
        </button>
        {parts.map((part, i) => (
          <span key={`${side}-${i}-${part}`} className="flex items-center gap-0.5">
            <ChevronRight className="w-2.5 h-2.5 text-text-faint flex-shrink-0" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void loadPanel(side, '/' + parts.slice(0, i + 1).join('/'));
              }}
              className="text-text-muted hover:text-text px-0.5 rounded truncate max-w-[120px]"
            >
              {part}
            </button>
          </span>
        ))}
      </div>
    );
  }

  function renderPanel(side: PanelSide) {
    const pathStr = side === 'left' ? leftPath : rightPath;
    const files = side === 'left' ? leftFiles : rightFiles;
    const loading = side === 'left' ? loadingLeft : loadingRight;
    const selected = side === 'left' ? selLeft : selRight;
    const isActive = activePanel === side;
    const isLocal = isPanelLocal(side);
    const localSegs = isLocal ? splitLocalPath(pathStr) : [];
    const canGoUp = isLocal ? localSegs.length > 1 : pathStr !== '/';

    return (
      <div
        role="button"
        tabIndex={0}
        className={`flex-1 flex flex-col min-w-0 min-h-0 border-2 rounded-lg overflow-hidden transition-colors ${
          isActive ? 'border-primary ring-1 ring-primary/30 bg-bg' : 'border-border bg-bg'
        } ${dragOverPanel === side ? 'ring-2 ring-inset ring-primary' : ''}`}
        onClick={() => setActivePanel(side)}
        onDragOver={(e) => onDragOverPanel(e, side)}
        onDragLeave={onDragLeavePanel}
        onDrop={(e) => onDropPanel(e, side)}
      >
        <div className="h-9 flex flex-col gap-0.5 px-2 py-1 border-b border-border bg-surface flex-shrink-0">
          {side === 'left' && (
            <div className="flex items-center gap-1 min-w-0">
              <Laptop className="w-3.5 h-3.5 text-text-faint flex-shrink-0" />
              <select
                value={leftMode === 'local' ? 'local' : leftRemoteSessionId}
                onChange={(e) => onLeftModeChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 h-6 text-[10px] bg-bg border border-border rounded px-1 text-text"
                title="Left panel source"
              >
                <option value="local">This computer</option>
                {sftpTabs.map((t) => (
                  <option key={t.sessionId} value={t.sessionId}>
                    SFTP: {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {side === 'right' && (
            <div className="flex items-center gap-1 text-[10px] text-text-muted">
              <HardDrive className="w-3.5 h-3.5" />
              <span className="truncate">Server: {host.name}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void navigateUp(side);
              }}
              disabled={!canGoUp}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted disabled:opacity-30"
              title="Up"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            {renderBreadcrumb(side, pathStr, isLocal)}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void loadPanel(side, pathStr);
              }}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-bg text-text-muted flex-shrink-0"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-text-faint animate-spin" />
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-text-muted text-left border-b border-border bg-surface sticky top-0">
                  <th className="py-1 px-2 font-medium w-6" />
                  <th className="py-1 px-2 font-medium">Name</th>
                  <th className="py-1 px-2 font-medium w-20 text-right">Size</th>
                  <th className="py-1 px-2 font-medium w-28">Modified</th>
                  <th className="py-1 px-2 font-medium w-12 text-center">Perms</th>
                  <th className="py-1 px-2 font-medium w-20" />
                </tr>
              </thead>
              <tbody>
                {newFolderSide === side && (
                  <tr className="border-b border-border bg-surface">
                    <td className="py-0.5 px-2">
                      <Folder className="w-3.5 h-3.5 text-primary" />
                    </td>
                    <td className="py-0.5 px-2" colSpan={5}>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreateFolder();
                          if (e.key === 'Escape') setNewFolderSide(null);
                        }}
                        onBlur={() => void handleCreateFolder()}
                        className="w-40 h-6 px-1 bg-bg border border-primary rounded text-[11px] text-text"
                        placeholder="Folder name"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  </tr>
                )}
                {files.map((file) => (
                  <tr
                    key={`${side}-${file.name}`}
                    className={`border-b border-border hover:bg-surface/80 cursor-default group ${
                      selected.has(file.name)
                        ? 'bg-primary/[0.22] ring-1 ring-inset ring-primary/50 shadow-[inset_3px_0_0_0_var(--color-primary)]'
                        : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActivePanel(side);
                      toggleSelect(side, file.name, e);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (file.isDirectory) void navigateTo(side, file.name);
                    }}
                  >
                    <td className="py-0.5 px-2">{getFileIcon(file)}</td>
                    <td className="py-0.5 px-2 text-text">
                      {renaming?.side === side && renaming.name === file.name ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRename(side, file.name, renameValue);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={() => void handleRename(side, file.name, renameValue)}
                          className="w-full max-w-[180px] h-6 px-1 bg-bg border border-primary rounded text-[11px]"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className={file.isDirectory ? 'font-medium' : ''}>{file.name}</span>
                      )}
                    </td>
                    <td className="py-0.5 px-2 text-text-muted text-right font-mono">
                      {file.isDirectory ? '—' : formatSize(file.size)}
                    </td>
                    <td className="py-0.5 px-2 text-text-muted">{formatDate(file.modifyTime)}</td>
                    <td className="py-0.5 px-2 text-text-faint text-center font-mono">
                      {formatPermissions(file.permissions)}
                    </td>
                    <td className="py-0.5 px-2">
                      <div className="flex items-center gap-0.5 justify-end opacity-0 group-hover:opacity-100">
                        {!file.isDirectory && !isLocal && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownloadRemote(side, file.name);
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg text-text-muted"
                            title="Download (dialog)"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenaming({ side, name: file.name });
                            setRenameValue(file.name);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-bg text-text-muted"
                          title="Rename"
                        >
                          <Edit className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {files.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-text-muted">
                      Empty · drag files here
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  const leftSelectValue = leftMode === 'local' ? 'local' : leftRemoteSessionId;

  return (
    <div className="h-full flex flex-col bg-bg min-h-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-surface flex-shrink-0">
        <span className="text-[10px] text-text-muted hidden sm:inline">Active panel:</span>
        <span className="text-[10px] font-medium text-primary">
          {activePanel === 'left' ? 'Left' : 'Right'}
        </span>
        <div className="h-4 w-px bg-border hidden sm:block" />
        <button
          type="button"
          disabled={bulkBusy || getSelectedInActive().size === 0}
          onClick={() => void copyToOther()}
          className="h-7 flex items-center gap-1 px-2 rounded-md text-[11px] bg-bg border border-border hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          title="Copy (F5)"
        >
          <Copy className="w-3.5 h-3.5" /> Copy
        </button>
        <button
          type="button"
          disabled={bulkBusy || getSelectedInActive().size === 0}
          onClick={() => void moveToOther()}
          className="h-7 flex items-center gap-1 px-2 rounded-md text-[11px] bg-bg border border-border hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          title="Move (F6)"
        >
          <CornerDownRight className="w-3.5 h-3.5" /> Move
        </button>
        <button
          type="button"
          disabled={bulkBusy || getSelectedInActive().size === 0}
          onClick={() => void deleteSelected()}
          className="h-7 flex items-center gap-1 px-2 rounded-md text-[11px] bg-error/15 text-error border border-error/30 hover:bg-error/25 disabled:opacity-40"
          title="Delete (F8)"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>
        <div className="flex-1 min-w-2" />
        <span className="text-[10px] text-text-faint hidden md:inline">
          Tab — panel · F5 / F6 / F8
        </span>
      </div>

      <div className="h-9 flex items-center gap-2 px-3 border-b border-border flex-shrink-0">
        <button
          type="button"
          onClick={() => void reconnect()}
          disabled={loadingLeft && loadingRight}
          className="h-7 flex items-center gap-1 px-2 rounded-md hover:bg-[var(--color-surface-2)] text-[11px] text-text-muted"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingLeft || loadingRight ? 'animate-spin' : ''}`} />
          Reconnect SSH
        </button>
        <button
          type="button"
          onClick={() => setShowQueue((s) => !s)}
          className={`h-7 flex items-center gap-1 px-2 rounded-md text-[11px] ${
            pendingCount ? 'text-primary bg-primary/10' : 'text-text-muted hover:bg-surface'
          }`}
        >
          <ListOrdered className="w-3.5 h-3.5" />
          Queue{transferQueue.length > 0 ? ` (${transferQueue.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => void handleUpload()}
          className="h-7 flex items-center gap-1 px-2 rounded-md hover:bg-surface text-[11px] text-text-muted"
        >
          <Upload className="w-3.5 h-3.5" /> Upload…
        </button>
        <button
          type="button"
          onClick={() => {
            setNewFolderSide(activePanel);
            setNewFolderName('');
          }}
          className="h-7 flex items-center gap-1 px-2 rounded-md hover:bg-surface text-[11px] text-text-muted"
        >
          <FolderPlus className="w-3.5 h-3.5" /> Folder
        </button>
      </div>

      {host.jumpHostId && (
        <div className="px-3 py-0.5 text-[10px] text-text-faint border-b border-border">
          Connecting via jump host
        </div>
      )}

      {showQueue && transferQueue.length > 0 && (
        <div className="border-b border-border bg-surface px-3 py-2 flex flex-col gap-1 max-h-24 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted font-medium">Upload queue to server</span>
            <button
              type="button"
              onClick={() => setQueuePaused((p) => !p)}
              className="text-[10px] flex items-center gap-1 text-primary"
            >
              {queuePaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              {queuePaused ? 'Resume' : 'Pause'}
            </button>
          </div>
          {transferQueue.map((j) => (
            <div key={j.id} className="text-[10px] font-mono flex justify-between gap-2">
              <span className="truncate text-text-muted">{j.name}</span>
              <span
                className={
                  j.status === 'error'
                    ? 'text-error'
                    : j.status === 'done'
                      ? 'text-success'
                      : j.status === 'running'
                        ? 'text-warning'
                        : 'text-text-faint'
                }
              >
                {j.status === 'pending' && 'wait'}
                {j.status === 'running' && '…'}
                {j.status === 'done' && 'done'}
                {j.status === 'error' && (j.error || 'error')}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[rgba(161,44,123,0.1)] border-b border-error text-[11px] text-error">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {bulkBusy && (
        <div className="px-3 py-1 text-[10px] text-text-muted border-b border-border flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Working…
        </div>
      )}

      <div className="flex-1 flex gap-2 p-2 min-h-0">
        {renderPanel('left')}
        {renderPanel('right')}
      </div>

      <div className="h-7 flex items-center justify-between px-3 border-t border-border text-[10px] text-text-faint flex-shrink-0 bg-surface">
        <span>
          Left: {leftMode === 'local' ? 'local' : `SFTP`} · Right: server
        </span>
        <span className="truncate max-w-[60%]">
          Selected: {getSelectedInActive().size}
          {activePanel === 'left' ? ` · ${leftPath}` : ` · ${rightPath}`}
        </span>
      </div>
    </div>
  );
}
