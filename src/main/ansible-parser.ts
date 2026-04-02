/**
 * Parses Ansible inventory files (INI and YAML formats)
 * and returns a flat list of hosts with their groups.
 */

export interface ParsedHost {
  name: string;
  hostname: string;
  port: number;
  user?: string;
  group: string;
  vars: Record<string, string>;
}

// ────────────────────────────────────────────────
//  INI format parser
// ────────────────────────────────────────────────

export function parseIniInventory(content: string): ParsedHost[] {
  const lines = content.split('\n');
  const hosts: ParsedHost[] = [];
  let currentGroup = 'ungrouped';
  let inVarsSection = false;
  const groupVars: Record<string, Record<string, string>> = {};

  for (let rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    // Group header: [groupname] or [groupname:vars] or [groupname:children]
    const groupMatch = line.match(/^\[([^\]]+)\]$/);
    if (groupMatch) {
      const header = groupMatch[1];
      if (header.endsWith(':vars')) {
        inVarsSection = true;
        currentGroup = header.replace(':vars', '');
        if (!groupVars[currentGroup]) groupVars[currentGroup] = {};
      } else if (header.endsWith(':children')) {
        // Skip children sections for now — groups are already resolved
        inVarsSection = false;
        currentGroup = '__children__';
      } else {
        currentGroup = header;
        inVarsSection = false;
      }
      continue;
    }

    // Group vars section
    if (inVarsSection) {
      const varMatch = line.match(/^(\S+)\s*=\s*(.+)$/);
      if (varMatch) {
        if (!groupVars[currentGroup]) groupVars[currentGroup] = {};
        groupVars[currentGroup][varMatch[1]] = varMatch[2].trim();
      }
      continue;
    }

    // Skip children section lines
    if (currentGroup === '__children__') continue;

    // Host line: hostname ansible_host=X ansible_port=Y ansible_user=Z ...
    const parts = line.split(/\s+/);
    const hostAlias = parts[0];
    const vars: Record<string, string> = {};

    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx > 0) {
        const key = parts[i].substring(0, eqIdx);
        const val = parts[i].substring(eqIdx + 1).replace(/^['"]|['"]$/g, '');
        vars[key] = val;
      }
    }

    // Merge group vars
    if (groupVars[currentGroup]) {
      for (const [k, v] of Object.entries(groupVars[currentGroup])) {
        if (!vars[k]) vars[k] = v;
      }
    }

    // Resolve ansible_host, ansible_port, ansible_user, ansible_ssh_port, etc.
    const hostname = vars['ansible_host'] || vars['ansible_ssh_host'] || hostAlias;
    const port = parseInt(vars['ansible_port'] || vars['ansible_ssh_port'] || '22', 10);
    const user = vars['ansible_user'] || vars['ansible_ssh_user'] || undefined;

    hosts.push({
      name: hostAlias,
      hostname,
      port: isNaN(port) ? 22 : port,
      user,
      group: currentGroup,
      vars,
    });
  }

  return hosts;
}

// ────────────────────────────────────────────────
//  YAML format parser (simple, no jinja2)
// ────────────────────────────────────────────────

export function parseYamlInventory(content: string): ParsedHost[] {
  // Simple YAML parser for Ansible inventory structure:
  // all:
  //   hosts:
  //     host1:
  //       ansible_host: 1.2.3.4
  //   children:
  //     groupname:
  //       hosts:
  //         host2:
  //           ansible_host: 5.6.7.8

  const hosts: ParsedHost[] = [];

  try {
    const doc = simpleYamlParse(content);
    if (!doc || typeof doc !== 'object') return hosts;

    // If top-level is 'all'
    const root = doc['all'] || doc;
    extractHosts(root, 'all', hosts);

    // children
    if (root['children'] && typeof root['children'] === 'object') {
      for (const [groupName, groupObj] of Object.entries(root['children'] as Record<string, any>)) {
        if (groupObj && typeof groupObj === 'object') {
          extractHosts(groupObj, groupName, hosts);
          // Nested children
          if (groupObj['children'] && typeof groupObj['children'] === 'object') {
            for (const [subGroupName, subGroupObj] of Object.entries(groupObj['children'] as Record<string, any>)) {
              if (subGroupObj && typeof subGroupObj === 'object') {
                extractHosts(subGroupObj, `${groupName}/${subGroupName}`, hosts);
              }
            }
          }
        }
      }
    }
  } catch {
    // Fallback: try INI parse
    return parseIniInventory(content);
  }

  return hosts;
}

