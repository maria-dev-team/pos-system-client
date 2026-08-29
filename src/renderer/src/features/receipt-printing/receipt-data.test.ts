import { describe, expect, it } from 'vitest';

import type { OrganizationResponse, SaleResponse } from '@renderer/common/api';

import { buildPrintableReceipt } from './receipt-data';

const sale: SaleResponse = {
  cancelled_at: null,
  cancelled_by_membership_id: null,
  cancellation_reason: null,
  cashier_membership_id: 'membership-1',
  cashier_session_id: 'session-1',
  completed_at: '2026-08-28T08:15:00.000Z',
  created_at: '2026-08-28T08:00:00.000Z',
  currency: 'KZT',
  held_at: null,
  id: 'sale-1',
  items: [
    {
      barcode: '123',
      base_unit_price: '1800.00',
      id: 'item-1',
      line_number: 1,
      line_total: '900.00',
      name: 'Қазақша тауар',
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '0.500',
      return_disposition: null,
      sku: 'SKU-1',
      source_sale_item_id: null,
      unit_code: 'kg',
      unit_price: '1800.00',
    },
  ],
  organization_id: 'organization-1',
  original_sale_id: null,
  payments: [
    {
      amount: '900.00',
      change: null,
      completed_at: '2026-08-28T08:15:00.000Z',
      created_at: '2026-08-28T08:14:00.000Z',
      direction: 'INCOMING',
      id: 'payment-1',
      method: 'CASHLESS',
      received: null,
      status: 'COMPLETED',
      updated_at: '2026-08-28T08:15:00.000Z',
    },
    {
      amount: '100.00',
      change: null,
      completed_at: null,
      created_at: '2026-08-28T08:14:00.000Z',
      direction: 'INCOMING',
      id: 'payment-pending',
      method: 'CASH',
      received: null,
      status: 'PENDING',
      updated_at: '2026-08-28T08:15:00.000Z',
    },
  ],
  receipt_number: '42',
  register_id: 'register-1',
  register_shift_id: 'shift-1',
  status: 'COMPLETED',
  store_id: 'store-1',
  total: '900.00',
  transaction_type: 'SALE',
  return_reason: null,
  updated_at: '2026-08-28T08:15:00.000Z',
  version: 3,
};

const organization: OrganizationResponse = {
  address: 'Алматы',
  bin_iin: '123456789012',
  created_at: '2026-01-01T00:00:00.000Z',
  default_currency: 'KZT',
  deleted_at: null,
  id: 'organization-1',
  language: 'ru',
  legal_form: 'TOO',
  legal_name: 'ТОО Maria',
  name: 'Maria',
  timezone: 'Asia/Almaty',
  trade_name: 'Maria Market',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('buildPrintableReceipt', () => {
  it('uses directory metadata and only completed incoming payments', () => {
    expect(
      buildPrintableReceipt(sale, {
        currentCashier: { id: 'membership-1', name: 'Айжан Қасымова' },
        organization,
        store: { address: 'Абай 1', name: 'Магазин №1' },
      }),
    ).toMatchObject({
      cashier: 'Айжан Қасымова',
      items: [
        {
          lineNumber: 1,
          name: 'Қазақша тауар',
          quantity: '0.500',
          unitLabel: 'кг',
        },
      ],
      organization: {
        binIin: '123456789012',
        displayName: 'Maria Market',
        legalName: 'ТОО Maria',
      },
      payments: [{ amount: '900.00', method: 'CASHLESS' }],
      receiptNumber: '42',
      store: { address: 'Абай 1', name: 'Магазин №1' },
      timeZone: 'Asia/Almaty',
    });
  });

  it('does not attribute another cashier historical receipt to current user', () => {
    expect(
      buildPrintableReceipt(
        { ...sale, cashier_membership_id: 'membership-2' },
        {
          currentCashier: { id: 'membership-1', name: 'Айжан Қасымова' },
          organization,
          store: null,
        },
      )?.cashier,
    ).toBe('ID: membership-2');
  });

  it('rejects non-sale and incomplete records', () => {
    expect(
      buildPrintableReceipt({ ...sale, transaction_type: 'RETURN' }, {}),
    ).toBeNull();
    expect(
      buildPrintableReceipt({ ...sale, receipt_number: null }, {}),
    ).toBeNull();
  });
});
