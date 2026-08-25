import { promises as fs } from 'fs';

import type {
  CameraConfig,
  CameraErrorCode,
  CameraStatus,
  CaptureJob,
  ClaimedCaptureJob,
} from './camera.types';

type CameraConfigResponse = {
  data: { camera: CameraConfig | null };
};

type CaptureJobResponse = {
  data: { job: CaptureJob | null; server_time: string };
};

export class CameraApiClient {
  constructor(private readonly apiUrl: string) {}

  async getConfig(
    accessToken: string,
    registerId: string | null,
  ): Promise<CameraConfig | null> {
    const url = new URL('/v1/cameras/config', this.apiUrl);
    if (registerId) url.searchParams.set('register_id', registerId);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Camera config request failed: ${response.status}`);
    const body = (await response.json()) as CameraConfigResponse;
    return body.data.camera;
  }

  async reportStatus(
    accessToken: string,
    cameraId: string,
    status: CameraStatus,
    errorCode?: CameraErrorCode,
  ): Promise<void> {
    const response = await fetch(
      new URL(
        `/v1/cameras/${encodeURIComponent(cameraId)}/status`,
        this.apiUrl,
      ),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          ...(errorCode ? { error_code: errorCode } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`Camera status request failed: ${response.status}`);
  }

  async claimCaptureJob(
    accessToken: string,
    cameraId: string,
  ): Promise<ClaimedCaptureJob | null> {
    const response = await fetch(
      new URL('/v1/anti-fraud/capture-jobs/claim', this.apiUrl),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ camera_id: cameraId }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const receivedAt = Date.now();
    if (!response.ok) {
      throw new Error(`Capture job request failed: ${response.status}`);
    }
    const body = (await response.json()) as CaptureJobResponse;
    return body.data.job
      ? {
          job: body.data.job,
          serverTime: body.data.server_time,
          receivedAt,
        }
      : null;
  }

  async uploadCaptureClip(
    accessToken: string,
    eventId: string,
    filePath: string,
  ): Promise<void> {
    const bytes = await fs.readFile(filePath);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes], { type: 'video/mp4' }),
      `${eventId}.mp4`,
    );
    const response = await fetch(
      new URL(
        `/v1/anti-fraud/capture-jobs/${encodeURIComponent(eventId)}/upload`,
        this.apiUrl,
      ),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Capture upload failed: ${response.status}`);
    }
  }

  async failCaptureJob(
    accessToken: string,
    eventId: string,
    message: string,
  ): Promise<void> {
    const response = await fetch(
      new URL(
        `/v1/anti-fraud/capture-jobs/${encodeURIComponent(eventId)}/fail`,
        this.apiUrl,
      ),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ error_message: message.slice(0, 2000) }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Capture failure report failed: ${response.status}`);
    }
  }
}
