export type CameraStatus = 'online' | 'offline' | 'error';

export type CameraErrorCode =
  | 'camera_device_unavailable'
  | 'ffmpeg_start_failed'
  | 'ffmpeg_exited'
  | 'camera_auth_failed'
  | 'camera_unreachable'
  | 'camera_stream_not_found'
  | 'camera_transport_unsupported'
  | 'ffmpeg_options_unsupported'
  | 'stream_invalid_timestamps'
  | 'camera_no_video'
  | 'stream_stalled'
  | 'filesystem_error';

export type CameraConfig = {
  id: string;
  type?: 'rtsp' | 'usb';
  device_id?: string | null;
  device_name?: string | null;
  host: string;
  rtsp_port: number;
  username: string;
  password: string;
  stream_path: string;
};

export type CameraAuthContext = {
  accessToken: string;
  registerId: string | null;
};

export type CaptureJob = {
  id: string;
  camera_id: string;
  occurred_at: string;
  pre_buffer_seconds: number;
  post_buffer_seconds: number;
  attempt: number;
};

export type ClaimedCaptureJob = {
  job: CaptureJob;
  serverTime: string;
  receivedAt: number;
};
