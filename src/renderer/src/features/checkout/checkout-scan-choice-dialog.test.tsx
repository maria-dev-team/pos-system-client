import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import type { ScanCandidate } from '../../../../shared/pos/barcode-scan';
import { CheckoutScanChoiceDialog } from './checkout-scan-choice-dialog';

const staticCandidate: ScanCandidate = {
  kind: 'static',
  product_id: 'product-1',
  name: 'Яблоки',
  unit: 'kg',
  quantity: null,
  retail_price: '1000.00',
  unavailable_reason: null,
};
const weightedCandidate: ScanCandidate = {
  ...staticCandidate,
  kind: 'weighted',
  quantity: '0.185',
};
afterEach(cleanup);
function setup(
  onConfirm = vi.fn(async (): Promise<unknown> => undefined),
  candidates = [staticCandidate, weightedCandidate],
) {
  const onClose = vi.fn();
  render(
    <CheckoutScanChoiceDialog
      ambiguity={{ current_version: 5, candidates }}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

it('requires explicit weight for a static kilogram candidate and keeps it separate from label weight', async () => {
  const f = setup();
  await userEvent.click(
    screen.getByRole('button', { name: /Весовая этикетка/ }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: /Обычный штрихкод/ }),
  );
  const weight = screen.getByLabelText('Вес обычного товара, кг');
  expect(weight).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Добавить в чек' }));
  expect(f.onConfirm).not.toHaveBeenCalled();
  await userEvent.type(weight, '0,420');
  await userEvent.click(screen.getByRole('button', { name: 'Добавить в чек' }));
  expect(f.onConfirm).toHaveBeenCalledExactlyOnceWith(staticCandidate, '0.420');
});

it('cancels without a sale command', async () => {
  const f = setup();
  await userEvent.click(
    screen.getByRole('button', { name: /Весовая этикетка/ }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
  expect(f.onConfirm).not.toHaveBeenCalled();
  expect(f.onClose).toHaveBeenCalledOnce();
});

it('blocks rapid duplicate confirmations and further attempts after an uncertain failure', async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, rejectPromise) => {
    reject = rejectPromise;
  });
  const f = setup(vi.fn(() => pending));
  await userEvent.click(
    screen.getByRole('button', { name: /Весовая этикетка/ }),
  );
  const confirm = screen.getByRole('button', { name: 'Добавить в чек' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(f.onConfirm).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Connection lost')));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(confirm).toBeDisabled();
  fireEvent.click(confirm);
  expect(f.onConfirm).toHaveBeenCalledTimes(1);
});

it('disables inactive and missing-price candidates and never invents identity for absent cards', () => {
  setup(undefined, [
    { ...staticCandidate, unavailable_reason: 'PRODUCT_NOT_SELLABLE' },
    {
      ...weightedCandidate,
      retail_price: null,
      unavailable_reason: 'PRODUCT_SALE_PRICE_REQUIRED',
    },
    {
      ...weightedCandidate,
      product_id: null,
      name: null,
      retail_price: null,
      unavailable_reason: 'PRODUCT_NOT_FOUND',
    },
  ]);
  expect(screen.getByText('Этот товар нельзя продавать')).toBeInTheDocument();
  expect(
    screen.getByText('Для товара не указана цена продажи'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Товар недоступен в этом магазине'),
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', {
      name: /Обычный штрихкод|Весовая этикетка/,
    }),
  ).toSatisfy((buttons: HTMLButtonElement[]) =>
    buttons.every((button) => button.disabled),
  );
  expect(screen.getAllByText('Яблоки')).toHaveLength(2);
});
