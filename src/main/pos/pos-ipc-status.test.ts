// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { type PosReply, type PosRequest } from '../../shared/pos/contracts';
import { ids } from '../../shared/pos/test-fixtures';
import { registerPosIpc } from './pos-ipc';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  mkdir: vi.fn(),
  close: (() => undefined) as () => void,
  worker: null as unknown as EventEmitter & {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  },
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/unused-test-user-data' },
  ipcMain: { handle: mocks.handle, removeHandler: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test-protected',
    decryptString: () => Buffer.alloc(32, 1).toString('base64'),
  },
}));
vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  readFile: vi.fn(async () => Buffer.from('encrypted-test-key')),
  stat: vi.fn(),
  open: vi.fn(),
}));
vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(function () {
    return mocks.worker;
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
  mocks.handle.mockClear();
  mocks.mkdir.mockReset().mockResolvedValue(undefined);
  mocks.worker = Object.assign(new EventEmitter(), {
    postMessage: vi.fn(),
    terminate: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function setup(): (request: PosRequest) => Promise<PosReply> {
  const frame = { url: 'maria://app/' };
  const contents = { mainFrame: frame, send: vi.fn() };
  registerPosIpc(
    {
      webContents: contents,
      once: (_event: string, callback: () => void) => {
        mocks.close = callback;
      },
      isDestroyed: () => false,
    } as never,
    'https://unused.invalid',
  );
  const handler = mocks.handle.mock.calls[0][1] as (
    event: unknown,
    request: PosRequest,
  ) => Promise<PosReply>;
  return (request) =>
    handler({ sender: contents, senderFrame: frame }, request);
}
function respond(value: unknown): void {
  const id = mocks.worker.postMessage.mock.lastCall![0].id;
  mocks.worker.emit('message', { id, reply: { ok: true, value } });
}

it('expires stuck status requests, releases capacity and ignores their late replies', async () => {
  const request = setup();
  const pending = Array.from({ length: 512 }, () =>
    request({ type: 'status' }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.worker.postMessage).toHaveBeenCalledTimes(512);
  const firstId = mocks.worker.postMessage.mock.calls[0][0].id;
  await vi.advanceTimersByTimeAsync(5000);
  expect(
    (await Promise.all(pending)).every(
      (r) => !r.ok && r.code === 'LOCAL_POS_STATUS_TIMEOUT',
    ),
  ).toBe(true);
  const next = request({ type: 'status' });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.worker.postMessage).toHaveBeenCalledTimes(513);
  mocks.worker.emit('message', {
    id: firstId,
    reply: { ok: true, value: { pending: 999 } },
  });
  respond({ pending: 0 });
  await expect(next).resolves.toEqual({ ok: true, value: { pending: 0 } });
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds requests before worker startup completes', async () => {
  let start!: () => void;
  mocks.mkdir.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        start = resolve;
      }),
  );
  const request = setup();
  const pending = Array.from({ length: 512 }, () =>
    request({ type: 'current' }),
  );
  await expect(request({ type: 'current' })).resolves.toMatchObject({
    ok: false,
    code: 'LOCAL_STORAGE_ERROR',
  });
  expect(mocks.worker.postMessage).not.toHaveBeenCalled();
  mocks.close();
  expect((await Promise.all(pending)).every((reply) => !reply.ok)).toBe(true);
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.worker.postMessage).not.toHaveBeenCalled();
});

it('fails pending requests on close even when startup is still waiting for storage', async () => {
  let start!: () => void;
  mocks.mkdir.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        start = resolve;
      }),
  );
  const request = setup();
  const pending = request({ type: 'current' });
  mocks.close();
  await expect(pending).resolves.toMatchObject({ ok: false });
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.worker.listenerCount('message')).toBe(0);
});

it('terminates an initialized worker exactly once when its window closes', async () => {
  const request = setup();
  const pending = request({ type: 'current' });
  await vi.advanceTimersByTimeAsync(0);
  mocks.close();
  await expect(pending).resolves.toMatchObject({ ok: false });
  expect(mocks.worker.terminate).toHaveBeenCalledTimes(1);
});

it('also bounds worker initialization without dispatching an expired probe after startup', async () => {
  let start!: () => void;
  mocks.mkdir.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        start = resolve;
      }),
  );
  const request = setup();
  const status = request({ type: 'status' });
  await vi.advanceTimersByTimeAsync(5000);
  await expect(status).resolves.toMatchObject({
    ok: false,
    code: 'LOCAL_POS_STATUS_TIMEOUT',
  });
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.worker.postMessage).not.toHaveBeenCalled();
  const next = request({ type: 'status' });
  await vi.advanceTimersByTimeAsync(0);
  respond({ pending: 0 });
  await expect(next).resolves.toMatchObject({ ok: true });
});

it('does not apply the status deadline to checkout or resend a financial command', async () => {
  const request = setup();
  const resolved = vi.fn();
  const checkout = request({
    type: 'checkout',
    saleId: ids.session,
    total: '1.00',
    payments: [{ method: 'CASH', amount: '1.00' }],
  });
  void checkout.then(resolved);
  await vi.advanceTimersByTimeAsync(10000);
  expect(resolved).not.toHaveBeenCalled();
  expect(mocks.worker.postMessage).toHaveBeenCalledTimes(1);
  respond(null);
  await expect(checkout).resolves.toEqual({ ok: true, value: null });
});

it('finishes probes immediately when the worker fails and clears their timers', async () => {
  const request = setup();
  const status = request({ type: 'status' });
  await vi.advanceTimersByTimeAsync(0);
  mocks.worker.emit('error', new Error('worker stopped'));
  await expect(status).resolves.toMatchObject({
    ok: false,
    code: 'LOCAL_STORAGE_ERROR',
  });
  expect(vi.getTimerCount()).toBe(0);
});
