import { describe, expect, it, vi } from 'vitest';

import { CameraApiClient } from './camera-api.client';
import { CameraManager } from './camera-manager';
import type { CameraConfig } from './camera.types';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/maria-pos-camera-test' },
}));

const camera: CameraConfig = {
  host: '192.0.2.1',
  id: 'camera-1',
  password: 'secret',
  rtsp_port: 554,
  stream_path: '/stream',
  username: 'camera',
};

type CameraManagerInternals = {
  buffer: { stop: () => Promise<void> } | null;
  camera: CameraConfig | null;
  replaceCamera: (camera: CameraConfig | null) => Promise<void>;
};

describe('CameraManager', () => {
  it.each([
    ['300', 300_000],
    ['Wed, 09 Sep 2026 00:05:00 GMT', 300_000],
    ['invalid', 120_000],
    [null, 120_000],
  ])('respects Retry-After: %s', async (retryAfter, delay) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
        }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { camera: null } })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const manager = new CameraManager(
      new CameraApiClient('https://api.example.test'),
    );
    try {
      manager.setContext({ accessToken: 'token', registerId: null });
      await vi.advanceTimersByTimeAsync(delay - 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await manager.shutdown();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('does not overlap refreshes or back off a new context because an old request failed', async () => {
    vi.useFakeTimers();
    let rejectRequest!: (error: Error) => void;
    const getConfig = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<null>((_resolve, reject) => {
            rejectRequest = reject;
          }),
      )
      .mockResolvedValue(null);
    const manager = new CameraManager({
      getConfig,
    } as unknown as CameraApiClient);
    try {
      manager.setContext({ accessToken: 'token', registerId: 'register-1' });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(getConfig).toHaveBeenCalledTimes(1);
      manager.setContext({ accessToken: 'token', registerId: 'register-2' });
      rejectRequest(new Error('Old request failed'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getConfig).toHaveBeenCalledTimes(3);
      expect(getConfig).toHaveBeenLastCalledWith('token', 'register-2');
    } finally {
      await manager.shutdown();
      vi.useRealTimers();
    }
  });

  it('ignores repeated context without postponing scheduled config refreshes', async () => {
    vi.useFakeTimers();
    const getConfig = vi.fn().mockResolvedValue(null);
    const manager = new CameraManager({
      getConfig,
    } as unknown as CameraApiClient);
    const context = { accessToken: 'token', registerId: 'register-1' };
    try {
      manager.setContext(context);
      manager.setContext({ ...context });
      expect(getConfig).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      manager.setContext({ ...context });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getConfig).toHaveBeenCalledTimes(2);

      manager.setContext({ ...context, registerId: 'register-2' });
      expect(getConfig).toHaveBeenLastCalledWith('token', 'register-2');
      expect(getConfig).toHaveBeenCalledTimes(3);
      manager.setContext({
        accessToken: 'new-token',
        registerId: 'register-2',
      });
      expect(getConfig).toHaveBeenLastCalledWith('new-token', 'register-2');

      manager.setContext(null);
      manager.setContext({
        accessToken: 'new-token',
        registerId: 'register-2',
      });
      expect(getConfig).toHaveBeenCalledTimes(5);
      await manager.shutdown();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(getConfig).toHaveBeenCalledTimes(5);
    } finally {
      await manager.shutdown();
      vi.useRealTimers();
    }
  });

  it('backs off failed config requests and restores normal refresh after recovery', async () => {
    vi.useFakeTimers();
    const getConfig = vi
      .fn()
      .mockRejectedValue(new Error('Camera config request failed: 429'));
    const manager = new CameraManager({
      getConfig,
    } as unknown as CameraApiClient);
    try {
      manager.setContext({ accessToken: 'token', registerId: null });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getConfig).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getConfig).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(getConfig).toHaveBeenCalledTimes(2);
      getConfig.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getConfig).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getConfig).toHaveBeenCalledTimes(4);
    } finally {
      await manager.shutdown();
      vi.useRealTimers();
    }
  });

  it('serializes concurrent camera teardown and stops the buffer once', async () => {
    let releaseStop: () => void = () => undefined;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
    );
    const manager = new CameraManager({} as CameraApiClient);
    const internals = manager as unknown as CameraManagerInternals;
    internals.camera = camera;
    internals.buffer = { stop };

    const first = internals.replaceCamera(null);
    const second = internals.replaceCamera(null);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    releaseStop();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(stop).toHaveBeenCalledOnce();
    expect(internals.buffer).toBeNull();
    expect(internals.camera).toBeNull();
  });
});
