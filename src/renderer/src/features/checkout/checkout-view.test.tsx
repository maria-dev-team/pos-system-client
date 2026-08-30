import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type ProductResponse,
  type SaleItemResponse,
  type SaleResponse,
  cancelSale,
  checkoutSale,
  createSale,
  getAuthContext,
  getCurrentSale,
  removeSaleItem,
  searchProducts,
  triggerAntiFraudEvent,
} from '@renderer/common/api';

import { CheckoutView } from './index';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    cancelSale: vi.fn(),
    checkoutSale: vi.fn(),
    createSale: vi.fn(),
    getAuthContext: vi.fn(),
    getCurrentSale: vi.fn(),
    removeSaleItem: vi.fn(),
    searchProducts: vi.fn(),
    triggerAntiFraudEvent: vi.fn(),
  };
});

const cashierSession: CashierSessionResponse = {
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
  status: 'ACTIVE',
  store_id: 'store-1',
  updated_at: '2026-08-24T08:05:00.000Z',
};

const contextFixture = (permissions: string[]): AuthContextResponse => ({
  isSystemPosition: false,
  organizationId: 'organization-1',
  permissions,
  position: 'Кассир',
  storeId: 'store-1',
  storeScope: {
    canAccessAll: false,
    primaryStoreId: 'store-1',
    storeIds: ['store-1'],
    stores: [{ address: 'Алматы', id: 'store-1', name: 'Главный' }],
  },
  userOrganizationId: 'membership-1',
});

const productFixture = (
  overrides: Partial<ProductResponse> = {},
): ProductResponse => ({
  barcode: '001234',
  category_id: 'category-1',
  created_at: '2026-08-24T10:00:00.000Z',
  deleted_at: null,
  id: 'product-1',
  is_active: true,
  name: 'Молоко',
  organization_id: 'organization-1',
  retail_price: '650.00',
  sku: 'MILK-1',
  unit: 'pcs',
  updated_at: '2026-08-24T10:00:00.000Z',
  ...overrides,
  nkt: overrides.nkt ?? null,
  nkt_product_id: overrides.nkt_product_id ?? null,
  vat_rate: overrides.vat_rate ?? null,
});

const itemFixture = (
  overrides: Partial<SaleItemResponse> = {},
): SaleItemResponse => ({
  barcode: '001234',
  base_unit_price: '650.00',
  id: 'item-1',
  is_marked: false,
  line_number: 1,
  line_total: '650.00',
  name: 'Молоко',
  marking_code: null,
  nkt_name: null,
  ntin_code: null,
  gtin: null,
  price_override_reason: null,
  price_overridden_by_membership_id: null,
  product_id: 'product-1',
  quantity: '1',
  return_disposition: null,
  sku: 'MILK-1',
  source_sale_item_id: null,
  unit_code: 'pcs',
  unit_price: '650.00',
  vat_amount: '0.00',
  vat_rate: 'NONE',
  ...overrides,
});

const saleFixture = (overrides: Partial<SaleResponse> = {}): SaleResponse => ({
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: cashierSession.id,
  completed_at: null,
  created_at: '2026-08-24T10:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id: 'sale-1',
  items: [],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [],
  receipt_number: null,
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  status: 'DRAFT',
  store_id: 'store-1',
  total: '0.00',
  transaction_type: 'SALE',
  return_reason: null,
  updated_at: '2026-08-24T10:00:00.000Z',
  version: 1,
  ...overrides,
  fiscal_receipt: overrides.fiscal_receipt ?? null,
});

