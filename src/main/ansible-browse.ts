import fs from 'fs';
import path from 'path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'release', '.venv', 'venv']);

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

export function listTree(root: string, rel = '', maxDepth = 4, depth = 0): TreeNode | null {
  const full = rel ? path.join(root, rel) : root;
  try {
    if (!fs.existsSync(full)) return null;
    const st = fs.statSync(full);
    const name = rel ? path.basename(full) : path.basename(root) || root;
    if (!st.isDirectory()) {
      return { name, path: full, type: 'file' };
    }
    if (depth >= maxDepth) {
      return { name, path: full, type: 'dir', children: [] };
    }
    const entries = fs.readdirSync(full, { withFileTypes: true });
    const children: TreeNode[] = [];
    for (const ent of entries) {
      if (SKIP.has(ent.name)) continue;
      if (ent.name.startsWith('.')) continue;
      const sub = ent.isDirectory()
        ? listTree(root, path.join(rel, ent.name), maxDepth, depth + 1)
        : { name: ent.name, path: path.join(full, ent.name), type: 'file' as const };
      if (sub) children.push(sub);
    }
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { name, path: full, type: 'dir', children };
  } catch {
    return null;
  }
}

const TEXT_EXT = new Set([
  '.yml',
  '.yaml',
  '.ini',
  '.cfg',
  '.j2',
  '.md',
  '.txt',
  '.sh',
  '',
]);

export function searchInRepo(
  root: string,
  query: string,
  maxFiles = 200
): { path: string; line: number; preview: string }[] {
  const results: { path: string; line: number; preview: string }[] = [];
  const q = query.toLowerCase();
  if (!q || !fs.existsSync(root)) return results;

  function walk(dir: string) {
    if (results.length >= maxFiles) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of dirents) {
      if (results.length >= maxFiles) return;
      if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        if (!TEXT_EXT.has(ext)) continue;
        try {
          const content = fs.readFileSync(p, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({
                path: p,
                line: i + 1,
                preview: lines[i].trim().slice(0, 200),
              });
              break;
            }
          }
        } catch {
          /* binary */
        }
      }
    }
  }

  walk(root);
  return results;
}
