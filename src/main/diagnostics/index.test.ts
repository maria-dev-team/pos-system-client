// @vitest-environment node
import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/unused', getVersion: () => 'test' },
  ipcMain: native,
}));
vi.mock('./journal', () => ({
  ErrorJournal: class {
    owner: string | null = null;
    page?: string;
    report = vi.fn();
    retry = vi.fn();
    pending = vi.fn().mockReturnValue([]);
    acknowledge = vi.fn();
  },
}));
vi.mock('../pos/pos-ipc', () => ({
  isPosSenderTrusted: (window: BrowserWindow, event: { sender: unknown }) =>
    window.webContents === event.sender,
}));
const windowFixture = (): BrowserWindow =>
  Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
  }) as unknown as BrowserWindow;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
it('registers handlers before announcing readiness and rejects unknown windows', async () => {
  const { registerDiagnostics } = await import('./index');
  const window = windowFixture();
  registerDiagnostics(window);
  const connect = native.on.mock.calls.find(
    ([channel]) => channel === 'diagnostics:connect',
  )![1];
  const reply = vi.fn(() => expect(native.handle).toHaveBeenCalledTimes(5));
  connect({ sender: window.webContents, reply }, 7);
  expect(reply).toHaveBeenCalledWith('diagnostics:ready', 7);
  reply.mockClear();
  connect({ sender: {}, reply }, 8);
  expect(reply).not.toHaveBeenCalled();
  const context = native.handle.mock.calls.find(
    ([channel]) => channel === 'diagnostics:context',
  )![1];
  expect(() => context({ sender: {} }, { owner: 'user' })).toThrow('Untrusted');
});
it('keeps process handlers when an old window closes after a replacement', async () => {
  const { registerDiagnostics } = await import('./index');
  const first = windowFixture();
  const second = windowFixture();
  registerDiagnostics(first);
  registerDiagnostics(first);
  registerDiagnostics(second);
  first.emit('closed');
  expect(native.handle).toHaveBeenCalledTimes(5);
  expect(native.removeHandler).not.toHaveBeenCalled();
  const pending = native.handle.mock.calls.find(
    ([channel]) => channel === 'diagnostics:pending',
  )![1];
  expect(pending({ sender: second.webContents }, 'user')).toEqual([]);
  expect(() => pending({ sender: first.webContents }, 'user')).toThrow(
    'Untrusted',
  );
  second.emit('closed');
  const third = windowFixture();
  registerDiagnostics(third);
  expect(native.handle).toHaveBeenCalledTimes(5);
  expect(pending({ sender: third.webContents }, 'user')).toEqual([]);
});
