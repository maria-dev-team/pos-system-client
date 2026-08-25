export type CameraStatus = 'online' | 'offline' | 'error';

export type CameraErrorCode =
  | 'ffmpeg_start_failed'
  | 'ffmpeg_exited'
  | 'stream_stalled'
  | 'filesystem_error';

export type CameraConfig = {
  id: string;
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
