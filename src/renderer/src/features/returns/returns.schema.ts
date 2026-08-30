import Decimal from 'decimal.js';
import { z } from 'zod';

import type { ProductUnit } from '@renderer/common/api';
import { quantitySchema } from '@renderer/common/lib/quantity';
import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

export { receiptNumberSchema } from '@renderer/common/schemas/receipt-number.schema';

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

export const priceOverrideSchema = (catalogPrice: string) =>
  z.object({
    reason: returnReasonSchema,
    unitPrice: cashAmountSchema.refine(
      (unitPrice) => !new Decimal(unitPrice).eq(catalogPrice),
      'Новая цена должна отличаться от цены каталога',
    ),
  });
