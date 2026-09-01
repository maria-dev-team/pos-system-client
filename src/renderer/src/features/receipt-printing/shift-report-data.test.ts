import { describe, expect, it } from 'vitest';

import type { FiscalShiftReportResponse } from '@renderer/common/api';

import { buildPrintableShiftReport } from './shift-report-data';

const response: FiscalShiftReportResponse = {
  cash: { balance: '720.00', deposited: '100.00', withdrawn: '20.00' },
  cashbox: {
    identity_number: 'IN-1',
    registration_number: 'RN-1',
    serial_number: 'SWK00000001',
  },
  cashier: { code: 'C-1', name: 'Айжан' },
  change: '50.00',
  closed_at: null,
  control_sum: 'control-sum',
  discount: '80.00',
  document_count: 3,
  generated_at: '2026-08-31T08:57:06.000Z',
  markup: '0.00',
  ofd: { name: 'ОФД', website: 'https://ofd.example' },
  offline: false,
  opened_at: '2026-08-31T08:30:00.000Z',
  operations: {
    purchase_returns: { amount: '0.00', count: 0 },
    purchases: { amount: '0.00', count: 0 },
    sale_returns: { amount: '100.00', count: 1 },
    sales: { amount: '900.00', count: 2 },
  },
  payments: [
    { amount: '500.00', provider_type: 0 },
    { amount: '300.00', provider_type: 1 },
  ],
  provider: 'WEBKASSA',
  report_number: '10',
  report_type: 'X',
  shift_number: '2',
  taken: '850.00',
  taxpayer: { bin_iin: '000000000000', name: 'Demo' },
  vat: '96.00',
};

describe('buildPrintableShiftReport', () => {
  it('maps the backend report without recalculating or leaking extra data', () => {
    const report = buildPrintableShiftReport(response, 'Asia/Almaty');

    expect(report).toEqual({
      cash: { balance: '720.00', deposited: '100.00', withdrawn: '20.00' },
      cashbox: {
        identityNumber: 'IN-1',
        registrationNumber: 'RN-1',
        serialNumber: 'SWK00000001',
      },
      cashier: { code: 'C-1', name: 'Айжан' },
      change: '50.00',
      closedAt: null,
      controlSum: 'control-sum',
      discount: '80.00',
      documentCount: 3,
      generatedAt: '2026-08-31T08:57:06.000Z',
      markup: '0.00',
      ofd: { name: 'ОФД', website: 'https://ofd.example' },
      offline: false,
      openedAt: '2026-08-31T08:30:00.000Z',
      operations: {
        purchaseReturns: { amount: '0.00', count: 0 },
        purchases: { amount: '0.00', count: 0 },
        saleReturns: { amount: '100.00', count: 1 },
        sales: { amount: '900.00', count: 2 },
      },
      payments: [
        { amount: '500.00', providerType: 0 },
        { amount: '300.00', providerType: 1 },
      ],
      provider: 'WEBKASSA',
      reportNumber: '10',
      reportType: 'X',
      shiftNumber: '2',
      taken: '850.00',
      taxpayer: { binIin: '000000000000', name: 'Demo' },
      timeZone: 'Asia/Almaty',
      vat: '96.00',
    });
    expect(report).not.toHaveProperty('raw');
  });
});
