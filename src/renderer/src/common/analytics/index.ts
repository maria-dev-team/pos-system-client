import {
  getAccessToken,
  getAuthGeneration,
} from '../api/access-token.provider';
import { request } from '../api/request';
import { AnalyticsSDK } from './analytics-sdk';

export const analytics = new AnalyticsSDK({
  version: import.meta.env.VITE_CLIENT_VERSION ?? 'development',
  owner: () => (getAccessToken() ? String(getAuthGeneration()) : null),
  send: (events) => request.post('/v1/analytics/events', { events }),
});
export function startAnalytics() {
  if (import.meta.env.VITE_ANALYTICS_ENABLED === 'false')
    return () => undefined;
  const cleanup = analytics.start();
  const req = request.interceptors.request.use((config) => {
    if (!config.url?.startsWith('/v1/analytics/')) {
      config.headers['X-Client-Version'] =
        import.meta.env.VITE_CLIENT_VERSION ?? 'development';
      config.headers['X-Client-Type'] = 'pos';
      config.headers['X-Trace-Id'] ??= crypto.randomUUID();
      const action = analytics.actionId();
      if (action) config.headers['X-Action-Id'] = action;
    }
    return config;
  });
  const res = request.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.config?.url && !error.config.url.startsWith('/v1/analytics/'))
        analytics.track('http.error', { action_id: analytics.actionId() });
      return Promise.reject(error);
    },
  );
  return () => {
    cleanup();
    request.interceptors.request.eject(req);
    request.interceptors.response.eject(res);
  };
}
