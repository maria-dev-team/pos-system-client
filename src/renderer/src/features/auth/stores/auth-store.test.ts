import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  logout: vi.fn(),
  refreshTokens: vi.fn(),
}));

vi.mock('@renderer/common/api', () => api);

const loadStore = async () => {
  vi.resetModules();
  return (await import('./auth-store')).useAuthStore;
};

beforeEach(() => {
  sessionStorage.clear();
  api.logout.mockReset();
  api.refreshTokens.mockReset();
});

afterEach(() => sessionStorage.clear());

describe('auth store', () => {
  it('restores an access token with the refresh cookie', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'fresh-token' });
    const store = await loadStore();

    await store.getState().initialize();

    expect(store.getState()).toMatchObject({
      accessToken: 'fresh-token',
      isInitialized: true,
      isInitializing: false,
    });
  });

  it('finishes initialization as a guest when refresh fails', async () => {
    api.refreshTokens.mockRejectedValue(new Error('No session'));
    const store = await loadStore();

    await store.getState().initialize();

    expect(store.getState()).toMatchObject({
      accessToken: null,
      isInitialized: true,
    });
  });

  it('keeps the local session when backend logout fails', async () => {
    api.logout.mockRejectedValue(new Error('Current cashier session'));
    const store = await loadStore();
    store.getState().setAccessToken('access-token');

    await expect(store.getState().logout()).rejects.toThrow(
      'Current cashier session',
    );

    expect(store.getState().accessToken).toBe('access-token');
    expect(store.getState().isLoggingOut).toBe(false);
  });

  it('clears the local session after backend logout succeeds', async () => {
    api.logout.mockResolvedValue(undefined);
    const store = await loadStore();
    store.getState().setAccessToken('access-token');

    await store.getState().logout();

    expect(store.getState().accessToken).toBeNull();
  });
});
