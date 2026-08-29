import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type ReceiptResponse,
  type ReceiptSummaryResponse,
  type SaleResponse,
  createReceiptReturn,
  createWithoutReceiptReturn,
  getProduct,
  getReceipt,
  getReceipts,
  searchProducts,
  triggerAntiFraudEvent,
} from '@renderer/common/api';

import { ReturnsView } from './index';
import { useReturnsPendingStore } from './stores/returns-pending-store';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    createReceiptReturn: vi.fn(),
    createWithoutReceiptReturn: vi.fn(),
    getProduct: vi.fn(),
    getReceipt: vi.fn(),
    getReceipts: vi.fn(),
    searchProducts: vi.fn(),
    triggerAntiFraudEvent: vi.fn(),
  };
});

const cashierSession: CashierSessionResponse = {
  actual_cash: null,
  created_at: '2026-08-27T08:00:00.000Z',
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
  register_shift_id: 'shift-1',
  started_at: '2026-08-27T08:00:00.000Z',
  status: 'ACTIVE',
  store_id: 'store-1',
  updated_at: '2026-08-27T08:00:00.000Z',
};
const context: AuthContextResponse = {
  isSystemPosition: false,
  organizationId: 'organization-1',
  permissions: [
    'returns.create',
    'sales.read',
    'returns.without_receipt',
    'product.read',
    'returns.price.override',
  ],
  position: 'Кассир',
  storeId: 'store-1',
  storeScope: {
    canAccessAll: false,
    primaryStoreId: 'store-1',
    storeIds: ['store-1'],
    stores: [{ address: 'Алматы', id: 'store-1', name: 'Main' }],
  },
  userOrganizationId: 'membership-1',
};
const receiptSummary: ReceiptSummaryResponse = {
  cashier_membership_id: 'membership-1',
  completed_at: '2026-08-27T09:00:00.000Z',
  currency: 'KZT',
  id: 'sale-1',
  payments: [{ amount: '900.00', method: 'CASH' }],
  receipt_number: '42',
  total: '900.00',
};
const saleBase: SaleResponse = {
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: cashierSession.id,
  completed_at: '2026-08-27T09:00:00.000Z',
  created_at: '2026-08-27T09:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id: 'sale-1',
  items: [],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [],
  receipt_number: '42',
  register_id: 'register-1',
  register_shift_id: 'shift-1',
  return_reason: null,
  status: 'COMPLETED',
  store_id: 'store-1',
  total: '900.00',
  transaction_type: 'SALE',
  updated_at: '2026-08-27T09:00:00.000Z',
  version: 3,
};
const receipt: ReceiptResponse = {
  ...saleBase,
  cashier_name: 'Бекзат Омаров',
  items: [
    {
      barcode: '001',
      base_unit_price: '450.00',
      id: 'item-1',
      line_number: 1,
      line_total: '450.00',
      name: 'Молоко',
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '1',
      return_disposition: null,
      returnable_quantity: '1',
      returned_quantity: '0',
      sku: 'MILK',
      source_sale_item_id: null,
      unit_code: 'pcs',
      unit_price: '450.00',
    },
    {
      barcode: '002',
      base_unit_price: '450.00',
      id: 'item-2',
      line_number: 2,
      line_total: '450.00',
      name: 'Хлеб',
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-2',
      quantity: '1',
      return_disposition: null,
      returnable_quantity: '0.000',
      returned_quantity: '1',
      sku: 'BREAD',
      source_sale_item_id: null,
      unit_code: 'pcs',
      unit_price: '450.00',
    },
  ],
  payments: [
    {
      amount: '900.00',
      change: '0.00',
      completed_at: '2026-08-27T09:00:00.000Z',
      created_at: '2026-08-27T09:00:00.000Z',
      direction: 'INCOMING',
      id: 'payment-1',
      method: 'CASH',
      received: '900.00',
      status: 'COMPLETED',
      updated_at: '2026-08-27T09:00:00.000Z',
    },
  ],
  receipt_number: '42',
};
const completedReturn: SaleResponse = {
  ...saleBase,
  cashier_session_id: cashierSession.id,
  id: 'return-1',
  original_sale_id: receipt.id,
  receipt_number: '43',
  return_reason: 'Товар не подошёл',
  total: '450.00',
  transaction_type: 'RETURN',
};

