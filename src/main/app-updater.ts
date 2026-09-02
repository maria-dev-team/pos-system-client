import { type BrowserWindow, app, ipcMain } from 'electron';
import {
  type ProgressInfo,
  type UpdateInfo,
  autoUpdater,
} from 'electron-updater';

export type AppUpdateState = Readonly<{
  status:
    | 'checking'
    | 'downloading'
    | 'restarting'
    | 'current'
    | 'unchecked'
    | 'outdated';
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number | null;
  attempt: number;
  restartAt: number | null;
}>;

const GET_STATE_CHANNEL = 'app-updater:get-state';
const STATE_CHANGED_CHANNEL = 'app-updater:state-changed';
const RETRY_DELAY_MS = 2_000;
const RESTART_DELAY_MS = 5_000;
const MAX_ATTEMPTS = 3;

const registeredWindows = new WeakSet<BrowserWindow>();

const initialState = (): AppUpdateState => ({
  status: 'checking',
  currentVersion: app.getVersion(),
  availableVersion: null,
  downloadPercent: null,
  attempt: 0,
  restartAt: null,
});

export const registerAppUpdater = (mainWindow: BrowserWindow): void => {
  if (registeredWindows.has(mainWindow)) return;

  let active = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveRetry: (() => void) | undefined;
  let updaterListenersRegistered = false;
  let state = initialState();

  const getState = (): AppUpdateState => ({ ...state });
  const publish = (): void => {
    mainWindow.webContents.send(STATE_CHANGED_CHANNEL, getState());
  };
  const setState = (next: Partial<AppUpdateState>): void => {
    state = { ...state, ...next };
    publish();
  };
  const waitToRetry = (): Promise<void> =>
    new Promise((resolve) => {
      resolveRetry = resolve;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        resolveRetry = undefined;
        resolve();
      }, RETRY_DELAY_MS);
    });
  const onUpdateAvailable = (updateInfo: UpdateInfo): void => {
    if (active) setState({ availableVersion: updateInfo.version });
  };
  const onDownloadProgress = (progress: ProgressInfo): void => {
    const percent = Number.isFinite(progress.percent)
      ? Math.min(100, Math.max(0, Math.round(progress.percent)))
      : 0;
    if (active) setState({ status: 'downloading', downloadPercent: percent });
  };
  const onError = (): void => undefined;
  registeredWindows.add(mainWindow);
  ipcMain.handle(GET_STATE_CHANNEL, async (event) => {
    if (event.sender !== mainWindow.webContents) {
      throw new Error('Unauthorized app updater request');
    }
    return getState();
  });

  const cleanup = (): void => {
    active = false;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    resolveRetry?.();
    resolveRetry = undefined;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = undefined;
    if (updaterListenersRegistered) {
      autoUpdater.removeListener('update-available', onUpdateAvailable);
      autoUpdater.removeListener('download-progress', onDownloadProgress);
      autoUpdater.removeListener('error', onError);
    }
    ipcMain.removeHandler(GET_STATE_CHANNEL);
    registeredWindows.delete(mainWindow);
  };

  mainWindow.on('closed', cleanup);

  if (!app.isPackaged) {
    setState({ status: 'current' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('download-progress', onDownloadProgress);
  autoUpdater.on('error', onError);
  updaterListenersRegistered = true;

  const checkForUpdate = async (): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && active; attempt += 1) {
      setState({
        status: 'checking',
        downloadPercent: null,
        attempt,
        restartAt: null,
      });
      try {
        const result = await autoUpdater.checkForUpdates();
        if (!active) return;
        if (!result?.downloadPromise) {
          setState({
            status: 'current',
            availableVersion: null,
            downloadPercent: null,
          });
          return;
        }
        setState({ status: 'downloading' });
        await result.downloadPromise;
        if (!active) return;
        const restartAt = Date.now() + RESTART_DELAY_MS;
        setState({ status: 'restarting', restartAt });
        restartTimer = setTimeout(() => {
          if (active) autoUpdater.quitAndInstall(true, true);
        }, RESTART_DELAY_MS);
        return;
      } catch {
        if (!active) return;
        if (attempt === MAX_ATTEMPTS) {
          setState({
            status: state.availableVersion ? 'outdated' : 'unchecked',
            downloadPercent: null,
            restartAt: null,
          });
          return;
        }
        await waitToRetry();
      }
    }
  };

  void checkForUpdate();
};
