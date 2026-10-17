import {
  getAccessToken,
  getAuthGeneration,
} from '../api/access-token.provider';
import { request } from '../api/request';
import { AnalyticsSDK } from './analytics-sdk';
import { reportPosError, startErrorReporting } from './error-reporting';

export const analytics = new AnalyticsSDK({
  version: import.meta.env.VITE_CLIENT_VERSION ?? 'development',
  owner: () => (getAccessToken() ? String(getAuthGeneration()) : null),
  send: (events) => request.post('/v1/analytics/events', { events }),
});
export function startAnalytics(getPage?: () => string) {
  if (import.meta.env.VITE_ANALYTICS_ENABLED === 'false')
    return () => undefined;
  const cleanup = analytics.start();
  const stopErrors = startErrorReporting(
    async (events) =>
      (
        await request.post('/v1/analytics/pos-errors', {
          events: events.map((event) => ({
            ...event,
            client_version:
              event.client_version ??
              import.meta.env.VITE_CLIENT_VERSION ??
              'development',
          })),
        })
      ).data.data,
    getPage,
  );
  const req = request.interceptors.request.use(
    (config) => {
      if (!config.url?.startsWith('/v1/analytics/')) {
        config.headers['X-Pos-Diagnostics'] = '1';
        config.headers['X-Client-Version'] =
          import.meta.env.VITE_CLIENT_VERSION ?? 'development';
        config.headers['X-Trace-Id'] ??= crypto.randomUUID();
        const action = analytics.actionId();
        if (action) config.headers['X-Action-Id'] = action;
      }
      return config;
    },
    undefined,
    // Auth mutations capture ownership synchronously when the request starts.
    { synchronous: true },
  );
  const res = request.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.config?.url && !error.config.url.startsWith('/v1/analytics/'))
        reportPosError(error, 'http', error.config.url.split('?')[0]);
      return Promise.reject(error);
    },
  );
  return () => {
    cleanup();
    stopErrors();
    request.interceptors.request.eject(req);
    request.interceptors.response.eject(res);
  };
}
