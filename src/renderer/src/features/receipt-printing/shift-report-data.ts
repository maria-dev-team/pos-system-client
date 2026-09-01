import type { FiscalShiftReportResponse } from '@renderer/common/api';

import type { PrintableShiftReport } from '../../../../main/receipt-printer/shift-report-document';

export const buildPrintableShiftReport = (
  report: FiscalShiftReportResponse,
  timeZone: string,
): PrintableShiftReport => ({
  cash: report.cash,
  cashbox: {
    identityNumber: report.cashbox.identity_number,
    registrationNumber: report.cashbox.registration_number,
    serialNumber: report.cashbox.serial_number,
  },
  cashier: report.cashier,
  change: report.change,
  closedAt: report.closed_at,
  controlSum: report.control_sum,
  discount: report.discount,
  documentCount: report.document_count,
  generatedAt: report.generated_at,
  markup: report.markup,
  ofd: report.ofd,
  offline: report.offline,
  openedAt: report.opened_at,
  operations: {
    purchaseReturns: report.operations.purchase_returns,
    purchases: report.operations.purchases,
    saleReturns: report.operations.sale_returns,
    sales: report.operations.sales,
  },
  payments: report.payments.map(({ amount, provider_type }) => ({
    amount,
    providerType: provider_type,
  })),
  provider: report.provider,
  reportNumber: report.report_number,
  reportType: report.report_type,
  shiftNumber: report.shift_number,
  taken: report.taken,
  taxpayer: {
    binIin: report.taxpayer.bin_iin,
    name: report.taxpayer.name,
  },
  timeZone,
  vat: report.vat,
});
