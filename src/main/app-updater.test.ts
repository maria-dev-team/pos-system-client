import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAppUpdater } from './app-updater';

const UPDATER_LOG_PATH = join('/logs', 'updater.log');

const electron = vi.hoisted(() => ({
  app: { getPath: vi.fn(), getVersion: vi.fn(), isPackaged: false },
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

const files = vi.hoisted(() => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

const updater = vi.hoisted(() => {
  const listeners = new Map<string, Set<(value?: unknown) => void>>();
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    emit: (event: string, value?: unknown) => {
      const eventListeners = listeners.get(event);
      if (event === 'error' && !eventListeners?.size) throw value;
      eventListeners?.forEach((listener) => listener(value));
    },
    on: vi.fn((event: string, listener: (value?: unknown) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return autoUpdater;
    }),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(
      (event: string, listener: (value?: unknown) => void) => {
        listeners.get(event)?.delete(listener);
        return autoUpdater;
      },
    ),
    reset: () => {
      listeners.clear();
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.checkForUpdates.mockReset();
      autoUpdater.downloadUpdate.mockReset();
      autoUpdater.quitAndInstall.mockReset();
      autoUpdater.on.mockClear();
      autoUpdater.removeListener.mockClear();
    },
  };
  return autoUpdater;
});

vi.mock('node:fs/promises', () => ({ default: files, ...files }));
vi.mock('electron', () => ({
  app: electron.app,
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));

type Window = {
  close: () => void;
  webContents: { send: ReturnType<typeof vi.fn> };
};

type UpdateResult = {
  isUpdateAvailable: boolean;
  updateInfo: { version: string };
  versionInfo: { version: string };
};

const updateResult = (
  isUpdateAvailable: boolean,
  version = '1.1.0',
): UpdateResult => ({
  isUpdateAvailable,
  updateInfo: { version },
  versionInfo: { version },
});

const ipcHandler = (
  channel: string,
): ((event: { sender: unknown }) => unknown) => {
  const registration = electron.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  );
  if (!registration) throw new Error(`${channel} handler was not registered`);
  return registration[1] as (event: { sender: unknown }) => unknown;
};

const stateHandler = (): ReturnType<typeof ipcHandler> =>
  ipcHandler('app-updater:get-state');

const createWindow = (): Window => {
  let close: () => void = () => undefined;
  const window = {
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'closed') close = listener;
    }),
    webContents: { send: vi.fn() },
  };
  return Object.assign(window, { close: () => close() }) as Window;
};

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

