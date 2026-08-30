import type { OrganizationResponse, SaleResponse } from '@renderer/common/api';

type PrintableReceipt = Parameters<
  NonNullable<Window['receiptPrinter']>['print']
>[0]['receipt'];

type ReceiptMetadata = {
  cashierName?: string | null;
  currentCashier?: { id: string; name: string } | null;
  organization?: OrganizationResponse | null;
  store?: { address: string | null; name: string } | null;
};

const unitLabels = { kg: 'кг', l: 'л', m: 'м', pcs: 'шт.' } as const;

export const buildPrintableReceipt = (
  sale: SaleResponse,
  metadata: ReceiptMetadata,
): PrintableReceipt | null => {
  if (
    sale.status !== 'COMPLETED' ||
    !sale.completed_at ||
    !sale.receipt_number ||
    !sale.fiscal_receipt
  ) {
    return null;
  }

  const payments = sale.payments
    .filter(
      (payment) =>
        payment.status === 'COMPLETED' &&
        payment.direction ===
          (sale.transaction_type === 'SALE' ? 'INCOMING' : 'OUTGOING'),
    )
    .map(({ amount, change, method, received }) => ({
      amount,
      change: sale.transaction_type === 'SALE' ? change : null,
      method,
      received: sale.transaction_type === 'SALE' ? received : null,
    }));
  if (payments.length === 0 || sale.items.length === 0) return null;

  const organization = metadata.organization;
  const currentCashier = metadata.currentCashier;
  const fiscal = sale.fiscal_receipt;
  const cashierName =
    metadata.cashierName !== undefined
      ? metadata.cashierName
      : currentCashier?.id === sale.cashier_membership_id
        ? currentCashier.name
        : null;
  if (!cashierName) return null;

  return {
    cashier: cashierName,
    completedAt: fiscal.fiscalized_at,
    currency: sale.currency,
    items: sale.items.map((item) => ({
      lineNumber: item.line_number,
      lineTotal: item.line_total,
      markingCode: item.marking_code,
      name: item.nkt_name ?? item.name,
      ntinCode: item.ntin_code,
      quantity: item.quantity,
      unitLabel: unitLabels[item.unit_code],
      unitPrice: item.unit_price,
      vatAmount: item.vat_amount,
      vatRate: item.vat_rate,
    })),
    organization: {
      binIin: fiscal.taxpayer_bin_iin,
      displayName:
        organization?.trade_name ?? organization?.name ?? sale.organization_id,
      legalName: fiscal.taxpayer_name,
    },
    fiscal: {
      address: fiscal.address,
      buyerBinIin: fiscal.buyer_bin_iin,
      cashboxUniqueNumber: fiscal.cashbox_unique_number,
      fiscalSign: fiscal.fiscal_sign,
      offline: fiscal.offline,
      ofdName: fiscal.ofd_name,
      ofdWebsite: fiscal.ofd_website,
      qrUrl: fiscal.qr_url,
      receiptNumber: fiscal.receipt_number,
      registrationNumber: fiscal.registration_number,
      shiftNumber: fiscal.shift_number,
      vatTotal: fiscal.vat_total,
    },
    isTest: false,
    localReceiptNumber: sale.receipt_number,
    operationType: sale.transaction_type,
    payments,
    store: {
      address: fiscal.address,
      name: metadata.store?.name ?? sale.store_id,
    },
    timeZone: organization?.timezone ?? 'Asia/Almaty',
    total: sale.total,
  };
};
