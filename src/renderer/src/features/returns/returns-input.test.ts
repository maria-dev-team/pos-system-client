import { describe, expect, it } from 'vitest';

import {
  buildReturnPayments,
  calculateReceiptReturnLineTotal,
  calculateReturnLineTotal,
  calculateReturnTotal,
} from './returns-calculations';
import {
  priceOverrideSchema,
  receiptNumberSchema,
  returnQuantitySchema,
} from './returns.schema';

describe('receipt number validation', () => {
  it.each(['1', '42', '9223372036854775807'])(
    'accepts backend receipt number %s',
    (receiptNumber) => {
      expect(receiptNumberSchema.safeParse(receiptNumber).success).toBe(true);
    },
  );

  it.each(['', '0', '01', '-1', '1.5', '9223372036854775808'])(
    'rejects invalid backend receipt number %s',
    (receiptNumber) => {
      expect(receiptNumberSchema.safeParse(receiptNumber).success).toBe(false);
    },
  );
});

describe('return quantities and money', () => {
  it('enforces unit rules and the remaining returnable quantity', () => {
    expect(returnQuantitySchema('pcs', '2').safeParse('1.5').success).toBe(
      false,
    );
    expect(returnQuantitySchema('kg', '2').safeParse('2.001').success).toBe(
      false,
    );
    expect(returnQuantitySchema('kg', '2').parse('1.125')).toBe('1.125');
  });

  it('rounds each line half up and sums exact decimal totals', () => {
    expect(calculateReturnLineTotal('3', '0.335')).toBe('1.01');
    expect(
      calculateReturnTotal([
        { quantity: '3', unitPrice: '0.335' },
        { quantity: '2', unitPrice: '10.00' },
      ]),
    ).toBe('21.01');
  });

  it('preserves cumulative rounding across partial discounted returns', () => {
    expect(
      calculateReceiptReturnLineTotal(
        {
          line_total: '2.00',
          quantity: '3.000',
          returned_quantity: '1.000',
        },
        '1',
      ),
    ).toBe('0.66');
  });
});

describe('outgoing return payments', () => {
  it('builds cash, cashless and mixed payments without received or change', () => {
    expect(buildReturnPayments('100.00', 'CASH')).toEqual([
      { amount: '100.00', method: 'CASH' },
    ]);
    expect(buildReturnPayments('100.00', 'CASHLESS')).toEqual([
      { amount: '100.00', method: 'CASHLESS' },
    ]);
    expect(buildReturnPayments('100.00', 'MIXED', '30.25')).toEqual([
      { amount: '30.25', method: 'CASH' },
      { amount: '69.75', method: 'CASHLESS' },
    ]);
  });

  it.each(['0', '99.999', '100', '101'])(
    'rejects invalid mixed cash amount %s',
    (cashAmount) => {
      expect(() =>
        buildReturnPayments('100.00', 'MIXED', cashAmount),
      ).toThrow();
    },
  );
});

describe('return price override', () => {
  it('requires a different price and a reason from 3 to 500 characters', () => {
    expect(
      priceOverrideSchema('450.00').parse({
        reason: '  Повреждена упаковка  ',
        unitPrice: '400.00',
      }),
    ).toEqual({ reason: 'Повреждена упаковка', unitPrice: '400.00' });
    expect(
      priceOverrideSchema('450.00').safeParse({
        reason: 'Новая цена',
        unitPrice: '450',
      }).success,
    ).toBe(false);
    expect(
      priceOverrideSchema('450.00').safeParse({
        reason: 'ок',
        unitPrice: '400.00',
      }).success,
    ).toBe(false);
  });
});
