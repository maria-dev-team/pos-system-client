import { describe, expect, it } from 'vitest';

import { FfmpegErrorParser, classifyFfmpegError } from './ffmpeg-error';

describe('FFmpeg errors', () => {
  it.each([
    ['method DESCRIBE failed: 401 Unauthorized', 'camera_auth_failed'],
    [
      'Connection to tcp://192.168.0.214:554 failed: Connection refused',
      'camera_unreachable',
    ],
    ['method DESCRIBE failed: 404 Not Found', 'camera_stream_not_found'],
    [
      'Connection to tcp://192.168.0.214:554?timeout=15000000 failed: Operation timed out',
      'camera_unreachable',
    ],
    ['Error opening input files: Operation timed out', 'camera_unreachable'],
    [
      'method SETUP failed: 461 Unsupported transport',
      'camera_transport_unsupported',
    ],
    ["Unrecognized option 'timeout'.", 'ffmpeg_options_unsupported'],
    ['first pts and dts value must be set', 'stream_invalid_timestamps'],
    ["Stream map '0:v:0' matches no streams.", 'camera_no_video'],
    ['Failed to open segment out.ts', 'filesystem_error'],
    ['Unknown fatal error', 'ffmpeg_exited'],
    [
      'Error opening rtsp://admin:401@192.168.0.214/channel/404',
      'ffmpeg_exited',
    ],
  ])('classifies %s', (message, code) =>
    expect(classifyFfmpegError(message)).toBe(code),
  );

  it('handles split stderr chunks and returns only a public error code', () => {
    const errors = new FfmpegErrorParser();
    errors.append(
      'Error opening rtsp://admin:secret@192.168.0.215/live\nOperation ti',
    );
    errors.append('med out\nError opening input: I/O error');
    expect(errors.finish()).toBe('camera_unreachable');
  });

  it('ignores oversized lines and still classifies the next error', () => {
    const errors = new FfmpegErrorParser();
    errors.append('x'.repeat(20_000));
    errors.append('\n401 Unauthorized\n');
    expect(errors.finish()).toBe('camera_auth_failed');
  });
});
