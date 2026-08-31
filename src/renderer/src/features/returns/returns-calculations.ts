import Decimal from 'decimal.js';

import type {
  ReceiptResponse,
  ReturnPaymentPayload,
} from '@renderer/common/api';
import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

const money = (value: Decimal.Value) =>
  new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

type ReceiptReturnItem = Pick<
  ReceiptResponse['items'][number],
  'line_total' | 'quantity' | 'returned_quantity'
>;

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

export const calculateReceiptReturnLineTotal = (
  item: ReceiptReturnItem,
  quantity: string,
) => {
  const sourceQuantity = new Decimal(item.quantity);
  const cumulativeTotal = (returnedQuantity: Decimal) =>
    returnedQuantity.equals(sourceQuantity)
      ? item.line_total
      : money(
          new Decimal(item.line_total)
            .times(returnedQuantity)
            .dividedBy(sourceQuantity),
        );
  const before = new Decimal(item.returned_quantity);
  return money(
    new Decimal(cumulativeTotal(before.plus(quantity))).minus(
      cumulativeTotal(before),
    ),
  );
};

export const calculateReceiptReturnTotal = (
  lines: {
    item: ReceiptReturnItem;
    quantity: string;
  }[],
) =>
  money(
    lines.reduce(
      (total, { item, quantity }) =>
        total.plus(calculateReceiptReturnLineTotal(item, quantity)),
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
