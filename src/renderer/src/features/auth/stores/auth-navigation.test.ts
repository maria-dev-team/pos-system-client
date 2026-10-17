import { MutationObserver } from '@tanstack/react-query';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_ANALYTICS_ENABLED', 'true');
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllEnvs());

const token = (organization?: string): string =>
  `h.${btoa(JSON.stringify({ sub: 'user', sessionId: 'session', exp: Math.floor(Date.now() / 1000) + 600, ...(organization ? { userOrganizationId: 'membership', organizationId: organization } : {}) }))}.s`;

describe('auth mutation navigation', () => {
  it.each(['login', 'select-context'] as const)(
    'runs the %s success callback after its asynchronous token commit and observer rerender',
    async (operation) => {
      let finish!: () => void;
      const returnedToken = token(
        operation === 'select-context' ? 'org' : undefined,
      );
      axios.defaults.adapter = vi.fn(
        async (config: InternalAxiosRequestConfig) => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return {
            config,
            status: 200,
            statusText: 'OK',
            headers: {},
            data: {
              data: {
                auth: { access_token: returnedToken },
                user: {},
                organizations: [],
              },
            },
          };
        },
      );
      const { useAuthStore, authTokenProvider } = await import('./auth-store');
      const { configureAccessTokenProvider } =
        await import('../../../common/api/access-token.provider');
      configureAccessTokenProvider(authTokenProvider);
      if (operation === 'select-context')
        useAuthStore.getState().setAccessToken(token());
      const { login } = await import('../../../common/api/requests/auth/login');
      const { selectContext } =
        await import('../../../common/api/requests/auth/select-context');
      const { createQueryClient } =
        await import('../../../common/lib/query-client');
      const { startAnalytics } = await import('../../../common/analytics');
      const stopAnalytics = startAnalytics();
      const client = createQueryClient();
      const onSuccess = vi.fn();
      const options = {
        mutationFn: async () =>
          operation === 'login'
            ? login({ login: 'user@example.com', password: 'password' })
            : selectContext('membership'),
        onSuccess,
      };
      const observer = new MutationObserver(client, options);
      const unsubscribe = observer.subscribe(() => undefined);
      const unsubscribeAuth = useAuthStore.subscribe(() =>
        observer.setOptions({ ...options }),
      );
      try {
        const pending = observer.mutate(undefined);
        const checked = expect(pending).resolves.toBeDefined();
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
        finish();
        await checked;
        expect(useAuthStore.getState().accessToken).toBe(returnedToken);
        expect(onSuccess).toHaveBeenCalledOnce();
      } finally {
        stopAnalytics();
        unsubscribeAuth();
        unsubscribe();
        client.clear();
      }
    },
  );
});
