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
  if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);

  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  } else {
    config.data = serializeRequestData(config.data);
  }
  config.params = serializeRequestData(config.params);

  return config;
});

type RetriableRequestConfig = InternalAxiosRequestConfig & { retry?: boolean };

let refreshPromise: Promise<string> | null = null;

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

const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post<{ data: { auth: { access_token: string } } }>(
        '/v1/auth/refresh',
        {},
      )
      .then(({ data }) => {
        const accessToken = data.data.auth.access_token;
        setAccessToken(accessToken);
        return accessToken;
      })
      .catch((error: unknown) => {
        if (axios.isAxiosError(error) && error.response?.status === 401)
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
    const accessToken = await refreshAccessToken();
    originalRequest.headers.set('Authorization', `Bearer ${accessToken}`);

    return request(originalRequest);
  },
);
