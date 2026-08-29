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
  addSaleItem: vi.fn(),
  cancelSale: vi.fn(),
  checkoutSale: vi.fn(),
  closeRegisterShift: vi.fn(),
  createReceiptReturn: vi.fn(),
  createSale: vi.fn(),
  createWithoutReceiptReturn: vi.fn(),
  endCashierSession: vi.fn(),
  getActiveRegisters: vi.fn(),
  getApiHealth: vi.fn(),
  getAuthContext: vi.fn(),
  getCurrentRegisterShift: vi.fn(),
  getCurrentCashierSession: vi.fn(),
  getCurrentSale: vi.fn(),
  getCurrentUser: vi.fn(),
  getHeldSales: vi.fn(),
  getSale: vi.fn(),
  holdSale: vi.fn(),
  getMyOrganizations: vi.fn(),
  getProduct: vi.fn(),
  getReceipt: vi.fn(),
  getReceipts: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  openRegisterShift: vi.fn(),
  overrideSaleItemPrice: vi.fn(),
  refreshTokens: vi.fn(),
  removeSaleItem: vi.fn(),
  resetSaleItemPrice: vi.fn(),
  resumeSale: vi.fn(),
  scanSaleItem: vi.fn(),
  searchProducts: vi.fn(),
  selectContext: vi.fn(),
  setSaleItemQuantity: vi.fn(),
  startCashierSession: vi.fn(),
  triggerAntiFraudEvent: vi.fn(),
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
  permissions: [
    'pos.login',
    'product.read',
    'register.read',
    'register_shift.close',
    'register_shift.open',
    'sales.cancel',
    'sales.create',
    'sales.modify',
    'sales.price.override',
  ],
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
const cashierSessionResponse = {
  actual_cash: null,
  created_at: '2026-08-24T08:05:00.000Z',
  difference: null,
  end_reason: null,
  ended_at: null,
  expected_cash: null,
  id: 'cashier-session-1',
  locked_at: null,
  membership_id: 'membership-1',
  opening_cash: '5000.00',
  organization_id: 'organization-1',
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  started_at: '2026-08-24T08:05:00.000Z',
  status: 'ACTIVE' as const,
  store_id: 'store-1',
  updated_at: '2026-08-24T08:05:00.000Z',
};
const endedCashierSessionResponse = {
  ...cashierSessionResponse,
  actual_cash: '4900.00',
  difference: '-100.00',
  end_reason: 'LOGOUT' as const,
  ended_at: '2026-08-24T10:00:00.000Z',
  expected_cash: '5000.00',
  status: 'ENDED' as const,
};
const productResponse = {
  barcode: '4870000000012',
  category_id: 'category-1',
  created_at: '2026-08-24T09:00:00.000Z',
  deleted_at: null,
  id: 'product-1',
  is_active: true,
  name: 'Молоко',
  organization_id: 'organization-1',
  retail_price: '650.00',
  sku: 'MILK-1',
  unit: 'pcs' as const,
  updated_at: '2026-08-24T09:00:00.000Z',
};
const productSearchResponse = {
  meta: { has_more: false, limit: 20, offset: 0, total: 1 },
  products: [productResponse],
};

