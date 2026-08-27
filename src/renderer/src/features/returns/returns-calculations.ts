import Decimal from 'decimal.js';

import type { ReturnPaymentPayload } from '@renderer/common/api';
import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

const money = (value: Decimal.Value) =>
  new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export const calculateReturnLineTotal = (quantity: string, unitPrice: string) =>
  money(new Decimal(quantity).times(unitPrice));

export const calculateReturnTotal = (
  lines: { quantity: string; unitPrice: string }[],
) =>
  money(
    lines.reduce(
      (total, line) =>
        total.plus(calculateReturnLineTotal(line.quantity, line.unitPrice)),
      new Decimal(0),
    ),
  );

export const getReturnUnitPrice = (line: {
  catalogUnitPrice: string;
  priceOverride?: { unitPrice: string };
}) => line.priceOverride?.unitPrice ?? line.catalogUnitPrice;

export type ReturnPaymentMode = 'CASH' | 'CASHLESS' | 'MIXED';

export function buildReturnPayments(
  total: string,
  mode: ReturnPaymentMode,
  cashAmount?: string,
): ReturnPaymentPayload[] {
  const roundedTotal = money(total);
  if (mode !== 'MIXED') return [{ amount: roundedTotal, method: mode }];

  const parsedCash = cashAmountSchema.safeParse(cashAmount);
  if (!parsedCash.success) throw new Error('Invalid mixed cash amount');
  const cash = new Decimal(parsedCash.data);
  const totalAmount = new Decimal(roundedTotal);
  if (cash.lte(0) || cash.gte(totalAmount)) {
    throw new Error(
      'Mixed cash amount must be greater than zero and below total',
    );
  }

  return [
    { amount: money(cash), method: 'CASH' },
    { amount: money(totalAmount.minus(cash)), method: 'CASHLESS' },
  ];
}
