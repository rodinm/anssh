import type { ParsedHost } from './ansible-parser';
import type { Host, HostGroup, HostStore } from './host-store';
import { collectAnsibleVarTags } from './ansible-vars';

export interface DiffAdded {
  name: string;
  hostname: string;
  port: number;
  group: string;
  varTags: string[];
  inventory?: string;
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

/** Stable key for matching hosts across merged inventories. */
export function parsedHostKey(ph: ParsedHost): string {
  return `${ph.inventorySourceId ?? 'legacy'}::${ph.name}`;
}

export function hostSyncKey(h: Host): string | null {
  if (!h.ansibleHostKey) return null;
  return `${h.inventorySourceId ?? 'legacy'}::${h.ansibleHostKey}`;
}

function normalizeAnsibleGroupSegments(group: string): string[] {
  const g = (group || '').trim();
  if (!g || g === 'all') return [];
  return g.split('/').filter(Boolean);
}

/** Deepest group id for a parsed host, or null if tree missing. */
export function resolveGroupIdForParsed(ph: ParsedHost, groups: HostGroup[]): string | null {
  if (ph.inventorySourceId) {
    const root = groups.find(
      (x) =>
        x.parentId === null &&
        x.inventorySourceId === ph.inventorySourceId &&
        (x.ansibleGroupPath === null || x.ansibleGroupPath === '')
    );
    if (!root) return null;
    const segments = normalizeAnsibleGroupSegments(ph.group);
    if (segments.length === 0) return root.id;
    let parentId = root.id;
    let found: HostGroup | undefined;
    for (let i = 0; i < segments.length; i++) {
      const pathStr = segments.slice(0, i + 1).join('/');
      found = groups.find(
        (x) =>
          x.parentId === parentId &&
          x.inventorySourceId === ph.inventorySourceId &&
          x.ansibleGroupPath === pathStr
      );
      if (!found) return null;
      parentId = found.id;
    }
    return found!.id;
  }
  const gname = ph.group.split('/')[0];
  const byAnsible = groups.find((g) => g.ansibleGroupName && g.ansibleGroupName === gname);
  if (byAnsible) return byAnsible.id;
  const byName = groups.find((g) => !g.inventorySourceId && g.name === gname);
  if (byName) return byName.id;
  return null;
}

function findExistingHost(ph: ParsedHost, hosts: Host[]): Host | undefined {
  return hosts.find(
    (h) =>
      (h.ansibleHostKey === ph.name &&
        (h.inventorySourceId ?? null) === (ph.inventorySourceId ?? null)) ||
      (!h.ansibleHostKey &&
        !ph.inventorySourceId &&
        h.hostname === ph.hostname &&
        h.port === ph.port)
  );
}

/**
 * Ensure root + nested groups exist for this inventory path; return leaf group id.
 */
export function ensureInventoryGroupPath(
  store: HostStore,
  sourceId: string,
  sourceName: string,
  ansibleGroup: string,
  createMissing: boolean
): string | null {
  let groups = store.listGroups();
  const segments = normalizeAnsibleGroupSegments(ansibleGroup);

  let root = groups.find(
    (g) =>
      g.parentId === null &&
      g.inventorySourceId === sourceId &&
      (g.ansibleGroupPath === null || g.ansibleGroupPath === '')
  );
  if (!root && createMissing) {
    root = store.saveGroup({
      name: sourceName,
      parentId: null,
      color: '#4f98a3',
      inventorySourceId: sourceId,
      ansibleGroupPath: null,
      ansibleGroupName: null,
    });
    groups = store.listGroups();
  }
  if (!root) return null;
  if (segments.length === 0) return root.id;

  let parentId = root.id;
  for (let i = 0; i < segments.length; i++) {
    const pathStr = segments.slice(0, i + 1).join('/');
    const segName = segments[i];
    let g = groups.find(
      (x) =>
        x.parentId === parentId &&
        x.inventorySourceId === sourceId &&
        x.ansibleGroupPath === pathStr
    );
    if (!g && createMissing) {
      g = store.saveGroup({
        name: segName,
        parentId,
        color: '#4f98a3',
        inventorySourceId: sourceId,
        ansibleGroupPath: pathStr,
        ansibleGroupName: pathStr,
      });
      groups = store.listGroups();
    }
    if (!g) return null;
    parentId = g.id;
  }
  return parentId;
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

  const parsedKeys = new Set(parsed.map(parsedHostKey));

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
        inventory: ph.inventorySourceName,
      });
    } else {
      const changes: string[] = [];
      if (ex.hostname !== ph.hostname || ex.port !== ph.port) {
        changes.push(`address ${ex.hostname}:${ex.port} → ${ph.hostname}:${ph.port}`);
      }
      const gid = resolveGroupIdForParsed(ph, groups);
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
    const k = hostSyncKey(h);
    if (k && !parsedKeys.has(k)) {
      removed.push({ id: h.id, name: h.name, ansibleHostKey: h.ansibleHostKey || '' });
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

  for (const ph of parsed) {
    const varTags = collectAnsibleVarTags(repoRoot, hostVarsRel, groupVarsRel, ph);
    const hosts = store.list();
    const ex = findExistingHost(ph, hosts);
    const sourceId = ph.inventorySourceId ?? 'default';
    const sourceName = ph.inventorySourceName ?? 'Inventory';
    const gid = ph.inventorySourceId
      ? ensureInventoryGroupPath(store, sourceId, sourceName, ph.group, opts.createMissingGroups)
      : legacyGroupId(store, ph, opts.createMissingGroups);

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
        inventorySourceId: ph.inventorySourceId ?? null,
        inventoryDisplayName: ph.inventorySourceName ?? null,
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
        inventorySourceId: ph.inventorySourceId ?? ex.inventorySourceId ?? null,
        inventoryDisplayName: ph.inventorySourceName ?? ex.inventoryDisplayName ?? null,
      });
      updated++;
    }
  }

  if (opts.deleteRemovedHosts) {
    const parsedKeys = new Set(parsed.map(parsedHostKey));
    const all = store.list();
    for (const h of all) {
      const k = hostSyncKey(h);
      if (k && !parsedKeys.has(k)) {
        if (store.delete(h.id)) deleted++;
      }
    }
  }

  return { imported, deleted, updated };
}

function legacyGroupId(store: HostStore, ph: ParsedHost, createMissing: boolean): string | null {
  const groups = store.listGroups();
  const gid = resolveGroupIdForParsed(ph, groups);
  if (gid || !createMissing) return gid;

  const gname = ph.group.split('/')[0];
  const ng = store.saveGroup({
    name: gname,
    color: '#4f98a3',
    ansibleGroupName: gname,
  });
  return ng.id;
}
