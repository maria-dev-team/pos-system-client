import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAppUpdater } from './app-updater';

const electron = vi.hoisted(() => ({
  app: { getVersion: vi.fn(), isPackaged: false },
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

const updater = vi.hoisted(() => {
  const listeners = new Map<string, Set<(value?: unknown) => void>>();
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(),
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
      autoUpdater.quitAndInstall.mockReset();
      autoUpdater.on.mockClear();
      autoUpdater.removeListener.mockClear();
    },
  };
  return autoUpdater;
});

vi.mock('electron', () => ({
  app: electron.app,
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));
vi.mock('electron-updater', () => ({ autoUpdater: updater }));

type Window = {
  close: () => void;
  webContents: { send: ReturnType<typeof vi.fn> };
};

const stateHandler = (): ((event: { sender: unknown }) => unknown) => {
  const registration = electron.handle.mock.calls.find(
    ([channel]) => channel === 'app-updater:get-state',
  );
  if (!registration) throw new Error('State handler was not registered');
  return registration[1] as (event: { sender: unknown }) => unknown;
};

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
    electron.app.getVersion.mockReturnValue('1.0.0');
    electron.app.isPackaged = true;
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
      attempt: 0,
      restartAt: null,
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    window.close();
    expect(updater.removeListener).not.toHaveBeenCalled();
  });

  it('reports the current version when the first check has no download', async () => {
    updater.checkForUpdates.mockResolvedValue({ downloadPromise: null });
    const window = createWindow();

    registerAppUpdater(window as never);
    await flush();

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'current',
      currentVersion: '1.0.0',
      availableVersion: null,
      downloadPercent: null,
      attempt: 1,
      restartAt: null,
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('downloads an available version on the third attempt', async () => {
    updater.checkForUpdates
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(async () => {
        updater.emit('update-available', { version: '1.1.0' });
        return { downloadPromise: Promise.resolve() };
      });
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
      attempt: 3,
    });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('exposes unchecked after three failed checks', async () => {
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
  });

  it('keeps a confirmed version outdated after three failed downloads', async () => {
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '1.1.0' });
      return { downloadPromise: Promise.reject(new Error('download failed')) };
    });
    const window = createWindow();

    registerAppUpdater(window as never);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'outdated',
      availableVersion: '1.1.0',
      attempt: 3,
    });
  });

  it('broadcasts bounded download progress then restarts after a successful download', async () => {
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '1.1.0' });
      updater.emit('download-progress', { percent: 100.4 });
      return { downloadPromise: Promise.resolve() };
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
      }),
    );
    await expect(
      stateHandler()({ sender: window.webContents }),
    ).resolves.toMatchObject({
      status: 'restarting',
      availableVersion: '1.1.0',
      downloadPercent: 100,
      restartAt: Date.now() + 5_000,
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('rejects state reads from another WebContents', async () => {
    updater.checkForUpdates.mockResolvedValue({ downloadPromise: null });
    const window = createWindow();

    registerAppUpdater(window as never);

    await expect(stateHandler()({ sender: {} })).rejects.toThrow(
      'Unauthorized app updater request',
    );
  });

  it('keeps the error listener through a late error from a closed window', async () => {
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

  it('keeps the error listener until a download returned after close rejects', async () => {
    let resolveCheck!: (value: unknown) => void;
    let rejectDownload!: (reason?: unknown) => void;
    const downloadPromise = new Promise<never>((_, reject) => {
      rejectDownload = reject;
    });
    void downloadPromise.catch(() => undefined);
    updater.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const window = createWindow();

    registerAppUpdater(window as never);
    window.close();
    resolveCheck({ downloadPromise });
    await flush();

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

  it('exposes outdated when quitAndInstall emits an error', async () => {
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '1.1.0' });
      return { downloadPromise: Promise.resolve() };
    });
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
  });
});
