import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface HostGroup {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
  order: number;
  /** When set, inventory sync maps this Ansible group name to the app group */
  ansibleGroupName?: string | null;
}

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
  /** Bastion / jump host (another saved host id). */
  jumpHostId: string | null;
  /** Saved port-forward presets applied when a terminal session connects. */
  tunnelPresets: HostTunnelPreset[];
  tags: string[];
  /** Inventory host alias for sync matching */
  ansibleHostKey?: string | null;
  connectionProfileId?: string | null;
  /** Tags derived from host_vars/group_vars (ansible `tags`) */
  ansibleVarTags?: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export class HostStore {
  private hostsPath: string;
  private groupsPath: string;
  private hosts: Host[] = [];
  private groups: HostGroup[] = [];

  constructor(userDataPath: string) {
    this.hostsPath = path.join(userDataPath, 'hosts.json');
    this.groupsPath = path.join(userDataPath, 'groups.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.hostsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.hostsPath, 'utf-8')) as Host[];
        this.hosts = raw.map((h) => ({
          ...h,
          jumpHostId: h.jumpHostId ?? null,
          tunnelPresets: Array.isArray(h.tunnelPresets) ? h.tunnelPresets : [],
          ansibleHostKey: h.ansibleHostKey ?? null,
          connectionProfileId: h.connectionProfileId ?? null,
          ansibleVarTags: Array.isArray(h.ansibleVarTags) ? h.ansibleVarTags : [],
        }));
      }
    } catch {
      this.hosts = [];
    }
    try {
      if (fs.existsSync(this.groupsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.groupsPath, 'utf-8')) as HostGroup[];
        this.groups = raw.map((g) => ({
          ...g,
          ansibleGroupName: g.ansibleGroupName ?? null,
        }));
      }
    } catch {
      this.groups = [];
    }
  }

  private saveHosts(): void {
    fs.writeFileSync(this.hostsPath, JSON.stringify(this.hosts, null, 2));
  }

  private saveGroups(): void {
    fs.writeFileSync(this.groupsPath, JSON.stringify(this.groups, null, 2));
  }

  // --- Hosts ---
  list(): Host[] {
    return this.hosts.sort((a, b) => a.order - b.order);
  }

  save(host: Partial<Host> & { name: string; hostname: string }): Host {
    const now = new Date().toISOString();
    const existing = host.id ? this.hosts.find((h) => h.id === host.id) : null;

    if (existing) {
      Object.assign(existing, {
        ...host,
        tunnelPresets: host.tunnelPresets ?? existing.tunnelPresets,
        jumpHostId: host.jumpHostId !== undefined ? host.jumpHostId : existing.jumpHostId,
        ansibleVarTags: host.ansibleVarTags ?? existing.ansibleVarTags,
        updatedAt: now,
      });
      this.saveHosts();
      return existing;
    }

    const newHost: Host = {
      id: uuidv4(),
      name: host.name,
      hostname: host.hostname,
      port: host.port || 22,
      groupId: host.groupId || null,
      credentialId: host.credentialId || null,
      jumpHostId: host.jumpHostId ?? null,
      tunnelPresets: host.tunnelPresets ?? [],
      tags: host.tags || [],
      ansibleHostKey: host.ansibleHostKey ?? null,
      connectionProfileId: host.connectionProfileId ?? null,
      ansibleVarTags: host.ansibleVarTags ?? [],
      order: this.hosts.length,
      createdAt: now,
      updatedAt: now,
    };

    this.hosts.push(newHost);
    this.saveHosts();
    return newHost;
  }

  delete(id: string): boolean {
    const idx = this.hosts.findIndex((h) => h.id === id);
    if (idx === -1) return false;
    this.hosts.splice(idx, 1);
    this.clearJumpRefsToDeleted(new Set([id]));
    this.saveHosts();
    return true;
  }

  /** Deletes multiple hosts and clears jumpHostId on others if it pointed at a deleted host. */
  deleteHosts(ids: string[]): number {
    const deleted = new Set(ids);
    const before = this.hosts.length;
    this.hosts = this.hosts.filter((h) => !deleted.has(h.id));
    const removed = before - this.hosts.length;
    if (removed === 0) return 0;
    this.clearJumpRefsToDeleted(deleted);
    this.saveHosts();
    return removed;
  }

  private clearJumpRefsToDeleted(deleted: Set<string>): void {
    for (const h of this.hosts) {
      if (h.jumpHostId && deleted.has(h.jumpHostId)) {
        h.jumpHostId = null;
      }
    }
  }

  deleteGroups(ids: string[]): number {
    let n = 0;
    for (const id of ids) {
      if (this.deleteGroup(id)) n++;
    }
    return n;
  }

  reorder(hosts: { id: string; order: number }[]): boolean {
    for (const { id, order } of hosts) {
      const host = this.hosts.find((h) => h.id === id);
      if (host) host.order = order;
    }
    this.saveHosts();
    return true;
  }

  // --- Groups ---
  listGroups(): HostGroup[] {
    return this.groups.sort((a, b) => a.order - b.order);
  }

  saveGroup(group: Partial<HostGroup> & { name: string }): HostGroup {
    const existing = group.id ? this.groups.find((g) => g.id === group.id) : null;

    if (existing) {
      Object.assign(existing, {
        ...group,
        ansibleGroupName:
          group.ansibleGroupName !== undefined ? group.ansibleGroupName : existing.ansibleGroupName,
      });
      this.saveGroups();
      return existing;
    }

    const newGroup: HostGroup = {
      id: uuidv4(),
      name: group.name,
      color: group.color || '#4f98a3',
      parentId: group.parentId || null,
      ansibleGroupName: group.ansibleGroupName ?? null,
      order: this.groups.length,
    };

    this.groups.push(newGroup);
    this.saveGroups();
    return newGroup;
  }

  deleteGroup(id: string): boolean {
    const idx = this.groups.findIndex((g) => g.id === id);
    if (idx === -1) return false;
    this.groups.splice(idx, 1);
    // Move hosts from deleted group to ungrouped
    this.hosts.forEach((h) => {
      if (h.groupId === id) h.groupId = null;
    });
    // Move child groups to root
    this.groups.forEach((g) => {
      if (g.parentId === id) g.parentId = null;
    });
    this.saveGroups();
    this.saveHosts();
    return true;
  }
}
