import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import type { ReactNode } from 'react';
import { Toaster, toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type HeldSaleResponse,
  type ProductResponse,
  type ProductSearchResponse,
  type SaleItemResponse,
  type SaleResponse,
  addSaleItem,
  cancelSale,
  checkoutSale,
  createSale,
  endCashierSession,
  getAuthContext,
  getCurrentSale,
  getHeldSales,
  getSale,
  holdSale,
  overrideSaleItemPrice,
  removeSaleItem,
  resetSaleItemPrice,
  resumeSale,
  scanSaleItem,
  searchProducts,
  setSaleItemQuantity,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

import { CheckoutView, useCheckoutCartStore } from './index';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();

  return {
    ...actual,
    addSaleItem: vi.fn(),
    cancelSale: vi.fn(),
    checkoutSale: vi.fn(),
    createSale: vi.fn(),
    endCashierSession: vi.fn(),
    getAuthContext: vi.fn(),
    getCurrentSale: vi.fn(),
    getHeldSales: vi.fn(),
    getSale: vi.fn(),
    holdSale: vi.fn(),
    overrideSaleItemPrice: vi.fn(),
    removeSaleItem: vi.fn(),
    resetSaleItemPrice: vi.fn(),
    resumeSale: vi.fn(),
    scanSaleItem: vi.fn(),
    searchProducts: vi.fn(),
    setSaleItemQuantity: vi.fn(),
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

const contextFixture = (
  permissions: string[] = [
    'product.read',
    'sales.cancel',
    'sales.modify',
    'sales.price.override',
  ],
): AuthContextResponse => ({
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
});

const productSearchFixture = (
  products: ProductResponse[],
): ProductSearchResponse => ({
  meta: { has_more: false, limit: 20, offset: 0, total: products.length },
  products,
});

const itemFixture = (
  overrides: Partial<SaleItemResponse> = {},
): SaleItemResponse => ({
  barcode: '001234',
  base_unit_price: '650.00',
  id: 'item-1',
  line_number: 1,
  line_total: '650.00',
  name: 'Молоко',
  price_override_reason: null,
  price_overridden_by_membership_id: null,
  product_id: 'product-1',
  quantity: '1',
  sku: 'MILK-1',
  unit_code: 'pcs',
  unit_price: '650.00',
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
  payments: [],
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  status: 'DRAFT',
  store_id: 'store-1',
  total: '0.00',
  updated_at: '2026-08-24T10:00:00.000Z',
  version: 1,
  ...overrides,
});

const heldFixture = (
  overrides: Partial<HeldSaleResponse> = {},
): HeldSaleResponse => ({
  created_at: '2026-08-24T10:00:00.000Z',
  held_at: '2026-08-24T10:05:00.000Z',
  id: 'sale-held-1',
  items_count: 2,
  status: 'HELD',
  total: '1300.00',
  version: 2,
  ...overrides,
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

function TestShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const renderCheckout = (
  options: {
    onRetrySession?: () => void;
    onSessionEnded?: () => void;
    queryClient?: QueryClient;
    session?: CashierSessionResponse;
  } = {},
) => {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const onSessionEnded = options.onSessionEnded ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TestShell>
        <CheckoutView
          cashierSession={options.session ?? cashierSession}
          onRetrySession={options.onRetrySession}
          onSessionEnded={onSessionEnded}
        />
        <Toaster />
      </TestShell>
    </QueryClientProvider>,
  );
  return { onSessionEnded, queryClient };
};

const salesMutations = () => [
  addSaleItem,
  cancelSale,
  checkoutSale,
  createSale,
  holdSale,
  overrideSaleItemPrice,
  removeSaleItem,
  resetSaleItemPrice,
  resumeSale,
  scanSaleItem,
  setSaleItemQuantity,
];

const expectNoSalesMutation = () => {
  for (const mutation of salesMutations()) {
    expect(mutation).not.toHaveBeenCalled();
  }
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
};

const responseError = (code: string, status: number) =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    config: {} as never,
    data: { error_code: code },
    headers: {},
    status,
    statusText: 'Request failed',
  });

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  useCheckoutCartStore.setState({ sessions: {} });
  vi.mocked(getAuthContext).mockResolvedValue(contextFixture());
  vi.mocked(getCurrentSale).mockResolvedValue(null);
  vi.mocked(searchProducts).mockResolvedValue(productSearchFixture([]));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('local-first checkout', () => {
  it('opens the search keyboard without an inner scroll container', async () => {
    const user = userEvent.setup();
    renderCheckout();

    await user.click(
      await screen.findByRole('button', {
        name: 'Показать виртуальную клавиатуру',
      }),
    );

    const keyboard = screen.getByRole('group', {
      name: 'Виртуальная клавиатура',
    });
    expect(keyboard.parentElement).toHaveClass('overflow-hidden');
    expect(keyboard.parentElement).not.toHaveClass('overflow-auto');
    expect(keyboard.firstElementChild).toHaveClass(
      'maria-virtual-keyboard--compact',
    );
  });

  it('GETs nullable current sale and restores this cashier cart without POST', async () => {
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    useCheckoutCartStore
      .getState()
      .setQuantity(cashierSession.id, 'product-1', '2');

    renderCheckout();

    expect(
      await screen.findByRole('heading', { name: 'Оформление продажи' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 шт.')).toBeInTheDocument();
    expect(screen.getByText('Предварительный итог')).toBeInTheDocument();
    expect(screen.getAllByText('1 300,00 ₸')).not.toHaveLength(0);
    expect(getCurrentSale).toHaveBeenCalledOnce();
    expectNoSalesMutation();
  });

  it('blocks cached checkout state until the re-entry GET settles', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false, staleTime: 30_000 },
      },
    });
    const cached = saleFixture({ items: [itemFixture()], total: '650.00' });
    const request = deferred<SaleResponse | null>();
    queryClient.setQueryData(queryKeys.auth.context(), contextFixture());
    queryClient.setQueryData(
      queryKeys.sales.current(cashierSession.id),
      cached,
    );
    vi.mocked(getCurrentSale).mockReturnValue(request.promise);

    renderCheckout({ queryClient });

    expect(await screen.findByText('Открываем чек')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Сканируйте или найдите товар'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Отменить чек' }),
    ).not.toBeInTheDocument();

    request.resolve(cached);

    expect(
      await screen.findByLabelText('Сканируйте или найдите товар'),
    ).toBeInTheDocument();
  });

  it('adds a manual result locally and disables inactive or unpriced results', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue(
      productSearchFixture([
        productFixture(),
        productFixture({ id: 'inactive', is_active: false, name: 'Архивный' }),
        productFixture({
          id: 'unpriced',
          name: 'Без цены',
          retail_price: null,
        }),
      ]),
    );
    renderCheckout();
    const input = await screen.findByLabelText('Сканируйте или найдите товар');

    await user.type(input, 'молоко');

    const enabled = await screen.findByRole('button', {
      name: 'Добавить товар Молоко',
    });
    expect(
      screen.getByRole('button', { name: 'Добавить товар Архивный' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Добавить товар Без цены' }),
    ).toBeDisabled();
    expect(screen.getByText('Товар неактивен')).toBeInTheDocument();
    expect(screen.getByText('Цена не указана')).toBeInTheDocument();
    await user.click(enabled);

    expect(await screen.findByText('1 шт.')).toBeInTheDocument();
    expect(input).toHaveValue('');
    await waitFor(() => expect(input).toHaveFocus());
    expect(searchProducts).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      search: 'молоко',
    });
    expectNoSalesMutation();
  });

  it('selects only an exact scanner barcode and preserves a rejected code', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts)
      .mockResolvedValueOnce(
        productSearchFixture([
          productFixture({ barcode: '0012345', id: 'fuzzy', name: 'Похожий' }),
        ]),
      )
      .mockResolvedValueOnce(
        productSearchFixture([
          productFixture({ barcode: '1234', id: 'without-zeroes' }),
          productFixture(),
        ]),
      );
    renderCheckout();
    const input = await screen.findByLabelText('Сканируйте или найдите товар');

    await user.type(input, '00123{Enter}');

    expect(
      await screen.findByText('Товар с кодом 00123 не найден'),
    ).toBeInTheDocument();
    expect(input).toHaveValue('');
    await user.click(
      screen.getByRole('button', { name: 'Вернуть код 00123 в поле' }),
    );
    expect(input).toHaveValue('00123');
    expect(input).toHaveFocus();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id],
    ).toBeUndefined();

    await user.clear(input);
    await user.type(input, ' 001234 {Enter}');

    expect(await screen.findByText('Молоко')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(searchProducts).toHaveBeenNthCalledWith(2, {
      limit: 20,
      offset: 0,
      search: '001234',
    });
    expectNoSalesMutation();
  });

  it('serializes rapid local scans per cashier session', async () => {
    const user = userEvent.setup();
    const first = deferred<ProductSearchResponse>();
    vi.mocked(searchProducts)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        productSearchFixture([
          productFixture({
            barcode: '002222',
            id: 'product-2',
            name: 'Хлеб',
          }),
        ]),
      );
    renderCheckout();
    const input = await screen.findByLabelText('Сканируйте или найдите товар');

    await user.type(input, '001234{Enter}');
    await waitFor(() => expect(searchProducts).toHaveBeenCalledOnce());
    expect(input).toHaveValue('');
    await user.type(input, '002222{Enter}');
    expect(searchProducts).toHaveBeenCalledOnce();

    first.resolve(productSearchFixture([productFixture()]));

    await waitFor(() => expect(searchProducts).toHaveBeenCalledTimes(2));
    expect(searchProducts).toHaveBeenNthCalledWith(2, {
      limit: 20,
      offset: 0,
      search: '002222',
    });
    expect(await screen.findByText('Хлеб')).toBeInTheDocument();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id]?.items,
    ).toHaveLength(2);
    expectNoSalesMutation();
  });

  it('does not let a late scan result erase newer input', async () => {
    const user = userEvent.setup();
    const scan = deferred<ProductSearchResponse>();
    vi.mocked(searchProducts).mockReturnValueOnce(scan.promise);
    renderCheckout();
    const input = await screen.findByLabelText('Сканируйте или найдите товар');

    await user.type(input, '001234{Enter}');
    expect(input).toHaveValue('');
    await user.type(input, 'новый ввод');
    scan.resolve(productSearchFixture([productFixture()]));

    await screen.findByText('Молоко');
    expect(input).toHaveValue('новый ввод');
  });

  it('shows an actionable inline error and restores focus when local scan search rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockRejectedValueOnce(
      new AxiosError('Network Error', 'ERR_NETWORK'),
    );
    renderCheckout();
    const input = await screen.findByLabelText('Сканируйте или найдите товар');

    await user.type(input, '001234{Enter}');

    expect(
      await screen.findByText('Не удалось найти товар с кодом 001234'),
    ).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
    await user.click(
      screen.getByRole('button', { name: 'Вернуть код 001234 в поле' }),
    );
    expect(input).toHaveValue('001234');
    expectNoSalesMutation();
  });

  it('hides session end while a local scan is pending', async () => {
    const user = userEvent.setup();
    const scan = deferred<ProductSearchResponse>();
    vi.mocked(searchProducts).mockReturnValueOnce(scan.promise);
    renderCheckout();
    const input = await screen.findByLabelText('Сканируйте или найдите товар');
    expect(
      screen.getByRole('button', { name: 'Завершить работу на кассе' }),
    ).toBeInTheDocument();

    await user.type(input, '001234{Enter}');

    expect(
      screen.queryByRole('button', { name: 'Завершить работу на кассе' }),
    ).not.toBeInTheDocument();
    scan.resolve(productSearchFixture([productFixture()]));
    await screen.findByText('Молоко');
    expect(
      screen.queryByRole('button', { name: 'Завершить работу на кассе' }),
    ).not.toBeInTheDocument();
  });

  it('blocks scanner and name search without product.read', async () => {
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['sales.cancel']),
    );
    renderCheckout();

    const input = await screen.findByLabelText('Сканируйте или найдите товар');
    expect(input).toBeDisabled();
    expect(
      screen.getByText('Нет права искать и сканировать товары.'),
    ).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(searchProducts).not.toHaveBeenCalled();
    expectNoSalesMutation();
  });

  it('edits every local line path without a Sales mutation', async () => {
    const user = userEvent.setup();
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Увеличить Молоко' }),
    );
    expect(screen.getByText('2 шт.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Уменьшить Молоко' }));
    expect(screen.getByText('1 шт.')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Изменить количество Молоко' }),
    );
    const quantity = screen.getByLabelText('Количество Молоко, шт.');
    await user.clear(quantity);
    await user.type(quantity, '3');
    await user.click(
      screen.getByRole('button', { name: 'Сохранить количество' }),
    );
    expect(await screen.findByText('3 шт.')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Изменить цену Молоко' }),
    );
    await user.type(screen.getByLabelText('Новая цена, ₸'), '600');
    await user.type(screen.getByLabelText('Причина изменения цены'), 'Акция');
    await user.click(screen.getByRole('button', { name: 'Сохранить цену' }));
    expect(await screen.findByText('Цена изменена')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Сбросить цену Молоко' }),
    );
    expect(screen.queryByText('Цена изменена')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Удалить Молоко' }));
    expect(screen.getByText('3 шт.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Удалить позицию' }));
    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
    expectNoSalesMutation();
  });

  it('requires both price permissions for a local override', async () => {
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.price.override']),
    );
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    renderCheckout();

    expect(await screen.findByText('Молоко')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Изменить цену Молоко' }),
    ).not.toBeInTheDocument();
  });

  it('clears a local cart only after confirmation and without a reason or API', async () => {
    const user = userEvent.setup();
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Очистить корзину' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Очистить корзину?' });
    expect(
      within(dialog).queryByLabelText('Причина отмены'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Молоко')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Очистить' }));

    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
    expectNoSalesMutation();
  });
});

