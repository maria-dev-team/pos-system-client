import { describe, expect, it } from 'vitest';

import {
  adjustQuantityByOne,
  formatQuantity,
  quantitySchema,
} from '@renderer/common/lib/quantity';

import { priceOverrideSchema, saleCancellationSchema } from './checkout-input';

describe('quantitySchema', () => {
  it.each(['1', '999999', '1.2', '1.234'])(
    'accepts valid measured quantity %s',
    (quantity) => {
      expect(quantitySchema('kg').safeParse(quantity).success).toBe(true);
    },
  );

  it.each(['0', '0.000', '.5', '1.', '1000000', '1.2345'])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(quantitySchema('l').safeParse(quantity).success).toBe(false);
    },
  );

  it('trims measured quantities and rejects fractional pieces', () => {
    expect(quantitySchema('m').parse(' 1.25 ')).toBe('1.25');
    expect(quantitySchema('pcs').safeParse('1.0').success).toBe(false);
  });
});

describe('quantity display and arithmetic', () => {
  it('formats quantities with Russian unit labels without floating point output', () => {
    expect(formatQuantity('2.000', 'pcs')).toBe('2 шт.');
    expect(formatQuantity('12.340', 'kg')).toBe('12,34 кг');
    expect(formatQuantity('0.125', 'l')).toBe('0,125 л');
    expect(formatQuantity('3', 'm')).toBe('3 м');
  });

  it('adjusts quantities exactly and marks non-positive results for removal', () => {
    expect(adjustQuantityByOne('0.125', 1)).toBe('1.125');
    expect(adjustQuantityByOne('1.000', -1)).toBeNull();
    expect(adjustQuantityByOne('2', -1)).toBe('1');
  });
});

describe('checkout reason schemas', () => {
  it('normalizes a valid price override using the common cash amount schema', () => {
    expect(
      priceOverrideSchema.parse({
        reason: '  Скидка постоянному клиенту  ',
        unitPrice: ' 15.50 ',
      }),
    ).toEqual({ reason: 'Скидка постоянному клиенту', unitPrice: '15.50' });
  });

  it.each([
    { reason: 'ок', unitPrice: '15.50' },
    { reason: 'Скидка', unitPrice: '15.555' },
    { reason: 'x'.repeat(501), unitPrice: '15' },
  ])('rejects invalid price override input %#', (values) => {
    expect(priceOverrideSchema.safeParse(values).success).toBe(false);
  });

  it('trims cancellation reasons and enforces their length', () => {
    expect(
      saleCancellationSchema.parse({ reason: '  Клиент передумал  ' }),
    ).toEqual({
      reason: 'Клиент передумал',
    });
    expect(saleCancellationSchema.safeParse({ reason: '  ' }).success).toBe(
      false,
    );
  });
});
