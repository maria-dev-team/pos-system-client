import { describe, expect, it } from 'vitest';

import {
  registerShiftClosingSchema,
  registerShiftOpeningSchema,
} from './register-shift.schema';

describe('register shift opening schema', () => {
  it.each(['0', '15000', '15000.5', '15000.50'])(
    'accepts backend money format %s',
    (openingCash) => {
      expect(
        registerShiftOpeningSchema.safeParse({ openingCash }).success,
      ).toBe(true);
    },
  );

  it.each(['', ' ', '-1', '1,50', '1.234', 'cash'])(
    'rejects invalid money format %s',
    (openingCash) => {
      expect(
        registerShiftOpeningSchema.safeParse({ openingCash }).success,
      ).toBe(false);
    },
  );

  it('trims the value sent to backend', () => {
    expect(
      registerShiftOpeningSchema.parse({ openingCash: ' 125.50 ' }),
    ).toEqual({ openingCash: '125.50' });
  });
});

describe('register shift closing schema', () => {
  it('accepts and trims the actual cash amount', () => {
    expect(
      registerShiftClosingSchema.parse({ actualCash: ' 19800.50 ' }),
    ).toEqual({ actualCash: '19800.50' });
  });

  it.each(['', '-1', '1,50', '1.234'])(
    'rejects invalid amount %s',
    (actualCash) => {
      expect(registerShiftClosingSchema.safeParse({ actualCash }).success).toBe(
        false,
      );
    },
  );
});
