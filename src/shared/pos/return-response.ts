import Decimal from 'decimal.js';

import type { SaleResponse } from '../api/responses/sale.response';
import type { PendingReturnCommand } from './return-command';

/** A successful HTTP status is not evidence that this refund completed. */
export function assertCompletedReturn(
  value: unknown,
  command: PendingReturnCommand,
  organizationId: string,
  storeId: string,
): asserts value is SaleResponse {
  const sale = value as SaleResponse | null;
  const invalid = (): never => {
    throw new Error(
      'Сервер не подтвердил этот возврат. Команда сохранена для проверки.',
    );
  };
  const money = (v: unknown): v is string =>
    typeof v === 'string' && /^\d{1,18}(?:\.\d{1,2})?$/.test(v);
  if (
    !sale ||
    sale.id !== command.idempotencyKey ||
    sale.organization_id !== organizationId ||
    sale.store_id !== storeId ||
    sale.transaction_type !== 'RETURN' ||
    sale.status !== 'COMPLETED' ||
    sale.currency !== 'KZT' ||
    !sale.completed_at ||
    !Number.isFinite(Date.parse(sale.completed_at)) ||
    !money(sale.total) ||
    !Array.isArray(sale.items) ||
    !Array.isArray(sale.payments) ||
    sale.items.length !== command.payload.items.length
  )
    return invalid();
  const expectedTotal = command.payload.payments.reduce(
    (sum, p) => sum.plus(p.amount),
    new Decimal(0),
  );
  if (!expectedTotal.eq(sale.total)) return invalid();
  for (const method of ['CASH', 'CASHLESS']) {
    const expected = command.payload.payments
      .filter((p) => p.method === method)
      .reduce((sum, p) => sum.plus(p.amount), new Decimal(0));
    const payments = sale.payments.filter((p) => p.method === method);
    if (
      payments.some(
        (p) =>
          p.status !== 'COMPLETED' ||
          p.direction !== 'OUTGOING' ||
          !money(p.amount),
      ) ||
      !payments
        .reduce((sum, p) => sum.plus(p.amount), new Decimal(0))
        .eq(expected)
    )
      return invalid();
  }
  if (sale.payments.some((p) => !['CASH', 'CASHLESS'].includes(p.method)))
    return invalid();
  for (let index = 0; index < sale.items.length; index++) {
    const actual = sale.items[index];
    const expected = command.payload.items[index];
    if (
      !actual ||
      !expected ||
      !/^\d+(?:\.\d{1,3})?$/.test(actual.quantity) ||
      !new Decimal(actual.quantity).eq(expected.quantity) ||
      actual.return_disposition !== expected.returnDisposition ||
      ('saleItemId' in expected
        ? actual.source_sale_item_id !== expected.saleItemId
        : actual.product_id !== expected.productId)
    )
      return invalid();
  }
  const fiscal = sale.fiscal_receipt;
  if (sale.fiscalization_mode === 'NON_FISCAL') {
    if (fiscal !== null) return invalid();
  } else if (
    !fiscal ||
    fiscal.status !== 'FISCALIZED' ||
    fiscal.operation_type !== 'RETURN' ||
    !['WEBKASSA', 'REKASSA'].includes(fiscal.provider) ||
    fiscal.currency !== sale.currency ||
    !money(fiscal.total) ||
    !expectedTotal.eq(fiscal.total) ||
    ![
      fiscal.fiscal_sign,
      fiscal.receipt_number,
      fiscal.cashbox_unique_number,
      fiscal.shift_number,
    ].every((v) => typeof v === 'string' && v.trim()) ||
    (fiscal.buyer_bin_iin ?? null) !== (command.payload.buyerBinIin ?? null)
  )
    return invalid();
}
