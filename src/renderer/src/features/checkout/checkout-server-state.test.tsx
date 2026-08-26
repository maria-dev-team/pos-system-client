import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useQuery,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ProductSearchResponse,
  type SaleResponse,
  addSaleItem,
  createSale,
  getCurrentSale,
  getHeldSales,
  getSale,
  scanSaleItem,
  searchProducts,
  setSaleItemQuantity,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

import {
  currentSaleQueryOptions,
  heldSalesQueryOptions,
  useProductSearchQuery,
} from './checkout-query-options';
import { useSaleCommandMutation } from './use-sale-command-mutation';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();

  return {
    ...actual,
    addSaleItem: vi.fn(),
    createSale: vi.fn(),
    getCurrentSale: vi.fn(),
    getHeldSales: vi.fn(),
    getSale: vi.fn(),
    scanSaleItem: vi.fn(),
    searchProducts: vi.fn(),
    setSaleItemQuantity: vi.fn(),
  };
});

const cashierSessionId = 'cashier-session-1';

const saleFixture = (version: number, id = 'sale-1'): SaleResponse => ({
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: cashierSessionId,
  completed_at: null,
  created_at: '2026-08-24T10:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id,
  items: [],
  organization_id: 'organization-1',
  payments: [],
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  status: 'DRAFT',
  store_id: 'store-1',
  total: '0.00',
  updated_at: `2026-08-24T10:00:0${version}.000Z`,
  version,
});

const productSearchFixture: ProductSearchResponse = {
  meta: { has_more: false, limit: 20, offset: 0, total: 1 },
  products: [
    {
      barcode: '4870000000012',
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
    },
  ],
};

