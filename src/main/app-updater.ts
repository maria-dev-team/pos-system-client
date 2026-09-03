import { type BrowserWindow, app, ipcMain } from 'electron';
import {
  type ProgressInfo,
  type UpdateInfo,
  autoUpdater,
} from 'electron-updater';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type AppUpdateState = Readonly<{
  status:
    | 'checking'
    | 'downloading'
    | 'download-failed'
    | 'restarting'
    | 'current'
    | 'unchecked'
    | 'outdated';
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number | null;
  downloadTransferred: number | null;
  downloadTotal: number | null;
  attempt: number;
  restartAt: number | null;
}>;

const GET_STATE_CHANNEL = 'app-updater:get-state';
const RETRY_DOWNLOAD_CHANNEL = 'app-updater:retry-download';
const CONTINUE_CHANNEL = 'app-updater:continue';
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
  downloadTransferred: null,
  downloadTotal: null,
  attempt: 0,
  restartAt: null,
});

const logUpdaterError = async (
  stage: 'check' | 'download' | 'install',
  attempt: number,
  state: AppUpdateState,
  error: unknown,
): Promise<void> => {
  const details =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          code: (error as NodeJS.ErrnoException).code ?? null,
        }
      : { message: String(error), name: 'Error', code: null };

  try {
    const logsDirectory = app.getPath('logs');
    await mkdir(logsDirectory, { recursive: true });
    await appendFile(
      join(logsDirectory, 'updater.log'),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        stage,
        attempt,
        currentVersion: state.currentVersion,
        availableVersion: state.availableVersion,
        error: details,
      })}\n`,
      'utf8',
    );
  } catch (logError) {
    console.error('Failed to write updater log', logError);
  }
};

export const registerAppUpdater = (mainWindow: BrowserWindow): void => {
  if (registeredWindows.has(mainWindow)) return;

  let active = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveRetry: (() => void) | undefined;
  let operationInFlight = false;
  let errorListenerRegistered = false;
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
  const authorize = (sender: Electron.WebContents): void => {
    if (sender !== mainWindow.webContents) {
      throw new Error('Unauthorized app updater request');
    }
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
    if (!active) return;
    setState({
      status: 'downloading',
      downloadPercent: percent,
      downloadTransferred: Number.isFinite(progress.transferred)
        ? Math.max(0, progress.transferred)
        : null,
      downloadTotal: Number.isFinite(progress.total)
        ? Math.max(0, progress.total)
        : null,
    });
  };
  const onError = (error: unknown): void => {
    if (!active || state.status !== 'restarting') return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = undefined;
    void logUpdaterError('install', state.attempt, state, error);
    setState({ status: 'outdated', restartAt: null });
  };
  const removeErrorListener = (): void => {
    if (!errorListenerRegistered) return;
    autoUpdater.removeListener('error', onError);
    errorListenerRegistered = false;
  };
  const finishOperation = (): void => {
    operationInFlight = false;
    if (!active) removeErrorListener();
  };
  const scheduleRestart = (): void => {
    const restartAt = Date.now() + RESTART_DELAY_MS;
    setState({ status: 'restarting', restartAt });
    restartTimer = setTimeout(() => {
      if (!active) return;
      try {
        autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        onError(error);
      }
    }, RESTART_DELAY_MS);
  };
  const downloadUpdate = async (attempt: number): Promise<void> => {
    if (!active) return;
    setState({
      status: 'downloading',
      downloadPercent: 0,
      downloadTransferred: null,
      downloadTotal: null,
      attempt,
      restartAt: null,
    });
    try {
      await autoUpdater.downloadUpdate();
      if (active) scheduleRestart();
    } catch (error) {
      if (!active) return;
      setState({ status: 'download-failed', restartAt: null });
      void logUpdaterError('download', attempt, state, error);
    }
  };

  registeredWindows.add(mainWindow);
  ipcMain.handle(GET_STATE_CHANNEL, async (event) => {
    authorize(event.sender);
    return getState();
  });
  ipcMain.handle(RETRY_DOWNLOAD_CHANNEL, async (event) => {
    authorize(event.sender);
    if (!active || operationInFlight || state.status !== 'download-failed') {
      return;
    }
    operationInFlight = true;
    try {
      await downloadUpdate(state.attempt + 1);
    } finally {
      finishOperation();
    }
  });
  ipcMain.handle(CONTINUE_CHANNEL, async (event) => {
    authorize(event.sender);
    if (active && !operationInFlight && state.status === 'download-failed') {
      setState({ status: 'outdated' });
    }
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
      updaterListenersRegistered = false;
      if (!operationInFlight) removeErrorListener();
    }
    ipcMain.removeHandler(GET_STATE_CHANNEL);
    ipcMain.removeHandler(RETRY_DOWNLOAD_CHANNEL);
    ipcMain.removeHandler(CONTINUE_CHANNEL);
    registeredWindows.delete(mainWindow);
  };

  mainWindow.on('closed', cleanup);

  if (!app.isPackaged) {
    setState({ status: 'current' });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', onUpdateAvailable);
  autoUpdater.on('download-progress', onDownloadProgress);
  autoUpdater.on('error', onError);
  errorListenerRegistered = true;
  updaterListenersRegistered = true;

  const checkForUpdate = async (): Promise<void> => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && active; attempt += 1) {
      setState({
        status: 'checking',
        availableVersion: null,
        downloadPercent: null,
        downloadTransferred: null,
        downloadTotal: null,
        attempt,
        restartAt: null,
      });
      try {
        const result = await autoUpdater.checkForUpdates();
        if (!active) return;
        if (!result?.isUpdateAvailable) {
          setState({ status: 'current' });
          return;
        }
        setState({ availableVersion: result.updateInfo.version });
        await downloadUpdate(1);
        return;
      } catch (error) {
        if (!active) return;
        void logUpdaterError('check', attempt, state, error);
        if (attempt === MAX_ATTEMPTS) {
          setState({ status: 'unchecked' });
          return;
        }
        await waitToRetry();
      }
    }
  };

  operationInFlight = true;
  void checkForUpdate().finally(finishOperation);
};
