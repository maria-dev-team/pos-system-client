import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SaleResponse } from '@renderer/common/api';

import { CheckoutPaymentDialog } from './checkout-payment-dialog';

const saleFixture = (overrides: Partial<SaleResponse> = {}): SaleResponse => ({
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: 'session-1',
  completed_at: null,
  created_at: '2026-08-25T10:00:00.000Z',
  currency: 'KZT',
  discount_amount: '0.00',
  discount_applied_by_membership_id: null,
  discount_percentage: null,
  discount_reason: null,
  held_at: null,
  id: 'sale-1',
  items: [],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [],
  receipt_number: null,
  register_id: 'register-1',
  register_shift_id: 'shift-1',
  status: 'DRAFT',
  store_id: 'store-1',
  subtotal: '100.00',
  total: '100.00',
  transaction_type: 'SALE',
  return_reason: null,
  updated_at: '2026-08-25T10:00:00.000Z',
  version: 3,
  ...overrides,
  fiscal_receipt: overrides.fiscal_receipt ?? null,
});

const renderDialog = (
  overrides: Partial<React.ComponentProps<typeof CheckoutPaymentDialog>> = {},
) => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const result = render(
    <CheckoutPaymentDialog
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open
      pending={false}
      sale={saleFixture()}
      {...overrides}
    />,
  );
  return { ...result, onConfirm, onOpenChange };
};

afterEach(cleanup);

