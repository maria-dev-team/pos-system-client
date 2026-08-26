import { z } from 'zod';

import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

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