const responseError = (errorCode: string): AxiosError =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    data: { error_code: errorCode },
    headers: {},
    status: 409,
    statusText: 'Conflict',
  } as AxiosResponse);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe('checkout sale queries', () => {
  it('reads the nullable current sale without creating one', async () => {
    const queryClient = createTestQueryClient();
    vi.mocked(getCurrentSale).mockResolvedValue(null);

    const result = await queryClient.fetchQuery(
      currentSaleQueryOptions(cashierSessionId),
    );

    expect(result).toBeNull();
    expect(getCurrentSale).toHaveBeenCalledOnce();
    expect(createSale).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
  });

  it('does not refetch current sale on reconnect but still supports an explicit GET refetch', async () => {
    const queryClient = createTestQueryClient();
    const firstSale = saleFixture(1);
    const nextSale = saleFixture(1, 'sale-2');
    vi.mocked(getCurrentSale)
      .mockResolvedValueOnce(firstSale)
      .mockResolvedValue(nextSale);
    const { result } = renderHook(
      () => useQuery(currentSaleQueryOptions(cashierSessionId)),
      { wrapper: wrapperFor(queryClient) },
    );
    await waitFor(() => expect(result.current.data).toEqual(firstSale));
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), {
      ...firstSale,
      cancelled_at: '2026-08-24T10:05:00.000Z',
      status: 'CANCELLED',
      version: 2,
    });

    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await new Promise((resolve) => window.setTimeout(resolve));
    });

    expect(getCurrentSale).toHaveBeenCalledOnce();
    expect(createSale).not.toHaveBeenCalled();
    expect(result.current.data?.status).toBe('CANCELLED');

    await act(() => result.current.refetch());

    expect(getCurrentSale).toHaveBeenCalledTimes(2);
    expect(createSale).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.data).toEqual(nextSale));
  });

  it.each([
    ['cached null', null],
    ['cached DRAFT', saleFixture(1)],
  ])('GETs current sale again on re-entry with %s', async (_label, cached) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 30_000 },
      },
    });
    const refreshed = saleFixture(2, 'sale-refreshed');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), cached);
    vi.mocked(getCurrentSale).mockResolvedValue(refreshed);

    const { result } = renderHook(
      () => useQuery(currentSaleQueryOptions(cashierSessionId)),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(getCurrentSale).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.data).toEqual(refreshed));
  });

  it('reads held summaries under the cashier-session held key', async () => {
    const queryClient = createTestQueryClient();
    const held = [
      {
        created_at: '2026-08-24T10:00:00.000Z',
        held_at: '2026-08-24T10:05:00.000Z',
        id: 'sale-held',
        items_count: 2,
        status: 'HELD' as const,
        total: '25.00',
        version: 4,
      },
    ];
    vi.mocked(getHeldSales).mockResolvedValue(held);

    const result = await queryClient.fetchQuery(
      heldSalesQueryOptions(cashierSessionId),
    );

    expect(result).toEqual(held);
    expect(
      queryClient.getQueryData(queryKeys.sales.held(cashierSessionId)),
    ).toEqual(held);
  });

  it('waits 250ms, normalizes the term and caches a limited product search', async () => {
    vi.useFakeTimers();
    const queryClient = createTestQueryClient();
    vi.mocked(searchProducts).mockResolvedValue(productSearchFixture);

    renderHook(
      () =>
        useProductSearchQuery('  Молоко  ', true, 'organization-1', 'store-1'),
      {
        wrapper: wrapperFor(queryClient),
      },
    );

    act(() => vi.advanceTimersByTime(249));
    expect(searchProducts).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(searchProducts).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      search: 'Молоко',
    });

    vi.useRealTimers();
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          queryKeys.products.search('organization-1', 'store-1', 'Молоко'),
        ),
      ).toEqual(productSearchFixture),
    );
  });

  it('does not search below two characters or without permission', () => {
    vi.useFakeTimers();
    const queryClient = createTestQueryClient();

    const shortSearch = renderHook(
      () => useProductSearchQuery(' м ', true, 'organization-1', 'store-1'),
      { wrapper: wrapperFor(queryClient) },
    );
    const forbiddenSearch = renderHook(
      () => useProductSearchQuery('молоко', false, 'organization-1', 'store-1'),
      { wrapper: wrapperFor(queryClient) },
    );

    act(() => vi.advanceTimersByTime(500));

    expect(searchProducts).not.toHaveBeenCalled();
    shortSearch.unmount();
    forbiddenSearch.unmount();
  });

  it('cancels obsolete debounce timers and requests only the latest term', () => {
    vi.useFakeTimers();
    const queryClient = createTestQueryClient();
    vi.mocked(searchProducts).mockResolvedValue(productSearchFixture);
    const { rerender } = renderHook(
      ({ term }) =>
        useProductSearchQuery(term, true, 'organization-1', 'store-1'),
      {
        initialProps: { term: 'мо' },
        wrapper: wrapperFor(queryClient),
      },
    );

    act(() => vi.advanceTimersByTime(100));
    rerender({ term: 'мол' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ term: '  молоко  ' });
    act(() => vi.advanceTimersByTime(249));

    expect(searchProducts).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(searchProducts).toHaveBeenCalledOnce();
    expect(searchProducts).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      search: 'молоко',
    });
  });

  it('hides cached product results until the scoped term refetch settles', async () => {
    vi.useFakeTimers();
    const queryClient = createTestQueryClient();
    const stale = productSearchFixture;
    const fresh = {
      ...productSearchFixture,
      products: productSearchFixture.products.map((product) => ({
        ...product,
        id: 'product-2',
        name: 'Свежий товар',
      })),
    };
    const request = deferred<ProductSearchResponse>();
    queryClient.setQueryData(['products', 'search', 'молоко'], stale);
    queryClient.setQueryData(
      ['products', 'search', 'organization-1', 'store-1', 'молоко'],
      stale,
    );
    vi.mocked(searchProducts).mockReturnValue(request.promise);

    const { result } = renderHook(
      () => useProductSearchQuery('молоко', true, 'organization-1', 'store-1'),
      { wrapper: wrapperFor(queryClient) },
    );

    expect(result.current.data).toBeUndefined();
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.data).toBeUndefined();
    request.resolve(fresh);
    vi.useRealTimers();

    await waitFor(() => expect(result.current.data).toEqual(fresh));
  });
});