describe('server DRAFT and session handoff', () => {
  it('shows recovered DRAFT fields and edits it through the server command boundary', async () => {
    const user = userEvent.setup();
    const initial = saleFixture({ items: [itemFixture()], total: '650.00' });
    vi.mocked(getCurrentSale).mockResolvedValue(initial);
    vi.mocked(setSaleItemQuantity).mockResolvedValue(
      saleFixture({
        items: [itemFixture({ line_total: '1300.00', quantity: '2' })],
        total: '1300.00',
        version: 2,
      }),
    );
    renderCheckout();

    expect(
      await screen.findByText('Восстановлен серверный черновик'),
    ).toBeInTheDocument();
    expect(screen.getByText('Итого')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Увеличить Молоко' }));

    expect(await screen.findByText('2 шт.')).toBeInTheDocument();
    expect(setSaleItemQuantity).toHaveBeenCalledWith('sale-1', 'item-1', {
      expectedVersion: 1,
      quantity: '2',
    });
    expect(createSale).not.toHaveBeenCalled();
  });

  it('opens sale cancellation instead of removing the last server line', async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentSale).mockResolvedValue(
      saleFixture({ items: [itemFixture()], total: '650.00' }),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Удалить Молоко' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Отменить чек?' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Причина отмены')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Удалить позицию' }),
    ).not.toBeInTheDocument();
    expect(removeSaleItem).not.toHaveBeenCalled();
    expect(cancelSale).not.toHaveBeenCalled();
  });

  it('converts a server SALE_EMPTY removal conflict into sale cancellation', async () => {
    const user = userEvent.setup();
    vi.mocked(getCurrentSale).mockResolvedValue(
      saleFixture({
        items: [
          itemFixture(),
          itemFixture({
            id: 'item-2',
            line_number: 2,
            name: 'Хлеб',
            product_id: 'product-2',
          }),
        ],
        total: '1300.00',
      }),
    );
    vi.mocked(removeSaleItem).mockRejectedValue(
      responseError('SALE_EMPTY', 409),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Удалить Молоко' }),
    );
    await user.click(screen.getByRole('button', { name: 'Удалить позицию' }));

    expect(
      await screen.findByRole('dialog', { name: 'Отменить чек?' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Причина отмены')).toBeInTheDocument();
    expect(removeSaleItem).toHaveBeenCalledOnce();
    expect(cancelSale).not.toHaveBeenCalled();
  });

  it('cancels a server DRAFT with permission and reason, then returns to local mode', async () => {
    const user = userEvent.setup();
    const initial = saleFixture({ items: [itemFixture()], total: '650.00' });
    const cancelled = saleFixture({
      ...initial,
      cancelled_at: '2026-08-24T10:05:00.000Z',
      cancellation_reason: 'Покупатель передумал',
      status: 'CANCELLED',
      version: 2,
    });
    vi.mocked(getCurrentSale).mockResolvedValue(initial);
    vi.mocked(cancelSale).mockResolvedValue(cancelled);
    useCheckoutCartStore.setState({
      sessions: {
        [cashierSession.id]: {
          items: [],
        },
        other: { items: [] },
      },
    });
    const { queryClient } = renderCheckout();
    const successToast = vi.spyOn(toast, 'success');

    await user.click(
      await screen.findByRole('button', { name: 'Отменить чек' }),
    );
    const reason = screen.getByLabelText('Причина отмены');
    await user.type(reason, 'Покупатель передумал');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить отмену' }),
    );

    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
    expect(screen.getByText('Предварительный итог')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        useCheckoutCartStore.getState().sessions[cashierSession.id],
      ).toBeUndefined(),
    );
    expect(successToast).toHaveBeenCalledOnce();
    expect(cancelSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 1,
      reason: 'Покупатель передумал',
    });
    expect(useCheckoutCartStore.getState().sessions.other).toEqual({
      items: [],
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSession.id)),
    ).toBeNull();
    successToast.mockRestore();
  });

  it('does not let an in-flight current-sale GET resurrect a cancelled sale', async () => {
    const user = userEvent.setup();
    const initial = saleFixture({ items: [itemFixture()], total: '650.00' });
    const cancelled = saleFixture({
      ...initial,
      cancelled_at: '2026-08-24T10:05:00.000Z',
      cancellation_reason: 'Покупатель передумал',
      status: 'CANCELLED',
      version: 2,
    });
    const cancellation = deferred<SaleResponse>();
    const lateCurrent = deferred<SaleResponse | null>();
    vi.mocked(getCurrentSale).mockResolvedValue(initial);
    vi.mocked(cancelSale).mockReturnValue(cancellation.promise);
    const { queryClient } = renderCheckout();
    const currentKey = queryKeys.sales.current(cashierSession.id);

    await user.click(
      await screen.findByRole('button', { name: 'Отменить чек' }),
    );
    await user.type(
      screen.getByLabelText('Причина отмены'),
      'Покупатель передумал',
    );
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить отмену' }),
    );
    await waitFor(() => expect(cancelSale).toHaveBeenCalledOnce());
    const refresh = queryClient.fetchQuery({
      queryFn: () => lateCurrent.promise,
      queryKey: currentKey,
    });

    cancellation.resolve(cancelled);
    await waitFor(() =>
      expect(queryClient.getQueryData(currentKey)).toBeNull(),
    );
    lateCurrent.resolve(initial);
    await refresh.catch(() => undefined);

    expect(queryClient.getQueryData(currentKey)).toBeNull();
  });

  it('treats an ambiguously rejected cancel reconciled as CANCELLED as success', async () => {
    const user = userEvent.setup();
    const initial = saleFixture({ items: [itemFixture()], total: '650.00' });
    const cancelled = saleFixture({
      ...initial,
      cancelled_at: '2026-08-24T10:05:00.000Z',
      cancellation_reason: 'Покупатель передумал',
      status: 'CANCELLED',
      version: 2,
    });
    vi.mocked(getCurrentSale).mockResolvedValue(initial);
    vi.mocked(cancelSale).mockRejectedValue(
      new AxiosError('Network Error', 'ERR_NETWORK'),
    );
    vi.mocked(getSale).mockResolvedValue(cancelled);
    useCheckoutCartStore.setState({
      sessions: {
        [cashierSession.id]: {
          items: [],
        },
        other: { items: [] },
      },
    });
    const { queryClient } = renderCheckout();
    const successToast = vi.spyOn(toast, 'success');

    await user.click(
      await screen.findByRole('button', { name: 'Отменить чек' }),
    );
    await user.type(
      screen.getByLabelText('Причина отмены'),
      'Покупатель передумал',
    );
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить отмену' }),
    );

    await waitFor(() =>
      expect(
        useCheckoutCartStore.getState().sessions[cashierSession.id],
      ).toBeUndefined(),
    );
    expect(successToast).toHaveBeenCalledOnce();
    expect(
      screen.queryByText('Не удалось изменить чек.'),
    ).not.toBeInTheDocument();
    expect(useCheckoutCartStore.getState().sessions.other).toEqual({
      items: [],
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSession.id)),
    ).toBeNull();
    successToast.mockRestore();
  });

  it('LOCKED performs no sale or product request and hides end until its local cart is empty', async () => {
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    const locked = {
      ...cashierSession,
      locked_at: '2026-08-24T10:00:00.000Z',
      status: 'LOCKED' as const,
    };
    renderCheckout({ session: locked });

    expect(
      await screen.findByRole('heading', {
        name: 'Смена кассира заблокирована',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Завершить работу на кассе' }),
    ).not.toBeInTheDocument();
    expect(getCurrentSale).not.toHaveBeenCalled();
    expect(searchProducts).not.toHaveBeenCalled();
  });

  it('deletes only this cashier cart before successful session-end navigation', async () => {
    const user = userEvent.setup();
    const onSessionEnded = vi.fn();
    useCheckoutCartStore.setState({
      sessions: {
        [cashierSession.id]: { items: [] },
        other: { items: [] },
      },
    });
    vi.mocked(endCashierSession).mockResolvedValue({
      ...cashierSession,
      actual_cash: '5000.00',
      difference: '0.00',
      end_reason: 'LOGOUT',
      ended_at: '2026-08-24T10:10:00.000Z',
      expected_cash: '5000.00',
      status: 'ENDED',
    });
    renderCheckout({ onSessionEnded });

    await user.click(
      await screen.findByRole('button', { name: 'Завершить работу на кассе' }),
    );
    await user.type(screen.getByLabelText('Наличные у кассира, ₸'), '5000');
    await user.click(
      screen.getByRole('button', { name: /^Завершить работу$/ }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'К выбору кассы' }),
    );

    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id],
    ).toBeUndefined();
    expect(useCheckoutCartStore.getState().sessions.other).toEqual({
      items: [],
    });
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });
});