const renderCheckout = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CheckoutView cashierSession={cashierSession} onSessionEnded={vi.fn()} />
      <Toaster />
    </QueryClientProvider>,
  );
  return queryClient;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthContext).mockResolvedValue(
    contextFixture([
      'product.read',
      'sales.cancel',
      'sales.complete',
      'sales.create',
      'sales.hold',
      'sales.modify',
    ]),
  );
  vi.mocked(getCurrentSale).mockResolvedValue(null);
  vi.mocked(searchProducts).mockResolvedValue({
    meta: { has_more: false, limit: 20, offset: 0, total: 1 },
    products: [productFixture()],
  });
  vi.mocked(triggerAntiFraudEvent).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('server-authoritative checkout', () => {
  it('creates a server DRAFT immediately when the first catalog product is selected', async () => {
    const user = userEvent.setup();
    const created = saleFixture({
      items: [itemFixture()],
      total: '650.00',
    });
    vi.mocked(createSale).mockResolvedValue(created);
    renderCheckout();

    const search = await screen.findByLabelText('Сканируйте или найдите товар');
    await user.type(search, 'Молоко');
    await user.click(
      await screen.findByRole('button', { name: 'Добавить товар Молоко' }),
    );

    expect(createSale).toHaveBeenCalledWith({
      items: [{ productId: 'product-1', quantity: '1' }],
    });
    expect((await screen.findAllByText('650,00 ₸')).length).toBeGreaterThan(0);
  });

  it('resolves the first barcode and creates the same authoritative DRAFT', async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue(
      saleFixture({ items: [itemFixture()], total: '650.00' }),
    );
    renderCheckout();

    const search = await screen.findByLabelText('Сканируйте или найдите товар');
    await user.type(search, '001234{enter}');

    await waitFor(() =>
      expect(searchProducts).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        search: '001234',
      }),
    );
    await waitFor(() =>
      expect(createSale).toHaveBeenCalledWith({
        items: [{ productId: 'product-1', quantity: '1' }],
      }),
    );
  });

  it('resolves a marked product by GTIN and sends its full Data Matrix', async () => {
    const user = userEvent.setup();
    const markingCode = '010487000000001221SERIAL';
    const markedProduct = productFixture({
      nkt: {
        gtin: '04870000000012',
        is_marked: true,
        is_social: false,
        name_kk: null,
        name_ru: 'Маркированный товар',
        ntin_code: 'NTIN-1',
      },
      nkt_product_id: 'nkt-1',
    });
    vi.mocked(searchProducts).mockResolvedValue({
      meta: { has_more: false, limit: 20, offset: 0, total: 1 },
      products: [markedProduct],
    });
    vi.mocked(createSale).mockResolvedValue(
      saleFixture({
        items: [
          itemFixture({
            gtin: '04870000000012',
            is_marked: true,
            marking_code: markingCode,
            nkt_name: 'Маркированный товар',
            ntin_code: 'NTIN-1',
          }),
        ],
        total: '650.00',
      }),
    );
    renderCheckout();

    await user.type(
      await screen.findByLabelText('Сканируйте или найдите товар'),
      `${markingCode}{enter}`,
    );

    await waitFor(() =>
      expect(searchProducts).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        search: '04870000000012',
      }),
    );
    await waitFor(() =>
      expect(createSale).toHaveBeenCalledWith({
        items: [
          {
            markingCode,
            productId: 'product-1',
            quantity: '1',
          },
        ],
      }),
    );
  });

  it('opens cancellation instead of silently deleting the last item', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const cancelled = saleFixture({
      ...draft,
      cancellation_reason: 'Покупатель передумал',
      cancelled_at: '2026-08-24T10:05:00.000Z',
      status: 'CANCELLED',
      version: 2,
    });
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(cancelSale).mockResolvedValue(cancelled);
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Удалить Молоко' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Отменить чек?' }),
    ).toBeInTheDocument();
    expect(removeSaleItem).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: 'Покупатель передумал' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить отмену' }),
    );

    await waitFor(() =>
      expect(cancelSale).toHaveBeenCalledWith('sale-1', {
        expectedVersion: 1,
        reason: 'Покупатель передумал',
      }),
    );
    await waitFor(() => expect(triggerAntiFraudEvent).toHaveBeenCalledOnce());
  });

  it('removes a non-last item through the backend command', async () => {
    const user = userEvent.setup();
    const second = itemFixture({
      id: 'item-2',
      line_number: 2,
      name: 'Хлеб',
      product_id: 'product-2',
    });
    const draft = saleFixture({
      items: [itemFixture(), second],
      total: '1300.00',
    });
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(removeSaleItem).mockResolvedValue(
      saleFixture({ items: [second], total: '650.00', version: 2 }),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Удалить Молоко' }),
    );
    await user.click(screen.getByRole('button', { name: 'Удалить позицию' }));

    await waitFor(() =>
      expect(removeSaleItem).toHaveBeenCalledWith('sale-1', 'item-1', {
        expectedVersion: 1,
      }),
    );
  });

  it('uses only the server total when completing payment', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const completed = saleFixture({
      ...draft,
      completed_at: '2026-08-24T10:05:00.000Z',
      payments: [
        {
          amount: '650.00',
          change: null,
          completed_at: '2026-08-24T10:05:00.000Z',
          created_at: '2026-08-24T10:05:00.000Z',
          direction: 'INCOMING',
          id: 'payment-1',
          method: 'CASHLESS',
          received: null,
          status: 'COMPLETED',
          updated_at: '2026-08-24T10:05:00.000Z',
        },
      ],
      receipt_number: '10',
      status: 'COMPLETED',
      version: 2,
    });
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockResolvedValue(completed);
    renderCheckout();

    await user.click(await screen.findByRole('button', { name: 'Оплатить' }));
    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.type(
      screen.getByLabelText('БИН/ИИН покупателя — по запросу'),
      '123456789012',
    );
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    await waitFor(() =>
      expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
        buyerBinIin: '123456789012',
        expectedVersion: 1,
        payments: [{ amount: '650.00', method: 'CASHLESS' }],
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Печать чека' }),
    ).toBeInTheDocument();
  });
});
