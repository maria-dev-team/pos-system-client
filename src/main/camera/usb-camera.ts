import { spawn } from 'child_process';
import { promises as fs } from 'fs';

import type { DiscoveredCamera } from './camera-discovery';

const usbDevice = (name: string, deviceId: string): DiscoveredCamera => ({
  type: 'usb',
  name: name.slice(0, 255),
  device_id: deviceId,
  host: 'localhost',
  status: 'ready',
});

/** Prefer DirectShow's alternative name: identical camera models have distinct IDs. */
export const parseUsbDevices = (
  output: string,
  platform: NodeJS.Platform,
): DiscoveredCamera[] => {
  const devices: DiscoveredCamera[] = [];
  let pendingName: string | null = null;
  let videoSection = false;
  for (const line of output.split(/\r?\n/)) {
    if (platform === 'win32') {
      if (/DirectShow video devices/.test(line)) videoSection = true;
      if (/DirectShow audio devices/.test(line)) videoSection = false;
      const name = line.match(/\]\s+"([^"]+)"(?:\s+\((video|audio)\))?\s*$/);
      if (name)
        pendingName =
          name[2] === 'video' || (!name[2] && videoSection) ? name[1] : null;
      const alternate = line.match(/Alternative name "([^"]+)"/);
      if (alternate && pendingName) {
        devices.push(usbDevice(pendingName, `dshow:${alternate[1]}`));
        pendingName = null;
      }
    } else if (platform === 'darwin') {
      if (/AVFoundation video devices/.test(line)) videoSection = true;
      if (/AVFoundation audio devices/.test(line)) videoSection = false;
      const name = line.match(/\]\s+\[\d+\]\s+(.+?)\s*$/);
      // Persist a name rather than an enumeration index, which changes on reconnect.
      if (videoSection && name && !/Capture screen|:|[\r\n\0]/i.test(name[1])) {
        devices.push(usbDevice(name[1], `avfoundation:${name[1]}`));
      }
    }
  }
  // An ambiguous macOS name must not silently select a different camera.
  return devices
    .filter(
      (device, index, all) =>
        all.findIndex((other) => other.device_id === device.device_id) ===
          index &&
        (platform !== 'darwin' ||
          all.filter((other) => other.device_id === device.device_id).length ===
            1),
    )
    .slice(0, 32);
};

export const usbInputArgs = (
  deviceId: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): string[] => {
  if (!deviceId || /[\r\n\0]/.test(deviceId))
    throw new Error('Invalid USB device');
  if (platform === 'win32' && /^dshow:@device_[^\r\n\0":]+$/.test(deviceId)) {
    return [
      '-f',
      'dshow',
      '-rtbufsize',
      '64M',
      '-i',
      `video=${deviceId.slice(6)}`,
    ];
  }
  if (platform === 'darwin' && deviceId.startsWith('avfoundation:')) {
    const name = deviceId.slice(13);
    if (!name || /:|^\d+$|^(default|none)$/i.test(name))
      throw new Error('Invalid USB device');
    return ['-f', 'avfoundation', '-framerate', '30', '-i', `${name}:none`];
  }
  if (
    platform === 'linux' &&
    /^v4l2:\/dev\/v4l\/by-id\/[A-Za-z0-9_.:+-]+-video-index0$/.test(deviceId)
  ) {
    return ['-f', 'v4l2', '-i', deviceId.slice(5)];
  }
  throw new Error('USB device is not supported on this platform');
};

export const discoverUsbCameras = async (
  ffmpegPath: string,
  signal: AbortSignal,
  platform: NodeJS.Platform = process.platform,
): Promise<DiscoveredCamera[]> => {
  if (signal.aborted) throw new Error('Discovery cancelled');
  if (platform === 'linux') {
    const names = await fs
      .readdir('/dev/v4l/by-id')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    return names
      .filter((name) => /^[A-Za-z0-9_.:+-]+-video-index0$/.test(name))
      .slice(0, 32)
      .map((name) => usbDevice(name, `v4l2:/dev/v4l/by-id/${name}`));
  }
  if (platform !== 'win32' && platform !== 'darwin')
    throw new Error('Unsupported platform');
  return new Promise((resolve, reject) => {
    const args =
      platform === 'win32'
        ? [
            '-hide_banner',
            '-list_devices',
            'true',
            '-f',
            'dshow',
            '-i',
            'dummy',
          ]
        : [
            '-hide_banner',
            '-f',
            'avfoundation',
            '-list_devices',
            'true',
            '-i',
            '',
          ];
    const child = spawn(ffmpegPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(parseUsbDevices(output, platform));
    };
    const abort = (): void => finish(new Error('Discovery cancelled'));
    const timer = setTimeout(
      () => finish(new Error('Device enumeration timed out')),
      15_000,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 256_000)
        finish(new Error('Device enumeration exceeded limit'));
    });
    child.once('error', () =>
      finish(new Error('Unable to enumerate USB cameras')),
    );
    // FFmpeg normally exits non-zero when listing input devices without an output.
    child.once('close', () => {
      const validList =
        /DirectShow (?:video|audio) devices|\((?:video|audio)\)|AVFoundation video devices|Could not enumerate video devices/i.test(
          output,
        );
      finish(
        validList ? undefined : new Error('USB device enumeration failed'),
      );
    });
  });
};

/** Use the platform encoder so the bundled LGPL build needs no GPL x264. */
export const usbEncodingArgs = (
  platform: NodeJS.Platform = process.platform,
): string[] => [
  '-vf',
  "scale=w='trunc(min(1280,iw)/2)*2':h=-2,format=yuv420p",
  '-r',
  '15',
  ...(platform === 'win32'
    ? ['-c:v', 'h264_mf', '-hw_encoding', '0']
    : platform === 'darwin'
      ? ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-realtime', '1']
      : ['-c:v', 'libx264', '-preset', 'ultrafast']),
  '-b:v',
  '1500k',
  '-maxrate',
  '2M',
  '-bufsize',
  '4M',
  '-g',
  '75',
  '-bf',
  '0',
  '-force_key_frames',
  'expr:gte(t,n_forced*5)',
];
