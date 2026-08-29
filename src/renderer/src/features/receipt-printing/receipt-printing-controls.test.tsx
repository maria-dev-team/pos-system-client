import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type SaleResponse,
  getCurrentUser,
  getMyOrganizations,
} from '@renderer/common/api';

import {
  ReceiptPrintButton,
  ReceiptPrinterSettingsButton,
} from './receipt-printing-controls';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getMyOrganizations: vi.fn(),
  };
});

const cashierSession: CashierSessionResponse = {
  actual_cash: null,
  created_at: '2026-08-28T08:00:00.000Z',
  difference: null,
  end_reason: null,
  ended_at: null,
  expected_cash: null,
  id: 'session-1',
  locked_at: null,
  membership_id: 'membership-1',
  opening_cash: '0.00',
  organization_id: 'organization-1',
  register_id: 'register-1',
  register_shift_id: 'shift-1',
  started_at: '2026-08-28T08:00:00.000Z',
  status: 'ACTIVE',
  store_id: 'store-1',
  updated_at: '2026-08-28T08:00:00.000Z',
};

const context: AuthContextResponse = {
  permissions: [],
  storeId: 'store-1',
  storeScope: {
    canAccessAll: false,
    primaryStoreId: 'store-1',
    storeIds: ['store-1'],
    stores: [{ address: 'Абай 1', id: 'store-1', name: 'Магазин №1' }],
  },
  userOrganizationId: 'membership-1',
};

const sale: SaleResponse = {
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: 'session-1',
  completed_at: '2026-08-28T08:15:00.000Z',
  created_at: '2026-08-28T08:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id: 'sale-1',
  items: [
    {
      barcode: '123',
      base_unit_price: '100.00',
      id: 'item-1',
      line_number: 1,
      line_total: '100.00',
      name: 'Товар',
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '1',
      return_disposition: null,
      sku: 'SKU-1',
      source_sale_item_id: null,
      unit_code: 'pcs',
      unit_price: '100.00',
    },
  ],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [
    {
      amount: '100.00',
      change: null,
      completed_at: '2026-08-28T08:15:00.000Z',
      created_at: '2026-08-28T08:14:00.000Z',
      direction: 'INCOMING',
      id: 'payment-1',
      method: 'CASHLESS',
      received: null,
      status: 'COMPLETED',
      updated_at: '2026-08-28T08:15:00.000Z',
    },
  ],
  receipt_number: '42',
  register_id: 'register-1',
  register_shift_id: 'shift-1',
  status: 'COMPLETED',
  store_id: 'store-1',
  total: '100.00',
  transaction_type: 'SALE',
  return_reason: null,
  updated_at: '2026-08-28T08:15:00.000Z',
  version: 2,
};

const queryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

