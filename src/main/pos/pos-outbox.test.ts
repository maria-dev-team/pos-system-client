// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import {
  PosApiError,
  PosConnectionError,
  requestPosApi,
} from './pos-api-client';
import { syncFailure } from './pos-outbox';

afterEach(() => vi.restoreAllMocks());
it.each([408, 425, 429, 500, 502, 503])(
  'automatically retries temporary HTTP %s with bounded exponential backoff',
  (status) => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const error = new PosApiError('ERROR', status);
    const first = syncFailure(error);
    expect(first).toMatchObject({
      temporary: true,
      attempts: 1,
      nextAttemptAt: 6000,
    });
    expect(syncFailure(error, first).nextAttemptAt).toBe(11000);
    expect(syncFailure(error, { ...first, attempts: 100 }).nextAttemptAt).toBe(
      301000,
    );
  },
);
it.each([400, 401, 403, 404, 409, 422])(
  'keeps definitive HTTP %s for explicit review, not automatic replay',
  (status) => {
    expect(syncFailure(new PosApiError('REJECTED', status))).toMatchObject({
      temporary: false,
      nextAttemptAt: null,
    });
  },
);
it('retries lost responses and honors Retry-After even for a non-JSON proxy error', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response('Busy', { status: 429, headers: { 'Retry-After': '120' } }),
    );
  const error = await requestPosApi(
    fetcher,
    'https://api.test',
    'token',
    '/v1/sales/local-draft',
    {},
    5000,
  ).catch((e: unknown) => e);
  expect(error).toMatchObject({ status: 429, retryAfterMs: 120000 });
  expect(syncFailure(error).nextAttemptAt! - Date.now()).toBeGreaterThanOrEqual(
    119999,
  );
  expect(
    syncFailure(new PosConnectionError('TIMEOUT', 'timeout')).temporary,
  ).toBe(true);
});
