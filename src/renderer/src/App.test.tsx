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
  closeRegisterShift: vi.fn(),
  getActiveRegisters: vi.fn(),
  getApiHealth: vi.fn(),
  getAuthContext: vi.fn(),
  getCurrentRegisterShift: vi.fn(),
  getCurrentUser: vi.fn(),
  getMyOrganizations: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  openRegisterShift: vi.fn(),
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
  permissions: ['register.read', 'register_shift.close', 'register_shift.open'],
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
const registerShiftResponse = {
  actual_cash: null,
  closed_at: null,
  closed_by_membership_id: null,
  created_at: '2026-08-24T08:00:00.000Z',
  deleted_at: null,
  difference: null,
  expected_cash: null,
  id: 'register-shift-1',
  opened_at: '2026-08-24T08:00:00.000Z',
  opened_by_membership_id: 'membership-1',
  opening_cash: '10000.00',
  organization_id: 'organization-1',
  register_id: 'register-1',
  status: 'OPEN' as const,
  store_id: 'store-1',
  updated_at: '2026-08-24T08:00:00.000Z',
};
const closedRegisterShiftResponse = {
  ...registerShiftResponse,
  actual_cash: '9800.00',
  closed_at: '2026-08-24T10:00:00.000Z',
  closed_by_membership_id: 'membership-1',
  difference: '-200.00',
  expected_cash: '10000.00',
  status: 'CLOSED' as const,
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
  api.getApiHealth.mockResolvedValue({ status: 'ok' });
  api.getCurrentRegisterShift.mockResolvedValue(registerShiftResponse);
  api.closeRegisterShift.mockResolvedValue(closedRegisterShiftResponse);
  api.logout.mockResolvedValue(undefined);
  api.openRegisterShift.mockResolvedValue(registerShiftResponse);
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
    expect(screen.getByText('Maria POS')).toBeInTheDocument();
    expect(await screen.findByText('Сервер доступен')).toBeInTheDocument();
    expect(screen.getByLabelText('Текущее время')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Выйти' }),
    ).not.toBeInTheDocument();
  });

  it('requires explicit organization, store and register shift selection before debug', async () => {
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
      await screen.findByRole('heading', { name: 'Выберите кассовую смену' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Данные авторизации' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Выбрать смену кассы Основная касса',
      }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Данные авторизации' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/register-shift-1/)).toBeInTheDocument();
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

  it('restores a complete backend context without auto-selecting one shift', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Выберите кассовую смену' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Выберите организацию' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Maria Cashier')).toBeInTheDocument();
    expect(screen.getByText('Кассир')).toBeInTheDocument();
    expect(screen.getByText('Maria · Main store')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Выйти' })).toHaveLength(1);
  });

  it('shows register shift reconciliation before returning to shift selection', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    const { queryClient, router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Выбрать смену кассы Основная касса',
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Закрыть кассовую смену' }),
    );
    await user.click(screen.getByRole('button', { name: '9' }));
    await user.click(screen.getByRole('button', { name: '8' }));
    await user.click(screen.getByRole('button', { name: '00' }));
    expect(screen.getByLabelText('Фактические наличные, ₸')).toHaveValue(
      '9800',
    );
    await user.click(screen.getByRole('button', { name: /^Закрыть смену$/ }));

    expect(
      await screen.findByRole('heading', { name: 'Смена закрыта' }),
    ).toBeInTheDocument();
    expect(screen.getByText('10 000,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('9 800,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('-200,00 ₸')).toBeInTheDocument();
    const reconciliation = screen.getByRole('status', {
      name: 'Результат сверки',
    });
    await waitFor(() => expect(reconciliation).toHaveFocus());
    expect(router.state.location.pathname).toBe('/debug');
    expect(
      queryClient.getQueryData(['register-shifts', 'current', 'register-1']),
    ).toBeNull();

    await user.keyboard('{Escape}');
    expect(
      screen.getByRole('heading', { name: 'Смена закрыта' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/debug');

    await user.click(screen.getByRole('button', { name: 'К списку смен' }));
    expect(
      await screen.findByRole('heading', { name: 'Выберите кассовую смену' }),
    ).toBeInTheDocument();
  });

  it('keeps the counted cash when closing the register shift fails', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.closeRegisterShift.mockRejectedValue(new Error('API unavailable'));
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Выбрать смену кассы Основная касса',
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Закрыть кассовую смену' }),
    );
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '00' }));
    await user.click(screen.getByRole('button', { name: /^Закрыть смену$/ }));

    expect(
      await screen.findByText('Не удалось закрыть кассовую смену.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Фактические наличные, ₸')).toHaveValue('100');
    expect(
      screen.getByRole('heading', { name: 'Закрыть кассовую смену' }),
    ).toBeInTheDocument();
  });

  it('does not expose register shift closing without permission', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: ['register.read'],
    });
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Выбрать смену кассы Основная касса',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Данные авторизации' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Закрыть кассовую смену' }),
    ).not.toBeInTheDocument();
  });

  it('exposes register shift closing with close-others permission', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: ['register.read', 'register_shift.close_others'],
    });
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Выбрать смену кассы Основная касса',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Закрыть кассовую смену' }),
    ).toBeInTheDocument();
  });

  it('shows backend connection loss without a blocking page error', async () => {
    api.getApiHealth.mockRejectedValue(new Error('API unavailable'));
    renderApp();

    expect(await screen.findByText('Нет связи с сервером')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Вход в Maria POS' }),
    ).toBeInTheDocument();
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

  it('shows a retryable register permission error', async () => {
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
    await screen.findByRole('heading', { name: 'Выберите кассовую смену' });

    await user.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(
      await screen.findByRole('heading', { name: 'Вход в Maria POS' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0),
    );
  });

  it('opens a register shift with validated opening cash and selects it', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentRegisterShift.mockResolvedValue(null);
    renderApp();

    await screen.findByRole('heading', { name: 'Выберите кассовую смену' });
    await user.click(
      screen.getByRole('button', {
        name: 'Открыть смену кассы Основная касса',
      }),
    );

    const openingCash = screen.getByLabelText('Наличные в кассе на начало, ₸');
    await user.type(openingCash, '100.999');
    await user.click(screen.getByRole('button', { name: 'Открыть и выбрать' }));
    expect(
      await screen.findByText('Введите сумму с точностью не более двух знаков'),
    ).toBeInTheDocument();
    expect(api.openRegisterShift).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Очистить' }));
    for (const key of ['1', '2', '5', '0', '0']) {
      await user.click(screen.getByRole('button', { name: key }));
    }
    await user.click(screen.getByRole('button', { name: 'Десятичная точка' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: '0' }));
    expect(openingCash).toHaveValue('12500.50');
    await user.click(screen.getByRole('button', { name: 'Открыть и выбрать' }));

    await waitFor(() => expect(api.openRegisterShift).toHaveBeenCalled());
    expect(api.openRegisterShift.mock.calls[0]?.[0]).toEqual({
      openingCash: '12500.50',
      registerId: 'register-1',
    });
    expect(
      await screen.findByRole('heading', { name: 'Данные авторизации' }),
    ).toBeInTheDocument();
  });

  it('shows an empty state when the store has no active registers', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getActiveRegisters.mockResolvedValue([]);
    renderApp();

    expect(await screen.findByText('Нет активных касс')).toBeInTheDocument();
  });
});
