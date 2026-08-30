import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type SaleResponse,
  cancelSale,
  checkoutSale,
  getSale,
  holdSale,
  resumeSale,
  triggerAntiFraudEvent,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

import { useCheckoutSaleTransitions } from './use-checkout-sale-transitions';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    cancelSale: vi.fn(),
    checkoutSale: vi.fn(),
    getSale: vi.fn(),
    holdSale: vi.fn(),
    resumeSale: vi.fn(),
    triggerAntiFraudEvent: vi.fn(),
  };
});

const cashierSessionId = 'cashier-session-1';

const saleFixture = (overrides: Partial<SaleResponse> = {}): SaleResponse => ({
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: cashierSessionId,
  completed_at: null,
  created_at: '2026-08-24T10:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id: 'sale-1',
  items: [
    {
      barcode: '001234',
      base_unit_price: '650.00',
      id: 'item-1',
      is_marked: false,
      line_number: 1,
      line_total: '650.00',
      name: 'Молоко',
      marking_code: null,
      nkt_name: null,
      ntin_code: null,
      gtin: null,
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '1',
      return_disposition: null,
      sku: 'MILK-1',
      source_sale_item_id: null,
      unit_code: 'pcs',
      unit_price: '650.00',
      vat_amount: '0.00',
      vat_rate: 'NONE',
    },
  ],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [],
  receipt_number: null,
  register_id: 'register-1',
  register_shift_id: 'register-shift-1',
  status: 'DRAFT',
  store_id: 'store-1',
  total: '650.00',
  transaction_type: 'SALE',
  return_reason: null,
  updated_at: '2026-08-24T10:00:00.000Z',
  version: 5,
  ...overrides,
  fiscal_receipt: overrides.fiscal_receipt ?? null,
});

const client = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

const wrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(triggerAntiFraudEvent).mockResolvedValue(undefined);
});

describe('checkout terminal transitions', () => {
  it('checks out the cached server draft and clears current sale', async () => {
    const queryClient = client();
    const draft = saleFixture();
    const completed = saleFixture({ status: 'COMPLETED', version: 6 });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(checkoutSale).mockResolvedValue(completed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapper(queryClient) },
    );

    await act(() =>
      result.current.checkout.mutateAsync({
        payments: [{ amount: '650.00', method: 'CASHLESS' }],
      }),
    );

    expect(checkoutSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 5,
      payments: [{ amount: '650.00', method: 'CASHLESS' }],
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
  });

  it('reconciles an ambiguous checkout that already completed', async () => {
    const queryClient = client();
    const draft = saleFixture();
    const completed = saleFixture({ status: 'COMPLETED', version: 6 });
    const networkError = new AxiosError('Network Error', 'ERR_NETWORK');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(checkoutSale).mockRejectedValue(networkError);
    vi.mocked(getSale).mockResolvedValue(completed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapper(queryClient) },
    );

    await expect(
      act(() =>
        result.current.checkout.mutateAsync({
          payments: [{ amount: '650.00', method: 'CASHLESS' }],
        }),
      ),
    ).resolves.toEqual(completed);
    expect(checkoutSale).toHaveBeenCalledOnce();
    expect(getSale).toHaveBeenCalledWith('sale-1');
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
  });

  it('keeps a reconciled DRAFT authoritative and does not replay the command', async () => {
    const queryClient = client();
    const draft = saleFixture();
    const refreshed = saleFixture({ version: 8 });
    const networkError = new AxiosError('Network Error', 'ERR_NETWORK');
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(checkoutSale).mockRejectedValue(networkError);
    vi.mocked(getSale).mockResolvedValue(refreshed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapper(queryClient) },
    );

    await expect(
      act(() =>
        result.current.checkout.mutateAsync({
          payments: [{ amount: '650.00', method: 'CASHLESS' }],
        }),
      ),
    ).rejects.toBe(networkError);
    expect(checkoutSale).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(refreshed);
  });

  it('cancels with a mandatory reason and emits anti-fraud once', async () => {
    const queryClient = client();
    const draft = saleFixture();
    const cancelled = saleFixture({
      cancelled_at: '2026-08-24T10:05:00.000Z',
      cancellation_reason: 'Ошибка кассира',
      status: 'CANCELLED',
      version: 6,
    });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    vi.mocked(cancelSale).mockResolvedValue(cancelled);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapper(queryClient) },
    );

    await act(() => result.current.cancel.mutateAsync('Ошибка кассира'));

    expect(cancelSale).toHaveBeenCalledWith('sale-1', {
      expectedVersion: 5,
      reason: 'Ошибка кассира',
    });
    await waitFor(() => expect(triggerAntiFraudEvent).toHaveBeenCalledOnce());
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
  });

  it('holds the current draft and invalidates held sales', async () => {
    const queryClient = client();
    const draft = saleFixture();
    const held = saleFixture({ status: 'HELD', version: 6 });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), draft);
    queryClient.setQueryData(queryKeys.sales.held(cashierSessionId), []);
    vi.mocked(holdSale).mockResolvedValue(held);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapper(queryClient) },
    );

    await act(() => result.current.hold.mutateAsync());

    expect(holdSale).toHaveBeenCalledWith('sale-1', { expectedVersion: 5 });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toBeNull();
    expect(
      queryClient.getQueryState(queryKeys.sales.held(cashierSessionId))
        ?.isInvalidated,
    ).toBe(true);
  });

  it('resumes a held sale only when no draft is active', async () => {
    const queryClient = client();
    const resumed = saleFixture({ id: 'sale-held', version: 4 });
    queryClient.setQueryData(queryKeys.sales.current(cashierSessionId), null);
    vi.mocked(resumeSale).mockResolvedValue(resumed);
    const { result } = renderHook(
      () => useCheckoutSaleTransitions(cashierSessionId),
      { wrapper: wrapper(queryClient) },
    );

    await act(() =>
      result.current.resume.mutateAsync({
        created_at: '2026-08-24T10:00:00.000Z',
        held_at: '2026-08-24T10:05:00.000Z',
        id: 'sale-held',
        items_count: 1,
        status: 'HELD',
        total: '650.00',
        version: 3,
      }),
    );

    expect(resumeSale).toHaveBeenCalledWith('sale-held', {
      expectedVersion: 3,
    });
    expect(
      queryClient.getQueryData(queryKeys.sales.current(cashierSessionId)),
    ).toEqual(resumed);
  });
});
