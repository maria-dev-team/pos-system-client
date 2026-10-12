import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
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

function setup(
  onAdd = vi.fn(async () => undefined),
  barcode = product.barcode,
) {
  const client = createQueryClient();
  const onClose = vi.fn();
  const rendered = render(
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
    { target: { value: barcode } },
  );
  return { onAdd, onClose, unmount: rendered.unmount };
}

beforeEach(() => {
  vi.resetAllMocks();
  onlineManager.setOnline(false);
  vi.mocked(callLocalPos).mockResolvedValue({ product, quantity: '1' });
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

it('reads the local catalog while offline without sale commands', async () => {
  const { onAdd } = setup();
  expect(await screen.findByText('650,00 ₸')).toBeInTheDocument();
  expect(callLocalPos).toHaveBeenCalledExactlyOnceWith({
    type: 'resolveScan',
    barcode: product.barcode,
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
    product: { ...product, organization_id: 'another-organization' },
    quantity: '1',
  });
  const { onAdd } = setup();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Ответ поиска относится к другой организации.',
  );
  expect(screen.queryByText('650,00 ₸')).not.toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});

it('checks a weight label without a sale command and adds its exact quantity only on click', async () => {
  const weighted = { ...product, unit: 'kg' as const, scale_plu: 1 };
  vi.mocked(callLocalPos).mockImplementation(async (command) =>
    command.type === 'resolveScan'
      ? { product: weighted, quantity: '0.185' }
      : { ...result, products: [] },
  );
  const { onAdd, onClose } = setup(undefined, '2000001001851');
  expect(await screen.findByText('650,00 ₸')).toBeInTheDocument();
  expect(callLocalPos).toHaveBeenCalledWith({
    type: 'resolveScan',
    barcode: '2000001001851',
  });
  expect(onAdd).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: `Добавить в чек ${product.name}` }),
  );
  expect(onAdd).toHaveBeenCalledWith(weighted, undefined, '0.185');
  expect(onClose).toHaveBeenCalledOnce();
});

it('keeps a text price search on the ordinary catalog path', async () => {
  vi.mocked(callLocalPos).mockResolvedValue(result);
  setup(undefined, product.name);
  expect(await screen.findByText('650,00 ₸')).toBeInTheDocument();
  expect(callLocalPos).toHaveBeenCalledExactlyOnceWith({
    type: 'search',
    search: product.name,
    limit: 20,
    offset: 0,
    quickOnly: undefined,
  });
});

it('blocks addition when a reserved prefix becomes conflicted after preview', async () => {
  const weighted = { ...product, unit: 'kg' as const, scale_plu: 1 };
  vi.mocked(callLocalPos).mockResolvedValue({
    product: weighted,
    quantity: '0.185',
  });
  const { onAdd, onClose } = setup(undefined, '2000001001851');
  const add = await screen.findByRole('button', {
    name: `Добавить в чек ${product.name}`,
  });
  vi.mocked(callLocalPos).mockRejectedValue(
    new PosError('SCALE_BARCODE_CONFLICT', 'Конфликт префикса весов.'),
  );
  await userEvent.click(add);
  expect(onAdd).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Конфликт префикса весов.',
  );
});

it('does not add a different product if the scanned label changes after preview', async () => {
  const weighted = { ...product, unit: 'kg' as const, scale_plu: 1 };
  vi.mocked(callLocalPos).mockResolvedValue({
    product: weighted,
    quantity: '0.185',
  });
  const { onAdd, onClose } = setup(undefined, '2000001001851');
  const add = await screen.findByRole('button', {
    name: `Добавить в чек ${product.name}`,
  });
  vi.mocked(callLocalPos).mockResolvedValue({
    product: { ...weighted, id: ids.shift },
    quantity: '0.185',
  });
  await userEvent.click(add);
  expect(onAdd).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent('изменился');
});

it('does not add a resolved label after the price dialog leaves the workspace', async () => {
  const weighted = { ...product, unit: 'kg' as const, scale_plu: 1 };
  vi.mocked(callLocalPos).mockResolvedValue({
    product: weighted,
    quantity: '0.185',
  });
  const { onAdd, onClose, unmount } = setup(undefined, '2000001001851');
  const add = await screen.findByRole('button', {
    name: `Добавить в чек ${product.name}`,
  });
  let finish!: (value: { product: typeof weighted; quantity: string }) => void;
  vi.mocked(callLocalPos).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(add);
  expect(finish).toBeTypeOf('function');
  unmount();
  await act(async () => finish({ product: weighted, quantity: '0.185' }));
  expect(onAdd).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
