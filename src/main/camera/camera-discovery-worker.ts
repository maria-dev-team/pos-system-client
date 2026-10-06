import type { CameraApiClient } from './camera-api.client';
import { discoverCameras } from './camera-discovery';
import type { CameraAuthContext } from './camera.types';
import { resolveFfmpegPath } from './ffmpeg-path';
import { discoverUsbCameras } from './usb-camera';

export class CameraDiscoveryWorker {
  private context: CameraAuthContext | null = null;
  private timer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly api: CameraApiClient) {}

  setContext(context: CameraAuthContext | null): void {
    if (
      context?.accessToken === this.context?.accessToken &&
      context?.registerId === this.context?.registerId
    )
      return;
    this.stop();
    this.context = context;
    if (context) {
      this.controller = new AbortController();
      void this.poll(context, this.controller.signal);
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.context = null;
  }

  private async poll(
    context: CameraAuthContext,
    signal: AbortSignal,
  ): Promise<void> {
    let delay = 5_000;
    try {
      const job = await this.api.claimDiscovery(
        context.accessToken,
        context.registerId,
        signal,
      );
      if (job && !signal.aborted) {
        let result;
        try {
          result = {
            cameras:
              job.type === 'usb'
                ? await discoverUsbCameras(resolveFfmpegPath(), signal)
                : await discoverCameras(job, signal),
          };
        } catch {
          result = {
            cameras: [],
            error:
              job.type === 'usb'
                ? ('device_error' as const)
                : ('network_error' as const),
          };
        }
        if (!signal.aborted)
          await this.api.completeDiscovery(
            context.accessToken,
            job,
            result,
            signal,
          );
      }
    } catch {
      // Search never blocks sales, recording, or offline operation.
      delay = 30_000;
    } finally {
      if (!signal.aborted)
        this.timer = setTimeout(() => void this.poll(context, signal), delay);
    }
  }
}
