// @vitest-environment node
import { describe, expect, it } from 'vitest';

import backendFixtures from './fixtures/ean13-weight-v1.json';
import { productFixture } from './test-fixtures';
import {
  type ScaleProfile,
  assertWeightedProduct,
  isIssuedPlu,
  mergeScaleProfiles,
  parseWeightedBarcode,
  scaleProfileSchema,
} from './weighted-barcode';

const profile: ScaleProfile = {
  format: 'ean13-weight-v1',
  prefix: '20',
  enabled: false,
  blocked_reason: null,
  revision: 2,
  issued_plu_ranges: [
    [1, 4],
    [8, 10],
  ],
};

describe('scale label contract', () => {
  it.each(backendFixtures.valid)(
    'reads the backend fixture $barcode even when uploads are disabled',
    ({ barcode, scalePlu, quantity }) => {
      expect(parseWeightedBarcode(barcode, profile)).toEqual({
        scalePlu,
        quantity,
      });
    },
  );

  it.each(backendFixtures.invalid)(
    'rejects a bad checksum, zero PLU or zero weight: %s',
    (code) => {
      expect(() => parseWeightedBarcode(code, profile)).toThrow(
        expect.objectContaining({ code: 'SCALE_BARCODE_INVALID' }),
      );
    },
  );

  it.each(backendFixtures.ordinary)(
    'keeps ordinary codes on their existing path: %s',
    (code) => expect(parseWeightedBarcode(code, profile)).toBeNull(),
  );

  it('only uses the organization prefix, never a hardcoded weight prefix', () => {
    expect(parseWeightedBarcode('2000001001851', null)).toBeNull();
    expect(
      parseWeightedBarcode('2000001001851', { ...profile, prefix: '21' }),
    ).toBeNull();
  });

  it('decodes the assigned 27 prefix with exact gram precision', () => {
    expect(
      parseWeightedBarcode('2704245001850', { ...profile, prefix: '27' }),
    ).toEqual({
      scalePlu: 4245,
      quantity: '0.185',
    });
  });

  it('validates metadata instead of guessing a format or reserved prefix', () => {
    expect(scaleProfileSchema.parse(profile)).toEqual(profile);
    expect(
      scaleProfileSchema.safeParse({ ...profile, prefix: null }).success,
    ).toBe(true);
    for (const invalid of [
      { ...profile, format: 'other' },
      { ...profile, prefix: '29' },
      { ...profile, prefix: '2' },
      { ...profile, prefix: null, enabled: true },
      { ...profile, blocked_reason: 'unknown' },
      { ...profile, blocked_reason: 'barcode_conflict' },
      { ...profile, revision: -1 },
      { ...profile, revision: 1.5 },
      { ...profile, revision: undefined },
      { ...profile, issued_plu_ranges: undefined },
      { ...profile, issued_plu_ranges: [[0, 4]] },
      { ...profile, issued_plu_ranges: [[1, 100000]] },
      { ...profile, issued_plu_ranges: [[4, 1]] },
      { ...profile, issued_plu_ranges: [[1]] },
      { ...profile, issued_plu_ranges: [[1, 2, 3]] },
    ])
      expect(scaleProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it('unions newly issued PLUs without changing an equal or older prefix revision', () => {
    const current = { ...profile, enabled: true };
    for (const revision of [1, 2]) {
      const merged = mergeScaleProfiles(current, {
        ...profile,
        revision,
        prefix: '27',
        issued_plu_ranges: [
          [3, 8],
          [4245, 4245],
        ],
      });
      expect(merged).toEqual({
        ...current,
        issued_plu_ranges: [
          [1, 10],
          [4245, 4245],
        ],
      });
      expect(isIssuedPlu(4245, merged)).toBe(true);
      expect(isIssuedPlu(11, merged)).toBe(false);
    }
    expect(current.issued_plu_ranges).toEqual([
      [1, 4],
      [8, 10],
    ]);
  });

  it('accepts a newer prefix while retaining all previously issued PLUs', () => {
    const merged = mergeScaleProfiles(profile, {
      ...profile,
      revision: 3,
      prefix: '27',
      enabled: true,
      issued_plu_ranges: [[4245, 4245]],
    });
    expect(merged).toEqual({
      ...profile,
      revision: 3,
      prefix: '27',
      enabled: true,
      issued_plu_ranges: [
        [1, 4],
        [8, 10],
        [4245, 4245],
      ],
    });
    expect(parseWeightedBarcode('2000001001851', merged)).toBeNull();
    expect(mergeScaleProfiles(null, merged)).toEqual(merged);
  });

  it('refuses a retained PLU on a piece product or a different PLU', () => {
    const label = { scalePlu: 1, quantity: '0.185' };
    const product = { ...productFixture(), unit: 'kg' as const, scale_plu: 1 };
    expect(() => assertWeightedProduct(product, label)).not.toThrow();
    expect(() =>
      assertWeightedProduct({ ...product, unit: 'pcs' }, label),
    ).toThrow(expect.objectContaining({ code: 'SCALE_BARCODE_INVALID' }));
    expect(() =>
      assertWeightedProduct({ ...product, scale_plu: 2 }, label),
    ).toThrow();
    expect(() => assertWeightedProduct(undefined, label)).toThrow(
      expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }),
    );
  });
});
