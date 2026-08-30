import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CreateReceiptReturnPayload,
  type SaleResponse,
  createReceiptReturn,
  createWithoutReceiptReturn,
  triggerAntiFraudEvent,
} from '@renderer/common/api';
import { ErrorCode, queryKeys } from '@renderer/common/constants';

import { useReturnSubmission } from './hooks/use-return-submission';
import { useReturnsPendingStore } from './stores/returns-pending-store';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    createReceiptReturn: vi.fn(),
    createWithoutReceiptReturn: vi.fn(),
    triggerAntiFraudEvent: vi.fn(),
  };
});

const cashierSessionId = 'cashier-session-1';
const organizationId = 'organization-1';
const storeId = 'store-1';
const idempotencyKey = '123e4567-e89b-42d3-a456-426614174000';
const payload: CreateReceiptReturnPayload = {
  items: [
    {
      quantity: '1',
      returnDisposition: 'RESTOCK',
      saleItemId: 'sale-item-1',
    },
  ],
  payments: [{ amount: '450.00', method: 'CASH' }],
  reason: 'Товар не подошёл',
};
const completedReturn: SaleResponse = {
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: cashierSessionId,
  completed_at: '2026-08-27T10:00:00.000Z',
  created_at: '2026-08-27T10:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id: 'return-1',
  items: [],
  organization_id: 'organization-1',
  original_sale_id: 'sale-1',
  payments: [],
  receipt_number: '43',
  register_id: 'register-1',
  register_shift_id: 'shift-1',
  return_reason: payload.reason,
  status: 'COMPLETED',
  store_id: 'store-1',
  total: '450.00',
  transaction_type: 'RETURN',
  updated_at: '2026-08-27T10:00:00.000Z',
  version: 1,
};

const responseError = (errorCode: string, status = 409): AxiosError =>
  new AxiosError('Request failed', undefined, undefined, undefined, {
    data: { error_code: errorCode },
    headers: {},
    status,
    statusText: 'Error',
  } as AxiosResponse);

const queryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
const wrapperFor = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(idempotencyKey);
  useReturnsPendingStore.setState({ pendingBySession: {} });
  vi.mocked(triggerAntiFraudEvent).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('return submission recovery', () => {
  it('refreshes only the current store receipt cache', async () => {
    const client = queryClient();
    const currentStoreFetch = vi.fn().mockResolvedValue({ store_id: storeId });
    const otherStoreFetch = vi.fn().mockResolvedValue({ store_id: 'store-2' });
    await client.fetchQuery({
      queryFn: currentStoreFetch,
      queryKey: queryKeys.sales.receipt('42', organizationId, storeId),
    });
    await client.fetchQuery({
      queryFn: otherStoreFetch,
      queryKey: queryKeys.sales.receipt('42', organizationId, 'store-2'),
    });
    vi.mocked(createReceiptReturn).mockResolvedValue(completedReturn);
    const { result } = renderHook(
      () => useReturnSubmission(cashierSessionId, organizationId, storeId),
      { wrapper: wrapperFor(client) },
    );

    await act(() =>
      result.current.submit.mutateAsync({
        payload,
        receiptNumber: '42',
        type: 'receipt',
      }),
    );

    expect(currentStoreFetch).toHaveBeenCalledTimes(2);
    expect(otherStoreFetch).toHaveBeenCalledOnce();
  });

  it('creates one UUID, retains an ambiguous command and retries the exact request', async () => {
    const client = queryClient();
    client.setQueryData(queryKeys.sales.receiptPage(20, 0), { receipts: [] });
    vi.mocked(createReceiptReturn)
      .mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
      .mockResolvedValueOnce(completedReturn);
    vi.mocked(triggerAntiFraudEvent).mockRejectedValue(
      new Error('Camera unavailable'),
    );
    const { result } = renderHook(
      () => useReturnSubmission(cashierSessionId, organizationId, storeId),
      { wrapper: wrapperFor(client) },
    );

    await expect(
      act(() =>
        result.current.submit.mutateAsync({
          payload,
          receiptNumber: '42',
          type: 'receipt',
        }),
      ),
    ).rejects.toThrow('Network Error');

    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    expect(result.current.pendingCommand).toEqual({
      endpoint: '/v1/returns/receipts/42',
      idempotencyKey,
      payload,
      receiptNumber: '42',
      type: 'receipt',
    });

    await act(() => result.current.retry.mutateAsync());

    expect(createReceiptReturn).toHaveBeenNthCalledWith(
      1,
      '42',
      idempotencyKey,
      payload,
    );
    expect(createReceiptReturn).toHaveBeenNthCalledWith(
      2,
      '42',
      idempotencyKey,
      payload,
    );
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
    expect(triggerAntiFraudEvent).toHaveBeenCalledWith({
      externalEventId: 'sale-refund:return-1',
      occurredAt: '2026-08-27T10:00:00.000Z',
      postBufferSeconds: 15,
      preBufferSeconds: 15,
      reason: 'Товар не подошёл',
      registerId: 'register-1',
      saleId: 'return-1',
      type: 'refund',
    });
    expect(
      useReturnsPendingStore.getState().pendingBySession[cashierSessionId],
    ).toBeUndefined();
    expect(
      client.getQueryState(queryKeys.sales.receiptPage(20, 0))?.isInvalidated,
    ).toBe(true);
  });

  it('clears a definitive quantity error and refreshes the selected receipt', async () => {
    const client = queryClient();
    const receiptKey = queryKeys.sales.receipt('42', organizationId, storeId);
    client.setQueryData(receiptKey, { id: 'sale-1' });
    vi.mocked(createReceiptReturn).mockRejectedValue(
      responseError(ErrorCode.ReturnQuantityExceeded),
    );
    const { result } = renderHook(
      () => useReturnSubmission(cashierSessionId, organizationId, storeId),
      { wrapper: wrapperFor(client) },
    );

    await expect(
      act(() =>
        result.current.submit.mutateAsync({
          payload,
          receiptNumber: '42',
          type: 'receipt',
        }),
      ),
    ).rejects.toThrow();

    expect(result.current.pendingCommand).toBeUndefined();
    expect(client.getQueryState(receiptKey)?.isInvalidated).toBe(true);
  });

  it('keeps an idempotency conflict blocked and never creates a replacement UUID', async () => {
    const client = queryClient();
    vi.mocked(createWithoutReceiptReturn).mockRejectedValue(
      responseError(ErrorCode.ReturnIdempotencyConflict),
    );
    const { result } = renderHook(
      () => useReturnSubmission(cashierSessionId, organizationId, storeId),
      { wrapper: wrapperFor(client) },
    );
    const withoutReceipt = {
      items: [
        {
          productId: 'product-1',
          quantity: '1',
          returnDisposition: 'WRITE_OFF' as const,
        },
      ],
      payments: [{ amount: '450.00', method: 'CASHLESS' as const }],
      reason: 'Возврат без чека',
    };

    await expect(
      act(() =>
        result.current.submit.mutateAsync({
          payload: withoutReceipt,
          type: 'withoutReceipt',
        }),
      ),
    ).rejects.toThrow();

    expect(result.current.pendingCommand?.idempotencyKey).toBe(idempotencyKey);
    await expect(
      act(() =>
        result.current.submit.mutateAsync({
          payload: withoutReceipt,
          type: 'withoutReceipt',
        }),
      ),
    ).rejects.toThrow('Pending return command requires recovery');
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });
});
