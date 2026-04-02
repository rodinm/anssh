export interface HostTunnelPreset {
  id: string;
  type: 'local' | 'remote' | 'dynamic';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  groupId: string | null;
  credentialId: string | null;
  jumpHostId: string | null;
  tunnelPresets: HostTunnelPreset[];
  tags: string[];
  ansibleHostKey?: string | null;
  connectionProfileId?: string | null;
  ansibleVarTags?: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface HostGroup {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  ansibleGroupName?: string | null;
  order: number;
}

export interface InventorySyncConfig {
  enabled: boolean;
  repoPath: string;
  branch: string;
  inventoryRelativePath: string;
  intervalMinutes: number;
  hostVarsRelative: string;
  groupVarsRelative: string;
  lastSyncedAt?: string;
  lastGitHead?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  jumpHostId: string | null;
  tunnelPresets: HostTunnelPreset[];
  order: number;
}

export interface AnsibleCommandPreset {
  id: string;
  name: string;
  command: string;
  cwd: string;
  order: number;
}

export interface AppSettings {
  inventorySync: InventorySyncConfig;
  connectionProfiles: ConnectionProfile[];
  ansibleCommands: AnsibleCommandPreset[];
  ansibleBrowseRoot: string;
}

export interface Credential {
  id: string;
  name: string;
  username: string;
  authType: 'password' | 'key' | 'key+password';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SftpFile {
  name: string;
  size: number;
  modifyTime: number;
  accessTime: number;
  isDirectory: boolean;
  isSymlink: boolean;
  permissions: number;
  owner: number;
  group: number;
}

export interface Snippet {
  id: string;
  name: string;
  command: string;
  scope: 'global' | 'group' | 'host';
  scopeId: string | null;
  tags: string[];
  order: number;
}

export interface TunnelConfig {
  id: string;
  sessionId: string;
  type: 'local' | 'remote' | 'dynamic';
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  connections?: number;
}

export interface Tab {
  id: string;
  type: 'terminal' | 'sftp';
  hostId: string;
  hostName: string;
  title: string;
  connected: boolean;
}

declare global {
  interface Window {
    anssh: {
      vault: {
        exists: () => Promise<boolean>;
        create: (password: string) => Promise<boolean>;
        unlock: (password: string) => Promise<boolean>;
        lock: () => Promise<boolean>;
        isUnlocked: () => Promise<boolean>;
      };
      credentials: {
        list: () => Promise<Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[]>;
        get: (id: string) => Promise<Credential | null>;
        save: (cred: Partial<Credential>) => Promise<Credential>;
        delete: (id: string) => Promise<boolean>;
      };
      hosts: {
        list: () => Promise<Host[]>;
        save: (host: Partial<Host>) => Promise<Host>;
        delete: (id: string) => Promise<boolean>;
        deleteMany: (ids: string[]) => Promise<number>;
        reorder: (hosts: { id: string; order: number }[]) => Promise<boolean>;
        effective: (
          hostId: string
        ) => Promise<{ jumpHostId: string | null; tunnelPresets: HostTunnelPreset[] } | null>;
      };
      groups: {
        list: () => Promise<HostGroup[]>;
        save: (group: Partial<HostGroup>) => Promise<HostGroup>;
        delete: (id: string) => Promise<boolean>;
        deleteMany: (ids: string[]) => Promise<number>;
      };
      ssh: {
        connect: (sessionId: string, config: any) => Promise<{ success: boolean; error?: string }>;
        disconnect: (sessionId: string) => Promise<boolean>;
        write: (sessionId: string, data: string | Uint8Array) => void;
        resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
        onData: (cb: (sessionId: string, data: Uint8Array) => void) => () => void;
        onClose: (cb: (sessionId: string) => void) => () => void;
        onError: (cb: (sessionId: string, error: string) => void) => () => void;
        hasSession: (sessionId: string) => Promise<boolean>;
      };
      localFs: {
        home: () => Promise<{ success: boolean; path?: string; error?: string }>;
        list: (dirPath: string) => Promise<{ success: boolean; files?: SftpFile[]; error?: string }>;
        dirname: (p: string) => Promise<string>;
        join: (a: string, b: string) => Promise<string>;
        delete: (p: string) => Promise<{ success: boolean; error?: string }>;
        rename: (from: string, to: string) => Promise<{ success: boolean; error?: string }>;
        mkdir: (p: string) => Promise<{ success: boolean; error?: string }>;
        mkdirp: (p: string) => Promise<{ success: boolean; error?: string }>;
        stat: (p: string) => Promise<{
          success: boolean;
          isDirectory?: boolean;
          isFile?: boolean;
          isSymbolicLink?: boolean;
          error?: string;
        }>;
        importPaths: (targetDir: string, paths: string[]) => Promise<{ success: boolean; error?: string }>;
      };
      sftp: {
        list: (sessionId: string, remotePath: string) => Promise<{ success: boolean; files?: SftpFile[]; error?: string }>;
        download: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
        downloadTo: (sessionId: string, remotePath: string, localPath: string) => Promise<{ success: boolean; error?: string }>;
        upload: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
        uploadPath: (sessionId: string, remoteDir: string, localPath: string) => Promise<{ success: boolean; error?: string }>;
        uploadFile: (sessionId: string, localPath: string, remoteFilePath: string) => Promise<{ success: boolean; error?: string }>;
        stat: (
          sessionId: string,
          remotePath: string
        ) => Promise<{
          success: boolean;
          isDirectory?: boolean;
          isFile?: boolean;
          isSymbolicLink?: boolean;
          error?: string;
        }>;
        mkdir: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
        delete: (sessionId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
        rename: (sessionId: string, oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
        copyRemote: (sessionId: string, fromPath: string, toPath: string) => Promise<{ success: boolean; error?: string }>;
        transfer: (fromSessionId: string, fromPath: string, toSessionId: string, toPath: string) => Promise<{ success: boolean; error?: string }>;
      };
      dialog: {
        openFile: (options?: any) => Promise<{ path: string; content: string } | null>;
        openDirectory: () => Promise<string | null>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      };
      inventory: {
        pull: () => Promise<{ success: boolean; error?: string; head?: string }>;
        diff: () => Promise<{
          success: boolean;
          error?: string;
          diff?: {
            added: { name: string; hostname: string; port: number; group: string; varTags: string[] }[];
            removed: { id: string; name: string; ansibleHostKey: string }[];
            updated: { id: string; name: string; changes: string[] }[];
            parsedCount: number;
          };
          parsed?: number;
        }>;
        apply: (opts: {
          createMissingGroups: boolean;
          deleteRemovedHosts: boolean;
        }) => Promise<{
          success: boolean;
          error?: string;
          imported?: number;
          deleted?: number;
          updated?: number;
        }>;
      };
      ansible: {
        import: () => Promise<{ success: boolean; error?: string; total?: number; imported?: number; skipped?: number; groups?: number }>;
        runPlaybook: (req: {
          cwd: string;
          playbookPath: string;
          inventoryPath: string;
          limit?: string;
          check: boolean;
          extraArgs?: string[];
        }) => Promise<{ success: boolean; code?: number; stdout?: string; stderr?: string; error?: string }>;
        runRaw: (
          cwd: string,
          argv: string[]
        ) => Promise<{ success: boolean; code?: number; stdout?: string; stderr?: string; error?: string }>;
        tree: (root: string) => Promise<{ success: boolean; tree?: unknown; error?: string }>;
        search: (
          root: string,
          query: string
        ) => Promise<{
          success: boolean;
          hits?: { path: string; line: number; preview: string }[];
          error?: string;
        }>;
      };
      health: {
        probe: (
          targets: { host: string; port: number }[]
        ) => Promise<{ host: string; port: number; ok: boolean; latencyMs?: number; error?: string }[]>;
      };
      profiles: {
        export: () => Promise<{ success: boolean; error?: string; path?: string; hostsCount?: number; groupsCount?: number }>;
        import: () => Promise<{ success: boolean; error?: string; importedHosts?: number; skippedHosts?: number; importedGroups?: number; groupsMapped?: number }>;
      };
      snippets: {
        list: (filter?: any) => Promise<Snippet[]>;
        listForHost: (hostId: string, groupId: string | null) => Promise<Snippet[]>;
        save: (snippet: Partial<Snippet>) => Promise<Snippet>;
        delete: (id: string) => Promise<boolean>;
      };
      broadcast: {
        write: (sessionIds: string[], data: string) => void;
      };
      tunnels: {
        open: (config: Partial<TunnelConfig>) => Promise<{ success: boolean; error?: string }>;
        close: (tunnelId: string) => Promise<boolean>;
        list: () => Promise<TunnelConfig[]>;
      };
      logs: {
        getRecent: (maxLines?: number) => Promise<string[]>;
        openDir: () => Promise<boolean>;
        report: (level: string, message: string, context?: any) => Promise<boolean>;
      };
    };
  }
}
