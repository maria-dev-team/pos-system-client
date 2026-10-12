import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

import type {
  CameraConfig,
  CameraErrorCode,
  CameraStatus,
  ClaimedCaptureJob,
} from './camera.types';
import { FfmpegErrorParser } from './ffmpeg-error';
import { buildRtspUrl } from './rtsp-url';
import { usbEncodingArgs, usbInputArgs } from './usb-camera';

const SEGMENT_SECONDS = 5;
const BUFFER_SECONDS = 90;
const MONITOR_INTERVAL_MS = 2_000;
const MAX_RESTART_DELAY_MS = 30_000;
const STREAM_STALE_AFTER_MS = SEGMENT_SECONDS * 3 * 1_000;

type RollingCameraBufferOptions = {
  camera: CameraConfig;
  ffmpegPath: string;
  rootDirectory: string;
  onStatus: (status: CameraStatus, errorCode?: CameraErrorCode) => void;
};

export class RollingCameraBuffer {
  private child: ReturnType<typeof spawn> | null = null;
  private monitorTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private restartAttempt = 0;
  private inspecting = false;
  private transport: 'tcp' | 'udp' = 'tcp';
  private runId = 0;
  private startedAt = 0;
  private stopped = true;
  private readonly directory: string;

  constructor(private readonly options: RollingCameraBufferOptions) {
    this.directory = join(options.rootDirectory, options.camera.id);
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await fs.mkdir(this.directory, { recursive: true });
    await this.cleanup();
    this.spawnFfmpeg();
    this.monitorTimer = setInterval(
      () => void this.inspectSegments(),
      MONITOR_INTERVAL_MS,
    );
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.runId += 1;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.monitorTimer = null;
    this.restartTimer = null;

    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.stdin?.write('q');
      } catch {
        child.kill();
      }
      const forceKill = setTimeout(() => {
        if (!child.killed) child.kill();
      }, 3_000);
      child.once('close', () => clearTimeout(forceKill));
    }
    await this.cleanup();
  }

  async createEventClip(
    claimed: ClaimedCaptureJob,
    clipsRoot: string,
  ): Promise<string> {
    const serverTime = Date.parse(claimed.serverTime);
    const occurredAt = Date.parse(claimed.job.occurred_at);
    if (!Number.isFinite(serverTime) || !Number.isFinite(occurredAt)) {
      throw new Error('Invalid capture job timestamps');
    }
    const localOccurredAt = occurredAt + (claimed.receivedAt - serverTime);
    const captureEnd =
      localOccurredAt + claimed.job.post_buffer_seconds * 1_000;
    const rangeStart =
      localOccurredAt -
      claimed.job.pre_buffer_seconds * 1_000 -
      SEGMENT_SECONDS * 1_000;
    const rangeEnd = captureEnd + (SEGMENT_SECONDS + 2) * 1_000;
    const eventDirectory = join(clipsRoot, claimed.job.id);
    await fs.rm(eventDirectory, { recursive: true, force: true });
    await fs.mkdir(eventDirectory, { recursive: true });
    const pinned = await this.pinCompletedSegments(eventDirectory, rangeStart);

    const waitMs = captureEnd + (SEGMENT_SECONDS + 1) * 1_000 - Date.now();
    if (waitMs > 120_000)
      throw new Error('Capture window exceeds the local limit');
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const names = await fs.readdir(this.directory);
    const liveSegments = (
      await Promise.all(
        names
          .filter((name) => name.endsWith('.ts'))
          .map(async (name) => {
            const path = join(this.directory, name);
            const stat = await fs.stat(path);
            return { path, mtime: stat.mtimeMs };
          }),
      )
    )
      .filter(({ mtime }) => mtime >= rangeStart && mtime <= rangeEnd)
      .sort((left, right) => left.mtime - right.mtime);
    const byName = new Map(
      pinned.map((segment) => [segment.sourceName, segment]),
    );
    for (const segment of liveSegments) {
      const sourceName = segment.path.split(/[\\/]/).at(-1)!;
      if (!byName.has(sourceName)) {
        byName.set(sourceName, { ...segment, sourceName });
      }
    }
    const segments = [...byName.values()].sort(
      (left, right) => left.mtime - right.mtime,
    );
    if (!segments.length) throw new Error('No buffered segments for event');

    const listPath = join(eventDirectory, 'segments.txt');
    const outputPath = join(eventDirectory, `${claimed.job.id}.mp4`);
    const list = segments
      .map(({ path }) => {
        const ffmpegPath = path.replace(/\\/g, '/').replace(/'/g, "'\\''");
        return `file '${ffmpegPath}'`;
      })
      .join('\n');
    await fs.writeFile(listPath, `${list}\n`, 'utf8');
    await fs.unlink(outputPath).catch(() => undefined);

    try {
      await this.runClipFfmpeg(listPath, outputPath);
      const output = await fs.stat(outputPath);
      if (!output.size) throw new Error('Created clip is empty');
      return outputPath;
    } finally {
      await fs.unlink(listPath).catch(() => undefined);
    }
  }

  private async pinCompletedSegments(
    eventDirectory: string,
    rangeStart: number,
  ): Promise<Array<{ path: string; mtime: number; sourceName: string }>> {
    const names = await fs.readdir(this.directory).catch(() => [] as string[]);
    const candidates = (
      await Promise.all(
        names
          .filter((name) => name.endsWith('.ts'))
          .map(async (sourceName) => {
            const path = join(this.directory, sourceName);
            const stat = await fs.stat(path).catch(() => null);
            return stat ? { path, mtime: stat.mtimeMs, sourceName } : null;
          }),
      )
    )
      .filter(
        (
          segment,
        ): segment is { path: string; mtime: number; sourceName: string } =>
          Boolean(segment && segment.mtime >= rangeStart),
      )
      .sort((left, right) => left.mtime - right.mtime);

    // FFmpeg may still be writing the newest segment. It will be complete by
    // the time the post-event window is collected from the rolling directory.
    const completed = candidates.slice(0, -1);
    const pinned = await Promise.all(
      completed.map(async (segment, index) => {
        const path = join(
          eventDirectory,
          `pre-${String(index).padStart(3, '0')}.ts`,
        );
        try {
          await fs.copyFile(segment.path, path);
          return { ...segment, path };
        } catch {
          return null;
        }
      }),
    );
    return pinned.filter(
      (
        segment,
      ): segment is { path: string; mtime: number; sourceName: string } =>
        segment !== null,
    );
  }

  private runClipFfmpeg(listPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-fflags',
          '+genpts',
          '-c',
          'copy',
          '-avoid_negative_ts',
          'make_zero',
          '-movflags',
          '+faststart',
          '-y',
          outputPath,
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        error ? reject(error) : resolve();
      };
      const deadline = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* still settle the failed job */
        }
        finish(new Error('Clip FFmpeg timed out'));
      }, 30_000);
      child.stderr?.resume();
      child.once('error', () =>
        finish(new Error('Unable to start clip FFmpeg')),
      );
      child.once('close', (code) => {
        if (code === 0) finish();
        else
          finish(
            new Error(`Clip FFmpeg exited with code ${code ?? 'unknown'}`),
          );
      });
    });
  }

  private spawnFfmpeg(): void {
    if (this.stopped) return;
    const currentRun = ++this.runId;
    this.startedAt = Date.now();
    const outputPattern = join(this.directory, 'segment-%Y%m%d-%H%M%S.ts');
    const isUsb = this.options.camera.type === 'usb';
    const errors = new FfmpegErrorParser(isUsb);
    let inputArgs: string[];
    try {
      inputArgs = isUsb
        ? usbInputArgs(this.options.camera.device_id)
        : [
            '-rtsp_transport',
            this.transport,
            '-timeout',
            '15000000',
            '-fflags',
            '+genpts',
            '-i',
            buildRtspUrl(this.options.camera),
          ];
    } catch {
      this.handleExit(currentRun, 'camera_device_unavailable');
      return;
    }
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      ...inputArgs,
      '-map',
      '0:v:0',
      '-an',
      ...(isUsb ? usbEncodingArgs() : ['-c:v', 'copy']),
      '-f',
      'segment',
      '-segment_format',
      'mpegts',
      '-segment_time',
      String(SEGMENT_SECONDS),
      '-reset_timestamps',
      '1',
      '-strftime',
      '1',
      '-y',
      outputPattern,
    ];

    const child = spawn(this.options.ffmpegPath, args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer) => errors.append(chunk));
    child.once('error', () =>
      this.handleExit(currentRun, 'ffmpeg_start_failed'),
    );
    child.once('close', () => this.handleExit(currentRun, errors.finish()));
  }

  private handleExit(runId: number, errorCode: CameraErrorCode): void {
    if (this.stopped || runId !== this.runId) return;
    this.runId += 1;
    this.child = null;
    this.options.onStatus('error', errorCode);
    if (
      this.options.camera.type !== 'usb' &&
      errorCode === 'camera_transport_unsupported' &&
      this.transport === 'tcp'
    ) {
      this.transport = 'udp';
    }
    const delay = Math.min(
      1_000 * 2 ** this.restartAttempt,
      MAX_RESTART_DELAY_MS,
    );
    this.restartAttempt += 1;
    this.restartTimer = setTimeout(() => this.spawnFfmpeg(), delay);
  }

  private async inspectSegments(): Promise<void> {
    if (this.inspecting || this.stopped || !this.child) return;
    const currentRun = this.runId;
    this.inspecting = true;
    try {
      const recent = await this.cleanup();
      if (this.stopped || currentRun !== this.runId || !this.child) return;
      const newestSegmentAt = recent.length ? Math.max(...recent) : 0;
      if (
        newestSegmentAt >= this.startedAt &&
        Date.now() - newestSegmentAt <= STREAM_STALE_AFTER_MS
      ) {
        this.restartAttempt = 0;
        this.options.onStatus('online');
      } else if (Date.now() - this.startedAt > 20_000) {
        this.restartStalledProcess();
      }
    } catch {
      if (!this.stopped && currentRun === this.runId)
        this.options.onStatus('error', 'filesystem_error');
    } finally {
      this.inspecting = false;
    }
  }

  private restartStalledProcess(): void {
    if (this.stopped) return;
    const currentRun = this.runId;
    const child = this.child;
    this.handleExit(currentRun, 'stream_stalled');
    if (child && !child.killed) child.kill();
  }

  private async cleanup(): Promise<number[]> {
    const cutoff = Date.now() - BUFFER_SECONDS * 1_000;
    const names = await fs.readdir(this.directory).catch(() => [] as string[]);
    const segments = await Promise.all(
      names
        .filter((name) => name.endsWith('.ts'))
        .map(async (name) => {
          const path = join(this.directory, name);
          const stat = await fs.stat(path).catch(() => null);
          return stat ? { path, mtime: stat.mtimeMs, size: stat.size } : null;
        }),
    );
    const existingSegments = segments.filter(
      (segment): segment is { path: string; mtime: number; size: number } =>
        segment !== null,
    );
    await Promise.all(
      existingSegments
        .filter(({ mtime }) => mtime < cutoff)
        .map(({ path }) => fs.unlink(path).catch(() => undefined)),
    );
    return existingSegments
      .filter(({ mtime, size }) => mtime >= cutoff && size > 0)
      .map(({ mtime }) => mtime);
  }
}
