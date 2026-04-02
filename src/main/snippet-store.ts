import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface Snippet {
  id: string;
  name: string;
  command: string;
  /** null = global, groupId = group-scoped, hostId = host-scoped */
  scope: 'global' | 'group' | 'host';
  scopeId: string | null;
  tags: string[];
  order: number;
}

export class SnippetStore {
  private filePath: string;
  private snippets: Snippet[] = [];

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'snippets.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.snippets = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch { this.snippets = []; }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.snippets, null, 2));
  }

  list(filter?: { scope?: string; scopeId?: string }): Snippet[] {
    let result = this.snippets;
    if (filter?.scope) {
      result = result.filter((s) => s.scope === filter.scope);
    }
    if (filter?.scopeId) {
      result = result.filter((s) => s.scopeId === filter.scopeId);
    }
    return result.sort((a, b) => a.order - b.order);
  }

  /** Get snippets relevant to a host: global + group + host */
  listForHost(hostId: string, groupId: string | null): Snippet[] {
    return this.snippets
      .filter((s) =>
        s.scope === 'global' ||
        (s.scope === 'host' && s.scopeId === hostId) ||
        (s.scope === 'group' && groupId && s.scopeId === groupId)
      )
      .sort((a, b) => {
        // host-specific first, then group, then global
        const order = { host: 0, group: 1, global: 2 };
        const diff = order[a.scope] - order[b.scope];
        return diff !== 0 ? diff : a.order - b.order;
      });
  }

  save(snippet: Partial<Snippet> & { name: string; command: string }): Snippet {
    const existing = snippet.id ? this.snippets.find((s) => s.id === snippet.id) : null;
    if (existing) {
      Object.assign(existing, snippet);
      this.persist();
      return existing;
    }
    const newSnippet: Snippet = {
      id: uuidv4(),
      name: snippet.name,
      command: snippet.command,
      scope: snippet.scope || 'global',
      scopeId: snippet.scopeId || null,
      tags: snippet.tags || [],
      order: this.snippets.length,
    };
    this.snippets.push(newSnippet);
    this.persist();
    return newSnippet;
  }

  delete(id: string): boolean {
    const idx = this.snippets.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.snippets.splice(idx, 1);
    this.persist();
    return true;
  }
}