describe('registerAppUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
    vi.clearAllMocks();
    updater.reset();
    electron.app.getPath.mockReturnValue('/logs');
    electron.app.getVersion.mockReturnValue('1.0.0');
    electron.app.isPackaged = true;
    updater.downloadUpdate.mockResolvedValue(['/update.exe']);
  });

  it('bypasses the updater for unpackaged builds', async () => {
    electron.app.isPackaged = false;
    const window = createWindow();

    registerAppUpdater(window as never);

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toEqual({
      status: 'current',
      currentVersion: '1.0.0',
      availableVersion: null,
      downloadPercent: null,
      downloadTransferred: null,
      downloadTotal: null,
      attempt: 0,
      restartAt: null,
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    window.close();
    expect(updater.removeListener).not.toHaveBeenCalled();
  });

  it('reports the current version when the first check finds no update', async () => {
    updater.checkForUpdates.mockResolvedValue(updateResult(false, '1.0.0'));
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'current',
      currentVersion: '1.0.0',
      availableVersion: null,
      attempt: 1,
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('retries only metadata checks and downloads once after the third succeeds', async () => {
    updater.checkForUpdates
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(updateResult(true));
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'restarting',
      availableVersion: '1.1.0',
      attempt: 1,
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it('exposes unchecked and logs the failure after three failed checks', async () => {
    updater.checkForUpdates.mockRejectedValue(new Error('offline'));
    const window = createWindow();

    registerAppUpdater(window as never);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'unchecked',
      attempt: 3,
      availableVersion: null,
    });
    expect(files.appendFile).toHaveBeenCalledWith(
      UPDATER_LOG_PATH,
      expect.stringContaining('"stage":"check"'),
      'utf8',
    );
    expect(files.appendFile).toHaveBeenCalledWith(
      UPDATER_LOG_PATH,
      expect.stringContaining('"attempt":3'),
      'utf8',
    );
  });

  it('does not automatically retry a failed installer download', async () => {
    updater.checkForUpdates.mockResolvedValue(updateResult(true));
    updater.downloadUpdate.mockRejectedValue(new Error('socket closed'));
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'download-failed',
      availableVersion: '1.1.0',
      attempt: 1,
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(files.appendFile).toHaveBeenCalledWith(
      UPDATER_LOG_PATH,
      expect.stringContaining('socket closed'),
      'utf8',
    );
  });

  it('retries a failed download only after an authorized renderer request', async () => {
    updater.checkForUpdates.mockResolvedValue(updateResult(true));
    updater.downloadUpdate
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(['/update.exe']);
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();
    await ipcHandler('app-updater:retry-download')({
      sender: window.webContents,
    });
    await flush();

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'restarting',
      availableVersion: '1.1.0',
      attempt: 2,
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it('continues with an outdated version after an authorized renderer request', async () => {
    updater.checkForUpdates.mockResolvedValue(updateResult(true));
    updater.downloadUpdate.mockRejectedValue(new Error('socket closed'));
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();
    await ipcHandler('app-updater:continue')({ sender: window.webContents });

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'outdated',
      availableVersion: '1.1.0',
    });
  });

  it('broadcasts bytes and bounded progress then restarts after a successful download', async () => {
    updater.checkForUpdates.mockResolvedValue(updateResult(true));
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('download-progress', {
        percent: 100.4,
        total: 162 * 1024 * 1024,
        transferred: 32 * 1024 * 1024,
      });
      return ['/update.exe'];
    });
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();

    expect(window.webContents.send).toHaveBeenCalledWith(
      'app-updater:state-changed',
      expect.objectContaining({
        status: 'downloading',
        availableVersion: '1.1.0',
        downloadPercent: 100,
        downloadTransferred: 32 * 1024 * 1024,
        downloadTotal: 162 * 1024 * 1024,
      }),
    );
    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'restarting',
      restartAt: Date.now() + 5_000,
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it.each([
    'app-updater:get-state',
    'app-updater:retry-download',
    'app-updater:continue',
  ])('rejects %s requests from another WebContents', async (channel) => {
    updater.checkForUpdates.mockResolvedValue(updateResult(false, '1.0.0'));
    const window = createWindow();

    registerAppUpdater(window as never);

    await expect(ipcHandler(channel)({ sender: {} })).rejects.toThrow(
      'Unauthorized app updater request',
    );
  });

  it('keeps the error listener through a late check error after close', async () => {
    let rejectCheck!: (reason?: unknown) => void;
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectCheck = reject;
        }),
    );
    const window = createWindow();

    registerAppUpdater(window as never);
    window.close();

    expect(() => updater.emit('error', new Error('late error'))).not.toThrow();
    rejectCheck(new Error('late rejection'));
    await flush();

    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.removeListener).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
  });

  it('keeps the error listener until a late download rejection after close', async () => {
    let rejectDownload!: (reason?: unknown) => void;
    updater.checkForUpdates.mockResolvedValue(updateResult(true));
    updater.downloadUpdate.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectDownload = reject;
        }),
    );
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();
    window.close();

    expect(updater.removeListener).not.toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
    expect(() =>
      updater.emit('error', new Error('late download error')),
    ).not.toThrow();
    rejectDownload(new Error('late download rejection'));
    await flush();

    expect(updater.removeListener).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
  });

  it('exposes outdated and logs when quitAndInstall emits an error', async () => {
    updater.checkForUpdates.mockResolvedValue(updateResult(true));
    updater.quitAndInstall.mockImplementation(() => {
      updater.emit('error', new Error('install failed'));
    });
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'outdated',
      availableVersion: '1.1.0',
      restartAt: null,
    });
    expect(files.appendFile).toHaveBeenCalledWith(
      UPDATER_LOG_PATH,
      expect.stringContaining('"stage":"install"'),
      'utf8',
    );
  });
});
