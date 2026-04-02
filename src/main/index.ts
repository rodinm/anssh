import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { SshManager } from './ssh-manager';
import { CryptoStore } from './crypto-store';
import { HostStore } from './host-store';
import { SnippetStore } from './snippet-store';
import { TunnelManager } from './tunnel-manager';
import { initLogger, getLogger } from './logger';
import { initAutoUpdater } from './updater';
import { SettingsStore } from './settings-store';
import { gitFetchPull } from './git-inventory';
import { registerAllIpc } from './ipc/register-handlers';

let mainWindow: BrowserWindow | null = null;
let cryptoStore: CryptoStore;
let hostStore: HostStore;
let snippetStore: SnippetStore;
let tunnelManager: TunnelManager;
let sshManager: SshManager;
let settingsStore: SettingsStore;
let inventorySyncTimer: ReturnType<typeof setInterval> | null = null;

function windowIconPath(): string | undefined {
  try {
    const p = path.join(__dirname, '..', '..', 'build', 'icon.png');
    if (fs.existsSync(p)) return p;
  } catch {
    /* */
  }
  return undefined;
}

function createWindow() {
  const icon = windowIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AnSSH',
    backgroundColor: '#171614',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Default renderer sandbox breaks `require('./ipc-channels')` in preload when packaged (asar);
      // preload then throws and `window.anssh` is never exposed.
      sandbox: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch {
    /* logged after logger init if needed */
  }

  // Initialize logger
  const log = initLogger(userDataPath);
  log.info('AnSSH starting', { version: app.getVersion(), platform: process.platform, arch: process.arch });

  initAutoUpdater();

  // Catch uncaught exceptions
  process.on('uncaughtException', (err) => {
    log.fatal('Uncaught exception', { error: err });
  });
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });

  cryptoStore = new CryptoStore(userDataPath);
  hostStore = new HostStore(userDataPath);
  snippetStore = new SnippetStore(userDataPath);
  tunnelManager = new TunnelManager();
  sshManager = new SshManager();
  settingsStore = new SettingsStore(userDataPath);

  registerAllIpc({
    getMainWindow: () => mainWindow,
    cryptoStore,
    hostStore,
    snippetStore,
    tunnelManager,
    sshManager,
    settingsStore,
    scheduleInventoryPullTimer,
  });
  scheduleInventoryPullTimer();
  createWindow();
});

app.on('window-all-closed', () => {
  getLogger().info('All windows closed, shutting down');
  tunnelManager.closeAll();
  sshManager.disconnectAll();
  getLogger().close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

function scheduleInventoryPullTimer() {
  if (inventorySyncTimer) {
    clearInterval(inventorySyncTimer);
    inventorySyncTimer = null;
  }
  const s = settingsStore.get().inventorySync;
  if (!s.enabled || !s.repoPath || s.intervalMinutes <= 0) return;
  inventorySyncTimer = setInterval(() => {
    const inv = settingsStore.get().inventorySync;
    if (!inv.repoPath) return;
    gitFetchPull(inv.repoPath, inv.branch).then((r) => {
      if (r.ok) {
        settingsStore.update({
          inventorySync: {
            ...inv,
            lastSyncedAt: new Date().toISOString(),
            lastGitHead: r.head,
          },
        });
        getLogger().info('Inventory git pull (scheduled)', { head: r.head });
      }
    }).catch(() => { /* */ });
  }, s.intervalMinutes * 60 * 1000);
}

