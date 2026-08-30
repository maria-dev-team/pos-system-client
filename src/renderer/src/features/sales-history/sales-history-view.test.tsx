import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type FiscalReceiptResponse,
  type ReceiptResponse,
  type ReceiptSummaryResponse,
  getReceipt,
  getReceipts,
} from '@renderer/common/api';

import { SalesHistoryView } from './index';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    getReceipt: vi.fn(),
    getReceipts: vi.fn(),
  };
});

vi.mock('@renderer/features/receipt-printing', () => ({
  ReceiptPrintButton: () => <button type="button">Печать чека</button>,
}));

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
  permissions: ['returns.create', 'sales.read'],
  position: 'Кассир',
  storeId: 'store-1',
  storeScope: {
    canAccessAll: false,
    primaryStoreId: 'store-1',
    storeIds: ['store-1'],
    stores: [{ address: 'Алматы', id: 'store-1', name: 'Главный' }],
  },
  userOrganizationId: 'membership-1',
};

const fiscalReceipt: FiscalReceiptResponse = {
  address: 'Алматы',
  buyer_bin_iin: null,
  cashbox_unique_number: 'SWK00000001',
  currency: 'KZT',
  fiscal_sign: '123456789',
  fiscalized_at: '2026-08-27T09:00:00.000Z',
  offline: false,
  ofd_name: 'ОФД',
  ofd_website: 'https://ofd.example',
  operation_type: 'SALE',
  print_url: null,
  provider: 'WEBKASSA',
  qr_url: 'https://ofd.example/check/42',
  receipt_number: '42',
  registration_number: 'RN-1',
  shift_number: '1',
  status: 'FISCALIZED',
  taxpayer_bin_iin: '123456789012',
  taxpayer_name: 'ТОО Maria',
  total: '900.00',
  vat_total: '0.00',
};

const summary: ReceiptSummaryResponse = {
  cashier_membership_id: 'membership-2',
  completed_at: '2026-08-27T09:00:00.000Z',
  currency: 'KZT',
  fiscal_receipt: fiscalReceipt,
  id: 'sale-1',
  payments: [{ amount: '900.00', method: 'CASH' }],
  receipt_number: '42',
  total: '900.00',
};

const receipt: ReceiptResponse = {
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-2',
  cashier_name: 'Бекзат Омаров',
  cashier_session_id: 'cashier-session-2',
  completed_at: summary.completed_at,
  created_at: summary.completed_at,
  currency: 'KZT',
  fiscal_receipt: fiscalReceipt,
  held_at: null,
  id: summary.id,
  items: [
    {
      barcode: '001',
      base_unit_price: '450.00',
      id: 'item-1',
      is_marked: false,
      line_number: 1,
      line_total: '900.00',
      marking_code: null,
      name: 'Молоко',
      nkt_name: 'Молоко',
      ntin_code: null,
      gtin: null,
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '2',
      return_disposition: null,
      returnable_quantity: '1',
      returned_quantity: '1',
      sku: 'MILK',
      source_sale_item_id: null,
      unit_code: 'pcs',
      unit_price: '450.00',
      vat_amount: '0.00',
      vat_rate: 'NONE',
    },
  ],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [
    {
      amount: '900.00',
      change: '100.00',
      completed_at: summary.completed_at,
      created_at: summary.completed_at,
      direction: 'INCOMING',
      id: 'payment-1',
      method: 'CASH',
      received: '1000.00',
      status: 'COMPLETED',
      updated_at: summary.completed_at,
    },
  ],
  receipt_number: summary.receipt_number,
  register_id: cashierSession.register_id,
  register_shift_id: cashierSession.register_shift_id,
  return_reason: null,
  status: 'COMPLETED',
  store_id: cashierSession.store_id,
  total: summary.total,
  transaction_type: 'SALE',
  updated_at: summary.completed_at,
  version: 3,
};

const createClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

const renderView = (
  overrides: Partial<React.ComponentProps<typeof SalesHistoryView>> = {},
) => {
  const props: React.ComponentProps<typeof SalesHistoryView> = {
    cashierSession,
    context,
    onBackToCheckout: vi.fn(),
    onOpenReturn: vi.fn(),
    onPageChange: vi.fn(),
    onReceiptNumberChange: vi.fn(),
    page: 0,
    ...overrides,
  };
  render(
    <QueryClientProvider client={createClient()}>
      <SalesHistoryView {...props} />
    </QueryClientProvider>,
  );
  return props;
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getReceipts).mockResolvedValue({
    meta: { has_more: false, limit: 20, offset: 0, total: 1 },
    receipts: [summary],
  });
  vi.mocked(getReceipt).mockResolvedValue(receipt);
});

afterEach(cleanup);

