import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { parseAnsibleInventory, type ParsedHost } from './ansible-parser';
import type { InventorySource } from './settings-store';

const execFileAsync = promisify(execFile);

export async function gitFetchPull(repoPath: string, branch: string): Promise<{ ok: boolean; error?: string; head?: string }> {
  try {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
      return { ok: false, error: 'Not a git repository (no .git directory)' };
    }
    await execFileAsync('git', ['-C', repoPath, 'fetch', 'origin'], { timeout: 120_000 });
    await execFileAsync('git', ['-C', repoPath, 'checkout', branch], { timeout: 60_000 });
    await execFileAsync('git', ['-C', repoPath, 'pull', '--ff-only', 'origin', branch], { timeout: 120_000 });
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', 'HEAD']);
    return { ok: true, head: stdout.trim() };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function readInventoryFile(repoPath: string, inventoryRelative: string): { ok: true; hosts: ParsedHost[] } | { ok: false; error: string } {
  try {
    const full = path.join(repoPath, inventoryRelative);
    if (!fs.existsSync(full)) {
      return { ok: false, error: `Inventory file not found: ${full}` };
    }
    const content = fs.readFileSync(full, 'utf-8');
    const hosts = parseAnsibleInventory(content);
    return { ok: true, hosts };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function hostKey(hostname: string, port: number): string {
  return `${hostname}:${port}`;
}

/** Read and merge all configured inventory files; tags each host with source id/name. */
export function readMergedInventories(
  repoPath: string,
  sources: InventorySource[]
): { ok: true; hosts: ParsedHost[] } | { ok: false; error: string } {
  if (!sources.length) {
    return { ok: false, error: 'No inventory sources configured' };
  }
  const all: ParsedHost[] = [];
  const errors: string[] = [];
  for (const src of sources) {
    const r = readInventoryFile(repoPath, src.relativePath);
    if (!r.ok) {
      errors.push(`${src.name}: ${r.error}`);
      continue;
    }
    for (const h of r.hosts) {
      all.push({
        ...h,
        inventorySourceId: src.id,
        inventorySourceName: src.name,
      });
    }
  }
  if (all.length === 0 && errors.length > 0) {
    return { ok: false, error: errors.join('; ') };
  }
  return { ok: true, hosts: all };
}
