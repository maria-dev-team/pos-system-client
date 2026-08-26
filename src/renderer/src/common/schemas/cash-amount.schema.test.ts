import { describe, expect, it } from 'vitest';

import { cashAmountSchema } from './cash-amount.schema';

describe('cashAmountSchema', () => {
  it.each(['0', '15000', '15000.5', '15000.50'])('accepts %s', (amount) => {
    expect(cashAmountSchema.safeParse(amount).success).toBe(true);
  });

  it.each(['', ' ', '-1', '1,50', '1.234', 'cash'])('rejects %s', (amount) => {
    expect(cashAmountSchema.safeParse(amount).success).toBe(false);
  });

  it('trims the value sent to backend', () => {
    expect(cashAmountSchema.parse(' 125.50 ')).toBe('125.50');
  });
});
