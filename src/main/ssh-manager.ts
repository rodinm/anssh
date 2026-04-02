import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { Client, ClientChannel, SFTPWrapper, ConnectConfig as Ssh2ConnectConfig } from 'ssh2';
import { EventEmitter } from 'events';
import { getLogger } from './logger';

function joinRemote(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return `${dir.replace(/\/$/, '')}/${name}`;
}

function dirnameRemote(remotePath: string): string {
  if (remotePath === '/' || remotePath === '') return '/';
  const n = remotePath.replace(/\/$/, '');
  const i = n.lastIndexOf('/');
  if (i <= 0) return '/';
  return n.slice(0, i) || '/';
}

function basenameRemote(remotePath: string): string {
  const n = remotePath.replace(/\/$/, '');
  const parts = n.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

export interface JumpConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

interface SshSession {
  client: Client;
  jumpClient: Client | null;
  shell: ClientChannel | null;
  sftp: SFTPWrapper | null;
  host: string;
  port: number;
  connectedAt: number;
  lastActivity: number;
}

export interface ConnectConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  /** Connect through another SSH host (ProxyJump-style, one hop). */
  jump?: JumpConnectConfig;
}

export class SshManager extends EventEmitter {
  private sessions: Map<string, SshSession> = new Map();

  getClient(sessionId: string): Client | null {
    return this.sessions.get(sessionId)?.client || null;
  }

  async connect(sessionId: string, config: ConnectConfig): Promise<void> {
    const existing = this.sessions.get(sessionId);
    if (existing?.shell) {
      return;
    }
    if (existing && !existing.shell) {
      this.disconnect(sessionId);
    }
    if (config.jump) {
      return this.connectViaJump(sessionId, config);
    }
    return this.connectDirect(sessionId, config);
  }

  private buildAuthOptions(config: {
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  }): Partial<Ssh2ConnectConfig> {
    const base: Partial<Ssh2ConnectConfig> = {
      username: config.username,
      readyTimeout: 15000,
    };
    if (config.privateKey) {
      base.privateKey = config.privateKey;
      if (config.passphrase) base.passphrase = config.passphrase;
    } else if (config.password) {
      base.password = config.password;
    }
    return base;
  }

  private connectDirect(sessionId: string, config: ConnectConfig): Promise<void> {
    const log = getLogger();
    const client = new Client();
    const keepaliveInterval = config.keepaliveInterval || 15000;
    const keepaliveCountMax = config.keepaliveCountMax || 4;

    const connectConfig: Ssh2ConnectConfig = {
      host: config.host,
      port: config.port,
      ...this.buildAuthOptions(config),
      keepaliveInterval,
      keepaliveCountMax,
    };

    log.info('SSH connecting', {
      sessionId,
      host: config.host,
      port: config.port,
      user: config.username,
      viaJump: false,
    });

    return this.wireClient(sessionId, client, null, config, connectConfig, log);
  }

  private connectViaJump(sessionId: string, config: ConnectConfig): Promise<void> {
    const log = getLogger();
    const jump = config.jump!;
    const keepaliveInterval = config.keepaliveInterval || 15000;
    const keepaliveCountMax = config.keepaliveCountMax || 4;

    const jumpClient = new Client();

    const jumpCfg: Ssh2ConnectConfig = {
      host: jump.host,
      port: jump.port,
      ...this.buildAuthOptions(jump),
      keepaliveInterval,
      keepaliveCountMax,
    };

    log.info('SSH connecting via jump', {
      sessionId,
      jump: `${jump.host}:${jump.port}`,
      target: `${config.host}:${config.port}`,
      user: config.username,
    });

    return new Promise((resolve, reject) => {
      jumpClient.on('error', (err) => {
        log.error('Jump host SSH error', { sessionId, error: err });
        reject(err);
      });

      jumpClient.on('ready', () => {
        jumpClient.forwardOut('127.0.0.1', 0, config.host, config.port, (err, stream) => {
          if (err) {
            log.error('Jump forwardOut failed', { sessionId, error: err });
            jumpClient.end();
            reject(err);
            return;
          }

          const client = new Client();
          const mainCfg: Ssh2ConnectConfig = {
            sock: stream,
            ...this.buildAuthOptions(config),
            keepaliveInterval,
            keepaliveCountMax,
          };

          this.wireClient(sessionId, client, jumpClient, config, mainCfg, log).then(resolve).catch((e) => {
            jumpClient.end();
            reject(e);
          });
        });
      });

      jumpClient.connect(jumpCfg);
    });
  }

