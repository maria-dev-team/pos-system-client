import { z } from 'zod';

import type { AuthContextResponse } from '../../renderer/src/common/api/responses/auth-context.response';
import type { CashierSessionResponse } from '../../renderer/src/common/api/responses/cashier-session.response';
import type { CategorySearchResponse } from '../../renderer/src/common/api/responses/category.response';
import type {
  ProductResponse,
  ProductSearchResponse,
} from '../../renderer/src/common/api/responses/product.response';
import type { RegisterShiftResponse } from '../../renderer/src/common/api/responses/register-shift.response';
import type {
  HeldSaleResponse,
  SaleResponse,
} from '../../renderer/src/common/api/responses/sale.response';

export type { ProductResponse, SaleResponse };

const money = z
  .string()
  .max(20)
  .regex(/^\d+(?:\.\d{1,2})?$/);
const quantity = z.string().regex(/^\d{1,6}(?:\.\d{1,3})?$/);
const id = z.string().uuid();
const reason = z.string().trim().min(3).max(500);

export const saleCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('scan'),
      barcode: z.string().trim().min(1).max(512),
    })
    .strict(),
  z
    .object({
      type: z.literal('add'),
      productId: id,
      quantity: quantity.optional(),
      markingCode: z.string().min(1).max(512).optional(),
    })
    .strict(),
  z.object({ type: z.literal('setQuantity'), itemId: id, quantity }).strict(),
  z.object({ type: z.literal('remove'), itemId: id }).strict(),
  z
    .object({
      type: z.literal('overridePrice'),
      itemId: id,
      unitPrice: money,
      reason,
    })
    .strict(),
  z.object({ type: z.literal('resetPrice'), itemId: id }).strict(),
  z
    .object({
      type: z.literal('applyDiscount'),
      percentage: z.string().regex(/^\d{1,2}(?:\.\d{1,2})?$/),
      reason,
    })
    .strict(),
  z.object({ type: z.literal('resetDiscount') }).strict(),
]);

export type SaleCommand = z.infer<typeof saleCommandSchema>;
export const posRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('deferPayment'), saleId: id }).strict(),
  z.object({ type: z.literal('resumePayment'), saleId: id }).strict(),
  z.object({ type: z.literal('reconcilePayment'), saleId: id }).strict(),
  z.object({ type: z.literal('conflict'), saleId: id }).strict(),
  z
    .object({
      type: z.literal('resolveConflict'),
      saleId: id,
      choice: z.enum(['local', 'server']),
      localRevision: z.number().int().nonnegative(),
      serverVersion: z.number().int().nonnegative().nullable(),
      serverId: id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('connect'),
      forceOnline: z.boolean().optional(),
      accessToken: z.string().min(1).max(16384),
      registerId: id,
    })
    .strict(),
  z
    .object({
      type: z.literal('restore'),
      accessToken: z.string().min(1).max(16384),
    })
    .strict(),
  z.object({ type: z.literal('disconnect') }).strict(),
  z.object({ type: z.literal('current') }).strict(),
  z.object({ type: z.literal('held') }).strict(),
  z.object({ type: z.literal('sale'), saleId: id }).strict(),
  z.object({ type: z.literal('execute'), command: saleCommandSchema }).strict(),
  z
    .object({
      type: z.literal('transition'),
      action: z.enum(['hold', 'resume', 'cancel']),
      saleId: id,
      reason: reason.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('search'),
      search: z.string().max(512).optional(),
      categoryId: id.optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(1000000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('categories'),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(1000000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('status') }).strict(),
  z.object({ type: z.literal('retry') }).strict(),
  z.object({ type: z.literal('flush') }).strict(),
  z
    .object({
      type: z.literal('checkout'),
      saleId: id,
      total: money,
      buyerBinIin: z
        .string()
        .regex(/^\d{12}$/)
        .optional(),
      payments: z
        .array(
          z
            .object({
              method: z.enum(['CASH', 'CASHLESS']),
              amount: money,
              received: money.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(2),
    })
    .strict(),
]);

export type PosRequest = z.infer<typeof posRequestSchema>;
export type PosProfile = {
  context: AuthContextResponse;
  session: CashierSessionResponse;
  shift: RegisterShiftResponse;
  expiresAt: number;
  tokenHash: string;
  verifiedAt: number;
};
export type PosStatus = {
  conflicts: { saleId: string; total: string }[];
  connected: boolean;
  pending: number;
  catalogReady: boolean;
  catalogUpdatedAt: string | null;
  error: string | null;
  paymentPending: boolean;
  paymentReviews: {
    saleId: string;
    total: string;
    deferred: boolean;
    canResume: boolean;
  }[];
  tokenRefreshRequired: boolean;
  authorizationRequired: boolean;
  fiscalShiftExpired: boolean;
};
export type PosResult =
  | PosConflict
  | PosProfile
  | SaleResponse
  | SaleResponse[]
  | HeldSaleResponse[]
  | ProductSearchResponse
  | CategorySearchResponse
  | PosStatus
  | null;

export type PosConflict = { local: SaleResponse; remote: SaleResponse | null };
export type PosReply =
  { ok: true; value: PosResult } | { ok: false; code: string; message: string };
export type LocalPosBridge = {
  request: (request: PosRequest) => Promise<PosReply>;
  onChange: (listener: () => void) => () => void;
};

/** Durable local aggregate and its last server version; these revisions are independent. */
export type LocalSale = {
  sale: SaleResponse;
  revision: number;
  syncedRevision: number;
  serverVersion: number;
  sequence: number;
  inFlight: {
    commandId: string;
    revision: number;
    payload: Record<string, unknown>;
  } | null;
  payment: {
    request: Extract<PosRequest, { type: 'checkout' }>;
    stage: 'PREPARING' | 'SENT';
  } | null;
  fiscalBlocked?: boolean;
  deferredPayment?: boolean;
  deferSynced?: boolean;
  error: string | null;
  cancellationEvent?: { occurredAt: string; reason: string } | null;
};

export class PosError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
