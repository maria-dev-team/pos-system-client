import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DefaultPrinterNotFoundError, sendRawReceipt } from './raw-printer';

const dependencies = vi.hoisted(() => ({
  getPath: vi.fn().mockReturnValue('/tmp'),
  randomUUID: vi.fn().mockReturnValue('job'),
  spawn: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  app: { getPath: dependencies.getPath },
  default: { app: { getPath: dependencies.getPath } },
}));
vi.mock('node:child_process', () => ({
  default: { spawn: dependencies.spawn },
  spawn: dependencies.spawn,
}));
vi.mock('node:crypto', () => ({
  default: { randomUUID: dependencies.randomUUID },
  randomUUID: dependencies.randomUUID,
}));
vi.mock('node:fs/promises', () => ({
  default: {
    unlink: dependencies.unlink,
    writeFile: dependencies.writeFile,
  },
  unlink: dependencies.unlink,
  writeFile: dependencies.writeFile,
}));

const spawn = dependencies.spawn;
const unlink = dependencies.unlink;
const writeFile = dependencies.writeFile;

const nextChild = (exitCode: number | null) => {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stderr: PassThrough;
    stdin: PassThrough;
    stdinChunks: Buffer[];
  };
  child.kill = vi.fn();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.stdinChunks = [];
  child.stdin.on('data', (chunk: Buffer) =>
    child.stdinChunks.push(Buffer.from(chunk)),
  );
  if (exitCode !== null) {
    child.stdin.on('finish', () =>
      queueMicrotask(() => child.emit('close', exitCode)),
    );
  }
  return child;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('sendRawReceipt', () => {
  it('pipes an explicit macOS queue through lp raw without a shell', async () => {
    const child = nextChild(0);
    spawn.mockReturnValue(child);

    await sendRawReceipt('XP-58IIH', Buffer.from([1, 2, 3]), 'darwin');

    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/lp',
      ['-d', 'XP-58IIH', '-o', 'raw', '-'],
      expect.objectContaining({ shell: false, windowsHide: true }),
    );
    expect(Buffer.concat(child.stdinChunks)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('lets CUPS choose the default queue when deviceName is null', async () => {
    spawn.mockReturnValue(nextChild(0));

    await sendRawReceipt(null, Buffer.from([1]), 'darwin');

    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/lp',
      ['-o', 'raw', '-'],
      expect.any(Object),
    );
  });

  it('spools Windows RAW bytes through a system PowerShell path and cleans up', async () => {
    spawn.mockReturnValue(nextChild(0));

    await sendRawReceipt('XP-58IIH"; exit 1', Buffer.from([1, 2]), 'win32');

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/maria-receipt-job.bin',
      Buffer.from([1, 2]),
      { flag: 'wx' },
    );
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        expect.any(String),
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          MARIA_RECEIPT_PATH: '/tmp/maria-receipt-job.bin',
          MARIA_RECEIPT_PRINTER: 'XP-58IIH"; exit 1',
        }),
        shell: false,
      }),
    );
    expect(unlink).toHaveBeenCalledWith('/tmp/maria-receipt-job.bin');
  });

  it('rejects unsupported platforms without spawning', async () => {
    await expect(
      sendRawReceipt(null, Buffer.from([1]), 'linux'),
    ).rejects.toThrow('Печать ESC/POS не поддерживается этой системой.');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('identifies a missing Windows default printer', async () => {
    spawn.mockReturnValue(nextChild(2));

    await expect(
      sendRawReceipt(null, Buffer.from([1]), 'win32'),
    ).rejects.toThrow(DefaultPrinterNotFoundError);
  });

  it('cleans up when the Windows queue rejects the job', async () => {
    spawn.mockReturnValue(nextChild(1));

    await expect(
      sendRawReceipt('XP-58IIH', Buffer.from([1]), 'win32'),
    ).rejects.toThrow('Системная очередь печати отклонила чек.');
    expect(unlink).toHaveBeenCalledWith('/tmp/maria-receipt-job.bin');
  });

  it('cleans up when spawning the Windows queue fails', async () => {
    const child = nextChild(null);
    spawn.mockReturnValue(child);
    const result = sendRawReceipt('XP-58IIH', Buffer.from([1]), 'win32');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    const expected = expect(result).rejects.toThrow(
      'Системная очередь печати отклонила чек.',
    );
    child.emit('error');

    await expected;
    expect(unlink).toHaveBeenCalledWith('/tmp/maria-receipt-job.bin');
  });

  it('kills and cleans up when the Windows queue times out', async () => {
    vi.useFakeTimers();
    const child = nextChild(null);
    spawn.mockReturnValue(child);
    const result = sendRawReceipt('XP-58IIH', Buffer.from([1]), 'win32');
    const expected = expect(result).rejects.toThrow(
      'Системная очередь печати не ответила вовремя.',
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expected;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(unlink).toHaveBeenCalledWith('/tmp/maria-receipt-job.bin');
  });
});