describe('checkout sale transitions', () => {
  it.each([
    ['local create only', null, ['sales.create'], false, false],
    ['local complete only', null, ['sales.complete'], false, false],
    [
      'local create + complete',
      null,
      ['sales.create', 'sales.complete'],
      true,
      false,
    ],
    ['local create + hold', null, ['sales.create', 'sales.hold'], false, true],
    ['DRAFT complete', 'draft', ['sales.complete'], true, false],
    ['DRAFT hold', 'draft', ['sales.hold'], false, true],
  ])(
    'applies the %s Pay/Hold permission gate',
    async (_name, mode, permissions, payVisible, holdVisible) => {
      vi.mocked(getAuthContext).mockResolvedValue(
        contextFixture(['product.read', ...permissions]),
      );
      if (mode === 'draft') {
        vi.mocked(getCurrentSale).mockResolvedValue(
          saleFixture({ items: [itemFixture()], total: '650.00' }),
        );
      } else {
        useCheckoutCartStore
          .getState()
          .addProduct(cashierSession.id, productFixture());
      }
      renderCheckout();

      expect(await screen.findByText('Молоко')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Оплатить' }) !== null).toBe(
        payVisible,
      );
      expect(
        screen.queryByRole('button', { name: 'Отложить чек' }) !== null,
      ).toBe(holdVisible);
    },
  );

  it('prepares a local cart only after Pay, shows total drift, and completes with the exact payment', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({
      items: [itemFixture({ line_total: '1250.00', unit_price: '625.00' })],
      total: '1250.00',
      version: 4,
    });
    const completed = saleFixture({
      ...draft,
      completed_at: '2026-08-24T10:10:00.000Z',
      payments: [
        {
          amount: '1250.00',
          change: null,
          completed_at: '2026-08-24T10:10:00.000Z',
          created_at: '2026-08-24T10:10:00.000Z',
          id: 'payment-1',
          method: 'CASHLESS',
          received: null,
          status: 'COMPLETED',
          updated_at: '2026-08-24T10:10:00.000Z',
        },
      ],
      status: 'COMPLETED',
      version: 5,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.create', 'sales.complete']),
    );
    vi.mocked(createSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockResolvedValue(completed);
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    useCheckoutCartStore
      .getState()
      .setQuantity(cashierSession.id, 'product-1', '2');
    renderCheckout();

    expect(await screen.findByText('Молоко')).toBeInTheDocument();
    expect(createSale).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Оплатить' }));

    const payment = await screen.findByRole('dialog', { name: 'Оплата чека' });
    expect(createSale).toHaveBeenCalledWith({
      items: [{ productId: 'product-1', quantity: '2' }],
    });
    expect(within(payment).getByLabelText('Локальная сумма')).toHaveTextContent(
      '1 300,00 ₸',
    );
    expect(
      within(payment).getByLabelText('Сумма на сервере'),
    ).toHaveTextContent('1 250,00 ₸');
    expect(checkoutSale).not.toHaveBeenCalled();

    await user.click(
      within(payment).getByRole('button', { name: 'Безналичные' }),
    );
    await user.click(
      within(payment).getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 4,
      payments: [{ amount: '1250.00', method: 'CASHLESS' }],
    });
    expect(screen.getByLabelText('Итог завершённого чека')).toHaveTextContent(
      '1 250,00 ₸',
    );
    expect(
      screen.getByRole('button', { name: 'Завершить работу на кассе' }),
    ).toBeInTheDocument();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id],
    ).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Новый чек' }));
    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
    expect(createSale).toHaveBeenCalledOnce();
    expect(checkoutSale).toHaveBeenCalledOnce();
  });

  it('opens payment for an existing DRAFT without create and preserves input after a deterministic failure', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockRejectedValue(
      responseError('INSUFFICIENT_STOCK', 422),
    );
    renderCheckout();

    await user.click(await screen.findByRole('button', { name: 'Оплатить' }));
    const received = screen.getByLabelText('Получено наличными, ₸');
    await user.type(received, '700');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Недостаточно товара на складе.',
    );
    expect(received).toHaveValue('700');
    expect(createSale).not.toHaveBeenCalled();
    expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 1,
      payments: [{ amount: '650.00', method: 'CASH', received: '700' }],
    });
    expect(
      screen.getByText('Восстановлен серверный черновик'),
    ).toBeInTheDocument();
  });

  it('shows a reconciled terminal checkout as completed instead of an ordinary failure', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const completed = saleFixture({
      ...draft,
      completed_at: '2026-08-24T10:10:00.000Z',
      status: 'COMPLETED',
      version: 2,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockRejectedValue(
      responseError('SALE_VERSION_CONFLICT', 409),
    );
    vi.mocked(getSale).mockResolvedValue(completed);
    renderCheckout();

    await user.click(await screen.findByRole('button', { name: 'Оплатить' }));
    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('updates payment authority to a reconciled changed DRAFT while preserving input', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const changedDraft = saleFixture({
      ...draft,
      total: '700.00',
      version: 2,
    });
    const completed = saleFixture({
      ...changedDraft,
      completed_at: '2026-08-24T10:10:00.000Z',
      status: 'COMPLETED',
      version: 3,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale)
      .mockRejectedValueOnce(responseError('SALE_VERSION_CONFLICT', 409))
      .mockResolvedValueOnce(completed);
    vi.mocked(getSale).mockResolvedValue(changedDraft);
    renderCheckout();

    await user.click(await screen.findByRole('button', { name: 'Оплатить' }));
    const received = screen.getByLabelText('Получено наличными, ₸');
    await user.type(received, '750');
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Продажа уже изменилась',
    );
    expect(screen.getByLabelText('Сумма на сервере')).toHaveTextContent(
      '700,00 ₸',
    );
    expect(received).toHaveValue('750');

    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(checkoutSale).toHaveBeenNthCalledWith(2, 'sale-1', {
      expectedVersion: 2,
      payments: [{ amount: '700.00', method: 'CASH', received: '750' }],
    });
  });

  it('creates and holds a local cart, then fetches held sales only when opened', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({
      items: [itemFixture()],
      total: '650.00',
      version: 3,
    });
    const held = saleFixture({
      ...draft,
      held_at: '2026-08-24T10:05:00.000Z',
      status: 'HELD',
      version: 4,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.create', 'sales.hold']),
    );
    vi.mocked(createSale).mockResolvedValue(draft);
    vi.mocked(holdSale).mockResolvedValue(held);
    vi.mocked(getHeldSales).mockResolvedValue([heldFixture()]);
    useCheckoutCartStore
      .getState()
      .addProduct(cashierSession.id, productFixture());
    renderCheckout();

    expect(await screen.findByText('Молоко')).toBeInTheDocument();
    expect(getHeldSales).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Отложить чек' }));

    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
    expect(createSale).toHaveBeenCalledOnce();
    expect(holdSale).toHaveBeenCalledWith('sale-1', { expectedVersion: 3 });
    expect(getHeldSales).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Отложенные чеки' }));
    const heldDialog = await screen.findByRole('dialog', {
      name: 'Отложенные чеки',
    });
    expect(getHeldSales).toHaveBeenCalledOnce();
    expect(within(heldDialog).getByText('2 позиции')).toBeInTheDocument();
    expect(within(heldDialog).getByText('1 300,00 ₸')).toBeInTheDocument();
  });

  it('loads and reveals held sale positions only when its card is expanded', async () => {
    const user = userEvent.setup();
    const held = heldFixture();
    vi.mocked(getHeldSales).mockResolvedValue([held]);
    vi.mocked(getSale).mockResolvedValue(
      saleFixture({
        held_at: held.held_at,
        id: held.id,
        items: [
          itemFixture(),
          itemFixture({
            id: 'item-2',
            line_number: 2,
            line_total: '650.00',
            name: 'Хлеб',
            product_id: 'product-2',
            quantity: '2',
            sku: 'BREAD-1',
            unit_price: '325.00',
          }),
        ],
        status: 'HELD',
        total: held.total,
        version: held.version,
      }),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Отложенные чеки' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Отложенные чеки',
    });
    expect(getSale).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', {
        name: /Показать товары чека/,
      }),
    );

    const positions = await within(dialog).findByRole('region', {
      name: /Товары в чеке/,
    });
    expect(getSale).toHaveBeenCalledOnce();
    expect(getSale).toHaveBeenCalledWith(held.id);
    expect(within(positions).getByText('Молоко')).toBeInTheDocument();
    expect(within(positions).getByText('1 шт. × 650,00 ₸')).toBeInTheDocument();
    expect(within(positions).getByText('Хлеб')).toBeInTheDocument();
    expect(within(positions).getByText('2 шт. × 325,00 ₸')).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', {
        name: /Скрыть товары чека/,
      }),
    );
    expect(
      within(dialog).queryByRole('region', { name: /Товары в чеке/ }),
    ).not.toBeInTheDocument();
  });

  it('holds an existing DRAFT without creating another sale', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({
      items: [itemFixture()],
      total: '650.00',
      version: 8,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.hold']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(holdSale).mockResolvedValue(
      saleFixture({ ...draft, status: 'HELD', version: 9 }),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Отложить чек' }),
    );

    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
    expect(createSale).not.toHaveBeenCalled();
    expect(holdSale).toHaveBeenCalledWith('sale-1', { expectedVersion: 8 });
  });

  it('shows held loading, error, retry, and empty states explicitly', async () => {
    const user = userEvent.setup();
    const request = deferred<HeldSaleResponse[]>();
    vi.mocked(getHeldSales)
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce([]);
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Отложенные чеки' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Отложенные чеки',
    });
    expect(
      within(dialog).getByText('Загружаем отложенные чеки'),
    ).toBeInTheDocument();

    request.reject(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(
      await within(dialog).findByText('Не удалось загрузить отложенные чеки.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Повторить' }));

    expect(
      await within(dialog).findByText('Нет отложенных чеков'),
    ).toBeInTheDocument();
  });

  it.each([
    ['a local cart', 'local', ['sales.hold']],
    ['a current DRAFT', 'draft', ['sales.hold']],
    ['missing sales.hold', 'empty', []],
  ])(
    'disables held resume for %s and explains why',
    async (_name, mode, permissions) => {
      const user = userEvent.setup();
      vi.mocked(getAuthContext).mockResolvedValue(
        contextFixture(['product.read', ...permissions]),
      );
      vi.mocked(getHeldSales).mockResolvedValue([heldFixture()]);
      if (mode === 'local') {
        useCheckoutCartStore
          .getState()
          .addProduct(cashierSession.id, productFixture());
      } else if (mode === 'draft') {
        vi.mocked(getCurrentSale).mockResolvedValue(
          saleFixture({ items: [itemFixture()], total: '650.00' }),
        );
      }
      renderCheckout();

      await user.click(
        await screen.findByRole('button', { name: 'Отложенные чеки' }),
      );
      expect(
        await screen.findByRole('button', { name: 'Возобновить чек' }),
      ).toBeDisabled();
      expect(
        screen.getByText('Сначала завершите или очистите текущий чек'),
      ).toBeInTheDocument();
      expect(resumeSale).not.toHaveBeenCalled();
    },
  );

  it('resumes a held sale only into an empty editable checkout', async () => {
    const user = userEvent.setup();
    const held = heldFixture();
    const resumed = saleFixture({
      id: held.id,
      items: [itemFixture(), itemFixture({ id: 'item-2', line_number: 2 })],
      total: held.total,
      version: 3,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.hold']),
    );
    vi.mocked(getHeldSales).mockResolvedValue([held]);
    vi.mocked(resumeSale).mockResolvedValue(resumed);
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Отложенные чеки' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Возобновить чек' }),
    );

    expect(
      await screen.findByText('Восстановлен серверный черновик'),
    ).toBeInTheDocument();
    expect(resumeSale).toHaveBeenCalledWith('sale-held-1', {
      expectedVersion: 2,
    });
    expect(createSale).not.toHaveBeenCalled();
  });

  it('opens cancellation for the last line of a resumed held sale', async () => {
    const user = userEvent.setup();
    const held = heldFixture({ items_count: 1, total: '650.00' });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture([
        'product.read',
        'sales.cancel',
        'sales.hold',
        'sales.modify',
      ]),
    );
    vi.mocked(getHeldSales).mockResolvedValue([held]);
    vi.mocked(resumeSale).mockResolvedValue(
      saleFixture({
        id: held.id,
        items: [itemFixture()],
        total: held.total,
        version: 3,
      }),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Отложенные чеки' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Возобновить чек' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Удалить Молоко' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'Отменить чек?' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Причина отмены')).toBeInTheDocument();
    expect(removeSaleItem).not.toHaveBeenCalled();
  });

  it('preserves an ambiguous checkout for explicit status, exact retry, or return-to-editing', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const completed = saleFixture({
      ...draft,
      completed_at: '2026-08-24T10:10:00.000Z',
      status: 'COMPLETED',
      version: 2,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockRejectedValueOnce(
      new AxiosError('Network Error', 'ERR_NETWORK'),
    );
    vi.mocked(getSale).mockResolvedValue(completed);
    renderCheckout();

    await user.click(await screen.findByRole('button', { name: 'Оплатить' }));
    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Проверьте статус операции' }),
    ).toBeInTheDocument();
    expect(getSale).not.toHaveBeenCalled();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id]
        ?.pendingOperation,
    ).toEqual({
      expectedVersion: 1,
      payments: [{ amount: '650.00', method: 'CASHLESS' }],
      saleId: 'sale-1',
      type: 'checkout',
    });
    expect(
      screen.queryByRole('button', { name: 'Оплатить' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Проверить статус' }));

    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(getSale).toHaveBeenCalledWith('sale-1');
    expect(checkoutSale).toHaveBeenCalledOnce();
  });

  it('preserves an ambiguous hold without status lookup or automatic replay', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.hold']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(holdSale).mockRejectedValue(
      new AxiosError('Network Error', 'ERR_NETWORK'),
    );
    renderCheckout();

    await user.click(
      await screen.findByRole('button', { name: 'Отложить чек' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Проверьте статус операции' }),
    ).toBeInTheDocument();
    expect(holdSale).toHaveBeenCalledOnce();
    expect(getSale).not.toHaveBeenCalled();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id]
        ?.pendingOperation,
    ).toEqual({ expectedVersion: 1, saleId: 'sale-1', type: 'hold' });
  });

  it('shows entry recovery for a pending DRAFT without replay and can return to editing', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete', 'sales.hold']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(getSale).mockResolvedValue(draft);
    useCheckoutCartStore.setState({
      sessions: {
        [cashierSession.id]: {
          items: [],
          pendingOperation: {
            expectedVersion: 1,
            payments: [{ amount: '650.00', method: 'CASHLESS' }],
            saleId: 'sale-1',
            type: 'checkout',
          },
        },
      },
    });
    renderCheckout();

    expect(
      await screen.findByRole('heading', { name: 'Проверьте статус операции' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Повторить' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Вернуться к редактированию' }),
    ).toBeInTheDocument();
    expect(checkoutSale).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Оплатить' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Отложенные чеки' }),
    ).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: 'Вернуться к редактированию' }),
    );

    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id]
        ?.pendingOperation,
    ).toBeUndefined();
    expect(
      await screen.findByRole('button', { name: 'Оплатить' }),
    ).toBeInTheDocument();
  });

  it('retries the exact persisted checkout only after the cashier asks', async () => {
    const user = userEvent.setup();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const completed = saleFixture({
      ...draft,
      completed_at: '2026-08-24T10:10:00.000Z',
      status: 'COMPLETED',
      version: 2,
    });
    const payments = [{ amount: '650.00', method: 'CASHLESS' as const }];
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(getSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockResolvedValue(completed);
    useCheckoutCartStore.setState({
      sessions: {
        [cashierSession.id]: {
          items: [],
          pendingOperation: {
            expectedVersion: 1,
            payments,
            saleId: 'sale-1',
            type: 'checkout',
          },
        },
      },
    });
    renderCheckout();

    expect(
      await screen.findByRole('button', { name: 'Повторить' }),
    ).toBeInTheDocument();
    expect(checkoutSale).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 1,
      payments,
    });
  });

  it('disables every recovery action while an exact retry is in flight', async () => {
    const user = userEvent.setup();
    const retry = deferred<SaleResponse>();
    const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
    const completed = saleFixture({
      ...draft,
      completed_at: '2026-08-24T10:10:00.000Z',
      status: 'COMPLETED',
      version: 2,
    });
    vi.mocked(getAuthContext).mockResolvedValue(
      contextFixture(['product.read', 'sales.complete']),
    );
    vi.mocked(getCurrentSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale)
      .mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
      .mockReturnValueOnce(retry.promise);
    renderCheckout();

    await user.click(await screen.findByRole('button', { name: 'Оплатить' }));
    await user.click(screen.getByRole('button', { name: 'Безналичные' }));
    await user.click(
      screen.getByRole('button', { name: 'Подтвердить оплату' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(checkoutSale).toHaveBeenCalledTimes(2));

    expect(
      screen.getByRole('button', { name: 'Проверить статус' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Вернуться к редактированию' }),
    ).toBeDisabled();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id]
        ?.pendingOperation,
    ).toBeDefined();

    retry.resolve(completed);
    expect(
      await screen.findByRole('heading', { name: 'Оплата завершена' }),
    ).toBeInTheDocument();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSession.id],
    ).toBeUndefined();
  });

  it.each(['COMPLETED', 'HELD'] as const)(
    'finishes a recovered terminal %s response',
    async (status) => {
      const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
      vi.mocked(getAuthContext).mockResolvedValue(
        contextFixture(['product.read', 'sales.complete', 'sales.hold']),
      );
      vi.mocked(getCurrentSale).mockResolvedValue(draft);
      vi.mocked(getSale).mockResolvedValue(
        saleFixture({
          ...draft,
          completed_at:
            status === 'COMPLETED' ? '2026-08-24T10:10:00.000Z' : null,
          held_at: status === 'HELD' ? '2026-08-24T10:10:00.000Z' : null,
          payments:
            status === 'COMPLETED'
              ? [
                  {
                    amount: '650.00',
                    change: '50.00',
                    completed_at: '2026-08-24T10:10:00.000Z',
                    created_at: '2026-08-24T10:10:00.000Z',
                    id: 'payment-cash',
                    method: 'CASH',
                    received: '700.00',
                    status: 'COMPLETED',
                    updated_at: '2026-08-24T10:10:00.000Z',
                  },
                ]
              : [],
          status,
          version: 2,
        }),
      );
      useCheckoutCartStore.setState({
        sessions: {
          [cashierSession.id]: {
            items: [],
            pendingOperation:
              status === 'COMPLETED'
                ? {
                    expectedVersion: 1,
                    payments: [
                      {
                        amount: '650.00',
                        method: 'CASH',
                        received: '700.00',
                      },
                    ],
                    saleId: 'sale-1',
                    type: 'checkout',
                  }
                : { expectedVersion: 1, saleId: 'sale-1', type: 'hold' },
          },
        },
      });
      renderCheckout();

      if (status === 'COMPLETED') {
        expect(
          await screen.findByRole('heading', { name: 'Оплата завершена' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Получено: 700,00 ₸')).toBeInTheDocument();
        expect(screen.getByText('Сдача: 50,00 ₸')).toBeInTheDocument();
      } else {
        expect(await screen.findByText('Корзина пуста')).toBeInTheDocument();
        expect(
          screen.queryByRole('heading', {
            name: 'Проверьте статус операции',
          }),
        ).not.toBeInTheDocument();
      }
      expect(
        useCheckoutCartStore.getState().sessions[cashierSession.id],
      ).toBeUndefined();
      expect(checkoutSale).not.toHaveBeenCalled();
      expect(holdSale).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['network', new AxiosError('Network Error', 'ERR_NETWORK'), true],
    ['confirmed 404', responseError('SALE_NOT_FOUND', 404), false],
  ])(
    'handles recovery %s without replay and clears only a confirmed stale pending operation',
    async (_name, error, pendingRemains) => {
      const draft = saleFixture({ items: [itemFixture()], total: '650.00' });
      vi.mocked(getAuthContext).mockResolvedValue(
        contextFixture(['product.read', 'sales.complete']),
      );
      vi.mocked(getCurrentSale).mockResolvedValue(draft);
      vi.mocked(getSale).mockRejectedValue(error);
      useCheckoutCartStore.setState({
        sessions: {
          [cashierSession.id]: {
            items: [],
            pendingOperation: {
              expectedVersion: 1,
              payments: [{ amount: '650.00', method: 'CASHLESS' }],
              saleId: 'sale-1',
              type: 'checkout',
            },
          },
          other: { items: [] },
        },
      });
      renderCheckout();

      if (pendingRemains) {
        expect(
          await screen.findByText(
            'Нет соединения с сервером. Проверьте интернет и повторите запрос.',
          ),
        ).toBeInTheDocument();
        expect(
          useCheckoutCartStore.getState().sessions[cashierSession.id]
            ?.pendingOperation,
        ).toBeDefined();
      } else {
        expect(
          await screen.findByRole('button', { name: 'Оплатить' }),
        ).toBeInTheDocument();
        expect(
          useCheckoutCartStore.getState().sessions[cashierSession.id]
            ?.pendingOperation,
        ).toBeUndefined();
      }
      expect(useCheckoutCartStore.getState().sessions.other).toEqual({
        items: [],
      });
      expect(checkoutSale).not.toHaveBeenCalled();
    },
  );
});
