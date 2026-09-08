import axios, {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const defaultAdapter = axios.defaults.adapter;
const payload = {
  externalEventId: 'sale-cancel:sale-1',
  occurredAt: '2026-09-08T10:00:00Z',
  reason: 'Customer cancelled',
  registerId: 'register-1',
  saleId: 'sale-1',
  type: 'cancel' as const,
};
const response = (
  config: InternalAxiosRequestConfig,
  status = 201,
): AxiosResponse => ({
  config,
  status,
  statusText: String(status),
  headers: {},
  data: { data: { event: null, skipped_reason: 'camera_not_configured' } },
});
const load = async (
  adapter: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>,
) => {
  vi.resetModules();
  axios.defaults.adapter = adapter;
  const api = await import('./anti-fraud');
  const { configureAccessTokenProvider } =
    await import('../../access-token.provider');
  const provider = {
    getAccessToken: vi.fn((): string | null => 'cashier-token'),
    clearAccessToken: vi.fn(),
    setAccessToken: vi.fn(),
  };
  configureAccessTokenProvider(provider);
  return { ...api, provider };
};
afterEach(() => {
  axios.defaults.adapter = defaultAdapter;
});

describe('isolated optional capture transport', () => {
  it('accepts missing camera as a normal response and uses a short bounded request', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
      response(config),
    );
    const { triggerAntiFraudEvent } = await load(adapter);
    await expect(triggerAntiFraudEvent(payload)).resolves.toBeUndefined();
    const config = adapter.mock.calls[0]?.[0];
    if (!config) throw new Error('Expected a capture request');
    expect(config.timeout).toBe(5_000);
    expect(config.withCredentials).toBe(false);
    expect(config.headers.get('Authorization')).toBe('Bearer cashier-token');
    expect(JSON.parse(config.data)).toMatchObject({
      external_event_id: payload.externalEventId,
      register_id: 'register-1',
    });
    expect(adapter).toHaveBeenCalledOnce();
  });

  it.each([401, 403, 409, 422, 429, 503])(
    'does not refresh, clear auth or retry after HTTP %s',
    async (status) => {
      const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        throw new AxiosError(
          'Capture unavailable',
          undefined,
          config,
          undefined,
          response(config, status),
        );
      });
      const { triggerAntiFraudEvent, provider } = await load(adapter);
      await expect(triggerAntiFraudEvent(payload)).rejects.toMatchObject({
        response: { status },
      });
      expect(adapter).toHaveBeenCalledOnce();
      expect(provider.clearAccessToken).not.toHaveBeenCalled();
      expect(provider.setAccessToken).not.toHaveBeenCalled();
    },
  );

  it('never sends without a cashier token', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
      response(config),
    );
    const { triggerAntiFraudEvent, provider } = await load(adapter);
    provider.getAccessToken.mockReturnValue(null);
    await triggerAntiFraudEvent(payload);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('deduplicates in-flight events and bounds concurrent work without accumulating a queue', async () => {
    const finish: (() => void)[] = [];
    const adapter = vi.fn(
      (config: InternalAxiosRequestConfig) =>
        new Promise<AxiosResponse>((resolve) => {
          finish.push(() => resolve(response(config)));
        }),
    );
    const { triggerAntiFraudEvent } = await load(adapter);
    const first = triggerAntiFraudEvent(payload);
    await triggerAntiFraudEvent(payload);
    const rest = Array.from({ length: 3 }, (_, index) =>
      triggerAntiFraudEvent({
        ...payload,
        externalEventId: `event-${index}`,
      }),
    );
    await triggerAntiFraudEvent({
      ...payload,
      externalEventId: 'over-capacity',
    });
    expect(adapter).toHaveBeenCalledTimes(4);
    finish.forEach((resolve) => resolve());
    await Promise.all([first, ...rest]);
    expect(adapter).toHaveBeenCalledTimes(4);
    const next = triggerAntiFraudEvent({
      ...payload,
      externalEventId: 'next-operation',
    });
    expect(adapter).toHaveBeenCalledTimes(5);
    finish.at(-1)?.();
    await next;
  });

  it('releases the in-flight slot after a transport timeout', async () => {
    const adapter = vi
      .fn(async (config: InternalAxiosRequestConfig) => response(config))
      .mockRejectedValueOnce(new AxiosError('Timed out', 'ECONNABORTED'));
    const { triggerAntiFraudEvent } = await load(adapter);
    await expect(triggerAntiFraudEvent(payload)).rejects.toMatchObject({
      code: 'ECONNABORTED',
    });
    await expect(triggerAntiFraudEvent(payload)).resolves.toBeUndefined();
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});
