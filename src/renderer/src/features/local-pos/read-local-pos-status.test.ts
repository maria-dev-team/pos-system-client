import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { PosStatus } from '../../../../shared/pos/contracts';
import { ids } from '../../../../shared/pos/test-fixtures';
import {
  LOCAL_POS_STATUS_TIMEOUT_MS,
  LocalPosStatusReader,
} from './read-local-pos-status';

const status = (): PosStatus => ({
  sessionId: ids.session,
  connected: true,
  pending: 0,
  catalogReady: true,
  catalogUpdatedAt: null,
  conflicts: [],
  paymentPending: false,
  paymentReviews: [],
  error: null,
  tokenRefreshRequired: false,
  authorizationRequired: false,
  fiscalShiftExpired: false,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('times out once, shares the underlying legacy IPC and discards a late response before recovery', async () => {
  let finish!: (value: unknown) => void;
  const request = vi
    .fn<() => Promise<unknown>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ ...status(), pending: 2 });
  const reader = new LocalPosStatusReader(request);
  const a = expect(reader.read(ids.session)).rejects.toMatchObject({
    code: 'LOCAL_POS_STATUS_TIMEOUT',
  });
  const b = expect(reader.read(ids.session)).rejects.toMatchObject({
    code: 'LOCAL_POS_STATUS_TIMEOUT',
  });
  await vi.advanceTimersByTimeAsync(LOCAL_POS_STATUS_TIMEOUT_MS);
  await Promise.all([a, b]);
  for (let i = 0; i < 20; i++)
    await expect(reader.read(ids.session)).rejects.toMatchObject({
      code: 'LOCAL_POS_STATUS_TIMEOUT',
    });
  expect(request).toHaveBeenCalledTimes(1);
  finish(status());
  await vi.advanceTimersByTimeAsync(0);
  await expect(reader.read(ids.session)).resolves.toMatchObject({ pending: 2 });
  expect(request).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  [{ sessionId: undefined }, 'LOCAL_POS_RESTART_REQUIRED'],
  [{ sessionId: null }, 'LOCAL_POS_SESSION_MISSING'],
  [{ sessionId: ids.register }, 'LOCAL_POS_SESSION_MISMATCH'],
  [{ pending: -1 }, 'LOCAL_POS_STATUS_INVALID'],
  [{ catalogSyncing: 'true' }, 'LOCAL_POS_STATUS_INVALID'],
] as const)(
  'rejects a completed but unusable response %o instead of waiting indefinitely',
  async (patch, code) => {
    const reader = new LocalPosStatusReader(async () => ({
      ...status(),
      ...patch,
    }));
    await expect(reader.read(ids.session)).rejects.toMatchObject({ code });
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('validates the session for every caller of a shared read', async () => {
  const request = vi.fn().mockResolvedValue(status());
  const reader = new LocalPosStatusReader(request);
  await Promise.all([
    expect(reader.read(ids.session)).resolves.toMatchObject({
      sessionId: ids.session,
    }),
    expect(reader.read(ids.register)).rejects.toMatchObject({
      code: 'LOCAL_POS_SESSION_MISMATCH',
    }),
  ]);
  expect(request).toHaveBeenCalledTimes(1);
});

it('releases a failed transport for the next read without unhandled timeout errors', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('worker died'))
    .mockResolvedValue(status());
  const reader = new LocalPosStatusReader(request);
  await expect(reader.read(ids.session)).rejects.toThrow('worker died');
  await expect(reader.read(ids.session)).resolves.toMatchObject({ pending: 0 });
  expect(vi.getTimerCount()).toBe(0);
});