describe('CheckoutPaymentDialog', () => {
  it('lets the cashier choose a non-fiscal check in selective mode', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      fiscalizationPolicy: 'SELECTIVE',
    });

    await user.type(screen.getByLabelText('Получено наличными, ₸'), '100');
    await user.click(screen.getByRole('radio', { name: 'Без фискализации' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(onConfirm).toHaveBeenCalledWith(
      [{ amount: '100.00', method: 'CASH', received: '100' }],
      undefined,
      'NON_FISCAL',
    );
  });

  it('submits exact cash payment and shows change', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.type(screen.getByLabelText('Получено наличными, ₸'), '120');

    expect(screen.getByText('20,00 ₸')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(onConfirm).toHaveBeenCalledWith([
      { amount: '100.00', method: 'CASH', received: '120' },
    ]);
  });

  it('fills exact cash without submitting and adds banknotes cumulatively', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      sale: saleFixture({ total: '1234.50' }),
    });
    const received = screen.getByLabelText('Получено наличными, ₸');
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 1000 ₸' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 2000 ₸' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 5000 ₸' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 10000 ₸' }),
    );
    expect(received).toHaveValue('18000.00');
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Без сдачи' }));
    expect(received).toHaveValue('1234.50');
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 1000 ₸' }),
    );
    expect(received).toHaveValue('2234.50');
    expect(screen.getByText('1 000,00 ₸')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(onConfirm).toHaveBeenCalledWith([
      { method: 'CASH', amount: '1234.50', received: '2234.50' },
    ]);
  });

  it('uses the cash portion for exact mixed receipts and keeps banknotes out of the split', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      sale: saleFixture({ total: '6500.00' }),
    });
    await user.click(screen.getByRole('button', { name: 'Смешанная' }));
    const exact = screen.getByRole('button', {
      name: 'Получено ровно наличную часть',
    });
    const cash = screen.getByLabelText('Наличная часть, ₸');
    const received = screen.getByLabelText('Получено наличными, ₸');
    expect(exact).toBeDisabled();
    for (const value of ['0', '6500', '7000', '1.234']) {
      fireEvent.change(cash, { target: { value } });
      expect(exact).toBeDisabled();
    }
    fireEvent.change(cash, { target: { value: '1500.50' } });
    await user.click(exact);
    expect(received).toHaveValue('1500.50');
    expect(screen.getByText('4 999,50 ₸')).toBeInTheDocument();
    fireEvent.change(cash, { target: { value: '2000.50' } });
    await user.click(exact);
    expect(received).toHaveValue('2000.50');
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 5000 ₸' }),
    );
    expect(cash).toHaveValue('2000.50');
    expect(received).toHaveValue('7000.50');
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(onConfirm).toHaveBeenCalledWith([
      { method: 'CASH', amount: '2000.50', received: '7000.50' },
      { method: 'CASHLESS', amount: '4499.50' },
    ]);
  });

  it('adds banknotes to the mixed cash portion independently and updates the cashless remainder', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      sale: saleFixture({ total: '25000.00' }),
    });
    await user.click(screen.getByRole('button', { name: 'Смешанная' }));
    const cash = screen.getByLabelText('Наличная часть, ₸');
    const received = screen.getByLabelText('Получено наличными, ₸');
    for (const amount of [1000, 2000, 5000, 10000]) {
      await user.click(
        screen.getByRole('button', {
          name: `Добавить ${amount} ₸ к наличной части`,
        }),
      );
    }
    expect(cash).toHaveValue('18000.00');
    expect(received).toHaveValue('');
    expect(screen.getByText('7 000,00 ₸')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Получено ровно наличную часть' }),
    );
    expect(received).toHaveValue('18000.00');
    await user.click(
      screen.getByRole('button', { name: 'Добавить купюру 1000 ₸' }),
    );
    expect(cash).toHaveValue('18000.00');
    expect(received).toHaveValue('19000.00');
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(onConfirm).toHaveBeenCalledWith([
      { amount: '18000.00', method: 'CASH', received: '19000.00' },
      { amount: '7000.00', method: 'CASHLESS' },
    ]);
  });

  it('preserves invalid cash input and disables both banknote groups while confirming', async () => {
    const user = userEvent.setup();
    const sale = saleFixture({ total: '6500.00' });
    const { rerender, onConfirm, onOpenChange } = renderDialog({ sale });
    await user.click(screen.getByRole('button', { name: 'Смешанная' }));
    const cash = screen.getByLabelText('Наличная часть, ₸');
    fireEvent.change(cash, { target: { value: '1.234' } });
    expect(
      screen.getByRole('button', { name: 'Добавить 1000 ₸ к наличной части' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Добавить купюру 1000 ₸' }),
    ).toBeEnabled();
    expect(cash).toHaveValue('1.234');
    fireEvent.change(cash, { target: { value: '500.50' } });
    await user.click(
      screen.getByRole('button', { name: 'Добавить 1000 ₸ к наличной части' }),
    );
    expect(cash).toHaveValue('1500.50');
    rerender(
      <CheckoutPaymentDialog
        sale={sale}
        open
        pending
        onConfirm={onConfirm}
        onOpenChange={onOpenChange}
      />,
    );
    for (const amount of [1000, 2000, 5000, 10000]) {
      expect(
        screen.getByRole('button', {
          name: `Добавить ${amount} ₸ к наличной части`,
        }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: `Добавить купюру ${amount} ₸` }),
      ).toBeDisabled();
    }
  });

  it('does not silently discard invalid received input when adding banknotes', async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByLabelText('Получено наличными, ₸');
    fireEvent.change(input, { target: { value: '1.234' } });
    const banknote = screen.getByRole('button', {
      name: 'Добавить купюру 1000 ₸',
    });
    expect(banknote).toBeDisabled();
    await user.click(banknote);
    expect(input).toHaveValue('1.234');
    await user.clear(input);
    expect(banknote).toBeEnabled();
    await user.click(banknote);
    expect(input).toHaveValue('1000.00');
  });

  it('includes a valid buyer BIN/IIN when requested', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.type(
      screen.getByLabelText('БИН/ИИН покупателя — по запросу'),
      '123456789012',
    );
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(onConfirm).toHaveBeenCalledWith(
      [{ amount: '100.00', method: 'CASHLESS' }],
      '123456789012',
    );
  });

  it('submits once when two events arrive before pending updates', async () => {
    const user = userEvent.setup();
    let settle: (() => void) | undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    renderDialog({ onConfirm });

    await user.type(screen.getByLabelText('Получено наличными, ₸'), '120');
    const form = screen
      .getByRole('button', { name: 'Подтвердить оплату' })
      .closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);

    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => settle?.());
    fireEvent.submit(form as HTMLFormElement);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('submits the exact server total for cashless payment without input', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Безналичные' }));

    expect(
      screen.queryByLabelText('Получено наличными, ₸'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(onConfirm).toHaveBeenCalledWith([
      { amount: '100.00', method: 'CASHLESS' },
    ]);
  });

  it('submits exact mixed payments and shows cashless remainder and change', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Смешанная' }));
    await user.type(screen.getByLabelText('Наличная часть, ₸'), '40.50');
    await user.type(screen.getByLabelText('Получено наличными, ₸'), '50');

    expect(screen.getByText('59,50 ₸')).toBeInTheDocument();
    expect(screen.getByText('9,50 ₸')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(onConfirm).toHaveBeenCalledWith([
      { amount: '40.50', method: 'CASH', received: '50' },
      { amount: '59.50', method: 'CASHLESS' },
    ]);
  });

  it('keeps invalid input and clears inline and server errors on edit', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      serverErrorMessage: 'Оплата отклонена сервером',
    });
    const input = screen.getByLabelText('Получено наличными, ₸');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Оплата отклонена сервером',
    );
    await user.type(input, '99.99');
    expect(
      screen.queryByText('Оплата отклонена сервером'),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(input).toHaveValue('99.99');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Полученной суммы недостаточно',
    );
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(input, '1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveValue('99.991');
  });

  it('rejects zero and full-total cash parts without clearing mixed inputs', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Смешанная' }));
    const cashAmount = screen.getByLabelText('Наличная часть, ₸');
    const cashReceived = screen.getByLabelText('Получено наличными, ₸');
    await user.type(cashAmount, '0');
    await user.type(cashReceived, '50');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(cashAmount).toHaveValue('0');
    expect(cashReceived).toHaveValue('50');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'больше нуля и меньше итога',
    );

    await user.clear(cashAmount);
    await user.type(cashAmount, '100');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(cashAmount).toHaveValue('100');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('keeps payment input when async confirmation rejects', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('rejected'));
    const { rerender } = renderDialog({ onConfirm });

    await user.type(screen.getByLabelText('Получено наличными, ₸'), '120');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    rerender(
      <CheckoutPaymentDialog
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
        pending={false}
        sale={saleFixture()}
        serverErrorMessage="Оплата отклонена сервером"
      />,
    );

    expect(screen.getByLabelText('Получено наличными, ₸')).toHaveValue('120');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Оплата отклонена сервером',
    );
  });

  it('shows only the authoritative server total', () => {
    renderDialog();
    expect(screen.getByLabelText('Сумма на сервере')).toHaveTextContent(
      '100,00 ₸',
    );
    expect(screen.queryByLabelText('Локальная сумма')).not.toBeInTheDocument();
  });

  it('disables closing, modes, input, and confirmation while pending', () => {
    renderDialog({ pending: true });

    expect(
      screen.queryByRole('button', { name: 'Закрыть' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Наличные' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Безналичные' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Смешанная' })).toBeDisabled();
    expect(screen.getByLabelText('Получено наличными, ₸')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Без сдачи' })).toBeDisabled();
    for (const amount of [1000, 2000, 5000, 10000]) {
      expect(
        screen.getByRole('button', { name: `Добавить купюру ${amount} ₸` }),
      ).toBeDisabled();
    }
    expect(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    ).toBeDisabled();
  });

  it('resets payment fields after the parent closes the dialog', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog();

    await user.type(screen.getByLabelText('Получено наличными, ₸'), '120');
    rerender(
      <CheckoutPaymentDialog
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        open={false}
        pending={false}
        sale={saleFixture()}
      />,
    );
    rerender(
      <CheckoutPaymentDialog
        onConfirm={vi.fn()}
        onOpenChange={vi.fn()}
        open
        pending={false}
        sale={saleFixture()}
      />,
    );

    expect(screen.getByLabelText('Получено наличными, ₸')).toHaveValue('');
  });
});
