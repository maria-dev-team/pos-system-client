import { z } from 'zod';

const moneyPattern = /^\d+(?:\.\d{1,2})?$/;
const cashAmountSchema = z
  .string()
  .trim()
  .min(1, 'Введите сумму наличных')
  .regex(moneyPattern, 'Введите сумму с точностью не более двух знаков');

export const registerShiftOpeningSchema = z.object({
  openingCash: cashAmountSchema,
});

export const registerShiftClosingSchema = z.object({
  actualCash: cashAmountSchema,
});

export type RegisterShiftOpeningValues = z.infer<
  typeof registerShiftOpeningSchema
>;

export type RegisterShiftClosingValues = z.infer<
  typeof registerShiftClosingSchema
>;
