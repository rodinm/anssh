import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface Credential {
  id: string;
  name: string;
  username: string;
  authType: 'password' | 'key' | 'key+password';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultData {
  salt: string;
  iv: string;
  tag: string;
  data: string;
  check: string; // encrypted known string to verify password
  checkIv: string;
  checkTag: string;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SALT_LENGTH = 64;
const IV_LENGTH = 16;
const ITERATIONS = 100000;
const DIGEST = 'sha512';
const CHECK_STRING = 'NEXTERM_VAULT_OK';

export class CryptoStore {
  private vaultPath: string;
  private derivedKey: Buffer | null = null;
  private credentials: Credential[] = [];

  constructor(userDataPath: string) {
    this.vaultPath = path.join(userDataPath, 'vault.json');
  }

  vaultExists(): boolean {
    return fs.existsSync(this.vaultPath);
  }

  isUnlocked(): boolean {
    return this.derivedKey !== null;
  }

  private deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  }

  private encrypt(data: string, key: Buffer): { iv: string; tag: string; encrypted: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      encrypted,
    };
  }

  private decrypt(encrypted: string, key: Buffer, ivHex: string, tagHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  createVault(password: string): boolean {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this.deriveKey(password, salt);

    const checkEnc = this.encrypt(CHECK_STRING, key);
    const dataEnc = this.encrypt(JSON.stringify([]), key);

    const vault: VaultData = {
      salt: salt.toString('hex'),
      iv: dataEnc.iv,
      tag: dataEnc.tag,
      data: dataEnc.encrypted,
      check: checkEnc.encrypted,
      checkIv: checkEnc.iv,
      checkTag: checkEnc.tag,
    };

    fs.writeFileSync(this.vaultPath, JSON.stringify(vault, null, 2));
    this.derivedKey = key;
    this.credentials = [];
    return true;
  }

  unlock(password: string): boolean {
    if (!this.vaultExists()) return false;

    const vault: VaultData = JSON.parse(fs.readFileSync(this.vaultPath, 'utf-8'));
    const salt = Buffer.from(vault.salt, 'hex');
    const key = this.deriveKey(password, salt);

    try {
      const check = this.decrypt(vault.check, key, vault.checkIv, vault.checkTag);
      if (check !== CHECK_STRING) return false;
    } catch {
      return false;
    }

    try {
      const data = this.decrypt(vault.data, key, vault.iv, vault.tag);
      this.credentials = JSON.parse(data);
    } catch {
      this.credentials = [];
    }

    this.derivedKey = key;
    return true;
  }

  lock(): void {
    this.save();
    this.derivedKey = null;
    this.credentials = [];
  }

  private save(): void {
    if (!this.derivedKey) return;

    const vault: VaultData = JSON.parse(fs.readFileSync(this.vaultPath, 'utf-8'));
    const dataEnc = this.encrypt(JSON.stringify(this.credentials), this.derivedKey);

    vault.iv = dataEnc.iv;
    vault.tag = dataEnc.tag;
    vault.data = dataEnc.encrypted;

    fs.writeFileSync(this.vaultPath, JSON.stringify(vault, null, 2));
  }

  listCredentials(): Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[] {
    return this.credentials.map(({ password, privateKey, passphrase, ...rest }) => rest);
  }

  getCredential(id: string): Credential | null {
    return this.credentials.find((c) => c.id === id) || null;
  }

  saveCredential(cred: Partial<Credential> & { name: string; username: string }): Credential {
    const now = new Date().toISOString();
    const existing = cred.id ? this.credentials.find((c) => c.id === cred.id) : null;

    if (existing) {
      Object.assign(existing, { ...cred, updatedAt: now });
      this.save();
      return existing;
    }

    const newCred: Credential = {
      id: uuidv4(),
      name: cred.name,
      username: cred.username,
      authType: cred.authType || 'password',
      password: cred.password,
      privateKey: cred.privateKey,
      passphrase: cred.passphrase,
      createdAt: now,
      updatedAt: now,
    };

    this.credentials.push(newCred);
    this.save();
    return newCred;
  }

  deleteCredential(id: string): boolean {
    const idx = this.credentials.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    this.credentials.splice(idx, 1);
    this.save();
    return true;
  }
}
