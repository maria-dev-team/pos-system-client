import { describe, expect, it } from 'vitest';

import {
  cashierSessionClosingSchema,
  cashierSessionOpeningSchema,
} from './cashier-session.schema';

describe('cashier session money schemas', () => {
  it('uses the shared backend money format for opening and ending', () => {
    expect(
      cashierSessionOpeningSchema.parse({ openingCash: ' 10000.50 ' }),
    ).toEqual({ openingCash: '10000.50' });
    expect(
      cashierSessionClosingSchema.parse({ actualCash: ' 9900.00 ' }),
    ).toEqual({ actualCash: '9900.00' });
  });

  it.each(['', '-1', '1,50', '1.234'])(
    'rejects invalid amount %s',
    (amount) => {
      expect(
        cashierSessionOpeningSchema.safeParse({ openingCash: amount }).success,
      ).toBe(false);
      expect(
        cashierSessionClosingSchema.safeParse({ actualCash: amount }).success,
      ).toBe(false);
    },
  );
});
