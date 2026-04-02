import { describe, it, expect } from 'vitest';
import {
  parseIniInventory,
  parseAnsibleInventory,
  parseYamlInventory,
} from './ansible-parser';

describe('parseIniInventory', () => {
  it('parses a simple group and host line', () => {
    const ini = `
[webservers]
web1 ansible_host=10.0.0.1 ansible_port=2222 ansible_user=deploy
`;
    const hosts = parseIniInventory(ini);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      name: 'web1',
      hostname: '10.0.0.1',
      port: 2222,
      user: 'deploy',
      group: 'webservers',
    });
  });

  it('uses host alias when ansible_host omitted', () => {
    const ini = `
[db]
postgres1
`;
    const hosts = parseIniInventory(ini);
    expect(hosts[0]?.hostname).toBe('postgres1');
    expect(hosts[0]?.port).toBe(22);
  });
});

describe('parseAnsibleInventory', () => {
  it('detects INI by leading bracket', () => {
    const ini = `[all]
h1 ansible_host=1.1.1.1
`;
    const hosts = parseAnsibleInventory(ini);
    expect(hosts.length).toBeGreaterThanOrEqual(1);
    expect(hosts.some((h) => h.hostname === '1.1.1.1')).toBe(true);
  });

  it('parses minimal YAML-style all/hosts', () => {
    const yaml = `all:
  hosts:
    n1:
      ansible_host: 192.168.1.10
      ansible_port: "22"
`;
    const hosts = parseYamlInventory(yaml);
    expect(hosts.some((h) => h.name === 'n1' && h.hostname === '192.168.1.10')).toBe(true);
  });
});