const responseError = (errorCode: string, data?: Record<string, unknown>) =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    data: { error_code: errorCode, ...data },
    headers: {},
    status: 409,
    statusText: 'Conflict',
  } as AxiosResponse);

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
  api.getCurrentCashierSession.mockResolvedValue(cashierSessionResponse);
  api.getCurrentSale.mockResolvedValue(null);
  api.getReceipts.mockResolvedValue({
    meta: { has_more: false, limit: 20, offset: 0, total: 0 },
    receipts: [],
  });
  api.closeRegisterShift.mockResolvedValue(closedRegisterShiftResponse);
  api.endCashierSession.mockResolvedValue(endedCashierSessionResponse);
  api.logout.mockResolvedValue(undefined);
  api.openRegisterShift.mockResolvedValue(registerShiftResponse);
  api.searchProducts.mockResolvedValue(productSearchResponse);
  api.startCashierSession.mockResolvedValue(cashierSessionResponse);
  api.triggerAntiFraudEvent.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('Maria POS authorization flow', () => {
  it('navigates checkout to returns and back within the active session', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: [
        ...contextResponse.permissions,
        'returns.create',
        'sales.read',
      ],
    });
    const { router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    await screen.findByRole('heading', { name: 'Оформление продажи' });
    await user.click(screen.getByRole('button', { name: 'Возвраты' }));

    expect(
      await screen.findByRole('heading', { name: 'Возвраты' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/returns');
    expect(router.state.location.search).toEqual({
      registerId: 'register-1',
      registerShiftId: 'register-shift-1',
    });

    await user.click(
      screen.getByRole('button', { name: 'Вернуться к продажам' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Оформление продажи' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/checkout');
    expect(router.state.location.search).toEqual({
      registerId: 'register-1',
      registerShiftId: 'register-shift-1',
    });
    expect(api.getCurrentSale).toHaveBeenCalled();
  });

  it('shows the returns access state on a direct active-session route', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: ['returns.create'],
    });
    const { router } = renderApp();
    await screen.findByRole('heading', { name: 'Выберите кассу' });

    await router.navigate({
      search: {
        registerId: 'register-1',
        registerShiftId: 'register-shift-1',
      },
      to: '/returns',
    });

    expect(
      await screen.findByRole('heading', { name: 'Нет доступа к возвратам' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/returns');
  });

  it('does not open returns for a locked cashier session', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession.mockResolvedValue({
      ...cashierSessionResponse,
      locked_at: '2026-08-27T09:00:00.000Z',
      status: 'LOCKED',
    });
    const { router } = renderApp();
    await screen.findByRole('heading', { name: 'Выберите кассу' });

    await router.navigate({
      search: {
        registerId: 'register-1',
        registerShiftId: 'register-shift-1',
      },
      to: '/returns',
    });

    expect(
      await screen.findByRole('heading', {
        name: 'Смена кассира заблокирована',
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).not.toBe('/returns');
  });

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

  it('requires explicit organization, store and register shift selection before checkout', async () => {
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
      await screen.findByRole('heading', { name: 'Выберите кассу' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Оформление продажи' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Оформление продажи' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Сканируйте или найдите товар')).toHaveFocus();
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
      await screen.findByRole('heading', { name: 'Выберите кассу' }),
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
      await screen.findByRole('button', { name: 'Закрыть кассу' }),
    );
    await user.click(screen.getByRole('button', { name: '9' }));
    await user.click(screen.getByRole('button', { name: '8' }));
    await user.click(screen.getByRole('button', { name: '00' }));
    expect(screen.getByLabelText('Фактические наличные, ₸')).toHaveValue(
      '9800',
    );
    await user.click(screen.getByRole('button', { name: /^Закрыть кассу$/ }));

    expect(
      await screen.findByRole('heading', { name: 'Касса закрыта' }),
    ).toBeInTheDocument();
    expect(screen.getByText('10 000,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('9 800,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('-200,00 ₸')).toBeInTheDocument();
    const reconciliation = screen.getByRole('status', {
      name: 'Результат сверки',
    });
    await waitFor(() => expect(reconciliation).toHaveFocus());
    expect(router.state.location.pathname).toBe('/select-register-shift');
    expect(
      queryClient.getQueryData(['register-shifts', 'current', 'register-1']),
    ).toEqual(registerShiftResponse);

    await user.keyboard('{Escape}');
    expect(
      screen.getByRole('heading', { name: 'Касса закрыта' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/select-register-shift');

    await user.click(screen.getByRole('button', { name: 'К списку касс' }));
    expect(
      await screen.findByRole('heading', { name: 'Выберите кассу' }),
    ).toBeInTheDocument();
    expect(
      queryClient.getQueryData(['register-shifts', 'current', 'register-1']),
    ).toBeNull();
  });

  it('keeps the counted cash when closing the register shift fails', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.closeRegisterShift.mockRejectedValue(new Error('API unavailable'));
    renderApp();

    await user.click(
      await screen.findByRole('button', { name: 'Закрыть кассу' }),
    );
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '00' }));
    await user.click(screen.getByRole('button', { name: /^Закрыть кассу$/ }));

    expect(
      await screen.findByText('Не удалось закрыть кассу.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Фактические наличные, ₸')).toHaveValue('100');
    expect(
      screen.getByRole('heading', { name: 'Закрыть кассу' }),
    ).toBeInTheDocument();
  });

  it('does not expose register shift closing without permission', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: ['register.read'],
    });
    renderApp();

    expect(
      await screen.findByRole('heading', { name: 'Выберите кассу' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Закрыть кассу' }),
    ).not.toBeInTheDocument();
  });

  it('exposes register shift closing with close-others permission', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: ['register.read', 'register_shift.close_others'],
    });
    api.getCurrentRegisterShift.mockResolvedValue({
      ...registerShiftResponse,
      opened_by_membership_id: 'membership-2',
    });
    renderApp();

    expect(
      await screen.findByRole('button', { name: 'Закрыть кассу' }),
    ).toBeInTheDocument();
  });

  it('exposes register shift closing to a system position', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      isSystemPosition: true,
      permissions: ['register.read'],
    });
    api.getCurrentRegisterShift.mockResolvedValue({
      ...registerShiftResponse,
      opened_by_membership_id: 'membership-2',
    });
    renderApp();

    expect(
      await screen.findByRole('button', { name: 'Закрыть кассу' }),
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

  it('keeps the password toggle centered while pressed', async () => {
    renderApp();

    const toggle = await screen.findByRole('button', {
      name: 'Показать пароль',
    });

    expect(toggle).toHaveClass('inset-y-0', 'my-auto', 'active:translate-y-0');
    expect(toggle).not.toHaveClass('top-1/2', '-translate-y-1/2');
  });

  it('returns to login after a successful logout', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    const { queryClient } = renderApp();
    await screen.findByRole('heading', { name: 'Выберите кассу' });

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

    await screen.findByRole('heading', { name: 'Выберите кассу' });
    await user.click(
      screen.getByRole('button', {
        name: 'Открыть кассу Основная касса',
      }),
    );

    const openingCash = screen.getByLabelText('Наличные в кассе, ₸');
    await user.type(openingCash, '100.999');
    await user.click(screen.getByRole('button', { name: 'Открыть и начать' }));
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
    await user.click(screen.getByRole('button', { name: 'Открыть и начать' }));

    await waitFor(() => expect(api.openRegisterShift).toHaveBeenCalled());
    expect(api.openRegisterShift.mock.calls[0]?.[0]).toEqual({
      openingCash: '12500.50',
      registerId: 'register-1',
    });
    expect(
      await screen.findByRole('heading', { name: 'Оформление продажи' }),
    ).toBeInTheDocument();
  });

  it('opens an independent cashier session before entering checkout', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession.mockResolvedValue(null);
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Начало работы' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Наличные у кассира, ₸')).toHaveValue('');
    expect(screen.getByLabelText('Цифровая клавиатура')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '5' }));
    for (let index = 0; index < 3; index += 1) {
      await user.click(screen.getByRole('button', { name: '0' }));
    }
    await user.click(
      screen.getByRole('button', { name: 'Перейти к продажам' }),
    );

    await waitFor(() =>
      expect(api.startCashierSession).toHaveBeenCalledWith('register-shift-1', {
        openingCash: '5000',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Оформление продажи' }),
    ).toBeInTheDocument();
    expect(api.getCurrentSale).toHaveBeenCalledOnce();
    expect(api.createSale).not.toHaveBeenCalled();
  });

  it('restores a locked cashier session without opening it again', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession.mockResolvedValue({
      ...cashierSessionResponse,
      locked_at: '2026-08-24T09:00:00.000Z',
      status: 'LOCKED',
    });
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Смена кассира заблокирована',
      }),
    ).toBeInTheDocument();
    expect(api.startCashierSession).not.toHaveBeenCalled();
    expect(api.createSale).not.toHaveBeenCalled();
  });

  it('returns a locked checkout to the cashier gate when retry finds no session', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession
      .mockResolvedValueOnce({
        ...cashierSessionResponse,
        locked_at: '2026-08-24T09:00:00.000Z',
        status: 'LOCKED',
      })
      .mockResolvedValueOnce(null);
    const { router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('heading', { name: 'Начало работы' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cashier-session');
    expect(router.state.location.search).toEqual({
      registerId: 'register-1',
      registerShiftId: 'register-shift-1',
    });
  });

  it('shows a recoverable checkout session error and retries it', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession
      .mockResolvedValueOnce({
        ...cashierSessionResponse,
        locked_at: '2026-08-24T09:00:00.000Z',
        status: 'LOCKED',
      })
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValueOnce(cashierSessionResponse);
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Смена кассира заблокирована',
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Не удалось проверить доступ к кассе',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Не удалось проверить доступ к кассе.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('heading', { name: 'Оформление продажи' }),
    ).toBeInTheDocument();
  });

  it('rejects mismatched register shift context at the cashier gate', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession.mockResolvedValue({
      ...cashierSessionResponse,
      register_shift_id: 'another-shift',
    });
    const { router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/select-register-shift'),
    );
    expect(
      screen.getByRole('heading', { name: 'Выберите кассу' }),
    ).toBeInTheDocument();
  });

  it('does not offer cashier session opening without pos.login', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getAuthContext.mockResolvedValue({
      ...contextResponse,
      permissions: ['register.read', 'register_shift.close'],
    });
    api.getCurrentCashierSession.mockResolvedValue(null);
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );

    expect(
      await screen.findByText('Нет права работать на кассе'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Перейти к продажам' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      'CASHIER_SESSION_REGISTER_OCCUPIED',
      'На этой кассе уже работает другой кассир.',
    ],
    [
      'CASHIER_SESSION_MEMBERSHIP_OCCUPIED',
      'У вас уже открыта смена кассира на другой кассе.',
    ],
  ])('keeps opening cash on %s', async (errorCode, message) => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession.mockResolvedValue(null);
    api.startCashierSession.mockRejectedValue(responseError(errorCode));
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    const input = await screen.findByLabelText('Наличные у кассира, ₸');
    await user.type(input, '5000');
    await user.click(
      screen.getByRole('button', { name: 'Перейти к продажам' }),
    );

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(input).toHaveValue('5000');
  });

  it('ends a cashier session with reconciliation and keeps the register shift open', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    const { queryClient, router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Завершить работу на кассе' }),
    );
    await user.type(screen.getByLabelText('Наличные у кассира, ₸'), '4900');
    await user.click(
      screen.getByRole('button', { name: /^Завершить работу$/ }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Работа завершена' }),
    ).toBeInTheDocument();
    expect(screen.getByText('5 000,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('4 900,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('-100,00 ₸')).toBeInTheDocument();
    expect(api.endCashierSession).toHaveBeenCalledWith('cashier-session-1', {
      actualCash: '4900',
    });
    expect(
      queryClient.getQueryData(['cashier-sessions', 'current', 'register-1']),
    ).toEqual(endedCashierSessionResponse);
    expect(
      queryClient.getQueryData(['register-shifts', 'current', 'register-1']),
    ).toEqual(registerShiftResponse);
    expect(router.state.location.pathname).toBe('/checkout');

    await user.click(screen.getByRole('button', { name: 'К выбору кассы' }));
    expect(
      await screen.findByRole('heading', { name: 'Выберите кассу' }),
    ).toBeInTheDocument();
    expect(
      queryClient.getQueryData(['cashier-sessions', 'current', 'register-1']),
    ).toBeNull();
  });

  it('keeps actual cash and shows blocking sales inline', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getCurrentCashierSession.mockResolvedValue({
      ...cashierSessionResponse,
      locked_at: '2026-08-24T09:00:00.000Z',
      status: 'LOCKED',
    });
    api.endCashierSession.mockRejectedValue(
      responseError('CASHIER_SESSION_HAS_OPEN_SALES', {
        sales: [
          {
            created_at: '2026-08-24T09:30:00.000Z',
            held_at: null,
            id: 'sale-1',
            items_count: 2,
            status: 'DRAFT',
            total: '1500.00',
          },
        ],
      }),
    );
    renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Завершить работу на кассе' }),
    );
    const input = screen.getByLabelText('Наличные у кассира, ₸');
    await user.type(input, '4900');
    await user.click(
      screen.getByRole('button', { name: /^Завершить работу$/ }),
    );

    expect(
      await screen.findByText('Сначала завершите открытые продажи'),
    ).toBeInTheDocument();
    expect(screen.getByText(/sale-1/)).toBeInTheDocument();
    expect(screen.getByText(/DRAFT/)).toBeInTheDocument();
    expect(screen.getByText(/2 позиции/)).toBeInTheDocument();
    expect(input).toHaveValue('4900');
  });

  it('keeps the active session when backend blocks logout', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.logout.mockRejectedValue(
      responseError('CASHIER_SESSION_MUST_BE_ENDED'),
    );
    const { router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Выйти' }));

    expect(
      await screen.findAllByText('Сначала завершите текущую кассовую сессию.'),
    ).not.toHaveLength(0);
    expect(router.state.location.pathname).toBe('/checkout');
    expect(useAuthStore.getState().accessToken).toBe('restored-token');
  });

  it('keeps the current context when backend blocks organization switching', async () => {
    const user = userEvent.setup();
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.selectContext.mockRejectedValue(
      responseError('CASHIER_SESSION_MUST_BE_ENDED'),
    );
    const { router } = renderApp();

    await user.click(
      await screen.findByRole('button', {
        name: 'Начать работу на кассе Основная касса',
      }),
    );
    await screen.findByRole('heading', { name: 'Оформление продажи' });
    await router.navigate({ to: '/select-organization' });
    await user.click(await screen.findByRole('button', { name: /Maria/ }));

    expect(
      await screen.findAllByText('Сначала завершите текущую кассовую сессию.'),
    ).not.toHaveLength(0);
    expect(router.state.location.pathname).toBe('/select-organization');
    expect(useAuthStore.getState().accessToken).toBe('restored-token');
  });

  it('shows an empty state when the store has no active registers', async () => {
    api.refreshTokens.mockResolvedValue({ access_token: 'restored-token' });
    api.getActiveRegisters.mockResolvedValue([]);
    renderApp();

    expect(await screen.findByText('Нет активных касс')).toBeInTheDocument();
  });
});