const renderWithClient = (children: ReactNode) =>
  render(
    <QueryClientProvider client={queryClient()}>
      {children}
    </QueryClientProvider>,
  );

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('receipt printing controls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue({
      created_at: '2026-01-01T00:00:00.000Z',
      email: 'cashier@example.com',
      first_name: 'Айжан',
      id: 'user-1',
      is_onboarded: true,
      last_name: 'Қасымова',
      phone: '+77000000000',
    });
    vi.mocked(getMyOrganizations).mockResolvedValue([
      {
        membership_id: 'membership-1',
        organization: {
          address: 'Алматы',
          bin_iin: '123456789012',
          created_at: '2026-01-01T00:00:00.000Z',
          default_currency: 'KZT',
          deleted_at: null,
          id: 'organization-1',
          language: 'ru',
          legal_form: 'TOO',
          legal_name: 'ТОО Maria',
          name: 'Maria',
          timezone: 'Asia/Almaty',
          trade_name: 'Maria Market',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        position: null,
        status: 'ACTIVE',
      },
    ]);
    window.receiptPrinter = {
      getPrinters: vi
        .fn()
        .mockResolvedValue([
          { description: 'USB', displayName: 'XPrinter', name: 'XP-58IIH' },
        ]),
      print: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.receiptPrinter;
  });

  it('saves paper width with the thin print threshold', async () => {
    const user = userEvent.setup();
    renderWithClient(<ReceiptPrinterSettingsButton />);

    await user.click(screen.getByRole('button', { name: 'Настроить принтер' }));
    await user.selectOptions(
      await screen.findByLabelText('Принтер'),
      'XP-58IIH',
    );
    await user.selectOptions(screen.getByLabelText('Ширина бумаги'), '80');
    expect(screen.queryByLabelText('Толщина печати')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(
      JSON.parse(window.localStorage.getItem('maria.receipt-printer') ?? ''),
    ).toEqual({
      deviceName: 'XP-58IIH',
      paperWidthMm: 80,
      rasterThreshold: 112,
    });
  });

  it('resets a disappeared stored printer before saving', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'maria.receipt-printer',
      JSON.stringify({ deviceName: 'Removed printer', paperWidthMm: 58 }),
    );
    renderWithClient(<ReceiptPrinterSettingsButton />);

    await user.click(screen.getByRole('button', { name: 'Настроить принтер' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Сохранённый принтер недоступен.',
    );
    expect(screen.getByLabelText('Принтер')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(
      JSON.parse(window.localStorage.getItem('maria.receipt-printer') ?? ''),
    ).toEqual({
      deviceName: null,
      paperWidthMm: 58,
      rasterThreshold: 112,
    });
  });

  it('keeps the settings open when storage is unavailable', async () => {
    const user = userEvent.setup();
    const setItem = vi
      .spyOn(window.localStorage, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('Storage unavailable');
      });
    renderWithClient(<ReceiptPrinterSettingsButton />);

    await user.click(screen.getByRole('button', { name: 'Настроить принтер' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось сохранить настройки принтера.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    setItem.mockRestore();
  });

  it('prints the completed sale with resolved receipt metadata', async () => {
    const user = userEvent.setup();
    const printing = deferred<{ ok: true }>();
    vi.mocked(window.receiptPrinter!.print).mockReturnValue(printing.promise);
    window.localStorage.setItem(
      'maria.receipt-printer',
      JSON.stringify({ deviceName: 'XP-58IIH', paperWidthMm: 80 }),
    );
    renderWithClient(
      <ReceiptPrintButton
        cashierSession={cashierSession}
        context={context}
        sale={sale}
      />,
    );

    const printButton = screen.getByRole('button', { name: 'Печать чека' });
    await user.click(printButton);

    await waitFor(() =>
      expect(window.receiptPrinter?.print).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceName: 'XP-58IIH',
          paperWidthMm: 80,
          rasterThreshold: 112,
          receipt: expect.objectContaining({
            cashier: 'Айжан Қасымова',
            receiptNumber: '42',
          }),
        }),
      ),
    );
    expect(printButton).toBeDisabled();
    printing.resolve({ ok: true });
    await waitFor(() => expect(printButton).toBeEnabled());
  });

  it('previews the same 58 mm document that will be rasterized', async () => {
    const user = userEvent.setup();
    renderWithClient(<ReceiptPrinterSettingsButton />);

    await user.click(screen.getByRole('button', { name: 'Настроить принтер' }));
    await user.selectOptions(
      await screen.findByLabelText('Принтер'),
      'XP-58IIH',
    );
    await user.click(screen.getByRole('button', { name: 'Тестовая печать' }));

    const preview = await screen.findByRole('dialog', {
      name: 'Предпросмотр тестового чека',
    });
    expect(window.receiptPrinter?.print).not.toHaveBeenCalled();
    const documentPreview = within(preview).getByTitle(
      'Содержимое тестового чека',
    );
    expect(documentPreview.getAttribute('srcdoc')).toContain(
      'НЕФИСКАЛЬНЫЙ ЧЕК',
    );
    expect(documentPreview.getAttribute('srcdoc')).toContain(
      'Ә Ғ Қ Ң Ө Ұ Ү Һ І',
    );
    expect(documentPreview).toHaveStyle({ width: '181px' });
    expect(
      within(preview).getByText(/Ширина бумаги: 58 мм/),
    ).toBeInTheDocument();

    await user.click(within(preview).getByRole('button', { name: 'Печатать' }));

    await waitFor(() =>
      expect(window.receiptPrinter?.print).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceName: 'XP-58IIH',
          paperWidthMm: 58,
          rasterThreshold: 112,
          receipt: expect.objectContaining({ receiptNumber: 'TEST' }),
        }),
      ),
    );
  });

  it('prints an 80 mm test receipt', async () => {
    const user = userEvent.setup();
    renderWithClient(<ReceiptPrinterSettingsButton />);

    await user.click(screen.getByRole('button', { name: 'Настроить принтер' }));
    await user.selectOptions(screen.getByLabelText('Ширина бумаги'), '80');
    await user.click(screen.getByRole('button', { name: 'Тестовая печать' }));
    const preview = await screen.findByRole('dialog', {
      name: 'Предпросмотр тестового чека',
    });
    await user.click(within(preview).getByRole('button', { name: 'Печатать' }));

    await waitFor(() =>
      expect(window.receiptPrinter?.print).toHaveBeenCalledWith(
        expect.objectContaining({ paperWidthMm: 80, rasterThreshold: 112 }),
      ),
    );
  });

  it('recovers when the test print bridge rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(window.receiptPrinter!.print).mockRejectedValue(
      new Error('IPC failed'),
    );
    renderWithClient(<ReceiptPrinterSettingsButton />);

    await user.click(screen.getByRole('button', { name: 'Настроить принтер' }));
    await user.click(screen.getByRole('button', { name: 'Тестовая печать' }));
    const preview = await screen.findByRole('dialog', {
      name: 'Предпросмотр тестового чека',
    });
    const printButton = within(preview).getByRole('button', {
      name: 'Печатать',
    });
    await user.click(printButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось отправить тестовый чек.',
    );
    expect(printButton).toBeEnabled();
  });

  it('opens printer settings when the selected device disappeared', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'maria.receipt-printer',
      JSON.stringify({ deviceName: 'XP-58IIH', paperWidthMm: 58 }),
    );
    vi.mocked(window.receiptPrinter!.print).mockResolvedValue({
      code: 'PRINTER_NOT_FOUND',
      message: 'Выбранный принтер недоступен.',
      ok: false,
    });
    renderWithClient(
      <ReceiptPrintButton
        cashierSession={cashierSession}
        context={context}
        sale={sale}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Печать чека' }));

    expect(
      await screen.findByRole('dialog', { name: 'Принтер чека' }),
    ).toBeInTheDocument();
  });
});
