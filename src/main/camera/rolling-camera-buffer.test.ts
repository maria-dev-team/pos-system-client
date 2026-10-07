// @vitest-environment node
import { type ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RollingCameraBuffer } from './rolling-camera-buffer';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    rm: vi.fn(),
    copyFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
  },
}));
const processes: ChildProcess[] = [];
const status = vi.fn();
let buffer: RollingCameraBuffer;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  processes.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  vi.mocked(fs.readdir).mockResolvedValue([]);
  vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  vi.mocked(fs.unlink).mockResolvedValue(undefined);
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcess;
    processes.push(child);
    return child;
  });
  buffer = new RollingCameraBuffer({
    camera: {
      id: 'camera',
      host: '192.168.0.214',
      rtsp_port: 554,
      username: 'admin',
      password: 'secret',
      stream_path: '/Streaming/Channels/101',
    },
    ffmpegPath: 'ffmpeg',
    rootDirectory: '/buffer',
    onStatus: status,
  });
});
afterEach(async () => {
  await buffer.stop();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fail = (message: string): void => {
  processes.at(-1)!.stderr!.emit('data', Buffer.from(message));
  processes.at(-1)!.emit('close', 1, null);
};

describe('RollingCameraBuffer failures', () => {
  it('kills a stuck clip encoder at its deadline and allows the next clip', async () => {
    const clip = buffer as unknown as {
      runClipFfmpeg: (input: string, output: string) => Promise<void>;
    };
    const pending = clip.runClipFfmpeg('/list', '/clip');
    const failed = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(processes[0].kill).toHaveBeenCalledWith('SIGKILL');
    const next = clip.runClipFfmpeg('/list2', '/clip2');
    processes[1].emit('close', 0);
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports only an error code without writing or printing diagnostics', async () => {
    await buffer.start();
    fail(
      'method DESCRIBE failed: 401 Unauthorized\nError opening rtsp://admin:secret@192.168.0.214:554/live\n',
    );
    expect(status).toHaveBeenCalledWith('error', 'camera_auth_failed');
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(spawn).mock.calls[1][1]).toContain('tcp');
  });

  it('retries using UDP only when the camera explicitly rejects TCP', async () => {
    await buffer.start();
    fail('method SETUP failed: 461 Unsupported transport\n');
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(spawn).mock.calls[1][1]).toContain('udp');
    fail('Connection timed out\n');
    await vi.advanceTimersByTimeAsync(2000);
    expect(vi.mocked(spawn).mock.calls[2][1]).toContain('udp');
  });

  it('does not replace a process start error or schedule two restarts', async () => {
    await buffer.start();
    processes[0].emit('error', new Error('spawn ffmpeg ENOENT'));
    processes[0].emit('close', -2, null);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith('error', 'ffmpeg_start_failed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('does not mark an empty segment as online', async () => {
    await buffer.start();
    vi.mocked(fs.readdir).mockResolvedValue(['segment.ts'] as never);
    vi.mocked(fs.stat).mockResolvedValue({
      mtimeMs: Date.now(),
      size: 0,
    } as never);
    await vi.advanceTimersByTimeAsync(2000);
    expect(status).not.toHaveBeenCalledWith('online');
  });

  it('ignores a segment inspection completed after FFmpeg has exited', async () => {
    await buffer.start();
    vi.mocked(fs.readdir).mockResolvedValue(['segment.ts'] as never);
    let finishStat!: (stat: unknown) => void;
    vi.mocked(fs.stat).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStat = resolve;
        }) as never,
    );
    await vi.advanceTimersByTimeAsync(2000);
    fail('Connection refused\n');
    finishStat({ mtimeMs: Date.now(), size: 100 });
    await vi.advanceTimersByTimeAsync(0);
    expect(status).not.toHaveBeenCalledWith('online');
    expect(status).toHaveBeenLastCalledWith('error', 'camera_unreachable');
  });

  it('does not report normal shutdown as a camera error', async () => {
    await buffer.start();
    await buffer.stop();
    processes[0].emit('close', 0, null);
    expect(status).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});

it('records USB into the same segment buffer and retries after disconnect', async () => {
  const device =
    process.platform === 'win32'
      ? 'dshow:@device_pnp_123'
      : process.platform === 'darwin'
        ? 'avfoundation:USB Camera'
        : 'v4l2:/dev/v4l/by-id/usb-Test-video-index0';
  buffer = new RollingCameraBuffer({
    camera: {
      id: 'usb',
      type: 'usb',
      device_id: device,
      host: '',
      rtsp_port: 554,
      username: '',
      password: '',
      stream_path: '',
    },
    ffmpegPath: 'ffmpeg',
    rootDirectory: '/buffer',
    onStatus: status,
  });
  await buffer.start();
  const args = vi.mocked(spawn).mock.calls[0][1] as string[];
  expect(args).not.toContain('-rtsp_transport');
  expect(args).not.toContain('copy');
  expect(args).toContain('mpegts');
  expect(args).toContain('expr:gte(t,n_forced*5)');
  fail('Could not find video device with name USB Camera\n');
  expect(status).toHaveBeenLastCalledWith('error', 'camera_device_unavailable');
  await vi.advanceTimersByTimeAsync(1000);
  expect(spawn).toHaveBeenCalledTimes(2);
  vi.mocked(fs.readdir).mockResolvedValue(['segment.ts'] as never);
  vi.mocked(fs.stat).mockResolvedValue({
    mtimeMs: Date.now(),
    size: 100,
  } as never);
  await vi.advanceTimersByTimeAsync(2000);
  expect(status).toHaveBeenLastCalledWith('online');
});

it('includes buffered footage before the USB event and waits for the post-event window', async () => {
  const now = Date.now();
  buffer = new RollingCameraBuffer({
    camera: {
      id: 'usb',
      type: 'usb',
      device_id: 'dshow:@device_pnp_123',
      host: '',
      rtsp_port: 554,
      username: '',
      password: '',
      stream_path: '',
    },
    ffmpegPath: 'ffmpeg',
    rootDirectory: '/buffer',
    onStatus: status,
  });
  vi.mocked(fs.readdir)
    .mockResolvedValueOnce(['too-old.ts', 'before.ts', 'current.ts'] as never)
    .mockResolvedValueOnce(['current.ts', 'after.ts'] as never);
  vi.mocked(fs.stat).mockImplementation(
    async (path) =>
      ({
        mtimeMs:
          now +
          (String(path).endsWith('too-old.ts')
            ? -30_000
            : String(path).endsWith('before.ts')
              ? -10_000
              : String(path).endsWith('after.ts')
                ? 15_000
                : 0),
        size: 100,
      }) as never,
  );
  const clip = buffer.createEventClip(
    {
      job: {
        id: 'event',
        camera_id: 'usb',
        occurred_at: new Date(now).toISOString(),
        pre_buffer_seconds: 15,
        post_buffer_seconds: 15,
        attempt: 1,
      },
      serverTime: new Date(now).toISOString(),
      receivedAt: now,
    },
    '/clips',
  );
  await vi.advanceTimersByTimeAsync(20_000);
  expect(spawn).not.toHaveBeenCalled();
  expect(fs.copyFile).toHaveBeenCalledWith(
    expect.stringContaining('before.ts'),
    expect.stringContaining('pre-000.ts'),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  const list = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
  expect(list).toContain('pre-000.ts');
  expect(list).toContain('after.ts');
  expect(list).not.toContain('too-old.ts');
  processes[0].emit('close', 0);
  await expect(clip).resolves.toMatch(/event[\\/]event\.mp4$/);
});
