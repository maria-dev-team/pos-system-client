import axios, {
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

type CheckoutApi = {
  addSaleItem: (...args: unknown[]) => Promise<unknown>;
  applySaleDiscount: (...args: unknown[]) => Promise<unknown>;
  cancelSale: (...args: unknown[]) => Promise<unknown>;
  checkoutSale: (...args: unknown[]) => Promise<unknown>;
  createSale: (...args: unknown[]) => Promise<unknown>;
  getCurrentSale: (...args: unknown[]) => Promise<unknown>;
  getHeldSales: (...args: unknown[]) => Promise<unknown>;
  getSale: (...args: unknown[]) => Promise<unknown>;
  holdSale: (...args: unknown[]) => Promise<unknown>;
  overrideSaleItemPrice: (...args: unknown[]) => Promise<unknown>;
  removeSaleItem: (...args: unknown[]) => Promise<unknown>;
  resetSaleItemPrice: (...args: unknown[]) => Promise<unknown>;
  resetSaleDiscount: (...args: unknown[]) => Promise<unknown>;
  resumeSale: (...args: unknown[]) => Promise<unknown>;
  scanSaleItem: (...args: unknown[]) => Promise<unknown>;
  searchProducts: (...args: unknown[]) => Promise<unknown>;
  setSaleItemQuantity: (...args: unknown[]) => Promise<unknown>;
};

type CatalogApi = {
  getCategories: (...args: unknown[]) => Promise<unknown>;
  searchProducts: (...args: unknown[]) => Promise<unknown>;
};

type ReturnsApi = {
  createReceiptReturn: (...args: unknown[]) => Promise<unknown>;
  createWithoutReceiptReturn: (...args: unknown[]) => Promise<unknown>;
  getProduct: (...args: unknown[]) => Promise<unknown>;
  getReceipt: (...args: unknown[]) => Promise<unknown>;
  getReceipts: (...args: unknown[]) => Promise<unknown>;
};

type AntiFraudApi = {
  triggerAntiFraudEvent: (...args: unknown[]) => Promise<unknown>;
};

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
const registerShift = {
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
  opening_cash: '12500.50',
  organization_id: 'organization-1',
  register_id: 'register-1',
  status: 'OPEN' as const,
  store_id: 'store-1',
  updated_at: '2026-08-24T08:00:00.000Z',
};
const closedRegisterShift = {
  ...registerShift,
  actual_cash: '12400.00',
  closed_at: '2026-08-24T10:00:00.000Z',
  closed_by_membership_id: 'membership-1',
  difference: '-100.50',
  expected_cash: '12500.50',
  status: 'CLOSED' as const,
};
const cashierSession = {
  actual_cash: null,
  created_at: '2026-08-24T08:05:00.000Z',
  difference: null,
  end_reason: null,
  ended_at: null,
  expected_cash: null,
  id: 'cashier-session-1',
  locked_at: null,
  membership_id: 'membership-1',
  opening_cash: '10000.00',
  organization_id: 'organization-1',
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  started_at: '2026-08-24T08:05:00.000Z',
  status: 'ACTIVE' as const,
  store_id: 'store-1',
  updated_at: '2026-08-24T08:05:00.000Z',
};
const endedCashierSession = {
  ...cashierSession,
  actual_cash: '9900.00',
  difference: '-100.00',
  end_reason: 'LOGOUT' as const,
  ended_at: '2026-08-24T10:00:00.000Z',
  expected_cash: '10000.00',
  status: 'ENDED' as const,
};
const product = {
  barcode: '4870000000012',
  category_id: 'category-1',
  created_at: '2026-08-24T08:00:00.000Z',
  deleted_at: null,
  id: 'product-1',
  is_active: true,
  name: 'Молоко',
  organization_id: 'organization-1',
  retail_price: '450.00',
  sku: 'MILK-1L',
  unit: 'pcs' as const,
  updated_at: '2026-08-24T08:00:00.000Z',
};
const category = {
  children: [
    {
      children: [],
      created_at: '2026-08-24T08:00:00.000Z',
      deleted_at: null,
      id: 'category-2',
      name: 'Молоко',
      organization_id: 'organization-1',
      parent_id: 'category-1',
      updated_at: '2026-08-24T08:00:00.000Z',
    },
  ],
  created_at: '2026-08-24T08:00:00.000Z',
  deleted_at: null,
  id: 'category-1',
  name: 'Продукты',
  organization_id: 'organization-1',
  parent_id: null,
  updated_at: '2026-08-24T08:00:00.000Z',
};
const sale = {
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: 'cashier-session-1',
  completed_at: null,
  created_at: '2026-08-24T08:10:00.000Z',
  currency: 'KZT' as const,
  held_at: null,
  id: 'sale-1',
  items: [
    {
      barcode: '4870000000012',
      base_unit_price: '450.00',
      id: 'sale-item-1',
      line_number: 1,
      line_total: '900.00',
      name: 'Молоко',
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '2',
      return_disposition: null,
      sku: 'MILK-1L',
      source_sale_item_id: null,
      unit_code: 'pcs',
      unit_price: '450.00',
    },
  ],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [],
  receipt_number: null,
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  status: 'DRAFT' as const,
  store_id: 'store-1',
  total: '900.00',
  transaction_type: 'SALE' as const,
  return_reason: null,
  updated_at: '2026-08-24T08:10:00.000Z',
  version: 1,
};
const heldSale = {
  created_at: '2026-08-24T08:10:00.000Z',
  held_at: '2026-08-24T08:15:00.000Z',
  id: 'sale-2',
  items_count: 2,
  status: 'HELD' as const,
  total: '900.00',
  version: 2,
};

afterEach(() => vi.unstubAllEnvs());

it('fetches the category tree and serializes a category product filter', async () => {
  const calls: InternalAxiosRequestConfig[] = [];
  axios.defaults.adapter = async (config): Promise<AxiosResponse> => {
    calls.push(config);
    return {
      config,
      data: {
        data:
          config.url === '/v1/categories'
            ? {
                categories: [category],
                meta: {
                  has_more: false,
                  limit: 100,
                  offset: 0,
                  total: 1,
                },
              }
            : {
                meta: {
                  has_more: false,
                  limit: 100,
                  offset: 0,
                  total: 1,
                },
                products: [product],
              },
      },
      headers: {},
      status: 200,
      statusText: 'OK',
    };
  };
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', 'http://localhost:4004');
  const api = (await import('./requests')) as unknown as CatalogApi;

  await expect(api.getCategories({ limit: 100, offset: 0 })).resolves.toEqual({
    categories: [category],
    meta: { has_more: false, limit: 100, offset: 0, total: 1 },
  });
  await expect(
    api.searchProducts({ categoryId: 'category-2', limit: 100, offset: 0 }),
  ).resolves.toEqual({
    meta: { has_more: false, limit: 100, offset: 0, total: 1 },
    products: [product],
  });

  expect(calls.map(({ method, url }) => [method, url])).toEqual([
    ['get', '/v1/categories'],
    ['get', '/v1/products'],
  ]);
  expect(calls[1]?.params).toEqual({
    category_id: 'category-2',
    limit: 100,
    offset: 0,
  });
});

describe('API endpoints', () => {
  it('uses the backend auth/context/register contracts and unwraps response data', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    axios.defaults.adapter = async (config): Promise<AxiosResponse> => {
      calls.push(config);
      const dataByUrl: Record<string, unknown> = {
        '/health': { status: 'ok' },
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
        '/v1/register-shifts': { data: { register_shift: registerShift } },
        '/v1/register-shifts/current': {
          data: { register_shift: registerShift },
        },
        '/v1/register-shifts/register-shift-1/close': {
          data: { register_shift: closedRegisterShift },
        },
        '/v1/register-shifts/register-shift-1/cashier-sessions': {
          data: { cashier_session: cashierSession },
        },
        '/v1/registers/register-1/cashier-sessions/current': {
          data: { cashier_session: cashierSession },
        },
        '/v1/cashier-sessions/cashier-session-1/end': {
          data: { cashier_session: endedCashierSession },
        },
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
      closeRegisterShift,
      endCashierSession,
      getActiveRegisters,
      getApiHealth,
      getAuthContext,
      getCurrentRegisterShift,
      getCurrentCashierSession,
      getCurrentUser,
      getMyOrganizations,
      login,
      openRegisterShift,
      startCashierSession,
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
    await expect(getCurrentRegisterShift('register-1')).resolves.toEqual(
      registerShift,
    );
    await expect(
      openRegisterShift({ openingCash: '12500.50', registerId: 'register-1' }),
    ).resolves.toEqual(registerShift);
    await expect(
      closeRegisterShift('register-shift-1', { actualCash: '12400.00' }),
    ).resolves.toEqual(closedRegisterShift);
    await expect(
      startCashierSession('register-shift-1', { openingCash: '10000.00' }),
    ).resolves.toEqual(cashierSession);
    await expect(getCurrentCashierSession('register-1')).resolves.toEqual(
      cashierSession,
    );
    await expect(
      endCashierSession('cashier-session-1', { actualCash: '9900.00' }),
    ).resolves.toEqual(endedCashierSession);
    await expect(getApiHealth()).resolves.toEqual({ status: 'ok' });

    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ['post', '/v1/auth/login'],
      ['post', '/v1/auth/select-context'],
      ['get', '/v1/users/me'],
      ['get', '/v1/organizations'],
      ['get', '/v1/auth/context'],
      ['get', '/v1/registers'],
      ['get', '/v1/register-shifts/current'],
      ['post', '/v1/register-shifts'],
      ['post', '/v1/register-shifts/register-shift-1/close'],
      ['post', '/v1/register-shifts/register-shift-1/cashier-sessions'],
      ['get', '/v1/registers/register-1/cashier-sessions/current'],
      ['post', '/v1/cashier-sessions/cashier-session-1/end'],
      ['get', '/health'],
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
    expect(calls.at(6)?.params).toEqual({ register_id: 'register-1' });
    expect(JSON.parse(calls.at(7)?.data as string)).toEqual({
      opening_cash: '12500.50',
      register_id: 'register-1',
    });
    expect(JSON.parse(calls.at(8)?.data as string)).toEqual({
      actual_cash: '12400.00',
    });
    expect(JSON.parse(calls.at(9)?.data as string)).toEqual({
      opening_cash: '10000.00',
    });
    expect(JSON.parse(calls.at(11)?.data as string)).toEqual({
      actual_cash: '9900.00',
    });
    expect(calls.at(12)?.timeout).toBe(3_000);
  });

  it('uses the checkout product and sale contracts and unwraps the inner sale', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    let currentSale: typeof sale | null = sale;
    axios.defaults.adapter = async (config): Promise<AxiosResponse> => {
      calls.push(config);
      const dataByUrl: Record<string, unknown> = {
        '/v1/products': {
          data: {
            meta: { has_more: false, limit: 20, offset: 0, total: 1 },
            products: [product],
          },
        },
        '/v1/sales': { data: { sale } },
        '/v1/sales/current': { data: { sale: currentSale } },
        '/v1/sales/held': { data: { sales: [heldSale] } },
        '/v1/sales/sale-1': { data: { sale } },
        '/v1/sales/sale-1/cancel': { data: { sale } },
        '/v1/sales/sale-1/apply-discount': { data: { sale } },
        '/v1/sales/sale-1/checkout': { data: { sale } },
        '/v1/sales/sale-1/hold': { data: { sale } },
        '/v1/sales/sale-1/items': { data: { sale } },
        '/v1/sales/sale-1/items/scan': { data: { sale } },
        '/v1/sales/sale-1/items/sale-item-1/override-price': {
          data: { sale },
        },
        '/v1/sales/sale-1/items/sale-item-1/remove': { data: { sale } },
        '/v1/sales/sale-1/items/sale-item-1/reset-price': {
          data: { sale },
        },
        '/v1/sales/sale-1/items/sale-item-1/set-quantity': {
          data: { sale },
        },
        '/v1/sales/sale-1/resume': { data: { sale } },
        '/v1/sales/sale-1/reset-discount': { data: { sale } },
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
    const api = (await import('./requests')) as unknown as CheckoutApi;

    expect(api).toMatchObject({
      addSaleItem: expect.any(Function),
      applySaleDiscount: expect.any(Function),
      cancelSale: expect.any(Function),
      checkoutSale: expect.any(Function),
      createSale: expect.any(Function),
      getCurrentSale: expect.any(Function),
      getHeldSales: expect.any(Function),
      getSale: expect.any(Function),
      holdSale: expect.any(Function),
      overrideSaleItemPrice: expect.any(Function),
      removeSaleItem: expect.any(Function),
      resetSaleItemPrice: expect.any(Function),
      resetSaleDiscount: expect.any(Function),
      resumeSale: expect.any(Function),
      scanSaleItem: expect.any(Function),
      searchProducts: expect.any(Function),
      setSaleItemQuantity: expect.any(Function),
    });

    await expect(
      api.searchProducts({ limit: 20, offset: 0, search: 'молоко' }),
    ).resolves.toEqual({
      meta: { has_more: false, limit: 20, offset: 0, total: 1 },
      products: [product],
    });
    await expect(
      api.createSale({
        items: [
          {
            priceOverride: { reason: 'Скидка', unitPrice: '400.00' },
            productId: 'product-1',
            quantity: '2',
          },
        ],
      }),
    ).resolves.toEqual(sale);
    await expect(api.getCurrentSale()).resolves.toEqual(sale);
    currentSale = null;
    await expect(api.getCurrentSale()).resolves.toBeNull();
    await expect(api.getHeldSales()).resolves.toEqual([heldSale]);
    await expect(api.getSale('sale-1')).resolves.toEqual(sale);
    await expect(
      api.holdSale('sale-1', { expectedVersion: 2 }),
    ).resolves.toEqual(sale);
    await expect(
      api.resumeSale('sale-1', { expectedVersion: 3 }),
    ).resolves.toEqual(sale);
    await expect(
      api.checkoutSale('sale-1', {
        expectedVersion: 4,
        payments: [{ amount: '900.00', method: 'CASH', received: '1000.00' }],
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.scanSaleItem('sale-1', {
        barcode: '4870000000012',
        expectedVersion: 1,
        quantityDelta: '1',
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.addSaleItem('sale-1', {
        expectedVersion: 2,
        productId: 'product-1',
        quantity: '2',
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.setSaleItemQuantity('sale-1', 'sale-item-1', {
        expectedVersion: 3,
        quantity: '3',
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.removeSaleItem('sale-1', 'sale-item-1', { expectedVersion: 4 }),
    ).resolves.toEqual(sale);
    await expect(
      api.overrideSaleItemPrice('sale-1', 'sale-item-1', {
        expectedVersion: 5,
        reason: 'Скидка',
        unitPrice: '400.00',
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.resetSaleItemPrice('sale-1', 'sale-item-1', {
        expectedVersion: 6,
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.applySaleDiscount('sale-1', {
        expectedVersion: 7,
        percentage: '10.00',
        reason: 'Постоянный покупатель',
      }),
    ).resolves.toEqual(sale);
    await expect(
      api.resetSaleDiscount('sale-1', { expectedVersion: 8 }),
    ).resolves.toEqual(sale);
    await expect(
      api.cancelSale('sale-1', {
        expectedVersion: 9,
        reason: 'Клиент передумал',
      }),
    ).resolves.toEqual(sale);

    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ['get', '/v1/products'],
      ['post', '/v1/sales'],
      ['get', '/v1/sales/current'],
      ['get', '/v1/sales/current'],
      ['get', '/v1/sales/held'],
      ['get', '/v1/sales/sale-1'],
      ['post', '/v1/sales/sale-1/hold'],
      ['post', '/v1/sales/sale-1/resume'],
      ['post', '/v1/sales/sale-1/checkout'],
      ['post', '/v1/sales/sale-1/items/scan'],
      ['post', '/v1/sales/sale-1/items'],
      ['post', '/v1/sales/sale-1/items/sale-item-1/set-quantity'],
      ['post', '/v1/sales/sale-1/items/sale-item-1/remove'],
      ['post', '/v1/sales/sale-1/items/sale-item-1/override-price'],
      ['post', '/v1/sales/sale-1/items/sale-item-1/reset-price'],
      ['post', '/v1/sales/sale-1/apply-discount'],
      ['post', '/v1/sales/sale-1/reset-discount'],
      ['post', '/v1/sales/sale-1/cancel'],
    ]);
    expect(calls.at(0)?.params).toEqual({
      limit: 20,
      offset: 0,
      search: 'молоко',
    });
    expect(JSON.parse(calls.at(1)?.data as string)).toEqual({
      items: [
        {
          price_override: { reason: 'Скидка', unit_price: '400.00' },
          product_id: 'product-1',
          quantity: '2',
        },
      ],
    });
    expect(JSON.parse(calls.at(6)?.data as string)).toEqual({
      expected_version: 2,
    });
    expect(JSON.parse(calls.at(7)?.data as string)).toEqual({
      expected_version: 3,
    });
    expect(JSON.parse(calls.at(8)?.data as string)).toEqual({
      expected_version: 4,
      payments: [{ amount: '900.00', method: 'CASH', received: '1000.00' }],
    });
    expect(JSON.parse(calls.at(9)?.data as string)).toEqual({
      barcode: '4870000000012',
      expected_version: 1,
      quantity_delta: '1',
    });
    expect(JSON.parse(calls.at(10)?.data as string)).toEqual({
      expected_version: 2,
      product_id: 'product-1',
      quantity: '2',
    });
    expect(JSON.parse(calls.at(11)?.data as string)).toEqual({
      expected_version: 3,
      quantity: '3',
    });
    expect(JSON.parse(calls.at(12)?.data as string)).toEqual({
      expected_version: 4,
    });
    expect(JSON.parse(calls.at(13)?.data as string)).toEqual({
      expected_version: 5,
      reason: 'Скидка',
      unit_price: '400.00',
    });
    expect(JSON.parse(calls.at(14)?.data as string)).toEqual({
      expected_version: 6,
    });
    expect(JSON.parse(calls.at(15)?.data as string)).toEqual({
      expected_version: 7,
      percentage: '10.00',
      reason: 'Постоянный покупатель',
    });
    expect(JSON.parse(calls.at(16)?.data as string)).toEqual({
      expected_version: 8,
    });
    expect(JSON.parse(calls.at(17)?.data as string)).toEqual({
      expected_version: 9,
      reason: 'Клиент передумал',
    });
  });

  it('triggers a register-scoped anti-fraud capture event', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    axios.defaults.adapter = async (config): Promise<AxiosResponse> => {
      calls.push(config);
      return {
        config,
        data: { data: { event: { id: 'anti-fraud-event-1' } } },
        headers: {},
        status: 201,
        statusText: 'Created',
      };
    };
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', 'http://localhost:4004');
    const api = (await import('./requests')) as unknown as AntiFraudApi;

    await expect(
      api.triggerAntiFraudEvent({
        externalEventId: 'sale-cancel:sale-1',
        occurredAt: '2026-08-24T10:05:00.000Z',
        postBufferSeconds: 15,
        preBufferSeconds: 15,
        reason: 'Клиент передумал',
        registerId: 'register-1',
        saleId: 'sale-1',
        type: 'cancel',
      }),
    ).resolves.toBeUndefined();

    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ['post', '/v1/anti-fraud/events/trigger'],
    ]);
    expect(JSON.parse(calls[0]?.data as string)).toEqual({
      external_event_id: 'sale-cancel:sale-1',
      occurred_at: '2026-08-24T10:05:00.000Z',
      post_buffer_seconds: 15,
      pre_buffer_seconds: 15,
      reason: 'Клиент передумал',
      register_id: 'register-1',
      sale_id: 'sale-1',
      type: 'cancel',
    });
  });

  it('uses receipt and return contracts with pagination, snake case and idempotency headers', async () => {
    const calls: InternalAxiosRequestConfig[] = [];
    const receiptSummary = {
      cashier_membership_id: 'membership-1',
      completed_at: '2026-08-24T08:15:00.000Z',
      currency: 'KZT',
      id: 'sale-1',
      payments: [{ amount: '900.00', method: 'CASH' }],
      receipt_number: '42',
      total: '900.00',
    };
    const receipt = {
      ...sale,
      cashier_name: 'Бекзат Омаров',
      items: sale.items.map((item) => ({
        ...item,
        returnable_quantity: '1',
        returned_quantity: '1',
      })),
      receipt_number: '42',
    };
    const completedReturn = {
      ...sale,
      completed_at: '2026-08-24T08:20:00.000Z',
      original_sale_id: 'sale-1',
      receipt_number: '43',
      return_reason: 'Повреждена упаковка',
      status: 'COMPLETED',
      transaction_type: 'RETURN',
    };

    axios.defaults.adapter = async (config): Promise<AxiosResponse> => {
      calls.push(config);
      const dataByUrl: Record<string, unknown> = {
        '/v1/products/product-1': { data: { product } },
        '/v1/returns/receipts/42': { data: { return: completedReturn } },
        '/v1/returns/without-receipt': {
          data: { return: completedReturn },
        },
        '/v1/sales/receipts': {
          data: {
            meta: { has_more: false, limit: 20, offset: 0, total: 1 },
            receipts: [receiptSummary],
          },
        },
        '/v1/sales/receipts/42': { data: { receipt } },
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
    const api = (await import('./requests')) as unknown as ReturnsApi;

    expect(api).toMatchObject({
      createReceiptReturn: expect.any(Function),
      createWithoutReceiptReturn: expect.any(Function),
      getProduct: expect.any(Function),
      getReceipt: expect.any(Function),
      getReceipts: expect.any(Function),
    });

    await expect(api.getReceipts({ limit: 20, offset: 0 })).resolves.toEqual({
      meta: { has_more: false, limit: 20, offset: 0, total: 1 },
      receipts: [receiptSummary],
    });
    await expect(api.getReceipt('42')).resolves.toEqual(receipt);
    await expect(api.getProduct('product-1')).resolves.toEqual(product);
    await expect(
      api.createReceiptReturn('42', '123e4567-e89b-42d3-a456-426614174000', {
        items: [
          {
            quantity: '1',
            returnDisposition: 'WRITE_OFF',
            saleItemId: 'sale-item-1',
          },
        ],
        payments: [{ amount: '450.00', method: 'CASH' }],
        reason: 'Повреждена упаковка',
      }),
    ).resolves.toEqual(completedReturn);
    await expect(
      api.createWithoutReceiptReturn('123e4567-e89b-42d3-a456-426614174001', {
        items: [
          {
            priceOverride: {
              reason: 'Актуальная цена',
              unitPrice: '400.00',
            },
            productId: 'product-1',
            quantity: '1',
            returnDisposition: 'RESTOCK',
          },
        ],
        payments: [{ amount: '400.00', method: 'CASHLESS' }],
        reason: 'Возврат без чека',
      }),
    ).resolves.toEqual(completedReturn);

    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ['get', '/v1/sales/receipts'],
      ['get', '/v1/sales/receipts/42'],
      ['get', '/v1/products/product-1'],
      ['post', '/v1/returns/receipts/42'],
      ['post', '/v1/returns/without-receipt'],
    ]);
    expect(calls.at(0)?.params).toEqual({ limit: 20, offset: 0 });
    expect(calls.at(3)?.headers.get('Idempotency-Key')).toBe(
      '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(calls.at(4)?.headers.get('Idempotency-Key')).toBe(
      '123e4567-e89b-42d3-a456-426614174001',
    );
    expect(JSON.parse(calls.at(3)?.data as string)).toEqual({
      items: [
        {
          quantity: '1',
          return_disposition: 'WRITE_OFF',
          sale_item_id: 'sale-item-1',
        },
      ],
      payments: [{ amount: '450.00', method: 'CASH' }],
      reason: 'Повреждена упаковка',
    });
    expect(JSON.parse(calls.at(4)?.data as string)).toEqual({
      items: [
        {
          price_override: {
            reason: 'Актуальная цена',
            unit_price: '400.00',
          },
          product_id: 'product-1',
          quantity: '1',
          return_disposition: 'RESTOCK',
        },
      ],
      payments: [{ amount: '400.00', method: 'CASHLESS' }],
      reason: 'Возврат без чека',
    });
  });
});
