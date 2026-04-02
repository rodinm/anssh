import type { ParsedHost } from './ansible-parser';
import type { Host, HostGroup, HostStore } from './host-store';
import { collectAnsibleVarTags } from './ansible-vars';

export interface DiffAdded {
  name: string;
  hostname: string;
  port: number;
  group: string;
  varTags: string[];
}

export interface DiffRemoved {
  id: string;
  name: string;
  ansibleHostKey: string;
}

export interface DiffUpdated {
  id: string;
  name: string;
  changes: string[];
}

export interface InventoryDiffResult {
  added: DiffAdded[];
  removed: DiffRemoved[];
  updated: DiffUpdated[];
  parsedCount: number;
}

function resolveGroupId(
  ph: ParsedHost,
  groups: HostGroup[]
): string | null {
  const gname = ph.group.split('/')[0];
  const byAnsible = groups.find((g) => g.ansibleGroupName && g.ansibleGroupName === gname);
  if (byAnsible) return byAnsible.id;
  const byName = groups.find((g) => g.name === gname);
  if (byName) return byName.id;
  return null;
}

function findExistingHost(
  ph: ParsedHost,
  hosts: Host[]
): Host | undefined {
  return hosts.find(
    (h) =>
      (h.ansibleHostKey && h.ansibleHostKey === ph.name) ||
      (!h.ansibleHostKey && h.hostname === ph.hostname && h.port === ph.port)
  );
}

export function computeInventoryDiff(
  hosts: Host[],
  groups: HostGroup[],
  parsed: ParsedHost[],
  repoRoot: string,
  hostVarsRel: string,
  groupVarsRel: string
): InventoryDiffResult {
  const added: DiffAdded[] = [];
  const removed: DiffRemoved[] = [];
  const updated: DiffUpdated[] = [];

  const parsedKeys = new Set(parsed.map((p) => p.name));

  for (const ph of parsed) {
    const varTags = collectAnsibleVarTags(repoRoot, hostVarsRel, groupVarsRel, ph);
    const ex = findExistingHost(ph, hosts);
    if (!ex) {
      added.push({
        name: ph.name,
        hostname: ph.hostname,
        port: ph.port,
        group: ph.group,
        varTags,
      });
    } else {
      const changes: string[] = [];
      if (ex.hostname !== ph.hostname || ex.port !== ph.port) {
        changes.push(`address ${ex.hostname}:${ex.port} → ${ph.hostname}:${ph.port}`);
      }
      const gid = resolveGroupId(ph, groups);
      if (gid && ex.groupId !== gid) {
        changes.push('group membership');
      }
      const merged = [...new Set([...(ex.ansibleVarTags || []), ...varTags])];
      const tagDiff =
        merged.length !== (ex.ansibleVarTags || []).length ||
        varTags.some((t) => !(ex.ansibleVarTags || []).includes(t));
      if (tagDiff) changes.push('tags from vars');
      if (changes.length) {
        updated.push({ id: ex.id, name: ex.name, changes });
      }
    }
  }

  for (const h of hosts) {
    if (h.ansibleHostKey && !parsedKeys.has(h.ansibleHostKey)) {
      removed.push({ id: h.id, name: h.name, ansibleHostKey: h.ansibleHostKey });
    }
  }

  return { added, removed, updated, parsedCount: parsed.length };
}

export interface ApplyInventoryOptions {
  createMissingGroups: boolean;
  deleteRemovedHosts: boolean;
}

export function applyInventorySync(
  store: HostStore,
  parsed: ParsedHost[],
  repoRoot: string,
  hostVarsRel: string,
  groupVarsRel: string,
  opts: ApplyInventoryOptions
): { imported: number; deleted: number; updated: number } {
  let imported = 0;
  let deleted = 0;
  let updated = 0;

  let groups = store.listGroups();
  const groupCache = new Map<string, string>();

  function groupIdFor(ph: ParsedHost): string | null {
    const gname = ph.group.split('/')[0];
    if (groupCache.has(gname)) return groupCache.get(gname)!;

    let gid = resolveGroupId(ph, groups);
    if (!gid && opts.createMissingGroups) {
      const ng = store.saveGroup({
        name: gname,
        color: '#4f98a3',
        ansibleGroupName: gname,
      });
      groups = store.listGroups();
      gid = ng.id;
    }
    if (gid) groupCache.set(gname, gid);
    return gid;
  }

  for (const ph of parsed) {
    const varTags = collectAnsibleVarTags(repoRoot, hostVarsRel, groupVarsRel, ph);
    const hosts = store.list();
    const ex = findExistingHost(ph, hosts);
    const gid = groupIdFor(ph);
    const userTag = ph.user ? [`user:${ph.user}`] : [];

    if (!ex) {
      store.save({
        name: ph.name,
        hostname: ph.hostname,
        port: ph.port,
        groupId: gid,
        tags: userTag,
        ansibleHostKey: ph.name,
        ansibleVarTags: varTags,
      });
      imported++;
    } else {
      store.save({
        id: ex.id,
        name: ph.name,
        hostname: ph.hostname,
        port: ph.port,
        groupId: gid ?? ex.groupId,
        ansibleHostKey: ph.name,
        ansibleVarTags: varTags,
        tags: [...new Set([...(ex.tags || []).filter((t) => !t.startsWith('user:')), ...userTag])],
      });
      updated++;
    }
  }

  if (opts.deleteRemovedHosts) {
    const parsedKeys = new Set(parsed.map((p) => p.name));
    const all = store.list();
    for (const h of all) {
      if (h.ansibleHostKey && !parsedKeys.has(h.ansibleHostKey)) {
        if (store.delete(h.id)) deleted++;
      }
    }
  }

  return { imported, deleted, updated };
}
