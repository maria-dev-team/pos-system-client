import { z } from 'zod';

import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

export const cashierSessionOpeningSchema = z.object({
  openingCash: cashAmountSchema,
});

export const cashierSessionClosingSchema = z.object({
  actualCash: cashAmountSchema,
});
