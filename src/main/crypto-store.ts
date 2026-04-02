import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const pbkdf2Async = promisify(crypto.pbkdf2);

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

/** On-disk shape; optional check* fields are legacy (pre–vault-only verification). */
interface VaultData {
  salt: string;
  iv: string;
  tag: string;
  data: string;
  check?: string;
  checkIv?: string;
  checkTag?: string;
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SALT_LENGTH = 64;
const IV_LENGTH = 16;
const ITERATIONS = 100000;
const DIGEST = 'sha512';

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
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

  async createVault(password: string): Promise<boolean> {
    this.zeroDerivedKey();
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = await this.deriveKey(password, salt);
    const dataEnc = this.encrypt(JSON.stringify([]), key);

    const vault: VaultData = {
      salt: salt.toString('hex'),
      iv: dataEnc.iv,
      tag: dataEnc.tag,
      data: dataEnc.encrypted,
    };

    atomicWriteJson(this.vaultPath, vault);
    this.derivedKey = key;
    this.credentials = [];
    return true;
  }

  async unlock(password: string): Promise<boolean> {
    if (!this.vaultExists()) return false;

    const vault: VaultData = JSON.parse(fs.readFileSync(this.vaultPath, 'utf-8'));
    const salt = Buffer.from(vault.salt, 'hex');
    const key = await this.deriveKey(password, salt);

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
