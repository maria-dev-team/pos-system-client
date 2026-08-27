import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type HeldSaleResponse,
  type SalePaymentPayload,
  type SaleResponse,
  checkoutSale,
  createSale,
  getCurrentSale,
  getSale,
  holdSale,
  resumeSale,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

import {
  type CheckoutCartSession,
  type PendingCheckoutOperation,
  useCheckoutCartStore,
} from './checkout-cart-store';
import type { CartItem } from './checkout-local-cart';
import { useCheckoutSaleTransitions } from './use-checkout-sale-transitions';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    checkoutSale: vi.fn(),
    createSale: vi.fn(),
    getCurrentSale: vi.fn(),
    getSale: vi.fn(),
    holdSale: vi.fn(),
    resumeSale: vi.fn(),
  };
});

const cashierSessionId = 'cashier-session-1';
const payments: SalePaymentPayload[] = [
  { amount: '22.00', method: 'CASH', received: '25.00' },
];

const cartItems: CartItem[] = [
  {
    barcode: '002',
    catalogUnitPrice: '10.00',
    name: 'Second',
    productId: 'product-2',
    productUpdatedAt: '2026-08-25T10:00:00.000Z',
    quantity: '2',
    sku: 'SECOND',
    unit: 'pcs',
  },
  {
    barcode: '001',
    catalogUnitPrice: '2.00',
    name: 'First',
    priceOverride: { reason: 'Manual price', unitPrice: '1.00' },
    productId: 'product-1',
    productUpdatedAt: '2026-08-25T10:00:00.000Z',
    quantity: '2',
    sku: 'FIRST',
    unit: 'pcs',
  },
];

const saleFixture = (
  version: number,
  status: SaleResponse['status'] = 'DRAFT',
  id = 'sale-1',
): SaleResponse => ({
  cancelled_at: status === 'CANCELLED' ? '2026-08-25T10:05:00.000Z' : null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: cashierSessionId,
  completed_at: status === 'COMPLETED' ? '2026-08-25T10:05:00.000Z' : null,
  created_at: '2026-08-25T10:00:00.000Z',
  currency: 'KZT',
  held_at: status === 'HELD' ? '2026-08-25T10:05:00.000Z' : null,
  id,
  items: [],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [],
  receipt_number: null,
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  status,
  store_id: 'store-1',
  total: '22.00',
  transaction_type: 'SALE',
  return_reason: null,
  updated_at: `2026-08-25T10:00:0${version}.000Z`,
  version,
});

const heldSummary: HeldSaleResponse = {
  created_at: '2026-08-25T10:00:00.000Z',
  held_at: '2026-08-25T10:05:00.000Z',
  id: 'sale-held',
  items_count: 2,
  status: 'HELD',
  total: '22.00',
  version: 7,
};

const responseError = (errorCode: string, status = 409): AxiosError =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    data: { error_code: errorCode },
    headers: {},
    status,
    statusText: 'Error',
  } as AxiosResponse);

const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
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

const setSession = (session: CheckoutCartSession) =>
  useCheckoutCartStore.setState({
    sessions: { [cashierSessionId]: session },
  });

let localStorageData = new Map<string, string>();

beforeEach(() => {
  vi.resetAllMocks();
  localStorageData = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => localStorageData.get(key) ?? null,
      removeItem: (key: string) => localStorageData.delete(key),
      setItem: (key: string, value: string) => localStorageData.set(key, value),
    },
  });
  useCheckoutCartStore.persist.setOptions({
    storage: {
      getItem: () => null,
      removeItem: (key) => localStorageData.delete(key),
      setItem: (key, value) => localStorageData.set(key, JSON.stringify(value)),
    },
  });
  useCheckoutCartStore.setState({ sessions: {} });
});

afterEach(cleanup);

