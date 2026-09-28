// @vitest-environment node
import { Cam } from 'onvif';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseProbeResponse,
  parseStreamUri,
  resolveCamera,
} from './camera-discovery';

vi.mock('onvif', () => ({ Cam: vi.fn() }));
const endpoint = {
  url: new URL('http://192.168.1.20:8080/onvif/device_service'),
  name: 'Касса',
};
const response = (addresses: string, relatesTo = 'urn:uuid:probe'): string => `
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<s:Header><a:RelatesTo>${relatesTo}</a:RelatesTo></s:Header><s:Body><d:ProbeMatches><d:ProbeMatch>
<d:XAddrs>${addresses}</d:XAddrs><d:Scopes>onvif://www.onvif.org/name/Front%20Door</d:Scopes>
</d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`;

describe('camera discovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reads namespaced ONVIF responses and the actual device service port', async () => {
    const devices = await parseProbeResponse(
      response(endpoint.url.href),
      '192.168.1.20',
      'urn:uuid:probe',
    );
    expect(devices).toEqual([{ url: endpoint.url, name: 'Front Door' }]);
  });

  it('accepts SOAP text elements with attributes and multiple matches', async () => {
    const xml = response(endpoint.url.href)
      .replace('<a:RelatesTo>', '<a:RelatesTo RelationshipType="a:Reply">')
      .replace('<d:Scopes>', '<d:Scopes MatchBy="rfc3986">');
    expect(
      await parseProbeResponse(xml, '192.168.1.20', 'urn:uuid:probe'),
    ).toEqual([{ url: endpoint.url, name: 'Front Door' }]);
  });

  it('rejects unrelated, malformed and externally redirected discovery responses', async () => {
    for (const xml of [
      response(endpoint.url.href, 'old'),
      '<invalid',
      response('http://example.com/onvif'),
      response('http://127.0.0.1/onvif'),
      '<!DOCTYPE x>' + response(endpoint.url.href),
    ]) {
      expect(
        await parseProbeResponse(xml, '192.168.1.20', 'urn:uuid:probe'),
      ).toEqual([]);
    }
  });

  it('uses the RTSP port, not the ONVIF service port, and strips URI credentials', () => {
    expect(
      parseStreamUri(
        'rtsp://admin:secret@192.168.1.20:8554/cam/realmonitor?channel=2&subtype=0',
        endpoint,
      ),
    ).toEqual({
      name: 'Касса',
      host: '192.168.1.20',
      rtsp_port: 8554,
      stream_path: '/cam/realmonitor?channel=2&subtype=0',
      status: 'ready',
    });
    expect(parseStreamUri('rtsp://0.0.0.0/stream1', endpoint)).toMatchObject({
      host: '192.168.1.20',
      rtsp_port: 554,
    });
    expect(() =>
      parseStreamUri('http://192.168.1.20/video', endpoint),
    ).toThrow();
    expect(() =>
      parseStreamUri('rtsp://203.0.113.10/stream', endpoint),
    ).toThrow();
  });

  it('authenticates on the discovered ONVIF port and retrieves the stream', async () => {
    const connect = vi.fn((callback) => callback(null));
    const getStreamUri = vi.fn((_options, callback) =>
      callback(null, { uri: 'rtsp://192.168.1.20:10554/live' }),
    );
    vi.mocked(Cam).mockImplementation(function () {
      return { on: vi.fn(), connect, getStreamUri } as unknown as Cam;
    });
    const result = await resolveCamera(
      endpoint,
      { username: 'admin', password: 'secret' },
      new AbortController().signal,
    );
    expect(Cam).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 8080,
        username: 'admin',
        password: 'secret',
        preserveAddress: true,
      }),
    );
    expect(result).toMatchObject({
      status: 'ready',
      rtsp_port: 10554,
      stream_path: '/live',
    });
  });

  it('distinguishes authentication failure from a timed-out device', async () => {
    vi.mocked(Cam).mockImplementation(function () {
      return {
        on: vi.fn(),
        connect: (callback) => callback(new Error('401 Unauthorized')),
      } as unknown as Cam;
    });
    expect(
      await resolveCamera(
        endpoint,
        { username: 'admin', password: 'bad' },
        new AbortController().signal,
      ),
    ).toMatchObject({ status: 'credentials_required', host: '192.168.1.20' });
    vi.mocked(Cam).mockImplementation(function () {
      return { on: vi.fn(), connect: vi.fn() } as unknown as Cam;
    });
    const result = resolveCamera(
      endpoint,
      { username: 'admin', password: 'bad' },
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ status: 'unavailable' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels without starting a connection after logout', async () => {
    vi.mocked(Cam).mockClear();
    const controller = new AbortController();
    controller.abort();
    expect(
      await resolveCamera(
        endpoint,
        { username: 'admin', password: 'secret' },
        controller.signal,
      ),
    ).toMatchObject({ status: 'unavailable' });
    expect(Cam).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
