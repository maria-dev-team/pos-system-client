import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAccessTokenProvider } from '../api/access-token.provider';
import { reportPosError, startErrorReporting } from './error-reporting';

const token = (user: string) =>
  `header.${btoa(JSON.stringify({ sub: user, organizationId: 'organization', storeId: 'store' }))}.signature`;
describe('POS error delivery', () => {
  let stop: () => void;
  let current: string | null;
  let page: string;
  const event = {
    id: '62e4c54a-0cef-47db-8e68-1311129d41d3',
    timestamp: '2020-01-01T00:00:00.000Z',
    code: 'LOCAL_STORAGE_ERROR',
    source: 'local',
    operation: 'status',
    manual_retry: false,
  };
  const bridge = {
    ready: vi.fn(),
    report: vi.fn(),
    context: vi.fn(),
    pending: vi.fn(),
    acknowledge: vi.fn(),
    retry: vi.fn(),
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    current = token('a');
    page = '/checkout';
    for (const method of Object.values(bridge))
      method.mockResolvedValue(undefined);
    bridge.ready.mockResolvedValue(true);
    bridge.pending.mockResolvedValue([event]);
    window.diagnostics = bridge;
    configureAccessTokenProvider({
      getAccessToken: () => current,
      setAccessToken: (value) => {
        current = value;
      },
      clearAccessToken: () => {
        current = null;
      },
    });
  });
  afterEach(() => {
    stop?.();
    delete window.diagnostics;
    vi.useRealTimers();
  });
  it('waits for native readiness and resumes delivery when handlers appear', async () => {
    bridge.ready.mockResolvedValue(false);
    const send = vi.fn().mockResolvedValue({ accepted_ids: [event.id] });
    stop = startErrorReporting(send, () => page);
    await vi.advanceTimersByTimeAsync(20000);
    expect(bridge.context).not.toHaveBeenCalled();
    expect(bridge.pending).not.toHaveBeenCalled();
    bridge.ready.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).toHaveBeenCalledWith([event]);
  });
  it('retries context registration after a failed acknowledgement', async () => {
    bridge.context.mockRejectedValueOnce(new Error('initialization failed'));
    stop = startErrorReporting(
      vi.fn().mockResolvedValue({ accepted_ids: [event.id] }),
      () => page,
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(bridge.context.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(bridge.pending).toHaveBeenCalled();
  });
  it('retains an offline error and acknowledges only explicit committed IDs', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ accepted_ids: [event.id] });
    stop = startErrorReporting(send, () => page);
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.acknowledge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(send).toHaveBeenNthCalledWith(2, [event]);
    expect(bridge.acknowledge).toHaveBeenCalledWith(expect.any(String), [
      event.id,
    ]);
    expect(bridge.report).not.toHaveBeenCalled();
  });
  it('does not acknowledge a batch when the cashier changed during delivery', async () => {
    let resolve!: (value: { accepted_ids: string[] }) => void;
    stop = startErrorReporting(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
      () => page,
    );
    await vi.advanceTimersByTimeAsync(0);
    current = token('b');
    resolve({ accepted_ids: [event.id] });
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.acknowledge).not.toHaveBeenCalled();
  });
  it('captures one exception reported by several layers and marks only explicit retry clicks', async () => {
    bridge.pending.mockResolvedValue([]);
    stop = startErrorReporting(vi.fn(), () => page);
    const error = Object.assign(new Error('secret'), { code: 'ENOSPC' });
    reportPosError(error, 'renderer', 'mutation');
    reportPosError(error, 'renderer', 'action');
    expect(bridge.report).toHaveBeenCalledTimes(1);
    expect(bridge.report.mock.calls[0]?.[0]).toMatchObject({
      page: '/checkout',
      code: 'ENOSPC',
    });
    const button = document.createElement('button');
    document.body.append(button);
    button.click();
    expect(bridge.retry).not.toHaveBeenCalled();
    button.dataset.errorRetry = 'true';
    button.click();
    expect(bridge.retry).toHaveBeenCalledWith({ page: '/checkout' });
    button.remove();
  });
});

it('does not poll a preload from before the readiness protocol', async () => {
  const legacy = { context: vi.fn(), pending: vi.fn() };
  window.diagnostics = legacy as unknown as NonNullable<Window['diagnostics']>;
  const stop = startErrorReporting(vi.fn());
  expect(legacy.context).not.toHaveBeenCalled();
  expect(legacy.pending).not.toHaveBeenCalled();
  stop();
  delete window.diagnostics;
});
