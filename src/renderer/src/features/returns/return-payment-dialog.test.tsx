import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReturnPaymentDialog } from './components/return-payment-dialog';

afterEach(cleanup);

describe('ReturnPaymentDialog', () => {
  it('requires an explicit payment choice and shows original payments as a hint only', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReturnPaymentDialog
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
        originalPayments={[{ amount: '100.00', method: 'CASH' }]}
        pending={false}
        total="100.00"
      />,
    );

    expect(
      screen.getByText('В исходном чеке: Наличные — 100,00 ₸'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Наличные' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    ).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );

    expect(onConfirm).toHaveBeenCalledWith([
      { amount: '100.00', method: 'CASHLESS' },
    ]);
  });

  it('requires mixed cash above zero and below total and sends the remainder cashless', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReturnPaymentDialog
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
        pending={false}
        total="100.00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Смешанный' }));
    await user.type(screen.getByLabelText('Наличная часть, ₸'), '100');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );
    expect(
      screen.getByText(
        'Наличная часть должна быть больше нуля и меньше итога.',
      ),
    ).toBeVisible();

    await user.clear(screen.getByLabelText('Наличная часть, ₸'));
    await user.type(screen.getByLabelText('Наличная часть, ₸'), '30.25');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );

    expect(onConfirm).toHaveBeenCalledWith([
      { amount: '30.25', method: 'CASH' },
      { amount: '69.75', method: 'CASHLESS' },
    ]);
  });

  it('includes a valid buyer BIN/IIN in the return request', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReturnPaymentDialog
        onConfirm={onConfirm}
        onOpenChange={vi.fn()}
        open
        pending={false}
        total="100.00"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.type(
      screen.getByLabelText('БИН/ИИН покупателя — по запросу'),
      '123456789012',
    );
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить возврат' }),
    );

    expect(onConfirm).toHaveBeenCalledWith(
      [{ amount: '100.00', method: 'CASHLESS' }],
      '123456789012',
    );
  });
});