function extractHosts(obj: any, groupName: string, hosts: ParsedHost[]): void {
  if (!obj['hosts'] || typeof obj['hosts'] !== 'object') return;

  for (const [hostAlias, hostVars] of Object.entries(obj['hosts'] as Record<string, any>)) {
    const vars: Record<string, string> = {};
    if (hostVars && typeof hostVars === 'object') {
      for (const [k, v] of Object.entries(hostVars)) {
        vars[k] = String(v);
      }
    }

    // Apply group vars
    if (obj['vars'] && typeof obj['vars'] === 'object') {
      for (const [k, v] of Object.entries(obj['vars'] as Record<string, any>)) {
        if (!vars[k]) vars[k] = String(v);
      }
    }

    const hostname = vars['ansible_host'] || vars['ansible_ssh_host'] || hostAlias;
    const port = parseInt(vars['ansible_port'] || vars['ansible_ssh_port'] || '22', 10);
    const user = vars['ansible_user'] || vars['ansible_ssh_user'] || undefined;

    hosts.push({
      name: hostAlias,
      hostname,
      port: isNaN(port) ? 22 : port,
      user,
      group: groupName,
      vars,
    });
  }
}

// ────────────────────────────────────────────────
//  Simple YAML parser (handles Ansible inventory subset)
//  Supports: mappings, strings, numbers, nulls, nested indentation
//  Does NOT support: anchors, aliases, multiline strings, flow style
// ────────────────────────────────────────────────

function simpleYamlParse(content: string): any {
  const lines = content.split('\n');
  const result: any = {};
  const stack: { indent: number; obj: any; key: string }[] = [{ indent: -1, obj: result, key: '' }];

  for (const rawLine of lines) {
    // Remove comments
    const commentIdx = rawLine.indexOf('#');
    const line = commentIdx >= 0 ? rawLine.substring(0, commentIdx) : rawLine;
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Skip YAML directives
    if (trimmed.startsWith('---') || trimmed.startsWith('...')) continue;

    // Key: value pair
    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim();
    const rawVal = kvMatch[2].trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (rawVal === '' || rawVal === '~' || rawVal === 'null') {
      // Nested object will follow
      const newObj: any = {};
      parent[key] = newObj;
      stack.push({ indent, obj: newObj, key });
    } else {
      // Scalar value
      let val: any = rawVal;
      // Unquote strings
      if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
        val = val.slice(1, -1);
      } else if (val === 'true' || val === 'True' || val === 'yes' || val === 'Yes') {
        val = true;
      } else if (val === 'false' || val === 'False' || val === 'no' || val === 'No') {
        val = false;
      } else if (!isNaN(Number(val)) && val !== '') {
        val = Number(val);
      }
      parent[key] = val;
    }
  }

  return result;
}

// ────────────────────────────────────────────────
//  Auto-detect format and parse
// ────────────────────────────────────────────────

export function parseAnsibleInventory(content: string): ParsedHost[] {
  const trimmed = content.trim();

  // Heuristic: if it starts with a group bracket, it's INI
  if (trimmed.startsWith('[')) {
    return parseIniInventory(content);
  }

  // If it contains "all:" or "hosts:" near the top → YAML
  const firstLines = trimmed.split('\n').slice(0, 10).join('\n');
  if (firstLines.includes('all:') || firstLines.includes('hosts:') || firstLines.includes('children:')) {
    return parseYamlInventory(content);
  }

  // If lines contain key=value pairs → INI
  if (trimmed.match(/\s+\w+=\S+/)) {
    return parseIniInventory(content);
  }

  // Default: try YAML first, then INI
  const yamlResult = parseYamlInventory(content);
  if (yamlResult.length > 0) return yamlResult;
  return parseIniInventory(content);
}
