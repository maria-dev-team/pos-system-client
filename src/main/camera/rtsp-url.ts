import type { CameraConfig } from './camera.types';

export const buildRtspUrl = (camera: CameraConfig): string => {
  const host =
    camera.host.includes(':') && !camera.host.startsWith('[')
      ? `[${camera.host}]`
      : camera.host;
  const path = camera.stream_path.startsWith('/')
    ? camera.stream_path
    : `/${camera.stream_path}`;
  return `rtsp://${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}@${host}:${camera.rtsp_port}${path}`;
};
