import axios, { type InternalAxiosRequestConfig } from 'axios';

import { ErrorCode } from '../constants/error-code';
import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from './access-token.provider';
import { apiConfig } from './config/api.config';
import { serializeRequestData } from './request-data.serializer';

const clientConfig = {
  baseURL: apiConfig.apiUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
  withCredentials: true,
};

export const request = axios.create(clientConfig);
const refreshClient = axios.create(clientConfig);

request.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  const expectedToken = (config as RetriableRequestConfig).retryAccessToken;
  if (expectedToken !== undefined && expectedToken !== accessToken)
    throw contextChanged();
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);

  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  } else {
    config.data = serializeRequestData(config.data);
  }
  config.params = serializeRequestData(config.params);

  return config;
});

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  retry?: boolean;
  retryAccessToken?: string;
};

let refreshPromise: Promise<string> | null = null;
let lastRotation: { previous: string | null; current: string } | null = null;
const contextChanged = (): Error & { code: string } =>
  Object.assign(
    new Error(
      'Вход или магазин изменился во время запроса. Повторите действие в текущем контексте.',
    ),
    { code: 'AUTH_CONTEXT_CHANGED' },
  );

const isAuthRequest = (url?: string): boolean =>
  url === '/v1/auth/login' ||
  url === '/v1/auth/register' ||
  url === '/v1/auth/logout' ||
  url === '/v1/auth/refresh';

const shouldAttemptRefresh = (
  status: number | undefined,
  errorCode: string | undefined,
  originalRequest: RetriableRequestConfig,
): boolean =>
  status === 401 &&
  !originalRequest.retry &&
  !isAuthRequest(originalRequest.url) &&
  (errorCode === ErrorCode.InvalidToken ||
    errorCode === ErrorCode.InvalidSession ||
    !errorCode);

export const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    const previous = getAccessToken();
    refreshPromise = refreshClient
      .post<{ data: { auth: { access_token: string } } }>(
        '/v1/auth/refresh',
        {},
      )
      .then(({ data }) => {
        if (getAccessToken() !== previous) throw contextChanged();
        const accessToken: unknown = data?.data?.auth?.access_token;
        if (
          typeof accessToken !== 'string' ||
          !accessToken.trim() ||
          accessToken.length > 16384
        )
          throw new Error('Сервер вернул некорректный токен доступа.');
        setAccessToken(accessToken);
        lastRotation = { previous, current: accessToken };
        return accessToken;
      })
      .catch((error: unknown) => {
        if (
          getAccessToken() === previous &&
          axios.isAxiosError(error) &&
          error.response?.status === 401
        )
          clearAccessToken();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

request.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) throw error;

    const originalRequest = error.config as RetriableRequestConfig;
    const status = error.response?.status;
    const errorCode = error.response?.data?.error_code as string | undefined;

    if (!shouldAttemptRefresh(status, errorCode, originalRequest)) throw error;

    originalRequest.retry = true;
    const sent = originalRequest.headers.get('Authorization');
    const current = getAccessToken();
    const sentToken =
      typeof sent === 'string' && sent.startsWith('Bearer ')
        ? sent.slice(7)
        : null;
    let accessToken: string;
    if (current !== sentToken) {
      // Only a known refresh rotation can replay an old request. A new login or
      // selected context must never inherit a previous user's pending mutation.
      if (
        !current ||
        lastRotation?.previous !== sentToken ||
        lastRotation.current !== current
      )
        throw contextChanged();
      accessToken = current;
    } else {
      accessToken = await refreshAccessToken();
    }
    if (getAccessToken() !== accessToken) throw contextChanged();
    originalRequest.retryAccessToken = accessToken;
    originalRequest.headers.set('Authorization', `Bearer ${accessToken}`);

    return request(originalRequest);
  },
);
