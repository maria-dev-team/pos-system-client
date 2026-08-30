import { z } from 'zod';

const maxReceiptNumber = 9_223_372_036_854_775_807n;

export const receiptNumberSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, 'Введите корректный номер чека')
  .refine(
    (value) => /^[1-9]\d*$/.test(value) && BigInt(value) <= maxReceiptNumber,
    'Номер чека слишком большой',
  );
