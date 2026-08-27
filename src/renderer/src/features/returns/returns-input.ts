import Decimal from 'decimal.js';
import { z } from 'zod';

import type { ProductUnit, ReturnPaymentPayload } from '@renderer/common/api';
import { quantitySchema } from '@renderer/common/lib/quantity';
import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

const maxReceiptNumber = 9_223_372_036_854_775_807n;

export const receiptNumberSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, 'Введите корректный номер чека')
  .refine(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= maxReceiptNumber,
    'Номер чека слишком большой',
  );

export const returnReasonSchema = z
  .string()
  .trim()
  .min(3, 'Укажите причину не короче 3 символов')
  .max(500, 'Причина не может быть длиннее 500 символов');

export const returnQuantitySchema = (
  unit: ProductUnit,
  returnableQuantity?: string,
) =>
  quantitySchema(unit).refine(
    (quantity) =>
      /^\d{1,6}(?:\.\d{1,3})?$/.test(quantity) &&
      (!returnableQuantity ||
        new Decimal(quantity).lte(new Decimal(returnableQuantity))),
    'Количество превышает доступное для возврата',
  );

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

export const priceOverrideSchema = (catalogPrice: string) =>
  z.object({
    reason: returnReasonSchema,
    unitPrice: cashAmountSchema.refine(
      (unitPrice) => !new Decimal(unitPrice).eq(catalogPrice),
      'Новая цена должна отличаться от цены каталога',
    ),
  });
