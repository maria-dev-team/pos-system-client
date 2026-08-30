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
  fiscal_receipt: {
    address: 'Алматы, Абай 1',
    buyer_bin_iin: null,
    cashbox_unique_number: 'SWK00000001',
    currency: 'KZT',
    fiscal_sign: '123456789',
    fiscalized_at: '2026-08-28T08:15:00.000Z',
    offline: false,
    ofd_name: 'ОФД',
    ofd_website: 'https://ofd.example',
    operation_type: 'SALE',
    print_url: null,
    provider: 'WEBKASSA',
    qr_url: 'https://ofd.example/check/7',
    receipt_number: '7',
    registration_number: 'RN-1',
    shift_number: '2',
    status: 'FISCALIZED',
    taxpayer_bin_iin: '123456789012',
    taxpayer_name: 'ТОО Maria',
    total: '900.00',
    vat_total: '0.00',
  },
  held_at: null,
  id: 'sale-1',
  items: [
    {
      barcode: '123',
      base_unit_price: '1800.00',
      id: 'item-1',
      is_marked: false,
      line_number: 1,
      line_total: '900.00',
      name: 'Қазақша тауар',
      marking_code: null,
      nkt_name: 'Қазақша тауар',
      ntin_code: 'NTIN-1',
      gtin: '00000000000123',
      price_override_reason: null,
      price_overridden_by_membership_id: null,
      product_id: 'product-1',
      quantity: '0.500',
      return_disposition: null,
      sku: 'SKU-1',
      source_sale_item_id: null,
      unit_code: 'kg',
      unit_price: '1800.00',
      vat_amount: '0.00',
      vat_rate: 'NONE',
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
      localReceiptNumber: '42',
      store: { address: 'Алматы, Абай 1', name: 'Магазин №1' },
      timeZone: 'Asia/Almaty',
    });
  });

  it('uses the resolved cashier name for a historical receipt', () => {
    expect(
      buildPrintableReceipt(
        { ...sale, cashier_membership_id: 'membership-2' },
        {
          cashierName: 'Бекзат Омаров',
          currentCashier: { id: 'membership-1', name: 'Айжан Қасымова' },
          organization,
          store: null,
        },
      )?.cashier,
    ).toBe('Бекзат Омаров');
  });

  it('rejects a historical receipt without the cashier name', () => {
    expect(
      buildPrintableReceipt(
        { ...sale, cashier_membership_id: 'membership-2' },
        {
          currentCashier: { id: 'membership-1', name: 'Айжан Қасымова' },
          organization,
          store: null,
        },
      ),
    ).toBeNull();
  });

  it('prints fiscal returns and rejects incomplete records', () => {
    expect(
      buildPrintableReceipt(
        {
          ...sale,
          fiscal_receipt: {
            ...sale.fiscal_receipt!,
            operation_type: 'RETURN',
          },
          payments: sale.payments.map((payment) => ({
            ...payment,
            direction: 'OUTGOING',
          })),
          transaction_type: 'RETURN',
        },
        {
          currentCashier: { id: 'membership-1', name: 'Айжан Қасымова' },
        },
      )?.operationType,
    ).toBe('RETURN');
    expect(
      buildPrintableReceipt({ ...sale, receipt_number: null }, {}),
    ).toBeNull();
    expect(
      buildPrintableReceipt({ ...sale, fiscal_receipt: null }, {}),
    ).toBeNull();
  });
});