describe('sale command mutation', () => {
  it('rejects commands when the nullable current cache has no DRAFT', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), null);
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, null),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(
      act(() => result.current.mutateAsync({ barcode: '111', type: 'scan' })),
    ).rejects.toThrow('Current sale is no longer active');

    expect(scanSaleItem).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
  });

  it('serializes rapid scans and reads the fresh cached version for each call', async () => {
    const queryClient = createTestQueryClient();
    const firstResponse = deferred<SaleResponse>();
    const sale1 = saleFixture(1);
    const sale2 = saleFixture(2);
    const sale3 = saleFixture(3);
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), sale1);
    vi.mocked(scanSaleItem)
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce(sale3);
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () =>
        useSaleCommandMutation(cashierSessionId, sale1, {
          onSuccess,
        }),
      { wrapper: wrapperFor(queryClient) },
    );

    let first!: Promise<SaleResponse>;
    let second!: Promise<SaleResponse>;
    act(() => {
      first = result.current.mutateAsync({ barcode: '111', type: 'scan' });
      second = result.current.mutateAsync({ barcode: '222', type: 'scan' });
    });

    await waitFor(() => expect(scanSaleItem).toHaveBeenCalledTimes(1));
    expect(scanSaleItem).toHaveBeenNthCalledWith(1, 'sale-1', {
      barcode: '111',
      expectedVersion: 1,
      quantityDelta: '1',
    });

    firstResponse.resolve(sale2);
    await expect(first).resolves.toEqual(sale2);
    await waitFor(() => expect(scanSaleItem).toHaveBeenCalledTimes(2));
    expect(scanSaleItem).toHaveBeenNthCalledWith(2, 'sale-1', {
      barcode: '222',
      expectedVersion: 2,
      quantityDelta: '1',
    });
    await expect(second).resolves.toEqual(sale3);
    expect(onSuccess).toHaveBeenNthCalledWith(1, sale2, {
      barcode: '111',
      type: 'scan',
    });
    expect(onSuccess).toHaveBeenNthCalledWith(2, sale3, {
      barcode: '222',
      type: 'scan',
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(sale3);
  });

  it('sends manual add and quantity commands with exact payloads and fresh versions', async () => {
    const queryClient = createTestQueryClient();
    const sale1 = saleFixture(1);
    const sale2 = saleFixture(2);
    const sale3 = saleFixture(3);
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), sale1);
    vi.mocked(addSaleItem).mockResolvedValue(sale2);
    vi.mocked(setSaleItemQuantity).mockResolvedValue(sale3);
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, sale1),
      { wrapper: wrapperFor(queryClient) },
    );

    await act(() =>
      result.current.mutateAsync({ productId: 'product-1', type: 'add' }),
    );
    await act(() =>
      result.current.mutateAsync({
        itemId: 'item-1',
        quantity: '2.5',
        type: 'setQuantity',
      }),
    );

    expect(addSaleItem).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 1,
      productId: 'product-1',
      quantity: '1',
    });
    expect(setSaleItemQuantity).toHaveBeenCalledWith('sale-1', 'item-1', {
      expectedVersion: 2,
      quantity: '2.5',
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(sale3);
  });

  it('does not let an in-flight old sale overwrite or command a newer sale', async () => {
    const queryClient = createTestQueryClient();
    const firstResponse = deferred<SaleResponse>();
    const saleA1 = saleFixture(1);
    const saleA2 = saleFixture(2);
    const saleA3 = saleFixture(3);
    const saleB = saleFixture(10, 'sale-2');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), saleA1);
    vi.mocked(scanSaleItem)
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce(saleA3);
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, saleA1),
      { wrapper: wrapperFor(queryClient) },
    );

    let first!: Promise<SaleResponse>;
    let second!: Promise<SaleResponse>;
    act(() => {
      first = result.current.mutateAsync({ barcode: '111', type: 'scan' });
      second = result.current.mutateAsync({ barcode: '222', type: 'scan' });
    });
    await waitFor(() => expect(scanSaleItem).toHaveBeenCalledOnce());

    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), saleB);
    firstResponse.resolve(saleA2);

    await expect(first).resolves.toEqual(saleA2);
    await expect(second).rejects.toThrow('Current sale is no longer active');
    expect(scanSaleItem).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(saleB);
  });

  it('reconciles a version conflict once without replaying or masking it', async () => {
    const queryClient = createTestQueryClient();
    const sale1 = saleFixture(1);
    const refreshedSale = saleFixture(6);
    const conflict = responseError('SALE_VERSION_CONFLICT');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), sale1);
    vi.mocked(scanSaleItem).mockRejectedValue(conflict);
    vi.mocked(getSale).mockResolvedValue(refreshedSale);
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, sale1),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(
      act(() => result.current.mutateAsync({ barcode: '111', type: 'scan' })),
    ).rejects.toBe(conflict);

    expect(getSale).toHaveBeenCalledOnce();
    expect(getSale).toHaveBeenCalledWith('sale-1');
    expect(scanSaleItem).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(refreshedSale);
  });

  it('keeps a queued scan paused through conflict reconciliation and then uses the reconciled version', async () => {
    const queryClient = createTestQueryClient();
    const reconciliation = deferred<SaleResponse>();
    const sale1 = saleFixture(1);
    const sale6 = saleFixture(6);
    const sale7 = saleFixture(7);
    const conflict = responseError('SALE_VERSION_CONFLICT');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), sale1);
    vi.mocked(scanSaleItem)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(sale7);
    vi.mocked(getSale).mockImplementation(() => reconciliation.promise);
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, sale1),
      { wrapper: wrapperFor(queryClient) },
    );

    let first!: Promise<SaleResponse>;
    let second!: Promise<SaleResponse>;
    act(() => {
      first = result.current.mutateAsync({ barcode: '111', type: 'scan' });
      second = result.current.mutateAsync({ barcode: '222', type: 'scan' });
    });

    await waitFor(() => expect(getSale).toHaveBeenCalledOnce());
    expect(scanSaleItem).toHaveBeenCalledOnce();

    reconciliation.resolve(sale6);
    await expect(first).rejects.toBe(conflict);
    await waitFor(() => expect(scanSaleItem).toHaveBeenCalledTimes(2));
    expect(scanSaleItem).toHaveBeenNthCalledWith(2, 'sale-1', {
      barcode: '222',
      expectedVersion: 6,
      quantityDelta: '1',
    });
    await expect(second).resolves.toEqual(sale7);
  });

  it.each([
    ['a newer sale', saleFixture(10, 'sale-2')],
    ['a cleared cache', undefined],
  ])(
    'does not let late reconciliation overwrite %s',
    async (_label, replacement) => {
      const queryClient = createTestQueryClient();
      const reconciliation = deferred<SaleResponse>();
      const sale1 = saleFixture(1);
      const refreshedSale = saleFixture(6);
      const conflict = responseError('SALE_VERSION_CONFLICT');
      const saleKey = queryKeys.sales.current(cashierSessionId);
      queryClient.setQueryData(saleKey, sale1);
      vi.mocked(scanSaleItem).mockRejectedValue(conflict);
      vi.mocked(getSale).mockImplementation(() => reconciliation.promise);
      const { result } = renderHook(
        () => useSaleCommandMutation(cashierSessionId, sale1),
        { wrapper: wrapperFor(queryClient) },
      );

      const command = result.current.mutateAsync({
        barcode: '111',
        type: 'scan',
      });
      await waitFor(() => expect(getSale).toHaveBeenCalledOnce());

      if (replacement) queryClient.setQueryData(saleKey, replacement);
      else queryClient.removeQueries({ exact: true, queryKey: saleKey });
      reconciliation.resolve(refreshedSale);

      await expect(command).rejects.toBe(conflict);
      expect(queryClient.getQueryData(saleKey)).toEqual(replacement);
      expect(scanSaleItem).toHaveBeenCalledOnce();
    },
  );

  it.each([
    new AxiosError('Network Error', 'ERR_NETWORK'),
    new AxiosError('Timed out', 'ECONNABORTED'),
    new AxiosError('Timed out', 'ETIMEDOUT'),
  ])(
    'reconciles an ambiguous Axios failure once without replaying it',
    async (error) => {
      const queryClient = createTestQueryClient();
      const sale1 = saleFixture(1);
      const refreshedSale = saleFixture(4);
      queryClient.setQueryData(
        queryKeys.sales.current(cashierSessionId),
        sale1,
      );
      vi.mocked(scanSaleItem).mockRejectedValue(error);
      vi.mocked(getSale).mockResolvedValue(refreshedSale);
      const { result } = renderHook(
        () => useSaleCommandMutation(cashierSessionId, sale1),
        { wrapper: wrapperFor(queryClient) },
      );

      await expect(
        act(() => result.current.mutateAsync({ barcode: '111', type: 'scan' })),
      ).rejects.toBe(error);

      expect(getSale).toHaveBeenCalledOnce();
      expect(scanSaleItem).toHaveBeenCalledOnce();
      expect(
        queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
      ).toEqual(refreshedSale);
    },
  );

  it('does not reconcile an ordinary backend validation error', async () => {
    const queryClient = createTestQueryClient();
    const sale1 = saleFixture(1);
    const error = responseError('INVALID_PRODUCT_QUANTITY');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), sale1);
    vi.mocked(setSaleItemQuantity).mockRejectedValue(error);
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, sale1),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(
      act(() =>
        result.current.mutateAsync({
          itemId: 'item-1',
          quantity: '0',
          type: 'setQuantity',
        }),
      ),
    ).rejects.toBe(error);

    expect(getSale).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(sale1);
  });

  it('preserves the original error when reconciliation also fails', async () => {
    const queryClient = createTestQueryClient();
    const sale1 = saleFixture(1);
    const networkError = new AxiosError('Network Error', 'ERR_NETWORK');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), sale1);
    vi.mocked(scanSaleItem).mockRejectedValue(networkError);
    vi.mocked(getSale).mockRejectedValue(new Error('reconciliation failed'));
    const { result } = renderHook(
      () => useSaleCommandMutation(cashierSessionId, sale1),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(
      act(() => result.current.mutateAsync({ barcode: '111', type: 'scan' })),
    ).rejects.toBe(networkError);

    expect(getSale).toHaveBeenCalledOnce();
    expect(scanSaleItem).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(sale1);
  });
});
