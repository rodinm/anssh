import { app } from 'electron';
import { getLogger } from './logger';

/**
 * Checks for updates when the app is packaged (installed build).
 * Set NEXTERM_DISABLE_UPDATES=1 to skip (CI, debugging).
 * Publishing is configured in package.json → build.publish (e.g. GitHub Releases).
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return;
  if (process.env.NEXTERM_DISABLE_UPDATES === '1') return;

  void import('electron-updater')
    .then(({ autoUpdater }) => {
      const log = getLogger();
      autoUpdater.on('error', (err) => {
        log.warn('Auto-updater error', { message: err.message });
      });
      autoUpdater.on('update-available', (info) => {
        log.info('Update available', { version: info.version });
      });
      autoUpdater.on('update-downloaded', (info) => {
        log.info('Update downloaded', { version: info.version });
      });
      return autoUpdater.checkForUpdatesAndNotify();
    })
    .catch((err) => {
      getLogger().warn('electron-updater unavailable', { error: String(err) });
    });
}
