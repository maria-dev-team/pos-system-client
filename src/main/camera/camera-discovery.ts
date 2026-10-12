import { randomUUID } from 'crypto';
import { createSocket } from 'dgram';
import { isIPv4 } from 'net';
import { Cam } from 'onvif';
import { networkInterfaces } from 'os';
import { parseStringPromise, processors } from 'xml2js';

export type DiscoveredCamera = {
  type?: 'rtsp' | 'usb';
  device_id?: string;
  name: string;
  host: string;
  rtsp_port?: number;
  stream_path?: string;
  status: 'ready' | 'credentials_required' | 'unavailable';
};
export type CameraDiscoveryJob = {
  type?: 'rtsp' | 'usb';
  id: string;
  username: string;
  password: string;
  claim_token: string;
};
export type DiscoveryEndpoint = { url: URL; name: string };
const PROBE_MS = 4_000;
const MAX_CAMERAS = 32;

const xmlText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    '_' in value &&
    typeof value._ === 'string'
  )
    return value._;
  return '';
};

// Only accept device endpoints advertised by the responding local IPv4 host.
export const parseProbeResponse = async (
  xml: string,
  source: string,
  messageId: string,
): Promise<DiscoveryEndpoint[]> => {
  if (!isIPv4(source) || xml.length > 65_536 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    return [];
  try {
    const data = await parseStringPromise(xml, {
      explicitArray: false,
      tagNameProcessors: [processors.stripPrefix],
    });
    if (xmlText(data?.Envelope?.Header?.RelatesTo) !== messageId) return [];
    const matches = data?.Envelope?.Body?.ProbeMatches?.ProbeMatch;
    return (Array.isArray(matches) ? matches : [matches])
      .flatMap((match) => {
        const addresses = xmlText(match?.XAddrs);
        if (!addresses) return [];
        const scope = xmlText(match.Scopes)
          .split(/\s+/)
          .find((value) => value.startsWith('onvif://www.onvif.org/name/'));
        let name = `Камера ${source}`;
        try {
          if (scope)
            name = decodeURIComponent(
              scope.slice('onvif://www.onvif.org/name/'.length),
            );
        } catch {
          /* Keep the address if a device sends an invalid name. */
        }
        return addresses.split(/\s+/).flatMap((address: string) => {
          try {
            const url = new URL(address);
            return ['http:', 'https:'].includes(url.protocol) &&
              url.hostname === source &&
              !url.username &&
              !url.password
              ? [{ url, name: name.slice(0, 255) || `Камера ${source}` }]
              : [];
          } catch {
            return [];
          }
        });
      })
      .slice(0, MAX_CAMERAS);
  } catch {
    return [];
  }
};

const ipv4Number = (address: string): number =>
  address.split('.').reduce((value, part) => (value << 8) | Number(part), 0);

const probeInterface = (
  address: string,
  netmask: string,
  signal: AbortSignal,
): Promise<DiscoveryEndpoint[]> =>
  new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const endpoints = new Map<string, DiscoveryEndpoint>();
    const messageId = `urn:uuid:${randomUUID()}`;
    let settled = false;
    let messages = 0;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      try {
        socket.close();
      } catch {
        /* Socket may not have bound yet. */
      }
      if (error) reject(error);
      else resolve([...endpoints.values()]);
    };
    const abort = (): void => finish(new Error('Discovery cancelled'));
    const timer = setTimeout(() => finish(), PROBE_MS);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    socket.on('error', finish);
    socket.on('message', (message, remote) => {
      if (
        messages++ >= 256 ||
        endpoints.size >= MAX_CAMERAS ||
        (ipv4Number(remote.address) & ipv4Number(netmask)) !==
          (ipv4Number(address) & ipv4Number(netmask))
      )
        return;
      void parseProbeResponse(
        message.toString(),
        remote.address,
        messageId,
      ).then((found) => {
        if (!settled)
          for (const endpoint of found) {
            if (
              endpoints.size < MAX_CAMERAS &&
              !endpoints.has(endpoint.url.hostname)
            )
              endpoints.set(endpoint.url.hostname, endpoint);
          }
      });
    });
    socket.bind(0, address, () => {
      if (settled) return;
      try {
        socket.setMulticastInterface(address);
        socket.setMulticastTTL(1);
        const probe = `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><s:Header><a:MessageID>${messageId}</a:MessageID><a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action></s:Header><s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body></s:Envelope>`;
        socket.send(probe, 3702, '239.255.255.250', (error) => {
          if (error) finish(error);
        });
      } catch {
        finish(new Error('Network unavailable'));
      }
    });
  });

