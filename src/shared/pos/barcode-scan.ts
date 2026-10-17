import { z } from 'zod';

import type { ProductResponse } from '../api/responses/product.response';
import {
  type ScaleProfile,
  isIssuedPlu,
  parseWeightedBarcode,
} from './weighted-barcode';

export const scanCandidateSchema = z.object({
  kind: z.enum(['static', 'weighted']),
  product_id: z.string().nullable(),
  name: z.string().nullable(),
  unit: z.string(),
  quantity: z.string().nullable(),
  retail_price: z.string().nullable(),
  unavailable_reason: z.string().nullable(),
});
export type ScanCandidate = z.infer<typeof scanCandidateSchema>;

export const scanAmbiguitySchema = z.object({
  current_version: z.number().int().nonnegative(),
  candidates: z.array(scanCandidateSchema),
});
export type ScanAmbiguity = z.infer<typeof scanAmbiguitySchema>;

export function buildScanCandidates(
  barcode: string,
  profile: ScaleProfile,
  staticProducts: readonly ProductResponse[],
  weightedProduct: ProductResponse | null | undefined,
): ScanCandidate[] {
  const uniqueStaticProducts = new Map(
    staticProducts.map((product) => [product.id, product]),
  );
  const candidates = [...uniqueStaticProducts.values()].map((product) =>
    scanCandidate('static', product, null),
  );
  let label: ReturnType<typeof parseWeightedBarcode>;
  try {
    label = parseWeightedBarcode(barcode, profile);
  } catch (error) {
    // A malformed weighted interpretation must not reject an exact static code.
    if (!candidates.length) throw error;
    return candidates;
  }
  if (label && isIssuedPlu(label.scalePlu, profile))
    candidates.push(
      scanCandidate(
        'weighted',
        weightedProduct,
        label.quantity,
        label.scalePlu,
      ),
    );
  return candidates;
}

function scanCandidate(
  kind: ScanCandidate['kind'],
  product: ProductResponse | null | undefined,
  quantity: string | null,
  scalePlu?: number,
): ScanCandidate {
  const unavailableReason = !product
    ? 'PRODUCT_NOT_FOUND'
    : kind === 'weighted' &&
        (product.unit !== 'kg' || product.scale_plu !== scalePlu)
      ? 'SCALE_BARCODE_INVALID'
      : !product.is_active
        ? 'PRODUCT_NOT_SELLABLE'
        : product.retail_price === null
          ? 'PRODUCT_SALE_PRICE_REQUIRED'
          : null;
  return {
    kind,
    product_id: product?.id ?? null,
    name: product?.name ?? null,
    unit: product?.unit ?? 'kg',
    quantity,
    retail_price: product?.retail_price ?? null,
    unavailable_reason: unavailableReason,
  };
}
