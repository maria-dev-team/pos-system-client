import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const response = (
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse => ({
  config,
  data,
  headers: {},
  status,
  statusText: String(status),
});

const unauthorized = (config: InternalAxiosRequestConfig): AxiosError =>
  new AxiosError(
    'Unauthorized',
    undefined,
    config,
    undefined,
    response(config, 401, { error_code: 'INVALID_TOKEN' }),
  );

const loadRequest = async (
  adapter: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>,
) => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', 'http://localhost:4004');
  axios.defaults.adapter = adapter;

  const token = { value: 'expired-token' as string | null };
  const api = await import('./request');
  const provider = await import('./access-token.provider');
  provider.configureAccessTokenProvider({
    clearAccessToken: () => {
      token.value = null;
    },
    getAccessToken: () => token.value,
    setAccessToken: (accessToken) => {
      token.value = accessToken;
    },
  });

  return { ...api, token };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('request refresh flow', () => {
  it('uses one refresh for parallel 401 responses and retries both requests with the new token', async () => {
    let refreshCalls = 0;
    const adapter = vi.fn(async (rawConfig: InternalAxiosRequestConfig) => {
      const config = {
        ...rawConfig,
        headers: AxiosHeaders.from(rawConfig.headers),
      };
      if (config.url === '/v1/auth/refresh') {
        refreshCalls += 1;
        return response(config, 200, {
          data: { auth: { access_token: 'new-token' } },
        });
      }
      if (config.headers.get('Authorization') !== 'Bearer new-token') {
        throw unauthorized(config);
      }
      return response(config, 200, { data: { ok: true } });
    });
    const { request, token } = await loadRequest(adapter);

    const results = await Promise.all([
      request.get('/protected-a'),
      request.get('/protected-b'),
    ]);

    expect(results.map(({ data }) => data)).toEqual([
      { data: { ok: true } },
      { data: { ok: true } },
    ]);
    expect(refreshCalls).toBe(1);
    expect(token.value).toBe('new-token');
  });

  it('does not refresh an authentication request', async () => {
    let refreshCalls = 0;
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/v1/auth/refresh') refreshCalls += 1;
      throw unauthorized(config);
    });
    const { request } = await loadRequest(adapter);

    await expect(request.post('/v1/auth/login', {})).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(refreshCalls).toBe(0);
  });

  it('retries a protected request at most once', async () => {
    let protectedCalls = 0;
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/v1/auth/refresh') {
        return response(config, 200, {
          data: { auth: { access_token: 'new-token' } },
        });
      }
      protectedCalls += 1;
      throw unauthorized(config);
    });
    const { request } = await loadRequest(adapter);

    await expect(request.get('/protected')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(protectedCalls).toBe(2);
  });

  it('clears the access token when refresh is rejected as unauthorized', async () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      throw unauthorized(config);
    });
    const { request, token } = await loadRequest(adapter);

    await expect(request.get('/protected')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(token.value).toBeNull();
  });
});
