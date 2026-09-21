import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWindowControlsIpc } from './window-controls';

const electron = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

type TestWindow = {
  close: () => void;
  minimize: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  webContents: object;
};

const createWindow = (): TestWindow => {
  let close: () => void = () => undefined;
  const window = {
    minimize: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      if (event === 'closed') close = listener;
    }),
    webContents: {},
  };

  return Object.assign(window, { close: () => close() });
};

describe('registerWindowControlsIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('minimizes only the window that sent the IPC event', () => {
    const window = createWindow();
    registerWindowControlsIpc(window as never);
    const listener = electron.on.mock.calls[0]?.[1] as
      ((event: { sender: unknown }) => void) | undefined;
    if (!listener) throw new Error('Minimize listener was not registered');

    listener({ sender: {} });
    expect(window.minimize).not.toHaveBeenCalled();

    listener({ sender: window.webContents });
    expect(window.minimize).toHaveBeenCalledOnce();
  });

  it('removes the listener when the window closes', () => {
    const window = createWindow();
    registerWindowControlsIpc(window as never);
    const listener = electron.on.mock.calls[0]?.[1];

    window.close();

    expect(electron.removeListener).toHaveBeenCalledWith(
      'window-controls:minimize',
      listener,
    );
  });
});
