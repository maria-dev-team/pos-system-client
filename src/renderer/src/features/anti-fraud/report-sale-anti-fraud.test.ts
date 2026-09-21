import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type SaleResponse, triggerAntiFraudEvent } from '@renderer/common/api';

import { newSale } from '../../../../shared/pos/sale';
import { ids, profileFixture } from '../../../../shared/pos/test-fixtures';
import { reportSaleAntiFraud } from './report-sale-anti-fraud';

vi.mock('@renderer/common/api', () => ({ triggerAntiFraudEvent: vi.fn() }));
const sale = (overrides: Partial<SaleResponse> = {}): SaleResponse => ({
  ...newSale(profileFixture(), ids.product, new Date().toISOString()),
  ...overrides,
});
beforeEach(() => {
  vi.resetAllMocks();
});

describe('optional sale capture policy', () => {
  it.each([
    {},
    { status: 'HELD' },
    { status: 'COMPLETED' },
    { status: 'CANCELLED', cancelled_at: null },
    { transaction_type: 'RETURN', status: 'DRAFT' },
    {
      transaction_type: 'RETURN',
      status: 'CANCELLED',
      cancelled_at: new Date().toISOString(),
    },
    { transaction_type: 'RETURN', status: 'COMPLETED', completed_at: null },
  ] satisfies Partial<SaleResponse>[])(
    'does not fabricate a video event for %j',
    async (overrides) => {
      await reportSaleAntiFraud(sale(overrides), 'Reason');
      expect(triggerAntiFraudEvent).not.toHaveBeenCalled();
    },
  );

  it('swallows even a synchronous capture failure without changing the cancelled sale', async () => {
    vi.mocked(triggerAntiFraudEvent).mockImplementation(() => {
      throw new Error('Capture unavailable');
    });
    const cancelled = sale({
      status: 'CANCELLED',
      cancelled_at: new Date().toISOString(),
    });
    const snapshot = structuredClone(cancelled);
    await expect(reportSaleAntiFraud(cancelled)).resolves.toBeUndefined();
    expect(cancelled).toEqual(snapshot);
  });
});
