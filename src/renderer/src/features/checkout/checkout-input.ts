import { z } from 'zod';

import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

const reasonSchema = z
  .string()
  .trim()
  .min(3, 'Укажите причину не короче 3 символов')
  .max(500, 'Причина не может быть длиннее 500 символов');

export const priceOverrideSchema = z.object({
  reason: reasonSchema,
  unitPrice: cashAmountSchema,
});

export const saleDiscountSchema = z.object({
  percentage: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,2})?$/, 'Укажите процент с точностью до сотых')
    .refine(
      (percentage) => Number(percentage) > 0 && Number(percentage) < 100,
      'Скидка должна быть больше 0 и меньше 100 процентов',
    ),
  reason: reasonSchema,
});

export const saleCancellationSchema = z.object({
  reason: reasonSchema,
});
