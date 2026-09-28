// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CameraApiClient } from './camera-api.client';
import { discoverCameras } from './camera-discovery';
import { CameraDiscoveryWorker } from './camera-discovery-worker';

vi.mock('./camera-discovery', () => ({
  discoverCameras: vi.fn().mockResolvedValue([]),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const context = { accessToken: 'token', registerId: 'register' };

describe('CameraDiscoveryWorker', () => {
  it('polls even before a camera is configured and stops on logout', async () => {
    vi.useFakeTimers();
    const api = {
      claimDiscovery: vi.fn().mockResolvedValue(null),
      completeDiscovery: vi.fn(),
    };
    const worker = new CameraDiscoveryWorker(api as unknown as CameraApiClient);
    worker.setContext(context);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.claimDiscovery).toHaveBeenCalledTimes(2);
    worker.setContext(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.claimDiscovery).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send stale results after a store/session change', async () => {
    vi.useFakeTimers();
    let resolveClaim!: (value: unknown) => void;
    const api = {
      claimDiscovery: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveClaim = resolve;
            }),
        )
        .mockResolvedValue(null),
      completeDiscovery: vi.fn(),
    };
    const worker = new CameraDiscoveryWorker(api as unknown as CameraApiClient);
    worker.setContext(context);
    worker.setContext({ ...context, accessToken: 'other-store' });
    resolveClaim({
      id: 'job',
      username: 'admin',
      password: 'secret',
      claim_token: 'claim',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(discoverCameras).not.toHaveBeenCalled();
    expect(api.completeDiscovery).not.toHaveBeenCalled();
    worker.stop();
  });

  it('reports only sanitized results and claim token', async () => {
    vi.useFakeTimers();
    const job = {
      id: 'job',
      username: 'admin',
      password: 'secret',
      claim_token: 'claim',
    };
    const api = {
      claimDiscovery: vi.fn().mockResolvedValue(job),
      completeDiscovery: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new CameraDiscoveryWorker(api as unknown as CameraApiClient);
    worker.setContext(context);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.completeDiscovery).toHaveBeenCalledWith(
      'token',
      job,
      { cameras: [] },
      expect.any(AbortSignal),
    );
    worker.stop();
  });
});
