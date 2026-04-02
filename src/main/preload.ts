import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels';

contextBridge.exposeInMainWorld('anssh', {
  vault: {
    exists: () => ipcRenderer.invoke(IPC.vault.exists),
    create: (password: string) => ipcRenderer.invoke(IPC.vault.create, password),
    unlock: (password: string) => ipcRenderer.invoke(IPC.vault.unlock, password),
    lock: () => ipcRenderer.invoke(IPC.vault.lock),
    isUnlocked: () => ipcRenderer.invoke(IPC.vault.isUnlocked),
  },

  credentials: {
    list: () => ipcRenderer.invoke(IPC.credentials.list),
    get: (id: string) => ipcRenderer.invoke(IPC.credentials.get, id),
    save: (cred: any) => ipcRenderer.invoke(IPC.credentials.save, cred),
    delete: (id: string) => ipcRenderer.invoke(IPC.credentials.delete, id),
  },

  hosts: {
    list: () => ipcRenderer.invoke(IPC.hosts.list),
    save: (host: any) => ipcRenderer.invoke(IPC.hosts.save, host),
    delete: (id: string) => ipcRenderer.invoke(IPC.hosts.delete, id),
    deleteMany: (ids: string[]) => ipcRenderer.invoke(IPC.hosts.deleteMany, ids),
    reorder: (hosts: any[]) => ipcRenderer.invoke(IPC.hosts.reorder, hosts),
    effective: (hostId: string) => ipcRenderer.invoke(IPC.hosts.effective, hostId),
  },

  groups: {
    list: () => ipcRenderer.invoke(IPC.groups.list),
    save: (group: any) => ipcRenderer.invoke(IPC.groups.save, group),
    delete: (id: string) => ipcRenderer.invoke(IPC.groups.delete, id),
    deleteMany: (ids: string[]) => ipcRenderer.invoke(IPC.groups.deleteMany, ids),
  },

  ssh: {
    connect: (sessionId: string, config: any) =>
      ipcRenderer.invoke(IPC.ssh.connect, sessionId, config),
    disconnect: (sessionId: string) => ipcRenderer.invoke(IPC.ssh.disconnect, sessionId),
    write: (sessionId: string, data: string | Uint8Array) =>
      ipcRenderer.send(IPC.ssh.data, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.ssh.resize, sessionId, cols, rows),
    onData: (callback: (sessionId: string, data: Uint8Array) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, data: Buffer | Uint8Array) => {
        const u8 = Buffer.isBuffer(data) ? new Uint8Array(data) : data;
        callback(sessionId, u8);
      };
      ipcRenderer.on(IPC.ssh.data, handler);
      return () => ipcRenderer.removeListener(IPC.ssh.data, handler);
    },
    onClose: (callback: (sessionId: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string) => callback(sessionId);
      ipcRenderer.on(IPC.ssh.close, handler);
      return () => ipcRenderer.removeListener(IPC.ssh.close, handler);
    },
    onError: (callback: (sessionId: string, error: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, error: string) =>
        callback(sessionId, error);
      ipcRenderer.on(IPC.ssh.error, handler);
      return () => ipcRenderer.removeListener(IPC.ssh.error, handler);
    },
    hasSession: (sessionId: string) => ipcRenderer.invoke(IPC.ssh.hasSession, sessionId),
  },

  localFs: {
    home: () => ipcRenderer.invoke(IPC.localFs.home),
    list: (dirPath: string) => ipcRenderer.invoke(IPC.localFs.list, dirPath),
    dirname: (p: string) => ipcRenderer.invoke(IPC.localFs.dirname, p),
    join: (a: string, b: string) => ipcRenderer.invoke(IPC.localFs.join, a, b),
    delete: (p: string) => ipcRenderer.invoke(IPC.localFs.delete, p),
    rename: (from: string, to: string) => ipcRenderer.invoke(IPC.localFs.rename, from, to),
    mkdir: (p: string) => ipcRenderer.invoke(IPC.localFs.mkdir, p),
    mkdirp: (p: string) => ipcRenderer.invoke(IPC.localFs.mkdirp, p),
    stat: (p: string) => ipcRenderer.invoke(IPC.localFs.stat, p),
    importPaths: (targetDir: string, paths: string[]) =>
      ipcRenderer.invoke(IPC.localFs.importPaths, targetDir, paths),
  },

  sftp: {
    list: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sftp.list, sessionId, remotePath),
    download: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sftp.download, sessionId, remotePath),
    upload: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sftp.upload, sessionId, remotePath),
    uploadPath: (sessionId: string, remoteDir: string, localPath: string) =>
      ipcRenderer.invoke(IPC.sftp.uploadPath, sessionId, remoteDir, localPath),
    uploadFile: (sessionId: string, localPath: string, remoteFilePath: string) =>
      ipcRenderer.invoke(IPC.sftp.uploadFile, sessionId, localPath, remoteFilePath),
    downloadTo: (sessionId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke(IPC.sftp.downloadTo, sessionId, remotePath, localPath),
    stat: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sftp.stat, sessionId, remotePath),
    mkdir: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sftp.mkdir, sessionId, remotePath),
    delete: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke(IPC.sftp.delete, sessionId, remotePath),
    rename: (sessionId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke(IPC.sftp.rename, sessionId, oldPath, newPath),
    copyRemote: (sessionId: string, fromPath: string, toPath: string) =>
      ipcRenderer.invoke(IPC.sftp.copyRemote, sessionId, fromPath, toPath),
    transfer: (fromSessionId: string, fromPath: string, toSessionId: string, toPath: string) =>
      ipcRenderer.invoke(IPC.sftp.transfer, fromSessionId, fromPath, toSessionId, toPath),
  },

  dialog: {
    openFile: (options?: any) => ipcRenderer.invoke(IPC.dialog.openFile, options),
    openDirectory: () => ipcRenderer.invoke(IPC.dialog.openDirectory),
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get),
    update: (patch: any) => ipcRenderer.invoke(IPC.settings.update, patch),
  },

  inventory: {
    pull: () => ipcRenderer.invoke(IPC.inventory.pull),
    diff: () => ipcRenderer.invoke(IPC.inventory.diff),
    apply: (opts: { createMissingGroups: boolean; deleteRemovedHosts: boolean }) =>
      ipcRenderer.invoke(IPC.inventory.apply, opts),
  },

  ansible: {
    import: () => ipcRenderer.invoke(IPC.ansible.import),
    runPlaybook: (req: any) => ipcRenderer.invoke(IPC.ansible.runPlaybook, req),
    runRaw: (cwd: string, argv: string[]) => ipcRenderer.invoke(IPC.ansible.runRaw, cwd, argv),
    tree: (root: string) => ipcRenderer.invoke(IPC.ansible.tree, root),
    search: (root: string, query: string) => ipcRenderer.invoke(IPC.ansible.search, root, query),
  },

  health: {
    probe: (targets: { host: string; port: number }[]) =>
      ipcRenderer.invoke(IPC.health.probe, targets),
  },

  profiles: {
    export: () => ipcRenderer.invoke(IPC.profiles.export),
    import: () => ipcRenderer.invoke(IPC.profiles.import),
  },

  snippets: {
    list: (filter?: any) => ipcRenderer.invoke(IPC.snippets.list, filter),
    listForHost: (hostId: string, groupId: string | null) =>
      ipcRenderer.invoke(IPC.snippets.listForHost, hostId, groupId),
    save: (snippet: any) => ipcRenderer.invoke(IPC.snippets.save, snippet),
    delete: (id: string) => ipcRenderer.invoke(IPC.snippets.delete, id),
  },

  broadcast: {
    write: (sessionIds: string[], data: string) =>
      ipcRenderer.send(IPC.broadcast.write, sessionIds, data),
  },

  tunnels: {
    open: (config: any) => ipcRenderer.invoke(IPC.tunnels.open, config),
    close: (tunnelId: string) => ipcRenderer.invoke(IPC.tunnels.close, tunnelId),
    list: () => ipcRenderer.invoke(IPC.tunnels.list),
  },

  logs: {
    getRecent: (maxLines?: number) => ipcRenderer.invoke(IPC.logs.getRecent, maxLines),
    openDir: () => ipcRenderer.invoke(IPC.logs.openDir),
    report: (level: string, message: string, context?: any) =>
      ipcRenderer.invoke(IPC.logs.report, level, message, context),
  },
});
