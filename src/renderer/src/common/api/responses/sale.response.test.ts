import { describe, expect, it } from 'vitest';

import type { HeldSaleResponse, SalePaymentResponse } from './sale.response';

const pendingPayment = {
  amount: '450.00',
  change: null,
  completed_at: null,
  created_at: '2026-08-24T08:10:00.000Z',
  direction: 'INCOMING',
  id: 'payment-1',
  method: 'CASH',
  received: null,
  status: 'PENDING',
  updated_at: '2026-08-24T08:10:00.000Z',
} satisfies SalePaymentResponse;

const heldSale = {
  created_at: '2026-08-24T08:10:00.000Z',
  discount_amount: '0.00',
  discount_applied_by_membership_id: null,
  discount_percentage: null,
  discount_reason: null,
  held_at: '2026-08-24T08:15:00.000Z',
  id: 'sale-1',
  items_count: 2,
  status: 'HELD',
  subtotal: '900.00',
  total: '900.00',
  version: 3,
} satisfies HeldSaleResponse;

describe('SalePaymentResponse', () => {
  it('represents pending payments without a completion timestamp', () => {
    expect(pendingPayment.completed_at).toBeNull();
  });

  it('represents held sale summaries without loading their items', () => {
    expect(heldSale.items_count).toBe(2);
  });
});
