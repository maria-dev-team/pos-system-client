import axios, {
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

const user = {
  created_at: '2026-08-23T00:00:00.000Z',
  email: 'cashier@maria.kz',
  first_name: 'Maria',
  id: 'user-1',
  is_onboarded: true,
  last_name: 'Cashier',
  phone: '+77771234567',
};
const organization = {
  address: 'Almaty',
  bin_iin: '123456789012',
  created_at: '2026-08-23T00:00:00.000Z',
  default_currency: 'KZT',
  deleted_at: null,
  id: 'organization-1',
  language: 'ru',
  legal_form: 'TOO',
  legal_name: 'Maria LLP',
  name: 'Maria',
  timezone: 'Asia/Almaty',
  trade_name: 'Maria',
  updated_at: '2026-08-23T00:00:00.000Z',
};
const membership = {
  membership_id: 'membership-1',
  organization,
  position: null,
  status: 'ACTIVE' as const,
};
const context = {
  isSystemPosition: false,
  organizationId: 'organization-1',
  permissions: ['register.read'],
  position: 'Кассир',
  storeId: 'store-1',
  storeScope: {
    canAccessAll: false,
    primaryStoreId: 'store-1',
    storeIds: ['store-1'],
    stores: [{ address: 'Almaty', id: 'store-1', name: 'Main' }],
  },
  userOrganizationId: 'membership-1',
};
const register = {
  code: 'POS-01',
  created_at: '2026-08-23T00:00:00.000Z',
  id: 'register-1',
  name: 'Основная касса',
  organization_id: 'organization-1',
  status: 'ACTIVE' as const,
  store_id: 'store-1',
  updated_at: '2026-08-23T00:00:00.000Z',
};

afterEach(() => vi.unstubAllEnvs());

describe('API endpoints', () => {
  it('uses the backend auth/context/register contracts and unwraps response data', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    axios.defaults.adapter = async (config): Promise<AxiosResponse> => {
      calls.push(config);
      const dataByUrl: Record<string, unknown> = {
        '/v1/auth/context': { data: { context } },
        '/v1/auth/login': {
          data: {
            auth: { access_token: 'access-token' },
            organizations: [membership],
            user,
          },
        },
        '/v1/auth/select-context': {
          data: { auth: { access_token: 'context-token' } },
        },
        '/v1/organizations': { data: { organizations: [membership] } },
        '/v1/registers': { data: { registers: [register] } },
        '/v1/users/me': { data: { user } },
      };
      return {
        config,
        data: dataByUrl[config.url!],
        headers: {},
        status: 200,
        statusText: 'OK',
      };
    };
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost:4004');
    const {
      getActiveRegisters,
      getAuthContext,
      getCurrentUser,
      getMyOrganizations,
      login,
      selectContext,
    } = await import('./requests');

    await expect(
      login({ login: 'cashier@maria.kz', password: 'pass word' }),
    ).resolves.toEqual({
      auth: { access_token: 'access-token' },
      organizations: [membership],
      user,
    });
    await expect(selectContext('membership-1', 'store-1')).resolves.toEqual({
      access_token: 'context-token',
    });
    await expect(getCurrentUser()).resolves.toEqual(user);
    await expect(getMyOrganizations()).resolves.toEqual([membership]);
    await expect(getAuthContext()).resolves.toEqual(context);
    await expect(getActiveRegisters()).resolves.toEqual([register]);

    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ['post', '/v1/auth/login'],
      ['post', '/v1/auth/select-context'],
      ['get', '/v1/users/me'],
      ['get', '/v1/organizations'],
      ['get', '/v1/auth/context'],
      ['get', '/v1/registers'],
    ]);

    const selectContextCall = calls.at(1);
    const registersCall = calls.at(5);
    if (!selectContextCall || !registersCall) {
      throw new Error('Expected select-context and registers requests');
    }

    expect(JSON.parse(selectContextCall.data as string)).toEqual({
      store_id: 'store-1',
      user_organization_id: 'membership-1',
    });
    expect(registersCall.params).toEqual({ status: 'ACTIVE' });
  });
});
