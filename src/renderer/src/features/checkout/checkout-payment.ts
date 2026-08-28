import Decimal from 'decimal.js';

import type { SalePaymentPayload } from '@renderer/common/api';
import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

const parseCashAmount = (value: string) => {
  const parsed = cashAmountSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const decimal = (value: string) => new Decimal(value);

export function getCashChange(received: string, cashAmount: string) {
  const parsedReceived = parseCashAmount(received);
  const parsedCashAmount = parseCashAmount(cashAmount);
  if (parsedReceived === null || parsedCashAmount === null) return null;

  const change = decimal(parsedReceived).minus(decimal(parsedCashAmount));
  return change.isNegative() ? null : change.toFixed(2);
}

export function createCashPayment(
  serverTotal: string,
  received: string,
): SalePaymentPayload[] | null {
  const total = parseCashAmount(serverTotal);
  const parsedReceived = parseCashAmount(received);
  if (total === null || parsedReceived === null) return null;
  if (decimal(total).lte(0)) return null;
  if (decimal(parsedReceived).lt(decimal(total))) return null;

  return [{ amount: total, method: 'CASH', received: parsedReceived }];
}

export function createCashlessPayment(
  serverTotal: string,
): SalePaymentPayload[] | null {
  const total = parseCashAmount(serverTotal);
  if (total === null || decimal(total).lte(0)) return null;
  return [{ amount: total, method: 'CASHLESS' }];
}

export function createMixedPayments(
  serverTotal: string,
  cashAmount: string,
  cashReceived: string,
): SalePaymentPayload[] | null {
  const total = parseCashAmount(serverTotal);
  const cash = parseCashAmount(cashAmount);
  const received = parseCashAmount(cashReceived);
  if (total === null || cash === null || received === null) return null;

  const cashDecimal = decimal(cash);
  if (
    !cashDecimal.gt(0) ||
    !cashDecimal.lt(decimal(total)) ||
    decimal(received).lt(cashDecimal)
  ) {
    return null;
  }

  return [
    { amount: cash, method: 'CASH', received },
    {
      amount: decimal(total).minus(cashDecimal).toFixed(2),
      method: 'CASHLESS',
    },
  ];
}
