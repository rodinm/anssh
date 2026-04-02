import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('anssh', {
  vault: {
    exists: () => ipcRenderer.invoke('vault:exists'),
    create: (password: string) => ipcRenderer.invoke('vault:create', password),
    unlock: (password: string) => ipcRenderer.invoke('vault:unlock', password),
    lock: () => ipcRenderer.invoke('vault:lock'),
    isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  },

  credentials: {
    list: () => ipcRenderer.invoke('credentials:list'),
    get: (id: string) => ipcRenderer.invoke('credentials:get', id),
    save: (cred: any) => ipcRenderer.invoke('credentials:save', cred),
    delete: (id: string) => ipcRenderer.invoke('credentials:delete', id),
  },

  hosts: {
    list: () => ipcRenderer.invoke('hosts:list'),
    save: (host: any) => ipcRenderer.invoke('hosts:save', host),
    delete: (id: string) => ipcRenderer.invoke('hosts:delete', id),
    deleteMany: (ids: string[]) => ipcRenderer.invoke('hosts:deleteMany', ids),
    reorder: (hosts: any[]) => ipcRenderer.invoke('hosts:reorder', hosts),
    effective: (hostId: string) => ipcRenderer.invoke('hosts:effective', hostId),
  },

  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    save: (group: any) => ipcRenderer.invoke('groups:save', group),
    delete: (id: string) => ipcRenderer.invoke('groups:delete', id),
    deleteMany: (ids: string[]) => ipcRenderer.invoke('groups:deleteMany', ids),
  },

  ssh: {
    connect: (sessionId: string, config: any) =>
      ipcRenderer.invoke('ssh:connect', sessionId, config),
    disconnect: (sessionId: string) => ipcRenderer.invoke('ssh:disconnect', sessionId),
    write: (sessionId: string, data: string) =>
      ipcRenderer.send('ssh:data', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ssh:resize', sessionId, cols, rows),
    onData: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_e: any, sessionId: string, data: string) => callback(sessionId, data);
      ipcRenderer.on('ssh:data', handler);
      return () => ipcRenderer.removeListener('ssh:data', handler);
    },
    onClose: (callback: (sessionId: string) => void) => {
      const handler = (_e: any, sessionId: string) => callback(sessionId);
      ipcRenderer.on('ssh:close', handler);
      return () => ipcRenderer.removeListener('ssh:close', handler);
    },
    onError: (callback: (sessionId: string, error: string) => void) => {
      const handler = (_e: any, sessionId: string, error: string) => callback(sessionId, error);
      ipcRenderer.on('ssh:error', handler);
      return () => ipcRenderer.removeListener('ssh:error', handler);
    },
    hasSession: (sessionId: string) => ipcRenderer.invoke('ssh:hasSession', sessionId),
  },

  localFs: {
    home: () => ipcRenderer.invoke('localFs:home'),
    list: (dirPath: string) => ipcRenderer.invoke('localFs:list', dirPath),
    dirname: (p: string) => ipcRenderer.invoke('localFs:dirname', p),
    join: (a: string, b: string) => ipcRenderer.invoke('localFs:join', a, b),
    delete: (p: string) => ipcRenderer.invoke('localFs:delete', p),
    rename: (from: string, to: string) => ipcRenderer.invoke('localFs:rename', from, to),
    mkdir: (p: string) => ipcRenderer.invoke('localFs:mkdir', p),
    mkdirp: (p: string) => ipcRenderer.invoke('localFs:mkdirp', p),
    stat: (p: string) => ipcRenderer.invoke('localFs:stat', p),
    importPaths: (targetDir: string, paths: string[]) =>
      ipcRenderer.invoke('localFs:importPaths', targetDir, paths),
  },

  sftp: {
    list: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:list', sessionId, remotePath),
    download: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:download', sessionId, remotePath),
    upload: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:upload', sessionId, remotePath),
    uploadPath: (sessionId: string, remoteDir: string, localPath: string) =>
      ipcRenderer.invoke('sftp:uploadPath', sessionId, remoteDir, localPath),
    uploadFile: (sessionId: string, localPath: string, remoteFilePath: string) =>
      ipcRenderer.invoke('sftp:uploadFile', sessionId, localPath, remoteFilePath),
    downloadTo: (sessionId: string, remotePath: string, localPath: string) =>
      ipcRenderer.invoke('sftp:downloadTo', sessionId, remotePath, localPath),
    stat: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:stat', sessionId, remotePath),
    mkdir: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:mkdir', sessionId, remotePath),
    delete: (sessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:delete', sessionId, remotePath),
    rename: (sessionId: string, oldPath: string, newPath: string) =>
      ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),
    copyRemote: (sessionId: string, fromPath: string, toPath: string) =>
      ipcRenderer.invoke('sftp:copyRemote', sessionId, fromPath, toPath),
    transfer: (fromSessionId: string, fromPath: string, toSessionId: string, toPath: string) =>
      ipcRenderer.invoke('sftp:transfer', fromSessionId, fromPath, toSessionId, toPath),
  },

  dialog: {
    openFile: (options?: any) => ipcRenderer.invoke('dialog:openFile', options),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: any) => ipcRenderer.invoke('settings:update', patch),
  },

  inventory: {
    pull: () => ipcRenderer.invoke('inventory:pull'),
    diff: () => ipcRenderer.invoke('inventory:diff'),
    apply: (opts: { createMissingGroups: boolean; deleteRemovedHosts: boolean }) =>
      ipcRenderer.invoke('inventory:apply', opts),
  },

  ansible: {
    import: () => ipcRenderer.invoke('ansible:import'),
    runPlaybook: (req: any) => ipcRenderer.invoke('ansible:runPlaybook', req),
    runRaw: (cwd: string, argv: string[]) => ipcRenderer.invoke('ansible:runRaw', cwd, argv),
    tree: (root: string) => ipcRenderer.invoke('ansible:tree', root),
    search: (root: string, query: string) => ipcRenderer.invoke('ansible:search', root, query),
  },

  health: {
    probe: (targets: { host: string; port: number }[]) =>
      ipcRenderer.invoke('health:probe', targets),
  },

  profiles: {
    export: () => ipcRenderer.invoke('profiles:export'),
    import: () => ipcRenderer.invoke('profiles:import'),
  },

  snippets: {
    list: (filter?: any) => ipcRenderer.invoke('snippets:list', filter),
    listForHost: (hostId: string, groupId: string | null) =>
      ipcRenderer.invoke('snippets:listForHost', hostId, groupId),
    save: (snippet: any) => ipcRenderer.invoke('snippets:save', snippet),
    delete: (id: string) => ipcRenderer.invoke('snippets:delete', id),
  },

  broadcast: {
    write: (sessionIds: string[], data: string) =>
      ipcRenderer.send('broadcast:write', sessionIds, data),
  },

  tunnels: {
    open: (config: any) => ipcRenderer.invoke('tunnels:open', config),
    close: (tunnelId: string) => ipcRenderer.invoke('tunnels:close', tunnelId),
    list: () => ipcRenderer.invoke('tunnels:list'),
  },

  logs: {
    getRecent: (maxLines?: number) => ipcRenderer.invoke('logs:getRecent', maxLines),
    openDir: () => ipcRenderer.invoke('logs:openDir'),
    report: (level: string, message: string, context?: any) =>
      ipcRenderer.invoke('logs:report', level, message, context),
  },
});
