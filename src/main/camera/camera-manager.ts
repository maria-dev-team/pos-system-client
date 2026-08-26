import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

import { CameraApiClient } from './camera-api.client';
import type {
  CameraAuthContext,
  CameraConfig,
  CameraErrorCode,
  CameraStatus,
} from './camera.types';
import { resolveFfmpegPath } from './ffmpeg-path';
import { RollingCameraBuffer } from './rolling-camera-buffer';

const CONFIG_REFRESH_MS = 60_000;
const CAPTURE_POLL_MS = 3_000;
const BUFFER_SECONDS = 90;
const CLIP_RETENTION_MS = 24 * 60 * 60 * 1_000;
const UPLOAD_ATTEMPTS = 3;
const STATUS_HEARTBEAT_MS = 30_000;

export class CameraManager {
  private authContext: CameraAuthContext | null = null;
  private buffer: RollingCameraBuffer | null = null;
  private camera: CameraConfig | null = null;
  private currentStatus: CameraStatus | null = null;
  private currentErrorCode: CameraErrorCode | null = null;
  private lastReportedStatus: CameraStatus | null = null;
  private lastReportedErrorCode: CameraErrorCode | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private processingCapture = false;
  private refreshTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private refreshGeneration = 0;
  private readonly bufferRoot = join(app.getPath('userData'), 'camera-buffer');
  private readonly clipsRoot = join(app.getPath('userData'), 'camera-clips');

  constructor(private readonly api: CameraApiClient) {}

  setContext(context: CameraAuthContext | null): void {
    this.refreshGeneration += 1;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.captureTimer) clearInterval(this.captureTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.refreshTimer = null;
    this.captureTimer = null;
    this.heartbeatTimer = null;
    if (!context) {
      void this.clearContext(this.refreshGeneration);
      return;
    }
    this.authContext = context;
    void this.pruneBufferRoot();
    const generation = this.refreshGeneration;
    void this.refresh(generation);
    this.refreshTimer = setInterval(
      () => void this.refresh(generation),
      CONFIG_REFRESH_MS,
    );
    this.captureTimer = setInterval(
      () => void this.pollCaptureJob(generation),
      CAPTURE_POLL_MS,
    );
    this.heartbeatTimer = setInterval(
      () => void this.flushStatus(true),
      STATUS_HEARTBEAT_MS,
    );
    void this.pollCaptureJob(generation);
  }

  async shutdown(): Promise<void> {
    this.refreshGeneration += 1;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.captureTimer) clearInterval(this.captureTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.refreshTimer = null;
    this.captureTimer = null;
    this.heartbeatTimer = null;
    await this.replaceCamera(null);
    this.authContext = null;
  }

  private async refresh(generation: number): Promise<void> {
    const context = this.authContext;
    if (!context) return;
    try {
      const camera = await this.api.getConfig(
        context.accessToken,
        context.registerId,
      );
      if (generation !== this.refreshGeneration) return;
      await this.replaceCamera(camera);
    } catch {
      // Keep an already-running local buffer alive during backend outages.
    } finally {
      void this.pruneBufferRoot();
      void this.flushStatus();
    }
  }

  private async replaceCamera(camera: CameraConfig | null): Promise<void> {
    if (this.sameCamera(this.camera, camera)) return;
    if (this.buffer) {
      await this.setStatus('offline');
      await this.buffer.stop();
      this.buffer = null;
    }
    this.camera = camera;
    this.currentStatus = null;
    this.currentErrorCode = null;
    this.lastReportedStatus = null;
    this.lastReportedErrorCode = null;
    if (!camera) return;

    this.buffer = new RollingCameraBuffer({
      camera,
      ffmpegPath: resolveFfmpegPath(),
      rootDirectory: this.bufferRoot,
      onStatus: (status, errorCode) => void this.setStatus(status, errorCode),
    });
    try {
      await this.buffer.start();
    } catch {
      await this.setStatus('error', 'filesystem_error');
    }
  }

