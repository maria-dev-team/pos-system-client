import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { callLocalPos } from '@renderer/common/lib/local-pos';
import { createQueryClient } from '@renderer/common/lib/query-client';

import { PosError } from '../../../../shared/pos/contracts';
import { ids, productFixture } from '../../../../shared/pos/test-fixtures';
import { CheckoutPriceCheckDialog } from './checkout-price-check-dialog';

vi.mock('@renderer/common/lib/local-pos', () => ({
  localPosActive: () => true,
  callLocalPos: vi.fn(),
}));

const product = productFixture();
const result = {
  products: [product],
  meta: { total: 1, limit: 20, offset: 0, has_more: false },
};

function setup(onAdd = vi.fn(async () => undefined)) {
  const client = createQueryClient();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <CheckoutPriceCheckDialog
        canAdd
        onAdd={onAdd}
        onClose={onClose}
        organizationId={ids.organization}
        storeId={ids.store}
      />
    </QueryClientProvider>,
  );
  fireEvent.change(
    screen.getByLabelText('Название или штрихкод для проверки цены'),
    { target: { value: product.barcode } },
  );
  return { onAdd, onClose };
}

beforeEach(() => {
  vi.resetAllMocks();
  onlineManager.setOnline(false);
  vi.mocked(callLocalPos).mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

it('reads the local catalog while offline without sale commands', async () => {
  const { onAdd } = setup();
  expect(await screen.findByText('650,00 ₸')).toBeInTheDocument();
  expect(callLocalPos).toHaveBeenCalledExactlyOnceWith({
    type: 'search',
    search: product.barcode,
    limit: 20,
    offset: 0,
    quickOnly: undefined,
  });
  expect(onAdd).not.toHaveBeenCalled();
});

it('offers retry after a catalog failure without adding anything', async () => {
  vi.mocked(callLocalPos).mockRejectedValueOnce(
    new PosError('LOCAL_UNAVAILABLE', 'Каталог недоступен.'),
  );
  const { onAdd } = setup();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Каталог недоступен.',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Повторить поиск' }),
  );
  expect(await screen.findByText('650,00 ₸')).toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});

it('retains the price dialog and reports a failed explicit addition', async () => {
  const onAdd = vi.fn(async () => {
    throw new PosError('LOCAL_UNAVAILABLE', 'Не удалось сохранить чек.');
  });
  const { onClose } = setup(onAdd);
  const button = await screen.findByRole('button', {
    name: `Добавить в чек ${product.name}`,
  });
  await userEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Не удалось сохранить чек.',
  );
  await waitFor(() => expect(button).toBeEnabled());
  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});

it('rejects products belonging to another organization', async () => {
  vi.mocked(callLocalPos).mockResolvedValue({
    ...result,
    products: [{ ...product, organization_id: 'another-organization' }],
  });
  const { onAdd } = setup();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Ответ поиска относится к другой организации.',
  );
  expect(screen.queryByText('650,00 ₸')).not.toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});