export const parseStreamUri = (
  uri: string,
  endpoint: DiscoveryEndpoint,
): DiscoveredCamera => {
  const url = new URL(uri);
  if (url.protocol !== 'rtsp:' || !url.hostname || url.hash)
    throw new Error('Unsupported stream');
  // Some cameras advertise 0.0.0.0; use the address that actually answered discovery.
  const host =
    url.hostname === '0.0.0.0' ? endpoint.url.hostname : url.hostname;
  if (host !== endpoint.url.hostname) throw new Error('Unexpected stream host');
  if (Number(url.port || 554) < 1) throw new Error('Invalid stream port');
  const path = `${url.pathname || '/'}${url.search}`;
  if (path.length > 1024 || /\s/.test(path))
    throw new Error('Invalid stream path');
  // Do not return userinfo from the URI to the backend or renderer.
  return {
    name: endpoint.name,
    host,
    rtsp_port: Number(url.port || 554),
    stream_path: path,
    status: 'ready',
  };
};

export const resolveCamera = (
  endpoint: DiscoveryEndpoint,
  credentials: Pick<CameraDiscoveryJob, 'username' | 'password'>,
  signal: AbortSignal,
): Promise<DiscoveredCamera> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (camera: DiscoveredCamera): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(camera);
    };
    const fail = (error?: Error | null): void =>
      finish({
        name: endpoint.name,
        host: endpoint.url.hostname,
        status:
          /401|403|unauthoriz|notauthorized|authentication|credential/i.test(
            error?.message ?? '',
          )
            ? 'credentials_required'
            : 'unavailable',
      });
    const abort = (): void => fail();
    const timer = setTimeout(() => fail(), 10_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    const camera = new Cam({
      hostname: endpoint.url.hostname,
      port: Number(
        endpoint.url.port || (endpoint.url.protocol === 'https:' ? 443 : 80),
      ),
      path: endpoint.url.pathname + endpoint.url.search,
      useSecure: endpoint.url.protocol === 'https:',
      ...credentials,
      timeout: 2_000,
      autoconnect: false,
      preserveAddress: true,
    });
    camera.on('error', fail);
    camera.connect((error) => {
      if (settled) return;
      if (error) {
        fail(error);
        return;
      }
      camera.getStreamUri({ protocol: 'RTSP' }, (streamError, stream) => {
        if (settled) return;
        if (streamError || !stream) {
          fail(streamError);
          return;
        }
        try {
          finish(parseStreamUri(stream.uri, endpoint));
        } catch {
          fail();
        }
      });
    });
  });

export const discoverCameras = async (
  credentials: Pick<CameraDiscoveryJob, 'username' | 'password'>,
  signal: AbortSignal,
): Promise<DiscoveredCamera[]> => {
  const interfaces = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal);
  const probes = await Promise.allSettled(
    interfaces.map((entry) =>
      probeInterface(entry.address, entry.netmask, signal),
    ),
  );
  if (!probes.some((probe) => probe.status === 'fulfilled'))
    throw new Error('Network unavailable');
  const endpoints = new Map<string, DiscoveryEndpoint>();
  for (const probe of probes)
    if (probe.status === 'fulfilled')
      for (const endpoint of probe.value) {
        if (
          endpoints.size < MAX_CAMERAS &&
          !endpoints.has(endpoint.url.hostname)
        )
          endpoints.set(endpoint.url.hostname, endpoint);
      }
  const pending = [...endpoints.values()];
  const results: DiscoveredCamera[] = [];
  // Bound simultaneous authentication requests and complete within the job deadline.
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (pending.length && !signal.aborted) {
        const endpoint = pending.shift()!;
        results.push(await resolveCamera(endpoint, credentials, signal));
      }
    }),
  );
  if (signal.aborted) throw new Error('Discovery cancelled');
  return results.sort((a, b) => a.host.localeCompare(b.host));
};
