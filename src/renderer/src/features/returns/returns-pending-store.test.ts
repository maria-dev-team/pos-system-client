import { beforeEach, describe, expect, it } from 'vitest';

import type { CreateReceiptReturnPayload } from '@renderer/common/api';

import {
  returnsPendingStorageName,
  useReturnsPendingStore,
} from './returns-pending-store';

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

let persisted = new Map<string, string>();

beforeEach(() => {
  persisted = new Map();
  useReturnsPendingStore.persist.setOptions({
    storage: {
      getItem: () => null,
      removeItem: (key) => persisted.delete(key),
      setItem: (key, value) => persisted.set(key, JSON.stringify(value)),
    },
  });
  useReturnsPendingStore.setState({ pendingBySession: {} });
});

describe('pending return commands', () => {
  it('persists the first exact endpoint, UUID and payload and refuses replacement', () => {
    const first = {
      endpoint: '/v1/returns/receipts/42' as const,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      payload,
      receiptNumber: '42',
      type: 'receipt' as const,
    };
    const replacement = {
      ...first,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174999',
    };

    expect(
      useReturnsPendingStore.getState().setPending('session-1', first),
    ).toBe(true);
    expect(
      useReturnsPendingStore.getState().setPending('session-1', replacement),
    ).toBe(false);
    expect(
      useReturnsPendingStore.getState().pendingBySession['session-1'],
    ).toEqual(first);
    expect(persisted.has(returnsPendingStorageName)).toBe(true);
  });

  it('clears only the completed cashier session command', () => {
    const command = {
      endpoint: '/v1/returns/receipts/42' as const,
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      payload,
      receiptNumber: '42',
      type: 'receipt' as const,
    };
    useReturnsPendingStore.setState({
      pendingBySession: { 'session-1': command, 'session-2': command },
    });

    useReturnsPendingStore.getState().clearPending('session-1');

    expect(useReturnsPendingStore.getState().pendingBySession).toEqual({
      'session-2': command,
    });
  });
});
