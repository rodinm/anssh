import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { HostTunnelPreset } from './host-store';

/** One inventory file inside the git repo (Hadoop, Greenplum, …). */
export interface InventorySource {
  id: string;
  /** Sidebar root label and tab prefix */
  name: string;
  /** Path relative to repo root */
  relativePath: string;
}

export interface InventorySyncConfig {
  enabled: boolean;
  /** Absolute path to local git clone */
  repoPath: string;
  branch: string;
  /**
   * Legacy single path; kept in sync with the first entry in `inventorySources` when possible.
   * @deprecated Prefer inventorySources
   */
  inventoryRelativePath: string;
  /** Multiple service inventories; each becomes a top-level group in the host list. */
  inventorySources?: InventorySource[];
  /** 0 = manual only */
  intervalMinutes: number;
  /** Relative to repo root */
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
  /** Arguments passed to ansible-playbook after playbook path, or full ansible command */
  command: string;
  cwd: string;
  order: number;
}

export interface AppSettings {
  inventorySync: InventorySyncConfig;
  connectionProfiles: ConnectionProfile[];
  ansibleCommands: AnsibleCommandPreset[];
  /** Default root for browse + ansible cwd */
  ansibleBrowseRoot: string;
}

const defaultInventorySync = (): InventorySyncConfig => ({
  enabled: false,
  repoPath: '',
  branch: 'main',
  inventoryRelativePath: 'inventory/hosts.ini',
  inventorySources: [
    { id: 'default', name: 'Inventory', relativePath: 'inventory/hosts.ini' },
  ],
  intervalMinutes: 60,
  hostVarsRelative: 'host_vars',
  groupVarsRelative: 'group_vars',
});

/** Sources to read for sync (supports legacy single-path settings). */
export function effectiveInventorySources(inv: InventorySyncConfig): InventorySource[] {
  if (inv.inventorySources && inv.inventorySources.length > 0) {
    return inv.inventorySources;
  }
  return [
    {
      id: 'default',
      name: 'Inventory',
      relativePath: inv.inventoryRelativePath || 'inventory/hosts.ini',
    },
  ];
}

export function defaultSettings(): AppSettings {
  return {
    inventorySync: defaultInventorySync(),
    connectionProfiles: [],
    ansibleCommands: [],
    ansibleBrowseRoot: '',
  };
}

export class SettingsStore {
  private path: string;
  private data: AppSettings;

  constructor(userDataPath: string) {
    this.path = path.join(userDataPath, 'settings.json');
    this.data = defaultSettings();
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.path)) {
        const raw = JSON.parse(fs.readFileSync(this.path, 'utf-8')) as Partial<AppSettings>;
        const mergedInv = { ...defaultInventorySync(), ...(raw.inventorySync || {}) };
        if (!raw.inventorySync?.inventorySources?.length) {
          mergedInv.inventorySources = [
            {
              id: 'default',
              name: 'Inventory',
              relativePath: mergedInv.inventoryRelativePath || 'inventory/hosts.ini',
            },
          ];
        }
        if (!mergedInv.inventoryRelativePath && mergedInv.inventorySources?.[0]) {
          mergedInv.inventoryRelativePath = mergedInv.inventorySources[0].relativePath;
        }
        this.data = {
          ...defaultSettings(),
          ...raw,
          inventorySync: mergedInv,
          connectionProfiles: Array.isArray(raw.connectionProfiles) ? raw.connectionProfiles : [],
          ansibleCommands: Array.isArray(raw.ansibleCommands) ? raw.ansibleCommands : [],
        };
      }
    } catch {
      this.data = defaultSettings();
    }
  }

  private save(): void {
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  get(): AppSettings {
    return JSON.parse(JSON.stringify(this.data));
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.data = {
      ...this.data,
      ...patch,
      inventorySync: patch.inventorySync
        ? { ...this.data.inventorySync, ...patch.inventorySync }
        : this.data.inventorySync,
    };
    this.save();
    return this.get();
  }

  saveConnectionProfiles(profiles: ConnectionProfile[]): void {
    this.data.connectionProfiles = profiles;
    this.save();
  }

  saveAnsibleCommands(cmds: AnsibleCommandPreset[]): void {
    this.data.ansibleCommands = cmds;
    this.save();
  }

  upsertProfile(p: Partial<ConnectionProfile> & { name: string }): ConnectionProfile {
    const list = this.data.connectionProfiles;
    const existing = p.id ? list.find((x) => x.id === p.id) : null;
    if (existing) {
      Object.assign(existing, p);
      this.save();
      return existing;
    }
    const n: ConnectionProfile = {
      id: uuidv4(),
      name: p.name,
      jumpHostId: p.jumpHostId ?? null,
      tunnelPresets: p.tunnelPresets ?? [],
      order: list.length,
    };
    list.push(n);
    this.save();
    return n;
  }

  deleteProfile(id: string): boolean {
    const i = this.data.connectionProfiles.findIndex((x) => x.id === id);
    if (i === -1) return false;
    this.data.connectionProfiles.splice(i, 1);
    this.save();
    return true;
  }
}
