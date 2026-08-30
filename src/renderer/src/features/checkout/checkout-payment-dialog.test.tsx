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

  it('disables closing, modes, input, keypad, and confirmation while pending', () => {
    renderDialog({ pending: true });

    expect(
      screen.queryByRole('button', { name: 'Закрыть' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Наличные' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Безналичные' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Смешанная' })).toBeDisabled();
    expect(screen.getByLabelText('Получено наличными, ₸')).toBeDisabled();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
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
