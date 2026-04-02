import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { ParsedHost } from './ansible-parser';

function readYamlFile(p: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const doc = yaml.load(raw);
    return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractTags(doc: Record<string, unknown> | null): string[] {
  if (!doc) return [];
  const t = doc.tags;
  if (Array.isArray(t)) {
    return t.map((x) => String(x));
  }
  if (typeof t === 'string') {
    return [t];
  }
  return [];
}

/**
 * Merge tags from host_vars and group_vars (ansible `tags` key).
 */
export function collectAnsibleVarTags(
  repoRoot: string,
  hostVarsRel: string,
  groupVarsRel: string,
  ph: ParsedHost
): string[] {
  const tags = new Set<string>();
  const hv = hostVarsRel.replace(/\/$/, '');
  const gv = groupVarsRel.replace(/\/$/, '');

  for (const ext of ['.yml', '.yaml']) {
    const hostFile = path.join(repoRoot, hv, `${ph.name}${ext}`);
    const doc = readYamlFile(hostFile);
    for (const x of extractTags(doc)) tags.add(`host:${x}`);
  }

  const group = ph.group.split('/')[0];
  for (const ext of ['.yml', '.yaml']) {
    const gf = path.join(repoRoot, gv, `${group}${ext}`);
    const doc = readYamlFile(gf);
    for (const x of extractTags(doc)) tags.add(`group:${x}`);
  }

  return [...tags];
}
