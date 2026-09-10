// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  PosApiError,
  PosConnectionError,
  requestPosApi,
} from './pos-api-client';

describe('local POS HTTP client', () => {
  const request = (fetcher: typeof fetch): Promise<unknown> =>
    requestPosApi(
      fetcher,
      'https://api.test',
      'private-token',
      '/v1/auth/context',
      undefined,
      15000,
    );
  it('keeps HTTP authentication errors available for token refresh', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error_code: 'INVALID_TOKEN' }), {
          status: 401,
        }),
    );
    await expect(request(fetcher)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 401,
    });
  });
  it('does not describe a backend failure as missing internet', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error_code: 'INTERNAL_SERVER_ERROR' }), {
          status: 500,
        }),
    );
    await expect(request(fetcher)).rejects.toBeInstanceOf(PosApiError);
    await expect(request(fetcher)).rejects.toMatchObject({
      message: 'Сервер временно недоступен.',
    });
  });
  it('preserves a useful message for a definitive payment rejection', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error_code: 'INSUFFICIENT_STOCK' }), {
          status: 409,
        }),
    );
    await expect(request(fetcher)).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 409,
      message: 'Недостаточно товара на складе.',
    });
  });
  it.each(['<html>Proxy error</html>', '{}', '{"data":null}'])(
    'diagnoses an invalid API response: %s',
    async (body) => {
      await expect(
        request(vi.fn(async () => new Response(body))),
      ).rejects.toMatchObject({ code: 'POS_API_INVALID_RESPONSE' });
    },
  );
  it('distinguishes timeout from connectivity errors without exposing the token', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('Timed out', 'TimeoutError');
    });
    await expect(request(timeout)).rejects.toMatchObject({
      code: 'POS_API_TIMEOUT',
      message: expect.stringContaining('15 секунд'),
    });
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(request(offline)).rejects.toBeInstanceOf(PosConnectionError);
    await expect(request(offline)).rejects.toMatchObject({
      message: expect.not.stringContaining('private-token'),
    });
  });
  it('returns the data envelope without modifying the payload', async () => {
    await expect(
      request(
        vi.fn(
          async () => new Response('{"data":{"context":{"permissions":[]}}}'),
        ),
      ),
    ).resolves.toEqual({ context: { permissions: [] } });
  });
});
