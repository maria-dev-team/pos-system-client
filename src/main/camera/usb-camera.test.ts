// @vitest-environment node
import { type ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverUsbCameras,
  parseUsbDevices,
  usbEncodingArgs,
  usbInputArgs,
} from './usb-camera';

vi.mock('child_process', () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const listing = `[dshow @ 0x123] "USB Camera" (video)
[dshow @ 0x123]   Alternative name "@device_pnp_123"
[dshow @ 0x123] "USB Camera" (video)
[dshow @ 0x123]   Alternative name "@device_pnp_456"
[dshow @ 0x123] "Microphone" (audio)
[dshow @ 0x123]   Alternative name "@device_cm_789"`;

describe('USB cameras', () => {
  it('keeps identical Windows cameras distinct without exposing microphones', () => {
    const cameras = parseUsbDevices(listing, 'win32');
    expect(cameras.map((camera) => camera.device_id)).toEqual([
      'dshow:@device_pnp_123',
      'dshow:@device_pnp_456',
    ]);
    expect(
      cameras.every(
        (camera) => camera.type === 'usb' && camera.status === 'ready',
      ),
    ).toBe(true);
  });
  it('uses names on macOS, excludes screen/audio and ambiguous names', () => {
    const cameras = parseUsbDevices(
      `[AVFoundation @ 123] AVFoundation video devices:
[AVFoundation @ 123] [0] FaceTime HD Camera
[AVFoundation @ 123] [1] USB Camera
[AVFoundation @ 123] [2] USB Camera
[AVFoundation @ 123] [3] Capture screen 0
[AVFoundation @ 123] AVFoundation audio devices:
[AVFoundation @ 123] [0] Microphone`,
      'darwin',
    );
    expect(cameras.map((camera) => camera.device_id)).toEqual([
      'avfoundation:FaceTime HD Camera',
    ]);
  });
  it('opens the selected device with a fixed local input driver and no RTSP settings', () => {
    expect(usbInputArgs('dshow:@device_pnp_123', 'win32')).toEqual([
      '-f',
      'dshow',
      '-rtbufsize',
      '64M',
      '-i',
      'video=@device_pnp_123',
    ]);
    expect(usbInputArgs('avfoundation:USB Camera', 'darwin')).toContain(
      'USB Camera:none',
    );
    expect(
      usbInputArgs('v4l2:/dev/v4l/by-id/usb-Test-video-index0', 'linux'),
    ).toContain('/dev/v4l/by-id/usb-Test-video-index0');
    for (const value of [
      'rtsp://example.com',
      'dshow:@device_x:audio=Mic',
      'avfoundation:0',
      'v4l2:/etc/passwd',
    ]) {
      expect(() => usbInputArgs(value, 'win32')).toThrow();
    }
    expect(() => usbInputArgs('avfoundation:0', 'darwin')).toThrow();
    expect(() =>
      usbInputArgs('v4l2:/dev/v4l/by-id/../video0', 'linux'),
    ).toThrow();
    expect(usbEncodingArgs('win32')).toContain('h264_mf');
    expect(usbEncodingArgs('win32')).not.toContain('libx264');
  });
  it('accepts FFmpeg nonzero enumeration exit, and cancels a hung search', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      kill: vi.fn(),
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    const controller = new AbortController();
    const result = discoverUsbCameras('ffmpeg', controller.signal, 'win32');
    child.stderr!.emit('data', Buffer.from(listing));
    child.emit('close', 1);
    expect(await result).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    const hung = discoverUsbCameras('ffmpeg', controller.signal, 'win32');
    const rejected = expect(hung).rejects.toThrow('cancelled');
    controller.abort();
    await rejected;
    expect(child.kill).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reports unsupported FFmpeg as failure instead of an empty successful search', async () => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
      kill: vi.fn(),
    }) as unknown as ChildProcess;
    vi.mocked(spawn).mockReturnValue(child);
    const result = discoverUsbCameras(
      'ffmpeg',
      new AbortController().signal,
      'win32',
    );
    child.stderr!.emit('data', Buffer.from("Unknown input format: 'dshow'"));
    child.emit('close', 1);
    await expect(result).rejects.toThrow('enumeration failed');
  });
});
