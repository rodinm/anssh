import type { BrowserWindow } from 'electron';
import type { CryptoStore } from '../crypto-store';
import type { HostStore } from '../host-store';
import type { SnippetStore } from '../snippet-store';
import type { TunnelManager } from '../tunnel-manager';
import type { SshManager } from '../ssh-manager';
import type { SettingsStore } from '../settings-store';

export interface MainIpcContext {
  getMainWindow: () => BrowserWindow | null;
  cryptoStore: CryptoStore;
  hostStore: HostStore;
  snippetStore: SnippetStore;
  tunnelManager: TunnelManager;
  sshManager: SshManager;
  settingsStore: SettingsStore;
  scheduleInventoryPullTimer: () => void;
}
