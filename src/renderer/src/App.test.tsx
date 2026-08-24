import { QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@renderer/common/components/ui/tooltip';
import { createQueryClient } from '@renderer/common/lib/query-client';
import { createAppRouter } from '@renderer/common/router';
import { useAuthStore } from '@renderer/features/auth';

import App from './App';

const api = vi.hoisted(() => ({
  getActiveRegisters: vi.fn(),
  getAuthContext: vi.fn(),
  getCurrentUser: vi.fn(),
  getMyOrganizations: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  refreshTokens: vi.fn(),
  selectContext: vi.fn(),
}));

vi.mock('@renderer/common/api', () => api);

const userResponse = {
  created_at: '2026-08-23T00:00:00.000Z',
  email: 'cashier@maria.kz',
  first_name: 'Maria',
  id: 'user-1',
  is_onboarded: true,
  last_name: 'Cashier',
  phone: '+77771234567',
};
const organizationResponse = {
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
const membershipResponse = {
  membership_id: 'membership-1',
  organization: organizationResponse,
  position: null,
  status: 'ACTIVE' as const,
};
const contextResponse = {
  isSystemPosition: false,
  organizationId: 'organization-1',
  permissions: ['register.read'],
  position: 'Кассир',
  storeId: 'store-1',
  storeScope: {
    canAccessAll: false,
    primaryStoreId: 'store-1',
    storeIds: ['store-1'],
    stores: [{ address: 'Almaty', id: 'store-1', name: 'Main store' }],
  },
  userOrganizationId: 'membership-1',
};
const registerResponse = {
  code: 'POS-01',
  created_at: '2026-08-23T00:00:00.000Z',
  id: 'register-1',
  name: 'Основная касса',
  organization_id: 'organization-1',
  status: 'ACTIVE' as const,
  store_id: 'store-1',
  updated_at: '2026-08-23T00:00:00.000Z',
};

const renderApp = () => {
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient);
  render(
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <App router={router} />
        <Toaster />
      </QueryClientProvider>
    </TooltipProvider>,
  );
  return { queryClient, router };
};

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  useAuthStore.setState({
    accessToken: null,
    isInitialized: false,
    isInitializing: false,
    isLoggingOut: false,
  });
  api.refreshTokens.mockRejectedValue(new Error('No refresh session'));
  api.getCurrentUser.mockResolvedValue(userResponse);
  api.getMyOrganizations.mockResolvedValue([membershipResponse]);
  api.getAuthContext.mockResolvedValue(contextResponse);
  api.getActiveRegisters.mockResolvedValue([registerResponse]);
  api.logout.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Maria POS authorization flow', () => {
  it('routes a guest to login and accepts email or phone', async () => {
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Вход в Maria POS' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email или телефон')).toHaveAttribute(
      'type',
      'text',
    );
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password');
  });

  it('requires explicit organization and store selection before debug', async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({
      auth: { access_token: 'login-token' },
      organizations: [membershipResponse],
      user: userResponse,
    });
    api.selectContext
      .mockResolvedValueOnce({ access_token: 'organization-token' })
      .mockResolvedValueOnce({ access_token: 'store-token' });
    renderApp();

    await user.type(
      await screen.findByLabelText('Email или телефон'),
      'cashier@maria.kz',
    );
    await user.type(screen.getByLabelText('Пароль'), 'pass word{Enter}');

    expect(
      await screen.findByRole('heading', { name: 'Выберите организацию' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Maria/ }));

    expect(
      await screen.findByRole('heading', { name: 'Выберите магазин' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Main store/ }));

    expect(
      await screen.findByRole('heading', { name: 'Данные авторизации' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cashier@maria.kz/)).toBeInTheDocument();
    expect(screen.getByText(/register.read/)).toBeInTheDocument();
    expect(screen.getByText(/Основная касса/)).toBeInTheDocument();
    expect(api.selectContext).toHaveBeenNthCalledWith(1, 'membership-1');
    expect(api.selectContext).toHaveBeenNthCalledWith(
      2,
      'membership-1',
      'store-1',
    );
  });

  it('restores a complete backend context directly into debug', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Данные авторизации' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Выберите организацию' }),
    ).not.toBeInTheDocument();
  });

  it('routes a restored organization without a store to store selection', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({ ...contextResponse, storeId: null });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Выберите магазин' }),
    ).toBeInTheDocument();
  });

  it('returns to login when bootstrap discovers an expired server session', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentUser.mockImplementation(async () => {
      useAuthStore.getState().clearAccessToken();
      throw new Error('Expired session');
    });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Вход в Maria POS' }),
    ).toBeInTheDocument();
  });

  it('returns a restored session with revoked context to organization selection', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      organizationId: undefined,
      storeId: null,
      storeScope: {
        canAccessAll: false,
        primaryStoreId: null,
        storeIds: [],
        stores: [],
      },
      userOrganizationId: undefined,
    });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Выберите организацию' }),
    ).toBeInTheDocument();
  });

  it('shows an empty store state for a membership without assigned stores', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      storeId: null,
      storeScope: {
        canAccessAll: false,
        primaryStoreId: null,
        storeIds: [],
        stores: [],
      },
    });
    renderApp();

    expect(
      await screen.findByText('Нет доступных магазинов'),
    ).toBeInTheDocument();
  });

  it('shows an empty organization state without auto-selecting anything', async () => {
    const user = userEvent.setup();
    api.login.mockResolvedValue({
      auth: { access_token: 'login-token' },
      organizations: [],
      user: userResponse,
    });
    renderApp();

    await user.type(
      await screen.findByLabelText('Email или телефон'),
      '+7 777 123 45 67',
    );
    await user.type(screen.getByLabelText('Пароль'), 'pass word{Enter}');

    expect(
      await screen.findByText('Нет доступных организаций'),
    ).toBeInTheDocument();
  });

  it('keeps debug data visible and shows a human-readable register permission error', async () => {
    const forbiddenResponse = {
      data: { error_code: 'INSUFFICIENT_PERMISSIONS' },
      headers: {},
      status: 403,
      statusText: 'Forbidden',
    } as AxiosResponse;
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getActiveRegisters.mockRejectedValue(
      new AxiosError(
        'Forbidden',
        undefined,
        undefined,
        undefined,
        forbiddenResponse,
      ),
    );
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Данные авторизации' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cashier@maria.kz/)).toBeInTheDocument();
    expect(
      await screen.findByText('У вас недостаточно прав для этого действия.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Основная касса/)).not.toBeInTheDocument();
  });

  it('toggles password visibility without losing its value', async () => {
    const user = userEvent.setup();
    renderApp();
    const password = await screen.findByLabelText('Пароль');

    await user.type(password, 'pass word');
    await user.click(screen.getByRole('button', { name: 'Показать пароль' }));

    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('pass word');
  });

  it('returns to login after a successful logout', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    const { queryClient } = renderApp();
    await screen.findByRole('heading', { name: 'Данные авторизации' });

    await user.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(
      await screen.findByRole('heading', { name: 'Вход в Maria POS' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0),
    );
  });
});
