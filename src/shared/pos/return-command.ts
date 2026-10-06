import { z } from 'zod';

const money = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/);
const item = z.object({
  quantity: z.string().regex(/^\d{1,6}(?:\.\d{1,3})?$/),
  returnDisposition: z.enum(['RESTOCK', 'WRITE_OFF']),
});
const common = {
  buyerBinIin: z
    .string()
    .regex(/^\d{12}$/)
    .optional(),
  reason: z.string().trim().min(1).max(500),
  payments: z
    .array(
      z
        .object({ method: z.enum(['CASH', 'CASHLESS']), amount: money })
        .strict(),
    )
    .min(1)
    .max(2),
};
export const pendingReturnSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('receipt'),
      endpoint: z.string().regex(/^\/v1\/returns\/receipts\/[1-9]\d{0,19}$/),
      idempotencyKey: z.string().uuid(),
      receiptNumber: z.string().regex(/^[1-9]\d{0,19}$/),
      payload: z
        .object({
          ...common,
          items: z
            .array(item.extend({ saleItemId: z.string().uuid() }).strict())
            .min(1)
            .max(500),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('withoutReceipt'),
      endpoint: z.literal('/v1/returns/without-receipt'),
      idempotencyKey: z.string().uuid(),
      payload: z
        .object({
          ...common,
          items: z
            .array(
              item
                .extend({
                  productId: z.string().uuid(),
                  markingCode: z.string().min(1).max(512).optional(),
                  priceOverride: z
                    .object({
                      reason: z.string().min(1).max(500),
                      unitPrice: money,
                    })
                    .strict()
                    .optional(),
                })
                .strict(),
            )
            .min(1)
            .max(500),
        })
        .strict(),
    })
    .strict(),
]);
export type PendingReturnCommand = z.infer<typeof pendingReturnSchema>;