describe('SalesHistoryView', () => {
  it('loads the receipt page but keeps the detail empty until selection', async () => {
    renderView();

    expect(
      screen.getByText('Выберите чек слева, чтобы посмотреть его содержимое'),
    ).toBeInTheDocument();
    expect(getReceipt).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'Открыть чек №42' }),
    ).toBeInTheDocument();
    expect(getReceipts).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(screen.getByText('1–1 из 1')).toBeInTheDocument();
  });

  it('shows empty receipts and retries a failed list request', async () => {
    const user = userEvent.setup();
    vi.mocked(getReceipts)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        meta: { has_more: false, limit: 20, offset: 0, total: 0 },
        receipts: [],
      });
    renderView();

    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(
      await screen.findByText('В магазине пока нет завершённых продаж'),
    ).toBeInTheDocument();
    expect(getReceipts).toHaveBeenCalledTimes(2);
  });

  it('handles an out-of-range page without showing an impossible range', async () => {
    vi.mocked(getReceipts).mockResolvedValueOnce({
      meta: { has_more: false, limit: 20, offset: 1980, total: 1 },
      receipts: [],
    });
    renderView({ page: 99 });

    expect(
      await screen.findByText('На этой странице нет продаж'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 из 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Назад' })).toBeEnabled();
  });

  it('selects a receipt and displays its complete read-only content', async () => {
    const user = userEvent.setup();
    const onReceiptNumberChange = vi.fn();
    const onOpenReturn = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={createClient()}>
        <SalesHistoryView
          cashierSession={cashierSession}
          context={context}
          onBackToCheckout={vi.fn()}
          onOpenReturn={onOpenReturn}
          onPageChange={vi.fn()}
          onReceiptNumberChange={onReceiptNumberChange}
          page={0}
        />
      </QueryClientProvider>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Открыть чек №42' }),
    );
    expect(onReceiptNumberChange).toHaveBeenCalledWith('42');

    rerender(
      <QueryClientProvider client={createClient()}>
        <SalesHistoryView
          cashierSession={cashierSession}
          context={context}
          onBackToCheckout={vi.fn()}
          onOpenReturn={onOpenReturn}
          onPageChange={vi.fn()}
          onReceiptNumberChange={onReceiptNumberChange}
          page={0}
          receiptNumber="42"
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Бекзат Омаров')).toBeInTheDocument();
    expect(screen.getByText('Молоко')).toBeInTheDocument();
    expect(screen.getByText('Возвращено: 1 шт.')).toBeInTheDocument();
    expect(screen.getAllByText('Наличные').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Печать чека' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Оформить возврат' }));
    expect(onOpenReturn).toHaveBeenCalledWith('42');
  });

  it('validates exact receipt search before opening a detail', async () => {
    const user = userEvent.setup();
    const onReceiptNumberChange = vi.fn();
    renderView({ onReceiptNumberChange });

    const input = screen.getByLabelText('Номер чека');
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Найти чек' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Введите корректный номер чека',
    );
    expect(onReceiptNumberChange).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '42');
    await user.click(screen.getByRole('button', { name: 'Найти чек' }));
    expect(onReceiptNumberChange).toHaveBeenCalledWith('42');
  });

  it('paginates without keeping the current selection', async () => {
    const user = userEvent.setup();
    vi.mocked(getReceipts).mockResolvedValueOnce({
      meta: { has_more: true, limit: 20, offset: 0, total: 21 },
      receipts: [summary],
    });
    const onPageChange = vi.fn();
    const onReceiptNumberChange = vi.fn();
    renderView({
      onPageChange,
      onReceiptNumberChange,
      receiptNumber: '42',
    });

    await user.click(await screen.findByRole('button', { name: 'Далее' }));
    expect(onReceiptNumberChange).not.toHaveBeenCalled();
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('hides return without access and disables it for a fully returned sale', async () => {
    const { rerender } = render(
      <QueryClientProvider client={createClient()}>
        <SalesHistoryView
          cashierSession={cashierSession}
          context={{ ...context, permissions: ['sales.read'] }}
          onBackToCheckout={vi.fn()}
          onOpenReturn={vi.fn()}
          onPageChange={vi.fn()}
          onReceiptNumberChange={vi.fn()}
          page={0}
          receiptNumber="42"
        />
      </QueryClientProvider>,
    );
    await screen.findByText('Бекзат Омаров');
    expect(
      screen.queryByRole('button', { name: 'Оформить возврат' }),
    ).not.toBeInTheDocument();

    vi.mocked(getReceipt).mockResolvedValue({
      ...receipt,
      items: receipt.items.map((item) => ({
        ...item,
        returnable_quantity: '0.000',
        returned_quantity: item.quantity,
      })),
    });
    rerender(
      <QueryClientProvider client={createClient()}>
        <SalesHistoryView
          cashierSession={cashierSession}
          context={context}
          onBackToCheckout={vi.fn()}
          onOpenReturn={vi.fn()}
          onPageChange={vi.fn()}
          onReceiptNumberChange={vi.fn()}
          page={0}
          receiptNumber="43"
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('button', { name: 'Оформить возврат' }),
    ).toBeDisabled();
  });

  it('retries a failed detail request', async () => {
    const user = userEvent.setup();
    vi.mocked(getReceipt)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(receipt);
    renderView({ receiptNumber: '42' });

    await user.click(
      await screen.findByRole('button', { name: 'Повторить загрузку чека' }),
    );
    await waitFor(() => expect(getReceipt).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Бекзат Омаров')).toBeInTheDocument();
  });
});