describe('local-first checkout sale transitions', () => {
  it('prepares ordered local items with the optional override intact', async () => {
    const queryClient = createTestQueryClient();
    const sale = saleFixture(3);
    setSession({ items: cartItems });
    vi.mocked(createSale).mockResolvedValue(sale);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await act(() => result.current.prepare.mutateAsync());

    expect(createSale).toHaveBeenCalledWith({
      items: [
        { productId: 'product-2', quantity: '2' },
        {
          priceOverride: { reason: 'Manual price', unitPrice: '1.00' },
          productId: 'product-1',
          quantity: '2',
        },
      ],
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(sale);
    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId]?.items,
    ).toEqual(cartItems);
  });

  it('adopts a reconciled DRAFT after an ambiguous create without replaying create', async () => {
    const queryClient = createTestQueryClient();
    const originalError = networkError();
    const reconciled = saleFixture(4);
    setSession({ items: cartItems });
    vi.mocked(createSale).mockRejectedValue(originalError);
    vi.mocked(getCurrentSale).mockResolvedValue(reconciled);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(act(() => result.current.prepare.mutateAsync())).resolves.toBe(
      reconciled,
    );

    expect(createSale).toHaveBeenCalledOnce();
    expect(getCurrentSale).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(reconciled);
  });

  it('keeps the local cart and original create error when reconciliation finds nothing', async () => {
    const queryClient = createTestQueryClient();
    const originalError = responseError('SALE_DRAFT_ALREADY_EXISTS');
    setSession({ items: cartItems });
    vi.mocked(createSale).mockRejectedValue(originalError);
    vi.mocked(getCurrentSale).mockResolvedValue(null);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(act(() => result.current.prepare.mutateAsync())).rejects.toBe(
      originalError,
    );

    expect(createSale).toHaveBeenCalledOnce();
    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId]?.items,
    ).toEqual(cartItems);
  });

  it('keeps the original create error when reconciled DRAFT adoption is rejected', async () => {
    const queryClient = createTestQueryClient();
    const creation = deferred<SaleResponse>();
    const originalError = networkError();
    const reconciled = saleFixture(4);
    const authoritative = saleFixture(9, 'DRAFT', 'sale-newer');
    setSession({ items: cartItems });
    vi.mocked(createSale).mockImplementation(() => creation.promise);
    vi.mocked(getCurrentSale).mockResolvedValue(reconciled);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    const checkout = result.current.checkout.mutateAsync(payments);
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    queryClient.setQueryData(
      queryKeys.sales.current(cashierSessionId),
      authoritative,
    );
    creation.reject(originalError);

    await expect(checkout).rejects.toBe(originalError);
    expect(useCheckoutCartStore.getState().sessions[cashierSessionId]).toEqual({
      items: cartItems,
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(authoritative);
    expect(checkoutSale).not.toHaveBeenCalled();
    expect(holdSale).not.toHaveBeenCalled();
  });

  it('persists exact checkout data before sending and clears only after COMPLETED', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(5);
    const completed = saleFixture(6, 'COMPLETED');
    setSession({ items: cartItems });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(checkoutSale).mockImplementation(async () => {
      expect(
        useCheckoutCartStore.getState().sessions[cashierSessionId]
          ?.pendingOperation,
      ).toEqual({
        expectedVersion: 5,
        payments,
        saleId: 'sale-1',
        type: 'checkout',
      });
      return completed;
    });
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(
      act(() => result.current.checkout.mutateAsync(payments)),
    ).resolves.toBe(completed);

    expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 5,
      payments,
    });
    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId],
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
  });

  it('recovers a restarted DRAFT then replays the exact stored checkout only on retry', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(8);
    const completed = saleFixture(9, 'COMPLETED');
    setSession({
      items: cartItems,
      pendingOperation: {
        expectedVersion: 5,
        payments,
        saleId: 'sale-1',
        type: 'checkout',
      },
    });
    vi.mocked(getSale).mockResolvedValue(draft);
    vi.mocked(checkoutSale).mockResolvedValue(completed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(getSale).toHaveBeenCalledWith('sale-1'));
    await waitFor(() =>
      expect(
        queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
      ).toBe(draft),
    );
    expect(checkoutSale).not.toHaveBeenCalled();

    await expect(act(() => result.current.retryPending())).resolves.toBe(
      completed,
    );

    expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 5,
      payments,
    });
    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId],
    ).toBeUndefined();
  });

  it.each([
    ['checkout', 'SALE_VERSION_CONFLICT', 'COMPLETED'],
    ['hold', 'SALE_NOT_EDITABLE', 'HELD'],
  ] as const)(
    'returns a reconciled terminal %s result instead of the original error',
    async (operation, errorCode, terminalStatus) => {
      const queryClient = createTestQueryClient();
      const draft = saleFixture(5);
      const terminal = saleFixture(6, terminalStatus);
      const error = responseError(errorCode);
      setSession({ items: cartItems });
      queryClient.setQueryData(
        queryKeys.sales.current(cashierSessionId),
        draft,
      );
      vi.mocked(getSale).mockResolvedValue(terminal);
      if (operation === 'checkout') {
        vi.mocked(checkoutSale).mockRejectedValue(error);
      } else {
        vi.mocked(holdSale).mockRejectedValue(error);
      }
      const { result } = renderHook(
        () => useCheckoutSaleTransitions(cashierSessionId),
        { wrapper: wrapperFor(queryClient) },
      );

      const transition =
        operation === 'checkout'
          ? result.current.checkout.mutateAsync(payments)
          : result.current.hold.mutateAsync();

      await expect(act(() => transition)).resolves.toBe(terminal);
      expect(
        useCheckoutCartStore.getState().sessions[cashierSessionId],
      ).toBeUndefined();
      expect(
        queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
      ).toBeNull();
    },
  );

  it('does not let an in-flight current-sale GET resurrect a completed sale', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(5);
    const completed = saleFixture(6, 'COMPLETED');
    const lateCurrent = deferred<SaleResponse | null>();
    const currentKey = queryKeys.sales.current(cashierSessionId);
    setSession({ items: cartItems });
    queryClient.setQueryData(currentKey, draft);
    const refresh = queryClient.fetchQuery({
      queryFn: () => lateCurrent.promise,
      queryKey: currentKey,
    });
    vi.mocked(checkoutSale).mockResolvedValue(completed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await act(() => result.current.checkout.mutateAsync(payments));
    lateCurrent.resolve(draft);
    await refresh.catch(() => undefined);

    expect(queryClient.getQueryData(currentKey)).toBeNull();
  });

  it('prepares before hold, persists the returned version, and invalidates held summaries', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(11);
    const held = saleFixture(12, 'HELD');
    setSession({ items: cartItems });
    vi.mocked(createSale).mockResolvedValue(draft);
    vi.mocked(holdSale).mockImplementation(async () => {
      expect(
        useCheckoutCartStore.getState().sessions[cashierSessionId]
          ?.pendingOperation,
      ).toEqual({ expectedVersion: 11, saleId: 'sale-1', type: 'hold' });
      return held;
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await act(() => result.current.hold.mutateAsync());

    expect(holdSale).toHaveBeenCalledWith('sale-1', { expectedVersion: 11 });
    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId],
    ).toBeUndefined();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.sales.held(cashierSessionId),
    });
  });

  it('clears a pending hold when recovery confirms HELD', async () => {
    const queryClient = createTestQueryClient();
    const held = saleFixture(6, 'HELD');
    setSession({
      items: cartItems,
      pendingOperation: { expectedVersion: 5, saleId: 'sale-1', type: 'hold' },
    });
    vi.mocked(getSale).mockResolvedValue(held);

    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() =>
      expect(
        useCheckoutCartStore.getState().sessions[cashierSessionId],
      ).toBeUndefined(),
    );
    expect(result.current.recovery.data).toBe(held);
  });

  it('resumes only when invoked, writes the full DRAFT, and invalidates held summaries', async () => {
    const queryClient = createTestQueryClient();
    const resumed = saleFixture(8, 'DRAFT', 'sale-held');
    vi.mocked(resumeSale).mockResolvedValue(resumed);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    expect(resumeSale).not.toHaveBeenCalled();
    await act(() => result.current.resume.mutateAsync(heldSummary));

    expect(resumeSale).toHaveBeenCalledWith('sale-held', {
      expectedVersion: 7,
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(resumed);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.sales.held(cashierSessionId),
    });
  });

  it('clears pending but retains DRAFT and cart after deterministic checkout failure', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(5);
    const error = responseError('INSUFFICIENT_STOCK', 422);
    setSession({ items: cartItems });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(checkoutSale).mockRejectedValue(error);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(
      act(() => result.current.checkout.mutateAsync(payments)),
    ).rejects.toBe(error);

    expect(useCheckoutCartStore.getState().sessions[cashierSessionId]).toEqual({
      items: cartItems,
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(draft);
  });

  it.each(['SALE_HELD_LIMIT_EXCEEDED', 'SALE_EMPTY'])(
    'clears pending and unblocks work after definitive hold error %s',
    async (errorCode) => {
      const queryClient = createTestQueryClient();
      const draft = saleFixture(5);
      const error = responseError(errorCode, 422);
      setSession({ items: cartItems });
      queryClient.setQueryData(
        queryKeys.sales.current(cashierSessionId),
        draft,
      );
      vi.mocked(holdSale).mockRejectedValue(error);
      const { result } = renderHook(
        () => useCheckoutSaleTransitions(cashierSessionId),
        { wrapper: wrapperFor(queryClient) },
      );

      await expect(act(() => result.current.hold.mutateAsync())).rejects.toBe(
        error,
      );

      expect(
        useCheckoutCartStore.getState().sessions[cashierSessionId],
      ).toEqual({
        items: cartItems,
      });
      await expect(
        act(() => result.current.prepare.mutateAsync()),
      ).resolves.toBe(draft);
    },
  );

  it('reconciles SALE_NOT_EDITABLE before clearing a failed hold', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(5);
    const refreshed = saleFixture(7);
    const error = responseError('SALE_NOT_EDITABLE');
    setSession({ items: cartItems });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(holdSale).mockRejectedValue(error);
    vi.mocked(getSale).mockResolvedValue(refreshed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await expect(act(() => result.current.hold.mutateAsync())).rejects.toBe(
      error,
    );

    expect(getSale).toHaveBeenCalledWith('sale-1');
    expect(useCheckoutCartStore.getState().sessions[cashierSessionId]).toEqual({
      items: cartItems,
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(refreshed);
  });

  it('retains ambiguous pending data, blocks new transitions, and retries recovery explicitly', async () => {
    const queryClient = createTestQueryClient();
    const error = networkError();
    const draft = saleFixture(5);
    setSession({
      items: cartItems,
      pendingOperation: { expectedVersion: 5, saleId: 'sale-1', type: 'hold' },
    });
    vi.mocked(getSale)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(draft);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.recovery.isError).toBe(true));
    expect(result.current.isRecoveryRequired).toBe(true);
    await expect(
      act(() => result.current.prepare.mutateAsync()),
    ).rejects.toThrow('Pending sale operation requires recovery');
    expect(createSale).not.toHaveBeenCalled();

    await act(() => result.current.recovery.refetch());
    await waitFor(() =>
      expect(
        queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
      ).toBe(draft),
    );
    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId]
        ?.pendingOperation,
    ).toBeDefined();
  });

  it('reconciles a retry version conflict and requires a new confirmation', async () => {
    const queryClient = createTestQueryClient();
    const originalDraft = saleFixture(5);
    const changedDraft = saleFixture(8);
    const conflict = responseError('SALE_VERSION_CONFLICT');
    setSession({
      items: cartItems,
      pendingOperation: {
        expectedVersion: 5,
        payments,
        saleId: 'sale-1',
        type: 'checkout',
      },
    });
    vi.mocked(getSale)
      .mockResolvedValueOnce(originalDraft)
      .mockResolvedValueOnce(changedDraft);
    vi.mocked(checkoutSale).mockRejectedValue(conflict);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
      ).toBe(originalDraft),
    );

    await expect(act(() => result.current.retryPending())).rejects.toBe(
      conflict,
    );

    expect(checkoutSale).toHaveBeenCalledOnce();
    expect(getSale).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(changedDraft);
    expect(useCheckoutCartStore.getState().sessions[cashierSessionId]).toEqual({
      items: cartItems,
    });
  });

  it('abandons only pending metadata while retaining the recovered DRAFT and cart', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(5);
    setSession({
      items: cartItems,
      pendingOperation: { expectedVersion: 5, saleId: 'sale-1', type: 'hold' },
    });
    vi.mocked(getSale).mockResolvedValue(draft);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );
    await waitFor(() => expect(result.current.recovery.data).toBe(draft));

    act(() => result.current.abandonPending());

    expect(useCheckoutCartStore.getState().sessions[cashierSessionId]).toEqual({
      items: cartItems,
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(draft);
  });

  it('clears only stale pending metadata after confirmed SALE_NOT_FOUND', async () => {
    const queryClient = createTestQueryClient();
    setSession({
      items: cartItems,
      pendingOperation: { expectedVersion: 5, saleId: 'sale-1', type: 'hold' },
    });
    vi.mocked(getSale).mockRejectedValue(responseError('SALE_NOT_FOUND', 404));
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.isRecoveryRequired).toBe(false));

    expect(useCheckoutCartStore.getState().sessions[cashierSessionId]).toEqual({
      items: cartItems,
    });
  });

  it('does not let a late SALE_NOT_FOUND for P1 erase a newer P2', async () => {
    const queryClient = createTestQueryClient();
    const recovery = deferred<SaleResponse>();
    const pending1 = {
      expectedVersion: 5,
      saleId: 'sale-1',
      type: 'hold' as const,
    };
    const pending2 = {
      expectedVersion: 9,
      payments,
      saleId: 'sale-2',
      type: 'checkout' as const,
    };
    setSession({ items: cartItems, pendingOperation: pending1 });
    vi.mocked(getSale).mockImplementation(() => recovery.promise);
    renderHook(() => useCheckoutSaleTransitions(cashierSessionId), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(getSale).toHaveBeenCalledWith('sale-1'));

    act(() =>
      useCheckoutCartStore
        .getState()
        .setPendingOperation(cashierSessionId, pending2),
    );
    await act(async () => {
      recovery.reject(responseError('SALE_NOT_FOUND', 404));
      await new Promise((resolve) => window.setTimeout(resolve));
    });

    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId]
        ?.pendingOperation,
    ).toEqual(pending2);
  });

  it('does not let P1 SALE_NOT_FOUND erase P2 with different exact payments', async () => {
    const queryClient = createTestQueryClient();
    const recovery = deferred<SaleResponse>();
    const pending1: PendingCheckoutOperation = {
      expectedVersion: 5,
      payments: [
        { amount: '10.00', method: 'CASH', received: '12.00' },
        { amount: '5.00', method: 'CASHLESS' },
      ],
      saleId: 'sale-1',
      type: 'checkout',
    };
    const pending2: PendingCheckoutOperation = {
      ...pending1,
      payments: [
        { amount: '5.00', method: 'CASHLESS' },
        { amount: '10.00', method: 'CASH', received: '15.00' },
      ],
    };
    setSession({ items: cartItems, pendingOperation: pending1 });
    vi.mocked(getSale).mockImplementation(() => recovery.promise);
    renderHook(() => useCheckoutSaleTransitions(cashierSessionId), {
      wrapper: wrapperFor(queryClient),
    });
    await waitFor(() => expect(getSale).toHaveBeenCalledWith('sale-1'));

    act(() =>
      useCheckoutCartStore
        .getState()
        .setPendingOperation(cashierSessionId, pending2),
    );
    await act(async () => {
      recovery.reject(responseError('SALE_NOT_FOUND', 404));
      await new Promise((resolve) => window.setTimeout(resolve));
    });

    expect(
      useCheckoutCartStore.getState().sessions[cashierSessionId]
        ?.pendingOperation,
    ).toEqual(pending2);
  });

  it('captures persisted recovery again when the cashier session prop changes', async () => {
    const queryClient = createTestQueryClient();
    const cashierB = 'cashier-session-2';
    const pendingB = {
      expectedVersion: 3,
      saleId: 'sale-b',
      type: 'hold' as const,
    };
    useCheckoutCartStore.setState({
      sessions: {
        [cashierSessionId]: { items: cartItems },
        [cashierB]: { items: cartItems, pendingOperation: pendingB },
      },
    });
    vi.mocked(getSale).mockResolvedValue(saleFixture(3, 'DRAFT', 'sale-b'));
    const { rerender } = renderHook(
      ({ sessionId }) => useCheckoutSaleTransitions(sessionId),
      {
        initialProps: { sessionId: cashierSessionId },
        wrapper: wrapperFor(queryClient),
      },
    );

    rerender({ sessionId: cashierB });

    await waitFor(() => expect(getSale).toHaveBeenCalledWith('sale-b'));
  });

  it('does not auto-recover pending metadata created by a current mutation', async () => {
    const queryClient = createTestQueryClient();
    const draft = saleFixture(5);
    const held = saleFixture(6, 'HELD');
    const holding = deferred<SaleResponse>();
    setSession({ items: cartItems });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(holdSale).mockImplementation(() => holding.promise);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    const hold = result.current.hold.mutateAsync();
    await waitFor(() => expect(holdSale).toHaveBeenCalledOnce());

    expect(getSale).not.toHaveBeenCalled();
    holding.resolve(held);
    await expect(hold).resolves.toBe(held);
  });

  it('does not let a late prepare overwrite a different cached sale', async () => {
    const queryClient = createTestQueryClient();
    const creation = deferred<SaleResponse>();
    const created = saleFixture(1);
    const newer = saleFixture(9, 'DRAFT', 'sale-newer');
    setSession({ items: cartItems });
    vi.mocked(createSale).mockImplementation(() => creation.promise);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    const prepare = result.current.prepare.mutateAsync();
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), newer);
    creation.resolve(created);

    await expect(prepare).rejects.toThrow(
      'Current sale changed while preparing',
    );
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBe(newer);
  });

  it.each(['checkout', 'hold'] as const)(
    'aborts %s when the create response is rejected by the cache identity guard',
    async (transition) => {
      const queryClient = createTestQueryClient();
      const creation = deferred<SaleResponse>();
      const rejected = saleFixture(1);
      const authoritative = saleFixture(9, 'DRAFT', 'sale-newer');
      setSession({ items: cartItems });
      vi.mocked(createSale).mockImplementation(() => creation.promise);
      const { result } = renderHook(
        () => useCheckoutSaleTransitions(cashierSessionId),
        { wrapper: wrapperFor(queryClient) },
      );

      const request =
        transition === 'checkout'
          ? result.current.checkout.mutateAsync(payments)
          : result.current.hold.mutateAsync();
      await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
      queryClient.setQueryData(
        queryKeys.sales.current(cashierSessionId),
        authoritative,
      );
      creation.resolve(rejected);

      await expect(request).rejects.toThrow(
        'Current sale changed while preparing',
      );
      expect(checkoutSale).not.toHaveBeenCalled();
      expect(holdSale).not.toHaveBeenCalled();
      expect(
        queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
      ).toBe(authoritative);
    },
  );

  it('serializes different transitions in one cashier-session scope', async () => {
    const queryClient = createTestQueryClient();
    const creation = deferred<SaleResponse>();
    const created = saleFixture(1);
    const resumed = saleFixture(2);
    setSession({ items: cartItems });
    vi.mocked(createSale).mockImplementation(() => creation.promise);
    vi.mocked(resumeSale).mockResolvedValue(resumed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapperFor(queryClient) },
    );

    const prepare = result.current.prepare.mutateAsync();
    const resume = result.current.resume.mutateAsync({
      ...heldSummary,
      id: 'sale-1',
    });
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(resumeSale).not.toHaveBeenCalled();

    creation.resolve(created);
    await expect(prepare).resolves.toBe(created);
    await expect(resume).resolves.toBe(resumed);
    expect(resumeSale).toHaveBeenCalledOnce();
  });
});
