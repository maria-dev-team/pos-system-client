import { describe, expect, it } from 'vitest';

import {
  createCashPayment,
  createCashlessPayment,
  createMixedPayments,
  getCashChange,
} from './checkout-payment';

describe('checkout payments', () => {
  it('builds cash payment from the authoritative total', () => {
    expect(createCashPayment('100.00', '120')).toEqual([
      { amount: '100.00', method: 'CASH', received: '120' },
    ]);
    expect(createCashPayment('100.00', '99.99')).toBeNull();
    expect(createCashPayment('0.00', '10')).toBeNull();
  });

  it('builds cashless payment from the authoritative total', () => {
    expect(createCashlessPayment('100.00')).toEqual([
      { amount: '100.00', method: 'CASHLESS' },
    ]);
    expect(createCashlessPayment('0')).toBeNull();
  });

  it('splits mixed payment without changing the total', () => {
    expect(createMixedPayments('100.00', '40', '50')).toEqual([
      { amount: '40', method: 'CASH', received: '50' },
      { amount: '60.00', method: 'CASHLESS' },
    ]);
    expect(createMixedPayments('100.00', '100', '100')).toBeNull();
  });

  it('calculates change only for sufficient received cash', () => {
    expect(getCashChange('120', '100.00')).toBe('20.00');
    expect(getCashChange('90', '100.00')).toBeNull();
  });
});
