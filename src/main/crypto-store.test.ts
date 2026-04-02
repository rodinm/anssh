import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CryptoStore } from './crypto-store';

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
    expect(await store.createVault('correct-horse-battery-staple')).toBe(true);
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
});
