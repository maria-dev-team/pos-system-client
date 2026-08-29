import { describe, expect, it, vi } from 'vitest';

import type { CameraApiClient } from './camera-api.client';
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
