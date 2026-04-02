import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CryptoStore, VAULT_FORMAT_VERSION } from './crypto-store';

describe('CryptoStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anssh-vault-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates vault, locks and unlocks with correct password', async () => {
    const store = new CryptoStore(dir);
    expect(store.vaultExists()).toBe(false);
    await store.createVault('correct-horse-battery-staple');
    expect(store.vaultExists()).toBe(true);
    expect(store.isUnlocked()).toBe(true);

    store.lock();
    expect(store.isUnlocked()).toBe(false);

    expect(await store.unlock('correct-horse-battery-staple')).toBe(true);
    expect(store.isUnlocked()).toBe(true);
  });

  it('rejects wrong password', async () => {
    const store = new CryptoStore(dir);
    await store.createVault('secret');
    store.lock();
    expect(await store.unlock('wrong')).toBe(false);
    expect(store.isUnlocked()).toBe(false);
  });

  it('stores and lists credentials without exposing secrets in list', async () => {
    const store = new CryptoStore(dir);
    await store.createVault('pw');
    store.saveCredential({
      name: 'prod',
      username: 'root',
      authType: 'password',
      password: 'hunter2',
    });
    store.lock();
    expect(await store.unlock('pw')).toBe(true);
    const list = store.listCredentials();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('prod');
    expect((list[0] as { password?: string }).password).toBeUndefined();

    const full = store.getCredential(list[0].id);
    expect(full?.password).toBe('hunter2');
  });

  it('inspectVaultFile reports missing file', () => {
    const store = new CryptoStore(dir);
    const r = store.inspectVaultFile();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/missing/i);
  });

  it('inspectVaultFile passes after create and records format version on disk', async () => {
    const store = new CryptoStore(dir);
    await store.createVault('pw');
    const r = store.inspectVaultFile();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.formatVersion).toBe(VAULT_FORMAT_VERSION);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf-8')) as { formatVersion?: number };
    expect(raw.formatVersion).toBe(VAULT_FORMAT_VERSION);
  });

  it('inspectVaultFile rejects invalid JSON', () => {
    fs.writeFileSync(path.join(dir, 'vault.json'), '{ not json', 'utf-8');
    const store = new CryptoStore(dir);
    const r = store.inspectVaultFile();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON/i);
  });

  it('createVault refuses to overwrite a valid vault', async () => {
    const store = new CryptoStore(dir);
    await store.createVault('first');
    store.lock();
    await expect(store.createVault('second')).rejects.toThrow(/already exists/i);
  });

  it('createVault replaces an unreadable vault file', async () => {
    fs.writeFileSync(path.join(dir, 'vault.json'), '{"legacy":true}', 'utf-8');
    const store = new CryptoStore(dir);
    expect(store.inspectVaultFile().ok).toBe(false);
    await store.createVault('fresh');
    expect(store.inspectVaultFile().ok).toBe(true);
    expect(await store.unlock('fresh')).toBe(true);
  });
});
