import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

function pbkdf2Async(
  password: string,
  salt: Buffer,
  iterations: number,
  keylen: number,
  digest: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keylen, digest, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

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

/** Current on-disk format; bump when breaking crypto or JSON shape. */
export const VAULT_FORMAT_VERSION = 2;

/** On-disk shape; optional check* fields are legacy (pre–vault-only verification). */
interface VaultData {
  formatVersion?: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
  check?: string;
  checkIv?: string;
  checkTag?: string;
}

export type VaultInspectOk = { ok: true; formatVersion?: number };
export type VaultInspectBad = { ok: false; reason: string };
export type VaultInspectResult = VaultInspectOk | VaultInspectBad;

function isHex(s: string): boolean {
  return s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SALT_LENGTH = 64;
const IV_LENGTH = 16;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmp, json, 'utf-8');
  const backupPath = `${filePath}.bak`;
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
    }
    if (fs.existsSync(filePath) && process.platform === 'win32') {
      fs.unlinkSync(filePath);
    }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* */
    }
    throw e;
  }
}

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

  /**
   * Validates JSON shape and hex fields. Does not verify the password.
   * Wrong or legacy crypto still looks "ok" here; unlock will fail until the file is replaced.
   */
  inspectVaultFile(): VaultInspectResult {
    if (!this.vaultExists()) {
      return { ok: false, reason: 'Vault file is missing.' };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.vaultPath, 'utf-8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, reason: `Cannot read vault.json: ${msg}` };
    }
    let vault: unknown;
    try {
      vault = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, reason: 'vault.json is not valid JSON (file may be corrupt).' };
    }
    if (vault === null || typeof vault !== 'object' || Array.isArray(vault)) {
      return { ok: false, reason: 'vault.json must be a JSON object.' };
    }
    const v = vault as Record<string, unknown>;
    for (const key of ['salt', 'iv', 'tag', 'data'] as const) {
      const val = v[key];
      if (typeof val !== 'string' || val.length === 0) {
        return {
          ok: false,
          reason: `Unsupported vault format: missing or invalid "${key}". This file may be from an older app version.`,
        };
      }
      if (!isHex(val)) {
        return {
          ok: false,
          reason: `Unsupported vault format: "${key}" is not hex-encoded. This file may be from an older app version.`,
        };
      }
    }
    let salt: Buffer;
    let iv: Buffer;
    let tag: Buffer;
    try {
      salt = Buffer.from(v.salt as string, 'hex');
      iv = Buffer.from(v.iv as string, 'hex');
      tag = Buffer.from(v.tag as string, 'hex');
    } catch {
      return { ok: false, reason: 'vault.json contains invalid hex fields.' };
    }
    if (salt.length < 8) {
      return {
        ok: false,
        reason: 'Unsupported vault: salt is too short. This file may be from an older app version.',
      };
    }
    if (iv.length < 12 || iv.length > 16) {
      return {
        ok: false,
        reason: 'Unsupported vault: IV length is invalid for AES-GCM. This file may be from an older app version.',
      };
    }
    if (tag.length < 12 || tag.length > 16) {
      return {
        ok: false,
        reason: 'Unsupported vault: auth tag length is invalid. This file may be from an older app version.',
      };
    }
    const fv =
      typeof v.formatVersion === 'number' && Number.isFinite(v.formatVersion)
        ? v.formatVersion
        : undefined;
    return { ok: true, formatVersion: fv };
  }

  isUnlocked(): boolean {
    return this.derivedKey !== null;
  }

  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return pbkdf2Async(password, salt, ITERATIONS, KEY_LENGTH, DIGEST) as Promise<Buffer>;
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

  private zeroDerivedKey(): void {
    if (this.derivedKey) {
      this.derivedKey.fill(0);
      this.derivedKey = null;
    }
  }

  async createVault(password: string): Promise<void> {
    if (this.vaultExists()) {
      const st = this.inspectVaultFile();
      if (st.ok) {
        throw new Error(
          'A vault already exists. Use Unlock, or back up and remove vault.json to create a new one.'
        );
      }
    }
    this.zeroDerivedKey();
    try {
      const salt = crypto.randomBytes(SALT_LENGTH);
      const key = await this.deriveKey(password, salt);
      const dataEnc = this.encrypt(JSON.stringify([]), key);

      const vault: VaultData = {
        formatVersion: VAULT_FORMAT_VERSION,
        salt: salt.toString('hex'),
        iv: dataEnc.iv,
        tag: dataEnc.tag,
        data: dataEnc.encrypted,
      };

      atomicWriteJson(this.vaultPath, vault);
      this.derivedKey = key;
      this.credentials = [];
    } catch (e) {
      this.zeroDerivedKey();
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg, { cause: e });
    }
  }

  async unlock(password: string): Promise<boolean> {
    if (!this.vaultExists()) return false;

    let vault: VaultData;
    try {
      vault = JSON.parse(fs.readFileSync(this.vaultPath, 'utf-8')) as VaultData;
    } catch {
      return false;
    }
    if (
      typeof vault.salt !== 'string' ||
      typeof vault.data !== 'string' ||
      typeof vault.iv !== 'string' ||
      typeof vault.tag !== 'string'
    ) {
      return false;
    }

    let salt: Buffer;
    try {
      salt = Buffer.from(vault.salt, 'hex');
    } catch {
      return false;
    }
    if (salt.length === 0) return false;

    let key: Buffer;
    try {
      key = await this.deriveKey(password, salt);
    } catch {
      return false;
    }

    try {
      const data = this.decrypt(vault.data, key, vault.iv, vault.tag);
      const parsed = JSON.parse(data) as unknown;
      this.credentials = Array.isArray(parsed) ? (parsed as Credential[]) : [];
    } catch {
      key.fill(0);
      return false;
    }

    this.zeroDerivedKey();
    this.derivedKey = key;
    return true;
  }

  lock(): void {
    this.save();
    this.zeroDerivedKey();
    this.credentials = [];
  }

  private save(): void {
    if (!this.derivedKey) return;

    const vault = JSON.parse(fs.readFileSync(this.vaultPath, 'utf-8')) as VaultData;
    const dataEnc = this.encrypt(JSON.stringify(this.credentials), this.derivedKey);

    vault.formatVersion = VAULT_FORMAT_VERSION;
    vault.iv = dataEnc.iv;
    vault.tag = dataEnc.tag;
    vault.data = dataEnc.encrypted;
    delete vault.check;
    delete vault.checkIv;
    delete vault.checkTag;

    atomicWriteJson(this.vaultPath, vault);
  }

  listCredentials(): Omit<Credential, 'password' | 'privateKey' | 'passphrase'>[] {
    return this.credentials.map(
      ({ password: _pw, privateKey: _pk, passphrase: _pp, ...rest }) => rest
    );
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
