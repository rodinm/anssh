import { app, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { parseAnsibleInventory } from '../ansible-parser';
import { getLogger } from '../logger';
import { gitFetchPull, readMergedInventories } from '../git-inventory';
import { effectiveInventorySources } from '../settings-store';
import { computeInventoryDiff, applyInventorySync } from '../inventory-diff';
import { runAnsiblePlaybook, runAnsibleRaw } from '../ansible-runner';
import { probeMany } from '../health-tcp';
import { listTree, searchInRepo } from '../ansible-browse';
import { IPC } from '../ipc-channels';
import type { MainIpcContext } from './context';

function sshInputToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf-8');
  return Buffer.alloc(0);
}

/**
 * Registers all `ipcMain` handlers once at startup. Channel names come from {@link IPC}
 * (shared with `preload.ts`). Logical blocks below: vault → hosts → SSH/SFTP → FS → settings → …
 */
export function registerAllIpc(ctx: MainIpcContext): void {
  const {
    cryptoStore,
    hostStore,
    snippetStore,
    tunnelManager,
    sshManager,
    settingsStore,
    getMainWindow,
    scheduleInventoryPullTimer,
  } = ctx;


    // --- Vault (master password) ---
    ipcMain.handle(IPC.vault.exists, () => cryptoStore.vaultExists());
    ipcMain.handle(IPC.vault.bootstrap, () => {
      const exists = cryptoStore.vaultExists();
      const unlocked = cryptoStore.isUnlocked();
      const userDataPath = app.getPath('userData');
      if (!exists) {
        return { exists: false, unlocked, userDataPath };
      }
      const inspected = cryptoStore.inspectVaultFile();
      if (!inspected.ok) {
        return {
          exists: true,
          unlocked,
          vaultIncompatible: true,
          vaultIncompatibleDetail: inspected.reason,
          userDataPath,
        };
      }
      return { exists: true, unlocked, userDataPath };
    });
    ipcMain.handle(IPC.vault.create, (_e, password: string) => cryptoStore.createVault(password));
    ipcMain.handle(IPC.vault.unlock, (_e, password: string) => cryptoStore.unlock(password));
    ipcMain.handle(IPC.vault.lock, () => { cryptoStore.lock(); return true; });
    ipcMain.handle(IPC.vault.isUnlocked, () => cryptoStore.isUnlocked());
    ipcMain.handle(IPC.app.openUserData, () => {
      void shell.openPath(app.getPath('userData'));
      return true;
    });

    // --- Credentials ---
    ipcMain.handle(IPC.credentials.list, () => cryptoStore.listCredentials());
    ipcMain.handle(IPC.credentials.get, (_e, id: string) => cryptoStore.getCredential(id));
    ipcMain.handle(IPC.credentials.save, (_e, cred: any) => cryptoStore.saveCredential(cred));
    ipcMain.handle(IPC.credentials.delete, (_e, id: string) => cryptoStore.deleteCredential(id));

    // --- Hosts ---
    ipcMain.handle(IPC.hosts.list, () => hostStore.list());
    ipcMain.handle(IPC.hosts.save, (_e, host: any) => hostStore.save(host));
    ipcMain.handle(IPC.hosts.delete, (_e, id: string) => hostStore.delete(id));
    ipcMain.handle(IPC.hosts.deleteMany, (_e, ids: string[]) => hostStore.deleteHosts(ids));
    ipcMain.handle(IPC.hosts.reorder, (_e, hosts: any[]) => hostStore.reorder(hosts));

    // --- Groups ---
    ipcMain.handle(IPC.groups.list, () => hostStore.listGroups());
    ipcMain.handle(IPC.groups.save, (_e, group: any) => hostStore.saveGroup(group));
    ipcMain.handle(IPC.groups.delete, (_e, id: string) => hostStore.deleteGroup(id));
    ipcMain.handle(IPC.groups.deleteMany, (_e, ids: string[]) => hostStore.deleteGroups(ids));

    // --- SSH ---
    ipcMain.handle(IPC.ssh.connect, async (_e, sessionId: string, config: any) => {
      try {
        let jumpHostId: string | undefined = config.jumpHostId;
        if (config.hostId) {
          const h = hostStore.list().find((x) => x.id === config.hostId);
          if (h) {
            let profileJump: string | null = null;
            if (h.connectionProfileId) {
              const prof = settingsStore.get().connectionProfiles.find((p) => p.id === h.connectionProfileId);
              profileJump = prof?.jumpHostId ?? null;
            }
            jumpHostId = (h.jumpHostId ?? profileJump) ?? undefined;
          }
        }

        const credential = config.credentialId
          ? cryptoStore.getCredential(config.credentialId)
          : null;
        const connectPayload: import('../ssh-manager').ConnectConfig = {
          host: config.host,
          port: config.port || 22,
          username: credential?.username || config.username,
          password: credential?.password,
          privateKey: credential?.privateKey,
          passphrase: credential?.passphrase,
        };

        if (jumpHostId) {
          const jumpHost = hostStore.list().find((h) => h.id === jumpHostId);
          if (!jumpHost) {
            return { success: false, error: 'Jump host not found' };
          }
          if (config.hostId && jumpHost.id === config.hostId) {
            return { success: false, error: 'Cannot use the same host as jump' };
          }
          const jc = jumpHost.credentialId
            ? cryptoStore.getCredential(jumpHost.credentialId)
            : null;
          const ju = jc?.username?.trim();
          if (!ju) {
            return { success: false, error: 'Jump host must have a credential with a username' };
          }
          connectPayload.jump = {
            host: jumpHost.hostname,
            port: jumpHost.port || 22,
            username: ju,
            password: jc?.password,
            privateKey: jc?.privateKey,
            passphrase: jc?.passphrase,
          };
        }

        await sshManager.connect(sessionId, connectPayload);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.hosts.effective, (_e, hostId: string) => {
      const h = hostStore.list().find((x) => x.id === hostId);
      if (!h) return null;
      let profileJump: string | null = null;
      let profileTunnels: import('../host-store').HostTunnelPreset[] = [];
      if (h.connectionProfileId) {
        const prof = settingsStore.get().connectionProfiles.find((p) => p.id === h.connectionProfileId);
        profileJump = prof?.jumpHostId ?? null;
        profileTunnels = prof?.tunnelPresets ?? [];
      }
      return {
        jumpHostId: h.jumpHostId ?? profileJump,
        tunnelPresets: [...profileTunnels, ...(h.tunnelPresets || [])],
      };
    });

    ipcMain.handle(IPC.ssh.disconnect, (_e, sessionId: string) => {
      sshManager.disconnect(sessionId);
      return true;
    });

    ipcMain.handle(IPC.ssh.resize, (_e, sessionId: string, cols: number, rows: number) => {
      sshManager.resize(sessionId, cols, rows);
    });

    ipcMain.on(IPC.ssh.data, (_e, sessionId: string, data: unknown) => {
      sshManager.write(sessionId, sshInputToBuffer(data));
    });

    sshManager.on('data', (sessionId: string, data: Buffer) => {
      getMainWindow()?.webContents.send(IPC.ssh.data, sessionId, data);
    });

    sshManager.on('close', (sessionId: string) => {
      tunnelManager.unregisterClient(sessionId);
      getMainWindow()?.webContents.send(IPC.ssh.close, sessionId);
    });

    sshManager.on('error', (sessionId: string, error: string) => {
      getMainWindow()?.webContents.send(IPC.ssh.error, sessionId, error);
    });

    // --- SFTP ---
    ipcMain.handle(IPC.sftp.list, async (_e, sessionId: string, remotePath: string) => {
      try {
        const files = await sshManager.sftpList(sessionId, remotePath);
        return { success: true, files };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.sftp.download, async (_e, sessionId: string, remotePath: string) => {
      const result = await dialog.showSaveDialog(getMainWindow()!, {
        defaultPath: path.basename(remotePath),
      });
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };
      try {
        await sshManager.sftpDownload(sessionId, remotePath, result.filePath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.sftp.upload, async (_e, sessionId: string, remotePath: string) => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths.length) return { success: false, error: 'Cancelled' };
      try {
        for (const localPath of result.filePaths) {
          const remoteFile = remotePath + '/' + path.basename(localPath);
          await sshManager.sftpUpload(sessionId, localPath, remoteFile);
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.sftp.uploadPath, async (_e, sessionId: string, remoteDir: string, localPath: string) => {
      try {
        const base = path.basename(localPath);
        const norm = remoteDir.replace(/\/$/, '') || '';
        const remoteFile =
          norm === '' || norm === '/'
            ? `/${base}`
            : `${norm}/${base}`;
        await sshManager.sftpUpload(sessionId, localPath, remoteFile);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    /** Upload local file to full remote path (recursive copies). */
    ipcMain.handle(
      IPC.sftp.uploadFile,
      async (_e, sessionId: string, localPath: string, remoteFilePath: string) => {
        try {
          await sshManager.sftpUpload(sessionId, localPath, remoteFilePath);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    );

    ipcMain.handle(IPC.sftp.mkdir, async (_e, sessionId: string, remotePath: string) => {
      try {
        await sshManager.sftpMkdir(sessionId, remotePath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.sftp.delete, async (_e, sessionId: string, remotePath: string) => {
      try {
        await sshManager.sftpDelete(sessionId, remotePath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.sftp.rename, async (_e, sessionId: string, oldPath: string, newPath: string) => {
      try {
        await sshManager.sftpRename(sessionId, oldPath, newPath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.sftp.copyRemote, async (_e, sessionId: string, fromPath: string, toPath: string) => {
      try {
        await sshManager.sftpCopyRemote(sessionId, fromPath, toPath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(
      IPC.sftp.downloadTo,
      async (_e, sessionId: string, remotePath: string, localPath: string) => {
        try {
          await sshManager.sftpDownload(sessionId, remotePath, localPath);
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    );

    ipcMain.handle(IPC.sftp.stat, async (_e, sessionId: string, remotePath: string) => {
      try {
        const s = await sshManager.sftpStat(sessionId, remotePath);
        return { success: true, ...s };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.ssh.hasSession, (_e, sessionId: string) => sshManager.hasSession(sessionId));

    // --- Local FS (“This computer” panel) ---
    ipcMain.handle(IPC.localFs.home, () => ({ success: true, path: os.homedir() }));

    ipcMain.handle(IPC.localFs.list, async (_e, dirPath: string) => {
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const files = await Promise.all(
          entries.map(async (d) => {
            const full = path.join(dirPath, d.name);
            const st = await fs.promises.stat(full);
            return {
              name: d.name,
              size: st.isDirectory() ? 0 : st.size,
              modifyTime: st.mtimeMs,
              accessTime: st.atimeMs,
              isDirectory: st.isDirectory(),
              isSymlink: d.isSymbolicLink(),
              permissions: st.mode,
              owner: st.uid,
              group: st.gid,
            };
          })
        );
        files.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return { success: true, files };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.localFs.dirname, (_e, p: string) => path.dirname(p));
    ipcMain.handle(IPC.localFs.join, (_e, a: string, b: string) => path.join(a, b));

    ipcMain.handle(IPC.localFs.delete, async (_e, targetPath: string) => {
      try {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.localFs.rename, async (_e, from: string, to: string) => {
      try {
        await fs.promises.rename(from, to);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.localFs.mkdir, async (_e, dirPath: string) => {
      try {
        await fs.promises.mkdir(dirPath, { recursive: false });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.localFs.mkdirp, async (_e, dirPath: string) => {
      try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.localFs.stat, async (_e, targetPath: string) => {
      try {
        const st = await fs.promises.stat(targetPath);
        return {
          success: true,
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
          isSymbolicLink: st.isSymbolicLink(),
          size: st.size,
          mtimeMs: st.mtimeMs,
          mode: st.mode,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    /** Copy files/folders from disk into local folder (drag-and-drop onto “This computer” panel). */
    ipcMain.handle(IPC.localFs.importPaths, async (_e, targetDir: string, paths: string[]) => {
      try {
        for (const p of paths) {
          const name = path.basename(p);
          const dest = path.join(targetDir, name);
          await fs.promises.cp(p, dest, { recursive: true, force: true });
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // --- File dialog for key selection ---
    ipcMain.handle(IPC.dialog.openFile, async (_e, options: any) => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        properties: ['openFile'],
        filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
      });
      if (result.canceled) return null;
      return {
        path: result.filePaths[0],
        content: fs.readFileSync(result.filePaths[0], 'utf-8'),
      };
    });

    ipcMain.handle(IPC.dialog.openDirectory, async () => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return result.filePaths[0];
    });

    // ─────────────────────────────────────────────
    //  Settings (Ansible sync, profiles, commands)
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.settings.get, () => settingsStore.get());

    ipcMain.handle(IPC.settings.update, (_e, patch: any) => {
      const next = settingsStore.update(patch);
      scheduleInventoryPullTimer();
      return next;
    });

    ipcMain.handle(IPC.inventory.pull, async () => {
      const inv = settingsStore.get().inventorySync;
      if (!inv.repoPath) return { success: false, error: 'Repository path not configured' };
      const r = await gitFetchPull(inv.repoPath, inv.branch);
      if (!r.ok) return { success: false, error: r.error };
      settingsStore.update({
        inventorySync: {
          ...inv,
          lastSyncedAt: new Date().toISOString(),
          lastGitHead: r.head,
        },
      });
      return { success: true, head: r.head };
    });

    ipcMain.handle(IPC.inventory.diff, async () => {
      const inv = settingsStore.get().inventorySync;
      if (!inv.repoPath) return { success: false, error: 'Repository path not configured' };
      const sources = effectiveInventorySources(inv);
      const read = readMergedInventories(inv.repoPath, sources);
      if (!read.ok) return { success: false, error: read.error };
      const hosts = hostStore.list();
      const groups = hostStore.listGroups();
      const diff = computeInventoryDiff(
        hosts,
        groups,
        read.hosts,
        inv.repoPath,
        inv.hostVarsRelative,
        inv.groupVarsRelative
      );
      return { success: true, diff, parsed: read.hosts.length };
    });

    ipcMain.handle(
      IPC.inventory.apply,
      (
        _e,
        opts: { createMissingGroups: boolean; deleteRemovedHosts: boolean }
      ) => {
        const inv = settingsStore.get().inventorySync;
        const sources = effectiveInventorySources(inv);
        const read = readMergedInventories(inv.repoPath, sources);
        if (!read.ok) return { success: false, error: read.error };
        const result = applyInventorySync(
          hostStore,
          read.hosts,
          inv.repoPath,
          inv.hostVarsRelative,
          inv.groupVarsRelative,
          {
            createMissingGroups: opts.createMissingGroups,
            deleteRemovedHosts: opts.deleteRemovedHosts,
          }
        );
        return { success: true, ...result };
      }
    );

    ipcMain.handle(
      IPC.ansible.runPlaybook,
      async (
        _e,
        req: {
          cwd: string;
          playbookPath: string;
          inventoryPath: string;
          limit?: string;
          check: boolean;
          extraArgs?: string[];
        }
      ) => {
        try {
          const r = await runAnsiblePlaybook({
            cwd: req.cwd,
            playbookPath: req.playbookPath,
            inventoryPath: req.inventoryPath,
            limit: req.limit,
            check: req.check,
            extraArgs: req.extraArgs,
          });
          return { success: true, ...r };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }
    );

    ipcMain.handle(IPC.ansible.runRaw, async (_e, cwd: string, argv: string[]) => {
      try {
        const r = await runAnsibleRaw(cwd, argv);
        return { success: true, ...r };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.ansible.tree, (_e, root: string) => {
      try {
        const tree = listTree(root, '', 5);
        return { success: true, tree };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.ansible.search, (_e, root: string, query: string) => {
      try {
        const hits = searchInRepo(root, query);
        return { success: true, hits };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(IPC.health.probe, async (_e, targets: { host: string; port: number }[]) => {
      return probeMany(targets, 5000);
    });

    // ─────────────────────────────────────────────
    //  Ansible Inventory Import
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.ansible.import, async () => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        properties: ['openFile'],
        filters: [
          { name: 'Ansible Inventory', extensions: ['ini', 'yml', 'yaml', 'cfg', 'hosts', '*'] },
        ],
        title: 'Choose Ansible inventory file',
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: 'Cancelled' };
      }

      try {
        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        const parsed = parseAnsibleInventory(content);

        if (parsed.length === 0) {
          return { success: false, error: 'No hosts found in inventory file' };
        }

        // Create groups for each unique Ansible group
        const uniqueGroups = [...new Set(parsed.map((h) => h.group))].filter(
          (g) => g !== 'ungrouped' && g !== 'all'
        );

        const groupColors = [
          '#4f98a3', '#6daa45', '#bb653b', '#a86fdf',
          '#5591c7', '#d163a7', '#e8af34', '#dd6974',
        ];

        const groupIdMap: Record<string, string> = {};
        const existingGroups = hostStore.listGroups();

        for (let i = 0; i < uniqueGroups.length; i++) {
          const gName = uniqueGroups[i];
          const existing = existingGroups.find((g) => g.name === gName);
          if (existing) {
            groupIdMap[gName] = existing.id;
          } else {
            const newGroup = hostStore.saveGroup({
              name: gName,
              color: groupColors[i % groupColors.length],
            });
            groupIdMap[gName] = newGroup.id;
          }
        }

        // Create hosts
        let importedCount = 0;
        const existingHosts = hostStore.list();

        for (const ph of parsed) {
          // Skip if host with same hostname already exists
          const duplicate = existingHosts.find(
            (h) => h.hostname === ph.hostname && h.port === ph.port
          );
          if (duplicate) continue;

          hostStore.save({
            name: ph.name,
            hostname: ph.hostname,
            port: ph.port,
            groupId: groupIdMap[ph.group] || null,
            tags: ph.user ? [`user:${ph.user}`] : [],
            jumpHostId: null,
            tunnelPresets: [],
          });
          importedCount++;
        }

        return {
          success: true,
          total: parsed.length,
          imported: importedCount,
          skipped: parsed.length - importedCount,
          groups: uniqueGroups.length,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ─────────────────────────────────────────────
    //  Export Profiles (hosts + groups, no secrets)
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.profiles.export, async () => {
      const result = await dialog.showSaveDialog(getMainWindow()!, {
        defaultPath: 'anssh-profiles.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        title: 'Export profiles',
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
      }

      try {
        const hosts = hostStore.list();
        const groups = hostStore.listGroups();
        const creds = cryptoStore.listCredentials(); // without secrets

        const exportData = {
          version: 1,
          exportDate: new Date().toISOString(),
          app: 'AnSSH',
          groups,
          hosts: hosts.map((h) => ({
            ...h,
            // Include credential name for reference, but not the credential ID (not portable)
            credentialName: h.credentialId
              ? creds.find((c) => c.id === h.credentialId)?.name || null
              : null,
            credentialId: undefined, // strip from export
          })),
        };

        fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
        return { success: true, path: result.filePath, hostsCount: hosts.length, groupsCount: groups.length };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ─────────────────────────────────────────────
    //  Import Profiles
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.profiles.import, async () => {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        properties: ['openFile'],
        filters: [{ name: 'AnSSH Profiles', extensions: ['json'] }],
        title: 'Import profiles',
      });
      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: 'Cancelled' };
      }

      try {
        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        const data = JSON.parse(content);

        if (!data.app || (data.app !== 'AnSSH' && data.app !== 'NexTerm') || !data.version) {
          return { success: false, error: 'Invalid file format. Expected an AnSSH or NexTerm export.' };
        }

        // Import groups
        const groupIdMap: Record<string, string> = {};
        const existingGroups = hostStore.listGroups();
        let groupsCreated = 0;

        if (data.groups && Array.isArray(data.groups)) {
          for (const g of data.groups) {
            const existing = existingGroups.find((eg) => eg.name === g.name);
            if (existing) {
              groupIdMap[g.id] = existing.id;
            } else {
              groupsCreated++;
              const newGroup = hostStore.saveGroup({
                name: g.name,
                color: g.color || '#4f98a3',
                parentId: null,
              });
              groupIdMap[g.id] = newGroup.id;
            }
          }
        }

        // Import hosts
        let importedHosts = 0;
        let skippedHosts = 0;
        const existingHosts = hostStore.list();

        const hostIdMap: Record<string, string> = {};

        if (data.hosts && Array.isArray(data.hosts)) {
          for (const h of data.hosts) {
            const duplicate = existingHosts.find(
              (eh) => eh.hostname === h.hostname && eh.port === h.port
            );
            if (duplicate) {
              skippedHosts++;
              continue;
            }

            const saved = hostStore.save({
              name: h.name,
              hostname: h.hostname,
              port: h.port || 22,
              groupId: h.groupId ? (groupIdMap[h.groupId] || null) : null,
              tags: h.tags || [],
              tunnelPresets: Array.isArray(h.tunnelPresets) ? h.tunnelPresets : [],
              jumpHostId: null,
            });
            if (h.id) hostIdMap[h.id] = saved.id;
            importedHosts++;
          }

          for (const h of data.hosts) {
            if (!h.jumpHostId || !h.id) continue;
            const newHostId = hostIdMap[h.id];
            const newJumpId = hostIdMap[h.jumpHostId];
            if (!newHostId || !newJumpId) continue;
            const cur = hostStore.list().find((x) => x.id === newHostId);
            if (cur) {
              hostStore.save({ ...cur, jumpHostId: newJumpId });
            }
          }
        }

        return {
          success: true,
          importedHosts,
          skippedHosts,
          importedGroups: groupsCreated,
          groupsMapped: Object.keys(groupIdMap).length,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ─────────────────────────────────────────────
    //  Logs
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.logs.getRecent, (_e, maxLines?: number) => {
      return getLogger().getRecentLogs(maxLines || 200);
    });

    ipcMain.handle(IPC.logs.openDir, () => {
      shell.openPath(getLogger().getLogDir());
      return true;
    });

    ipcMain.handle(IPC.logs.report, (_e, level: string, message: string, context?: any) => {
      const log = getLogger();
      switch (level) {
        case 'warn': log.warn(`[renderer] ${message}`, context); break;
        case 'error': log.error(`[renderer] ${message}`, context); break;
        default: log.info(`[renderer] ${message}`, context); break;
      }
      return true;
    });

    // ─────────────────────────────────────────────
    //  Snippets
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.snippets.list, (_e, filter?: any) => snippetStore.list(filter));
    ipcMain.handle(IPC.snippets.listForHost, (_e, hostId: string, groupId: string | null) =>
      snippetStore.listForHost(hostId, groupId)
    );
    ipcMain.handle(IPC.snippets.save, (_e, snippet: any) => snippetStore.save(snippet));
    ipcMain.handle(IPC.snippets.delete, (_e, id: string) => snippetStore.delete(id));

    // ─────────────────────────────────────────────
    //  Broadcast (write to multiple sessions)
    // ─────────────────────────────────────────────
    ipcMain.on(IPC.broadcast.write, (_e, sessionIds: string[], data: string) => {
      for (const id of sessionIds) {
        sshManager.write(id, data);
      }
    });

    // ─────────────────────────────────────────────
    //  SSH Tunnels
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.tunnels.open, async (_e, config: any) => {
      // Register client if not already
      const client = sshManager.getClient(config.sessionId);
      if (client) tunnelManager.registerClient(config.sessionId, client);
      return tunnelManager.openTunnel(config);
    });

    ipcMain.handle(IPC.tunnels.close, (_e, tunnelId: string) => {
      return tunnelManager.closeTunnel(tunnelId);
    });

    ipcMain.handle(IPC.tunnels.list, () => {
      return tunnelManager.listTunnels();
    });

    // ─────────────────────────────────────────────
    //  SFTP cross-host transfer
    // ─────────────────────────────────────────────
    ipcMain.handle(IPC.sftp.transfer, async (_e, fromSessionId: string, fromPath: string, toSessionId: string, toPath: string) => {
      try {
        // Download to temp, then upload
        const tmpFile = path.join(os.tmpdir(), `anssh-transfer-${Date.now()}-${path.basename(fromPath)}`);
        await sshManager.sftpDownload(fromSessionId, fromPath, tmpFile);
        await sshManager.sftpUpload(toSessionId, tmpFile, toPath);
        // Cleanup temp
        try { fs.unlinkSync(tmpFile); } catch {}
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });
}
