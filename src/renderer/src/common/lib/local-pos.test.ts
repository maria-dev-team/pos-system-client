import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { profileFixture } from '../../../../shared/pos/test-fixtures';

const mocks = vi.hoisted(() => ({
  token: 'old-token' as string | null,
  refresh: vi.fn(),
}));
vi.mock('../api/access-token.provider', () => ({
  getAccessToken: () => mocks.token,
}));
vi.mock('../api/request', () => ({ refreshAccessToken: mocks.refresh }));

async function fixture() {
  vi.resetModules();
  mocks.token = 'old-token';
  mocks.refresh.mockReset().mockImplementation(async () => {
    mocks.token = 'new-token';
    return mocks.token;
  });
  const request = vi.fn();
  Object.defineProperty(window, 'localPos', {
    configurable: true,
    value: { request, onChange: vi.fn() },
  });
  const api = await import('./local-pos');
  return { ...api, request, profile: profileFixture() };
}
afterEach(() => {
  Object.defineProperty(window, 'localPos', {
    configurable: true,
    value: undefined,
  });
});

describe('local cashier session authorization', () => {
  it.each(['connect', 'restore'] as const)(
    'does not reinstall a late %s profile after disconnect with the same token',
    async (kind) => {
      const f = await fixture();
      let respond!: (value: unknown) => void;
      f.request.mockImplementation((request) =>
        request.type === 'disconnect'
          ? Promise.resolve({ ok: true, value: null })
          : new Promise((resolve) => {
              respond = resolve;
            }),
      );
      const pending =
        kind === 'connect'
          ? f.connectLocalPos(f.profile.session.register_id)
          : f.restoreLocalPos(new QueryClient());
      const rejected = expect(pending).rejects.toMatchObject({
        code: 'LOCAL_CONTEXT_CHANGED',
      });
      await f.disconnectLocalPos();
      respond({ ok: true, value: f.profile });
      await rejected;
      expect(f.localPosProfile()).toBeNull();
      expect(f.request).toHaveBeenCalledWith({ type: 'disconnect' });
    },
  );
  it('publishes a stable profile snapshot after connect, restore and disconnect', async () => {
    const {
      subscribeLocalPosProfile,
      localPosProfile,
      connectLocalPos,
      restoreLocalPos,
      disconnectLocalPos,
      request,
      profile,
    } = await fixture();
    const changed = vi.fn();
    const unsubscribe = subscribeLocalPosProfile(changed);
    expect(localPosProfile()).toBeNull();
    request.mockResolvedValue({ ok: true, value: profile });
    await connectLocalPos(profile.session.register_id);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(localPosProfile()).toBe(profile);
    expect(localPosProfile()).toBe(localPosProfile());
    await connectLocalPos(profile.session.register_id);
    expect(changed).toHaveBeenCalledTimes(1);
    await restoreLocalPos(new QueryClient());
    expect(changed).toHaveBeenCalledTimes(2);
    await disconnectLocalPos();
    expect(localPosProfile()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    await connectLocalPos(profile.session.register_id);
    expect(changed).toHaveBeenCalledTimes(3);
  });
  it('refreshes an expired token once and verifies the active session again', async () => {
    const { connectLocalPos, request, profile } = await fixture();
    request
      .mockResolvedValueOnce({
        ok: false,
        code: 'INVALID_TOKEN',
        message: 'Expired',
      })
      .mockResolvedValueOnce({ ok: true, value: profile });
    await expect(connectLocalPos(profile.session.register_id)).resolves.toEqual(
      profile,
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith({
      type: 'connect',
      registerId: profile.session.register_id,
      accessToken: 'new-token',
      forceOnline: true,
    });
  });
  it('shares a single initialization between simultaneous session readers', async () => {
    const { connectLocalPos, request, profile } = await fixture();
    request.mockResolvedValue({ ok: true, value: profile });
    await Promise.all([
      connectLocalPos(profile.session.register_id),
      connectLocalPos(profile.session.register_id),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('passes explicit online verification through the IPC cache', async () => {
    const { connectLocalPos, request, profile } = await fixture();
    request.mockResolvedValue({ ok: true, value: profile });
    await connectLocalPos(profile.session.register_id);
    await connectLocalPos(profile.session.register_id, true);
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({ forceOnline: true }),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    'INSUFFICIENT_PERMISSIONS',
    'CASHIER_SESSION_NOT_ACTIVE',
    'LOCAL_SESSION_UNAVAILABLE',
  ])('does not refresh or fabricate access after %s', async (code) => {
    const { connectLocalPos, localPosProfile, request, profile } =
      await fixture();
    request.mockResolvedValue({ ok: false, code, message: 'Denied' });
    await expect(
      connectLocalPos(profile.session.register_id),
    ).rejects.toMatchObject({ code });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(localPosProfile()).toBeNull();
  });
  it('does not loop when the renewed token is still rejected', async () => {
    const { connectLocalPos, request, profile } = await fixture();
    request.mockResolvedValue({
      ok: false,
      code: 'INVALID_TOKEN',
      message: 'Denied',
    });
    await expect(
      connectLocalPos(profile.session.register_id),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not install a stale profile after logout during verification', async () => {
    const { connectLocalPos, localPosProfile, request, profile } =
      await fixture();
    request.mockImplementation(async () => {
      mocks.token = null;
      return { ok: true, value: profile };
    });
    await expect(
      connectLocalPos(profile.session.register_id),
    ).rejects.toMatchObject({ code: 'LOCAL_CONTEXT_CHANGED' });
    expect(localPosProfile()).toBeNull();
  });
});