  private wireClient(
    sessionId: string,
    client: Client,
    jumpClient: Client | null,
    config: ConnectConfig,
    connectConfig: Ssh2ConnectConfig,
    log: ReturnType<typeof getLogger>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        const now = Date.now();
        const session: SshSession = {
          client,
          jumpClient,
          shell: null,
          sftp: null,
          host: config.host,
          port: config.port,
          connectedAt: now,
          lastActivity: now,
        };
        this.sessions.set(sessionId, session);

        log.info('SSH connected', { sessionId, host: config.host, viaJump: !!jumpClient });

        client.shell(
          {
            term: 'xterm-256color',
            cols: 80,
            rows: 24,
          },
          (err, stream) => {
            if (err) {
              log.error('SSH shell open failed', { sessionId, error: err });
              this.cleanup(sessionId);
              client.end();
              jumpClient?.end();
              reject(err);
              return;
            }

            session.shell = stream;

            stream.on('data', (data: Buffer) => {
              session.lastActivity = Date.now();
              this.emit('data', sessionId, data);
            });

            stream.on('close', () => {
              log.info('SSH shell closed', { sessionId, host: config.host });
              this.cleanup(sessionId);
            });

            stream.stderr.on('data', (data: Buffer) => {
              session.lastActivity = Date.now();
              this.emit('data', sessionId, data);
            });

            resolve();
          }
        );
      });

      client.on('timeout', () => {
        log.warn('SSH keepalive timeout — connection lost', {
          sessionId,
          host: config.host,
        });
        this.emit('error', sessionId, 'Keepalive timeout — connection lost');
        this.cleanup(sessionId);
      });

      client.on('error', (err) => {
        log.error('SSH connection error', {
          sessionId,
          host: config.host,
          error: err,
        });
        this.emit('error', sessionId, err.message);
        jumpClient?.end();
        if (this.sessions.has(sessionId)) {
          this.cleanup(sessionId);
        } else {
          reject(err);
        }
      });

      client.on('close', () => {
        log.info('SSH connection closed', { sessionId, host: config.host });
        this.cleanup(sessionId);
      });

      client.on('end', () => {
        log.info('SSH connection ended', { sessionId, host: config.host });
      });

      client.connect(connectConfig);
    });
  }

  write(sessionId: string, data: string | Buffer | Uint8Array): void {
    const session = this.sessions.get(sessionId);
    if (session?.shell) {
      session.lastActivity = Date.now();
      if (typeof data === 'string') {
        session.shell.write(data);
      } else {
        session.shell.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session?.shell) {
      session.shell.setWindow(rows, cols, 0, 0);
    }
  }

  getSessionInfo(sessionId: string): { host: string; port: number; lastActivity: number; uptime: number } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      host: session.host,
      port: session.port,
      lastActivity: session.lastActivity,
      uptime: Date.now() - session.connectedAt,
    };
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const log = getLogger();
      log.info('SSH disconnecting (user)', { sessionId, host: session.host });
      session.shell?.close();
      session.client.end();
      session.jumpClient?.end();
      this.cleanup(sessionId);
    }
  }

  disconnectAll(): void {
    for (const [id] of this.sessions) {
      this.disconnect(id);
    }
  }

  private cleanup(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    session?.jumpClient?.end();
    this.emit('close', sessionId);
  }

  private async getSftp(sessionId: string): Promise<SFTPWrapper> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.sftp) return session.sftp;

    return new Promise((resolve, reject) => {
      session.client.sftp((err, sftp) => {
        if (err) {
          getLogger().error('SFTP subsystem open failed', { sessionId, error: err });
          reject(err);
        } else {
          session.sftp = sftp;
          resolve(sftp);
        }
      });
    });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async sftpStat(
    sessionId: string,
    remotePath: string
  ): Promise<{ isDirectory: boolean; isFile: boolean; isSymbolicLink: boolean }> {
    const sftp = await this.getSftp(sessionId);
    return new Promise((resolve, reject) => {
      sftp.lstat(remotePath, (err, st) => {
        if (err) reject(err);
        else {
          resolve({
            isDirectory: st.isDirectory(),
            isFile: st.isFile(),
            isSymbolicLink: st.isSymbolicLink(),
          });
        }
      });
    });
  }

  async sftpList(sessionId: string, remotePath: string): Promise<any[]> {
    const sftp = await this.getSftp(sessionId);
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) reject(err);
        else {
          const files = list.map((item) => ({
            name: item.filename,
            size: item.attrs.size,
            modifyTime: item.attrs.mtime ? item.attrs.mtime * 1000 : 0,
            accessTime: item.attrs.atime ? item.attrs.atime * 1000 : 0,
            isDirectory: (item.attrs.mode! & 0o40000) !== 0,
            isSymlink: (item.attrs.mode! & 0o120000) === 0o120000,
            permissions: item.attrs.mode,
            owner: item.attrs.uid,
            group: item.attrs.gid,
          }));
          resolve(files.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          }));
        }
      });
    });
  }

  async sftpDownload(sessionId: string, remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => {
        if (err) {
          getLogger().error('SFTP download failed', { sessionId, remotePath, error: err });
          reject(err);
        } else resolve();
      });
    });
  }

  async sftpUpload(sessionId: string, localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err) => {
        if (err) {
          getLogger().error('SFTP upload failed', { sessionId, remotePath, error: err });
          reject(err);
        } else resolve();
      });
    });
  }

  async sftpMkdir(sessionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async sftpDelete(sessionId: string, remotePath: string): Promise<void> {
    await this.sftpDeleteRecursive(sessionId, remotePath);
  }

  private async sftpDeleteRecursive(sessionId: string, remotePath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    const stats = await new Promise<any>((resolve, reject) => {
      sftp.lstat(remotePath, (err, st) => (err ? reject(err) : resolve(st)));
    });
    if (stats.isSymbolicLink()) {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()));
      });
      return;
    }
    if (stats.isDirectory()) {
      const list = await this.sftpList(sessionId, remotePath);
      const children = list.filter((f) => f.name !== '.' && f.name !== '..');
      const limit = 10;
      for (let i = 0; i < children.length; i += limit) {
        const batch = children.slice(i, i + limit);
        await Promise.all(
          batch.map((f) => this.sftpDeleteRecursive(sessionId, joinRemote(remotePath, f.name)))
        );
      }
      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(remotePath, (err) => (err ? reject(err) : resolve()));
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => (err ? reject(err) : resolve()));
      });
    }
  }

  /** Copy file or directory within one SFTP session (dual-pane mode). */
  async sftpCopyRemote(sessionId: string, fromPath: string, toPath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    const stats = await new Promise<any>((resolve, reject) => {
      sftp.lstat(fromPath, (err, st) => (err ? reject(err) : resolve(st)));
    });
    if (stats.isSymbolicLink()) {
      const tmp = path.join(os.tmpdir(), `anssh-ln-${randomUUID()}-${basenameRemote(fromPath)}`);
      await this.sftpDownload(sessionId, fromPath, tmp);
      try {
        await this.sftpEnsureDir(sessionId, dirnameRemote(toPath));
        await this.sftpUpload(sessionId, tmp, toPath);
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* */
        }
      }
      return;
    }
    if (stats.isDirectory()) {
      await this.sftpEnsureDir(sessionId, toPath);
      const list = await this.sftpList(sessionId, fromPath);
      for (const f of list) {
        if (f.name === '.' || f.name === '..') continue;
        await this.sftpCopyRemote(
          sessionId,
          joinRemote(fromPath, f.name),
          joinRemote(toPath, f.name)
        );
      }
    } else {
      await this.sftpEnsureDir(sessionId, dirnameRemote(toPath));
      const tmp = path.join(os.tmpdir(), `anssh-cp-${randomUUID()}-${basenameRemote(fromPath)}`);
      await this.sftpDownload(sessionId, fromPath, tmp);
      try {
        await this.sftpUpload(sessionId, tmp, toPath);
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* */
        }
      }
    }
  }

  private async sftpEnsureDir(sessionId: string, remotePath: string): Promise<void> {
    if (remotePath === '/' || remotePath === '') return;
    const segments = remotePath.split('/').filter(Boolean);
    let cur = '';
    for (const seg of segments) {
      cur = cur ? `${cur}/${seg}` : `/${seg}`;
      try {
        await this.sftpMkdir(sessionId, cur);
      } catch {
        const sftp = await this.getSftp(sessionId);
        await new Promise<void>((resolve, reject) => {
          sftp.stat(cur, (err, st) => {
            if (err) reject(err);
            else if (st.isDirectory()) resolve();
            else reject(new Error(`${cur} exists and is not a directory`));
          });
        });
      }
    }
  }

  async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSftp(sessionId);
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
