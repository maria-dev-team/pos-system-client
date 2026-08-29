import { describe, expect, it } from 'vitest';

import { queryKeys } from './query-keys';

describe('queryKeys', () => {
  it('keeps auth, organization and store-scoped register caches separate', () => {
    expect(queryKeys.auth.context()).toEqual(['auth', 'context']);
    expect(queryKeys.auth.currentUser()).toEqual(['auth', 'user']);
    expect(queryKeys.cashierSessions.all()).toEqual(['cashier-sessions']);
    expect(queryKeys.cashierSessions.current('register-1')).toEqual([
      'cashier-sessions',
      'current',
      'register-1',
    ]);
    expect(queryKeys.products.all()).toEqual(['products']);
    expect(queryKeys.products.detail('product-1')).toEqual([
      'products',
      'detail',
      'product-1',
    ]);
    expect(
      queryKeys.products.search('organization-1', 'store-1', 'молоко'),
    ).toEqual(['products', 'search', 'organization-1', 'store-1', 'молоко']);
    expect(
      queryKeys.products.search('organization-2', 'store-1', 'молоко'),
    ).not.toEqual(
      queryKeys.products.search('organization-1', 'store-1', 'молоко'),
    );
    expect(queryKeys.sales.all()).toEqual(['sales']);
    expect(queryKeys.sales.current('cashier-session-1')).toEqual([
      'sales',
      'current',
      'cashier-session-1',
    ]);
    expect(queryKeys.sales.held('cashier-session-1')).toEqual([
      'sales',
      'held',
      'cashier-session-1',
    ]);
    expect(queryKeys.sales.receiptPages()).toEqual([
      'sales',
      'receipts',
      'page',
    ]);
    expect(queryKeys.sales.receiptPage(20, 40)).toEqual([
      'sales',
      'receipts',
      'page',
      20,
      40,
    ]);
    expect(queryKeys.sales.receipt('42')).toEqual([
      'sales',
      'receipts',
      'detail',
      '42',
    ]);
    expect(queryKeys.health.api()).toEqual(['health', 'api']);
    expect(queryKeys.organizations.mine()).toEqual(['organizations', 'mine']);
    expect(queryKeys.registers.all()).toEqual(['registers']);
    expect(queryKeys.registers.active('store-1')).toEqual([
      'registers',
      'active',
      'store-1',
    ]);
    expect(queryKeys.registers.active()).toEqual(['registers', 'active', null]);
    expect(queryKeys.registerShifts.all()).toEqual(['register-shifts']);
    expect(queryKeys.registerShifts.current('register-1')).toEqual([
      'register-shifts',
      'current',
      'register-1',
    ]);
  });
});