const client = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
const wrapper = (queryClient: QueryClient, children: ReactNode) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const renderView = (
  overrides: Partial<{
    context: AuthContextResponse;
    onBackToSales: () => void;
  }> = {},
) => {
  const queryClient = client();
  const onBackToSales = overrides.onBackToSales ?? vi.fn();
  render(
    wrapper(
      queryClient,
      <ReturnsView
        cashierSession={cashierSession}
        context={overrides.context ?? context}
        onBackToSales={onBackToSales}
      />,
    ),
  );
  return { onBackToSales, queryClient };
};

beforeEach(() => {
  vi.resetAllMocks();
  useReturnsPendingStore.setState({ pendingBySession: {} });
  vi.mocked(getReceipts).mockResolvedValue({
    meta: { has_more: false, limit: 20, offset: 0, total: 1 },
    receipts: [receiptSummary],
  });
  vi.mocked(getReceipt).mockResolvedValue(receipt);
  vi.mocked(createReceiptReturn).mockResolvedValue(completedReturn);
  vi.mocked(createWithoutReceiptReturn).mockResolvedValue(completedReturn);
  vi.mocked(triggerAntiFraudEvent).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('ReturnsView', () => {
  it('shows receipt loading and empty states', async () => {
    vi.mocked(getReceipts).mockReturnValueOnce(new Promise(() => undefined));
    const first = renderView();
    expect(
      await screen.findByText('Загружаем последние чеки'),
    ).toBeInTheDocument();
    cleanup();
    first.queryClient.clear();

    vi.mocked(getReceipts).mockResolvedValueOnce({
      meta: { has_more: false, limit: 20, offset: 0, total: 0 },
      receipts: [],
    });
    renderView();
    expect(
      await screen.findByText('В магазине пока нет завершённых чеков'),
    ).toBeInTheDocument();
  });

  it('shows an access state when no return mode is permitted', async () => {
    const user = userEvent.setup();
    const onBackToSales = vi.fn();
    renderView({
      context: { ...context, permissions: [] },
      onBackToSales,
    });

    expect(screen.getByText('Нет доступа к возвратам')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Вернуться к продажам' }),
    );
    expect(onBackToSales).toHaveBeenCalledOnce();
    expect(getReceipts).not.toHaveBeenCalled();
  });

  it('loads receipt details on selection and requires quantity, disposition, reason and payment', async () => {
    const user = userEvent.setup();
    const refreshedReceipt: ReceiptResponse = {
      ...receipt,
      items: receipt.items.map((item) =>
        item.id === 'item-1'
          ? {
              ...item,
              returnable_quantity: '0.000',
              returned_quantity: '1.000',
            }
          : item,
      ),
    };
    vi.mocked(getReceipt)
      .mockResolvedValueOnce(receipt)
      .mockResolvedValue(refreshedReceipt);
    renderView();

    expect(getReceipt).not.toHaveBeenCalled();
    const receiptButton = await screen.findByRole('button', {
      name: 'Открыть чек №42',
    });
    await user.click(receiptButton);
    expect(await screen.findByText('Молоко')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Печать чека' }),
    ).toBeInTheDocument();
    expect(receiptButton).toHaveAttribute('aria-expanded', 'true');
    expect(receiptButton.nextElementSibling).toContainElement(
      screen.getByText('Молоко'),
    );
    expect(screen.getByLabelText('Выбрать Хлеб')).toBeDisabled();

    await user.click(screen.getByLabelText('Выбрать Молоко'));
    const paymentButton = screen.getByRole('button', {
      name: 'Оформить возврат',
    });
    expect(paymentButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'На склад Молоко' }));
    await user.type(
      screen.getByLabelText('Причина возврата'),
      'Товар не подошёл',
    );
    expect(paymentButton).toBeEnabled();

    await user.click(paymentButton);
    expect(screen.getByText('Способ возврата')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Наличные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );
    expect(
      await screen.findByText('Возврат успешно завершён'),
    ).toBeInTheDocument();
    expect(createReceiptReturn).toHaveBeenCalledWith('42', expect.any(String), {
      items: [
        {
          quantity: '1',
          returnDisposition: 'RESTOCK',
          saleItemId: 'item-1',
        },
      ],
      payments: [{ amount: '450.00', method: 'CASH' }],
      reason: 'Товар не подошёл',
    });
    expect(getReceipt).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Новый возврат' }));
    await user.click(
      await screen.findByRole('button', { name: 'Открыть чек №42' }),
    );
    expect(await screen.findAllByText('Возвращено полностью')).toHaveLength(2);
    expect(screen.getByLabelText('Выбрать Молоко')).toBeDisabled();
  });

  it('supports receipt pagination and an error retry state', async () => {
    const user = userEvent.setup();
    vi.mocked(getReceipts)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        meta: { has_more: true, limit: 20, offset: 0, total: 21 },
        receipts: [receiptSummary],
      })
      .mockResolvedValueOnce({
        meta: { has_more: false, limit: 20, offset: 20, total: 21 },
        receipts: [{ ...receiptSummary, receipt_number: '21' }],
      });
    renderView();

    expect(
      await screen.findByText('Не удалось загрузить чеки'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('button', { name: 'Открыть чек №42' });
    await user.click(screen.getByRole('button', { name: 'Следующая' }));

    await waitFor(() =>
      expect(getReceipts).toHaveBeenLastCalledWith({ limit: 20, offset: 20 }),
    );
    expect(
      await screen.findByRole('button', { name: 'Открыть чек №21' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Предыдущая' })).toBeEnabled();
  });

  it('does not show recovery while the first return request is in progress', async () => {
    const user = userEvent.setup();
    let rejectReturn: (error: unknown) => void = () => undefined;
    vi.mocked(createReceiptReturn).mockReturnValue(
      new Promise((_, reject) => {
        rejectReturn = reject;
      }),
    );
    renderView();

    await user.click(
      await screen.findByRole('button', { name: 'Открыть чек №42' }),
    );
    await user.click(screen.getByLabelText('Выбрать Молоко'));
    await user.click(screen.getByRole('button', { name: 'На склад Молоко' }));
    await user.type(
      screen.getByLabelText('Причина возврата'),
      'Товар не подошёл',
    );
    await user.click(screen.getByRole('button', { name: 'Оформить возврат' }));
    await user.click(screen.getByRole('button', { name: 'Наличные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );

    await waitFor(() => expect(createReceiptReturn).toHaveBeenCalledOnce());
    expect(screen.queryByText('Незавершённый возврат')).not.toBeInTheDocument();
    expect(screen.getByText('Способ возврата')).toBeInTheDocument();

    rejectReturn(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(
      await screen.findByText('Незавершённый возврат'),
    ).toBeInTheDocument();
  });

  it('allows inactive priced products without a receipt and disables unpriced products', async () => {
    const user = userEvent.setup();
    const inactiveProduct = {
      barcode: '001',
      category_id: null,
      created_at: '2026-08-27T08:00:00.000Z',
      deleted_at: null,
      id: 'product-1',
      is_active: false,
      name: 'Неактивный товар',
      organization_id: 'organization-1',
      retail_price: '450.00',
      sku: 'OLD',
      unit: 'pcs' as const,
      updated_at: '2026-08-27T08:00:00.000Z',
    };
    vi.mocked(searchProducts).mockResolvedValue({
      meta: { has_more: false, limit: 20, offset: 0, total: 2 },
      products: [
        inactiveProduct,
        {
          ...inactiveProduct,
          id: 'product-2',
          is_active: true,
          name: 'Товар без цены',
          retail_price: null,
        },
      ],
    });
    vi.mocked(getProduct).mockResolvedValue(inactiveProduct);
    renderView();

    await user.click(screen.getByRole('button', { name: 'Без чека' }));
    await user.type(screen.getByLabelText('Поиск товаров'), 'товар');

    const inactive = await screen.findByRole('button', {
      name: 'Добавить товар Неактивный товар',
    });
    expect(inactive).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Добавить товар Товар без цены' }),
    ).toBeDisabled();
    await user.click(inactive);

    const quantity = screen.getByRole('button', {
      name: 'Изменить количество Неактивный товар',
    });
    expect(quantity).toHaveTextContent('1 шт.');
    await user.click(
      screen.getByRole('button', {
        name: 'Увеличить количество Неактивный товар',
      }),
    );
    expect(quantity).toHaveTextContent('2 шт.');
    await user.click(
      screen.getByRole('button', {
        name: 'Уменьшить количество Неактивный товар',
      }),
    );
    expect(quantity).toHaveTextContent('1 шт.');
    expect(
      screen.getByRole('button', {
        name: 'Изменить цену Неактивный товар',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Неактивен')).toHaveLength(2);
  });

  it('opens the screen keyboard over the page without stretching the layout', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole('button', { name: 'Экранная клавиатура' }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Экранная клавиатура',
    });
    expect(dialog).toHaveClass('bottom-0', 'top-auto', 'max-h-[50svh]');
    await user.click(screen.getByRole('button', { name: 'а' }));
    expect(screen.getByLabelText('Причина возврата')).toHaveValue('а');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits a permitted without-receipt price override after refreshing the product', async () => {
    const user = userEvent.setup();
    const product = {
      barcode: '001',
      category_id: null,
      created_at: '2026-08-27T08:00:00.000Z',
      deleted_at: null,
      id: 'product-1',
      is_active: true,
      name: 'Кофе',
      organization_id: 'organization-1',
      retail_price: '450.00',
      sku: 'COFFEE',
      unit: 'pcs' as const,
      updated_at: '2026-08-27T08:00:00.000Z',
    };
    vi.mocked(searchProducts).mockResolvedValue({
      meta: { has_more: false, limit: 20, offset: 0, total: 1 },
      products: [product],
    });
    vi.mocked(getProduct).mockResolvedValue(product);
    renderView();

    await user.click(screen.getByRole('button', { name: 'Без чека' }));
    await user.type(screen.getByLabelText('Поиск товаров'), 'кофе');
    await user.click(
      await screen.findByRole('button', { name: 'Добавить товар Кофе' }),
    );
    const overrideButton = screen.getByRole('button', {
      name: 'Изменить цену Кофе',
    });
    expect(overrideButton.querySelector('.lucide-pencil')).toBeInTheDocument();
    await user.click(overrideButton);

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-2xl');
    expect(
      screen.queryByLabelText('Причина изменения цены'),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Новая цена, ₸'), '400');
    await user.click(screen.getByRole('button', { name: 'Далее' }));

    expect(screen.getByRole('dialog')).toHaveClass('sm:max-w-2xl');
    expect(screen.queryByLabelText('Новая цена, ₸')).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText('Причина изменения цены'),
      'Повреждена упаковка',
    );
    await user.click(screen.getByRole('button', { name: 'Сохранить цену' }));
    await user.click(screen.getByRole('button', { name: 'Списать Кофе' }));
    await user.type(
      screen.getByLabelText('Причина возврата'),
      'Возврат без чека',
    );
    await user.click(screen.getByRole('button', { name: 'Оформить возврат' }));
    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );

    await waitFor(() =>
      expect(createWithoutReceiptReturn).toHaveBeenCalledWith(
        expect.any(String),
        {
          items: [
            {
              priceOverride: {
                reason: 'Повреждена упаковка',
                unitPrice: '400',
              },
              productId: 'product-1',
              quantity: '1',
              returnDisposition: 'WRITE_OFF',
            },
          ],
          payments: [{ amount: '400.00', method: 'CASHLESS' }],
          reason: 'Возврат без чека',
        },
      ),
    );
  });
});
