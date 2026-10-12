// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { productFixture } from './test-fixtures';
import {
  type ScaleProfile,
  assertWeightedProduct,
  parseWeightedBarcode,
  scaleProfileSchema,
} from './weighted-barcode';

const profile: ScaleProfile = {
  format: 'ean13-weight-v1',
  prefix: '20',
  enabled: false,
  blocked_reason: null,
};

describe('scale label contract', () => {
  it.each([
    ['2000001001851', 1, '0.185'],
    ['2000001000014', 1, '0.001'],
    ['2000001010006', 1, '1'],
    ['2099999999998', 99999, '99.999'],
  ])(
    'reads the backend fixture %s even when uploads are disabled',
    (code, scalePlu, quantity) => {
      expect(parseWeightedBarcode(code, profile)).toEqual({
        scalePlu,
        quantity,
      });
    },
  );

  it.each(['2000001001852', '2000000001852', '2000001000007'])(
    'rejects a bad checksum, zero PLU or zero weight: %s',
    (code) => {
      expect(() => parseWeightedBarcode(code, profile)).toThrow(
        expect.objectContaining({ code: 'SCALE_BARCODE_INVALID' }),
      );
    },
  );

  it.each([
    '2900001001854',
    '4870000000012',
    '20',
    '200000100185',
    '(01)04870000000012(21)serial',
  ])('keeps ordinary codes on their existing path: %s', (code) =>
    expect(parseWeightedBarcode(code, profile)).toBeNull(),
  );

  it('only uses the organization prefix, never a hardcoded weight prefix', () => {
    expect(parseWeightedBarcode('2000001001851', null)).toBeNull();
    expect(
      parseWeightedBarcode('2000001001851', { ...profile, prefix: '21' }),
    ).toBeNull();
  });

  it('blocks ambiguous weight labels without blocking ordinary identifiers', () => {
    const blocked = { ...profile, blocked_reason: 'barcode_conflict' as const };
    expect(() => parseWeightedBarcode('2000001001851', blocked)).toThrow(
      expect.objectContaining({ code: 'SCALE_BARCODE_CONFLICT' }),
    );
    expect(parseWeightedBarcode('4870000000012', blocked)).toBeNull();
  });

  it('validates metadata instead of guessing a format or reserved prefix', () => {
    expect(scaleProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      scaleProfileSchema.safeParse({ ...profile, prefix: null }).success,
    ).toBe(true);
    for (const invalid of [
      { ...profile, format: 'other' },
      { ...profile, prefix: '29' },
      { ...profile, prefix: '2' },
      { ...profile, prefix: null, enabled: true },
      { ...profile, blocked_reason: 'unknown' },
    ])
      expect(scaleProfileSchema.safeParse(invalid).success).toBe(false);
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
