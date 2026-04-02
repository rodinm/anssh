/**
 * Single source of truth for IPC channel names (main ↔ preload).
 */
export const IPC = {
  vault: {
    exists: 'vault:exists',
    bootstrap: 'vault:bootstrap',
    create: 'vault:create',
    unlock: 'vault:unlock',
    lock: 'vault:lock',
    isUnlocked: 'vault:isUnlocked',
  },
  app: {
    openUserData: 'app:openUserData',
  },
  credentials: {
    list: 'credentials:list',
    get: 'credentials:get',
    save: 'credentials:save',
    delete: 'credentials:delete',
  },
  hosts: {
    list: 'hosts:list',
    save: 'hosts:save',
    delete: 'hosts:delete',
    deleteMany: 'hosts:deleteMany',
    reorder: 'hosts:reorder',
    effective: 'hosts:effective',
  },
  groups: {
    list: 'groups:list',
    save: 'groups:save',
    delete: 'groups:delete',
    deleteMany: 'groups:deleteMany',
  },
  ssh: {
    connect: 'ssh:connect',
    disconnect: 'ssh:disconnect',
    data: 'ssh:data',
    resize: 'ssh:resize',
    hasSession: 'ssh:hasSession',
    close: 'ssh:close',
    error: 'ssh:error',
  },
  sftp: {
    list: 'sftp:list',
    download: 'sftp:download',
    upload: 'sftp:upload',
    uploadPath: 'sftp:uploadPath',
    uploadFile: 'sftp:uploadFile',
    downloadTo: 'sftp:downloadTo',
    stat: 'sftp:stat',
    mkdir: 'sftp:mkdir',
    delete: 'sftp:delete',
    rename: 'sftp:rename',
    copyRemote: 'sftp:copyRemote',
    transfer: 'sftp:transfer',
  },
  localFs: {
    home: 'localFs:home',
    list: 'localFs:list',
    dirname: 'localFs:dirname',
    join: 'localFs:join',
    delete: 'localFs:delete',
    rename: 'localFs:rename',
    mkdir: 'localFs:mkdir',
    mkdirp: 'localFs:mkdirp',
    stat: 'localFs:stat',
    importPaths: 'localFs:importPaths',
  },
  dialog: {
    openFile: 'dialog:openFile',
    openDirectory: 'dialog:openDirectory',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
  },
  inventory: {
    pull: 'inventory:pull',
    diff: 'inventory:diff',
    apply: 'inventory:apply',
  },
  ansible: {
    import: 'ansible:import',
    runPlaybook: 'ansible:runPlaybook',
    runRaw: 'ansible:runRaw',
    tree: 'ansible:tree',
    search: 'ansible:search',
  },
  health: {
    probe: 'health:probe',
  },
  profiles: {
    export: 'profiles:export',
    import: 'profiles:import',
  },
  snippets: {
    list: 'snippets:list',
    listForHost: 'snippets:listForHost',
    save: 'snippets:save',
    delete: 'snippets:delete',
  },
  broadcast: {
    write: 'broadcast:write',
  },
  tunnels: {
    open: 'tunnels:open',
    close: 'tunnels:close',
    list: 'tunnels:list',
  },
  logs: {
    getRecent: 'logs:getRecent',
    openDir: 'logs:openDir',
    report: 'logs:report',
  },
} as const;
