import { describe, expect, it } from 'vitest';

import { buildRtspUrl } from './rtsp-url';

describe('buildRtspUrl', () => {
  it('builds the HiWatch URL and escapes credentials', () => {
    expect(
      buildRtspUrl({
        id: 'camera-id',
        host: '192.168.0.214',
        rtsp_port: 554,
        username: 'camera@user',
        password: 'p:a/ss',
        stream_path: '/Streaming/Channels/101',
      }),
    ).toBe(
      'rtsp://camera%40user:p%3Aa%2Fss@192.168.0.214:554/Streaming/Channels/101',
    );
  });

  it('brackets IPv6 hosts without altering the stream path', () => {
    expect(
      buildRtspUrl({
        id: 'camera-id',
        host: 'fe80::1',
        rtsp_port: 8554,
        username: 'user',
        password: 'password',
        stream_path: '/stream?channel=1',
      }),
    ).toBe('rtsp://user:password@[fe80::1]:8554/stream?channel=1');
  });
});
