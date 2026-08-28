import type { OrganizationResponse, SaleResponse } from '@renderer/common/api';

type PrintableReceipt = Parameters<
  NonNullable<Window['receiptPrinter']>['print']
>[0]['receipt'];

type ReceiptMetadata = {
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
    sale.transaction_type !== 'SALE' ||
    !sale.completed_at ||
    !sale.receipt_number
  ) {
    return null;
  }

  const payments = sale.payments
    .filter(
      (payment) =>
        payment.status === 'COMPLETED' && payment.direction === 'INCOMING',
    )
    .map(({ amount, change, method, received }) => ({
      amount,
      change,
      method,
      received,
    }));
  if (payments.length === 0 || sale.items.length === 0) return null;

  const organization = metadata.organization;
  const currentCashier = metadata.currentCashier;

  return {
    cashier:
      currentCashier?.id === sale.cashier_membership_id
        ? currentCashier.name
        : `ID: ${sale.cashier_membership_id}`,
    completedAt: sale.completed_at,
    currency: sale.currency,
    items: sale.items.map((item) => ({
      lineNumber: item.line_number,
      lineTotal: item.line_total,
      name: item.name,
      quantity: item.quantity,
      unitLabel: unitLabels[item.unit_code],
      unitPrice: item.unit_price,
    })),
    organization: {
      binIin: organization?.bin_iin ?? null,
      displayName:
        organization?.trade_name ?? organization?.name ?? sale.organization_id,
      legalName: organization?.legal_name ?? null,
    },
    payments,
    receiptNumber: sale.receipt_number,
    store: {
      address: metadata.store?.address ?? null,
      name: metadata.store?.name ?? sale.store_id,
    },
    timeZone: organization?.timezone ?? 'Asia/Almaty',
    total: sale.total,
  };
};