  private async setStatus(
    status: CameraStatus,
    errorCode?: CameraErrorCode,
  ): Promise<void> {
    const nextErrorCode = errorCode ?? null;
    if (
      status === this.currentStatus &&
      nextErrorCode === this.currentErrorCode
    )
      return;
    this.currentStatus = status;
    this.currentErrorCode = nextErrorCode;
    await this.flushStatus();
  }

  private async flushStatus(force = false): Promise<void> {
    const status = this.currentStatus;
    const errorCode = this.currentErrorCode;
    if (
      !status ||
      (!force &&
        status === this.lastReportedStatus &&
        errorCode === this.lastReportedErrorCode)
    )
      return;
    const context = this.authContext;
    const camera = this.camera;
    if (!context || !camera) return;
    try {
      await this.api.reportStatus(
        context.accessToken,
        camera.id,
        status,
        errorCode ?? undefined,
      );
      if (
        this.camera?.id === camera.id &&
        this.currentStatus === status &&
        this.currentErrorCode === errorCode
      ) {
        this.lastReportedStatus = status;
        this.lastReportedErrorCode = errorCode;
      }
    } catch {
      // Status reporting is best-effort and must never affect POS or buffering.
    }
  }

  private async pollCaptureJob(generation: number): Promise<void> {
    if (this.processingCapture || generation !== this.refreshGeneration) return;
    const context = this.authContext;
    const camera = this.camera;
    const buffer = this.buffer;
    if (!context || !camera || !buffer) return;

    this.processingCapture = true;
    let eventId: string | null = null;
    let clipPath: string | null = null;
    try {
      const claimed = await this.api.claimCaptureJob(
        context.accessToken,
        camera.id,
      );
      if (!claimed || generation !== this.refreshGeneration) return;
      eventId = claimed.job.id;
      clipPath = await buffer.createEventClip(claimed, this.clipsRoot);
      await this.uploadWithRetry(context.accessToken, eventId, clipPath);
    } catch (error) {
      if (eventId) {
        const message =
          error instanceof Error ? error.message : 'Unknown capture error';
        await this.api
          .failCaptureJob(context.accessToken, eventId, message)
          .catch(() => undefined);
      }
    } finally {
      if (eventId) {
        await fs.rm(join(this.clipsRoot, eventId), {
          recursive: true,
          force: true,
        });
      }
      this.processingCapture = false;
      void this.pruneClipsRoot();
    }
  }

  private async uploadWithRetry(
    accessToken: string,
    eventId: string,
    clipPath: string,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        await this.api.uploadCaptureClip(accessToken, eventId, clipPath);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < UPLOAD_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Capture upload failed');
  }

  private sameCamera(
    left: CameraConfig | null,
    right: CameraConfig | null,
  ): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private async clearContext(generation: number): Promise<void> {
    if (generation !== this.refreshGeneration) return;
    await this.replaceCamera(null);
    if (generation === this.refreshGeneration) this.authContext = null;
    await this.pruneBufferRoot();
  }

  private async pruneBufferRoot(): Promise<void> {
    const cutoff = Date.now() - BUFFER_SECONDS * 1_000;
    const directories = await fs
      .readdir(this.bufferRoot, { withFileTypes: true })
      .catch(() => []);
    await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const directory = join(this.bufferRoot, entry.name);
          const files = await fs.readdir(directory).catch(() => [] as string[]);
          await Promise.all(
            files
              .filter((name) => name.endsWith('.ts'))
              .map(async (name) => {
                const path = join(directory, name);
                const stat = await fs.stat(path).catch(() => null);
                if (stat && stat.mtimeMs < cutoff) {
                  await fs.unlink(path).catch(() => undefined);
                }
              }),
          );
        }),
    );
    await this.pruneClipsRoot();
  }

  private async pruneClipsRoot(): Promise<void> {
    const cutoff = Date.now() - CLIP_RETENTION_MS;
    const entries = await fs
      .readdir(this.clipsRoot, { withFileTypes: true })
      .catch(() => []);
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(this.clipsRoot, entry.name);
        const stat = await fs.stat(path).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) {
          await fs.rm(path, { recursive: true, force: true });
        }
      }),
    );
  }
}
