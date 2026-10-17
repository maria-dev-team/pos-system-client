// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildScanCandidates, scanAmbiguitySchema } from './barcode-scan';
import { productFixture } from './test-fixtures';
import type { ScaleProfile } from './weighted-barcode';

const profile: ScaleProfile = {
  format: 'ean13-weight-v1',
  prefix: '27',
  enabled: false,
  blocked_reason: null,
  revision: 2,
  issued_plu_ranges: [[4245, 4245]],
};
const barcode = '2704245001850';
const weighted = {
  ...productFixture(),
  unit: 'kg' as const,
  scale_plu: 4245,
  retail_price: '1500.00',
};
const staticProduct = {
  ...productFixture(),
  id: '88888888-8888-4888-8888-888888888888',
  barcode,
};

describe('barcode scan candidates', () => {
  it('uses the exact label quantity for an issued, available weight product', () => {
    expect(buildScanCandidates(barcode, profile, [], weighted)).toEqual([
      {
        kind: 'weighted',
        product_id: weighted.id,
        name: weighted.name,
        unit: 'kg',
        quantity: '0.185',
        retail_price: '1500.00',
        unavailable_reason: null,
      },
    ]);
  });

  it('deduplicates static matches by product but retains both interpretations of one card', () => {
    const sameProduct = { ...weighted, barcode };
    expect(
      buildScanCandidates(
        barcode,
        profile,
        [sameProduct, sameProduct],
        sameProduct,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'static',
        product_id: sameProduct.id,
        quantity: null,
      }),
      expect.objectContaining({
        kind: 'weighted',
        product_id: sameProduct.id,
        quantity: '0.185',
      }),
    ]);
  });

  it('does not silently discard a PLU missing from the store catalog', () => {
    expect(
      buildScanCandidates(barcode, profile, [staticProduct], undefined),
    ).toEqual([
      expect.objectContaining({ kind: 'static', product_id: staticProduct.id }),
      {
        kind: 'weighted',
        product_id: null,
        name: null,
        unit: 'kg',
        quantity: '0.185',
        retail_price: null,
        unavailable_reason: 'PRODUCT_NOT_FOUND',
      },
    ]);
  });

  it.each([
    [{ is_active: false }, 'PRODUCT_NOT_SELLABLE'],
    [{ retail_price: null }, 'PRODUCT_SALE_PRICE_REQUIRED'],
    [{ unit: 'pcs' as const }, 'SCALE_BARCODE_INVALID'],
    [{ scale_plu: 4246 }, 'SCALE_BARCODE_INVALID'],
  ])(
    'preserves unavailable weighted interpretations (%j)',
    (changes, reason) => {
      expect(
        buildScanCandidates(barcode, profile, [staticProduct], {
          ...weighted,
          ...changes,
        }),
      ).toEqual([
        expect.objectContaining({ kind: 'static', unavailable_reason: null }),
        expect.objectContaining({
          kind: 'weighted',
          unavailable_reason: reason,
        }),
      ]);
    },
  );

  it('keeps unavailable static candidates visible with their actual details', () => {
    expect(
      buildScanCandidates(
        '4870000000012',
        profile,
        [
          { ...staticProduct, is_active: false },
          { ...weighted, retail_price: null },
        ],
        null,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'static',
        name: staticProduct.name,
        unavailable_reason: 'PRODUCT_NOT_SELLABLE',
      }),
      expect.objectContaining({
        kind: 'static',
        retail_price: null,
        unavailable_reason: 'PRODUCT_SALE_PRICE_REQUIRED',
      }),
    ]);
  });

  it('does not interpret a valid label as weighted when its PLU was never issued', () => {
    expect(
      buildScanCandidates(
        barcode,
        { ...profile, issued_plu_ranges: [] },
        [staticProduct],
        weighted,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'static',
        product_id: staticProduct.id,
        quantity: null,
      }),
    ]);
  });

  it.each(['2704245001851', '2704245000006'])(
    'allows an exact static code despite an invalid weighted interpretation (%s)',
    (invalid) => {
      expect(
        buildScanCandidates(
          invalid,
          profile,
          [{ ...staticProduct, barcode: invalid }],
          weighted,
        ),
      ).toEqual([expect.objectContaining({ kind: 'static', quantity: null })]);
      expect(() => buildScanCandidates(invalid, profile, [], weighted)).toThrow(
        expect.objectContaining({ code: 'SCALE_BARCODE_INVALID' }),
      );
    },
  );

  it.each([null, '28'])(
    'only uses the current organization prefix (%s)',
    (prefix) => {
      expect(
        buildScanCandidates(
          barcode,
          { ...profile, prefix },
          [staticProduct],
          weighted,
        ),
      ).toEqual([expect.objectContaining({ kind: 'static', quantity: null })]);
    },
  );

  it('validates the flat backend ambiguity without losing unknown product details', () => {
    const ambiguity = {
      current_version: 5,
      candidates: [
        {
          kind: 'static',
          product_id: staticProduct.id,
          name: staticProduct.name,
          unit: 'pcs',
          quantity: null,
          retail_price: '650.00',
          unavailable_reason: null,
        },
        {
          kind: 'weighted',
          product_id: null,
          name: null,
          unit: 'kg',
          quantity: '0.185',
          retail_price: null,
          unavailable_reason: 'PRODUCT_NOT_FOUND',
        },
      ],
    };
    expect(
      scanAmbiguitySchema.parse({
        ...ambiguity,
        error_code: 'PRODUCT_BARCODE_AMBIGUOUS',
      }),
    ).toEqual(ambiguity);
    expect(
      scanAmbiguitySchema.safeParse({ ...ambiguity, current_version: -1 })
        .success,
    ).toBe(false);
    expect(
      scanAmbiguitySchema.safeParse({
        ...ambiguity,
        candidates: [{ ...ambiguity.candidates[0], kind: 'other' }],
      }).success,
    ).toBe(false);
  });
});
