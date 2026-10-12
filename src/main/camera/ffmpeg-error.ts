import { StringDecoder } from 'string_decoder';

import type { CameraErrorCode } from './camera.types';

const MAX_LINE = 16_384;

export const classifyFfmpegError = (
  message: string,
  isUsb = false,
): CameraErrorCode => {
  message = message.replace(/rtsps?:\/\/[^\s<>]+/gi, '[RTSP URL]');
  if (
    isUsb &&
    /could not find video device|video device not found|could not open video device|could not run graph|could not set video options|device or resource busy|no such file or directory|permission denied|not authorized|access denied|failed to create capture session/i.test(
      message,
    )
  )
    return 'camera_device_unavailable';
  if (
    /\b(?:401|403)\b|unauthorized|forbidden|authentication failed/i.test(
      message,
    )
  )
    return 'camera_auth_failed';
  if (/\b461\b|unsupported transport/i.test(message))
    return 'camera_transport_unsupported';
  if (/\b404\b|stream not found|method DESCRIBE failed: 400/i.test(message))
    return 'camera_stream_not_found';
  if (
    /connection refused|connection timed out|operation timed out|connection timeout|no route to host|network is unreachable|failed to resolve|error number -138/i.test(
      message,
    )
  )
    return 'camera_unreachable';
  if (
    /unknown encoder|unknown input format|unrecognized option|option .+ not found|error splitting the argument list/i.test(
      message,
    )
  )
    return 'ffmpeg_options_unsupported';
  if (
    /first pts and dts value must be set|timestamps are unset|can't write packet with unknown timestamp/i.test(
      message,
    )
  )
    return 'stream_invalid_timestamps';
  if (
    /matches no streams|does not contain any stream|could not find codec parameters/i.test(
      message,
    )
  )
    return 'camera_no_video';
  if (
    /permission denied|no space left on device|read-only file system|failed to open segment/i.test(
      message,
    )
  )
    return 'filesystem_error';
  return 'ffmpeg_exited';
};

/** Read bounded stderr lines only to classify the failure; never retain or expose a log. */
export class FfmpegErrorParser {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';
  private droppingLine = false;
  private errorCode: CameraErrorCode = 'ffmpeg_exited';

  constructor(private readonly isUsb = false) {}

  append(chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.droppingLine) this.pending += part;
      if (this.pending.length > MAX_LINE) {
        this.pending = '';
        this.droppingLine = true;
      }
      if (part.endsWith('\n')) {
        if (!this.droppingLine) this.classify(this.pending);
        this.pending = '';
        this.droppingLine = false;
      }
    }
  }

  finish(): CameraErrorCode {
    this.append(this.decoder.end());
    if (!this.droppingLine && this.pending) this.classify(this.pending);
    this.pending = '';
    return this.errorCode;
  }

  private classify(line: string): void {
    const code = classifyFfmpegError(line, this.isUsb);
    if (code !== 'ffmpeg_exited') this.errorCode = code;
  }
}
