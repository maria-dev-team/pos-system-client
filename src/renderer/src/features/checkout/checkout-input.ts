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

export const saleCancellationSchema = z.object({
  reason: reasonSchema,
});
