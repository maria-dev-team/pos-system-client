// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { type Mock, afterEach, expect, it, vi } from 'vitest';

import type { LocalSale, SaleResponse } from '../../shared/pos/contracts';
import { applyCommand, newSale } from '../../shared/pos/sale';
import {
  ids,
  productFixture,
  profileFixture,
} from '../../shared/pos/test-fixtures';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const services: PosService[] = [];
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
});

async function pendingPayment(state: (sale: SaleResponse) => unknown): Promise<{
  db: PosDatabase;
  service: PosService;
  sale: SaleResponse;
  fetcher: Mock<typeof fetch>;
}> {
  const db = new PosDatabase(':memory:', randomBytes(32));
  const profile = profileFixture();
  profile.tokenHash = createHash('sha256').update('token').digest('hex');
  db.set(`profile:${profile.tokenHash}:${ids.register}`, profile);
  db.set(`adopted:${ids.session}`, true);
  const now = new Date().toISOString();
  const sale = applyCommand(
    newSale(profile, randomUUID(), now),
    { type: 'add', productId: ids.product },
    profile,
    productFixture(),
    randomUUID(),
    now,
  );
  sale.version = 1;
  const record: LocalSale = {
    sale,
    revision: 1,
    syncedRevision: 1,
    serverVersion: 1,
    sequence: 1,
    inFlight: null,
    error: null,
    payment: {
      stage: 'SENT',
      request: {
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      },
    },
  };
  db.save(record);
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/checkout-state'))
      return new Response(JSON.stringify({ data: state(sale) }));
    throw new TypeError('offline');
  });
  const service = new PosService(
    db,
    'https://api.test',
    () => undefined,
    fetcher,
  );
  services.push(service);
  await service.connect('token', ids.register);
  return { db, service, sale, fetcher };
}

it.each([
  [
    'a different receipt',
    (sale: SaleResponse) => ({
      sale: { ...sale, id: randomUUID() },
      retry_safe: true,
      replay_ready: false,
    }),
  ],
  [
    'a different register shift',
    (sale: SaleResponse) => ({
      sale: { ...sale, register_shift_id: randomUUID() },
      retry_safe: true,
      replay_ready: false,
    }),
  ],
  [
    'a string instead of retry_safe',
    (sale: SaleResponse) => ({
      sale,
      retry_safe: 'false',
      replay_ready: false,
    }),
  ],
  [
    'a string instead of replay_ready',
    (sale: SaleResponse) => ({
      sale,
      retry_safe: false,
      replay_ready: 'false',
    }),
  ],
  [
    'contradictory safe/replay flags',
    (sale: SaleResponse) => ({ sale, retry_safe: true, replay_ready: true }),
  ],
  [
    'a false completed acknowledgement',
    (sale: SaleResponse) => ({
      sale: { ...sale, status: 'COMPLETED', fiscal_receipt: {} },
      retry_safe: false,
      replay_ready: false,
    }),
  ],
] as const)(
  'keeps the durable payment intent when backend returns %s',
  async (_name, state) => {
    const { service, db, sale, fetcher } = await pendingPayment(state);
    await expect(
      service.handle({ type: 'reconcilePayment', saleId: sale.id }),
    ).rejects.toMatchObject({ code: 'POS_API_INVALID_RESPONSE' });
    expect(db.sale(ids.session, sale.id)?.payment?.stage).toBe('SENT');
    expect(db.sale(ids.session, sale.id)?.sale.status).toBe('DRAFT');
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith('/checkout')),
    ).toBe(false);
  },
);

it('accepts a completed non-fiscal payment without a fiscal receipt', async () => {
  const { service, db, sale } = await pendingPayment((draft) => ({
    sale: {
      ...draft,
      fiscal_receipt: null,
      fiscalization_mode: 'NON_FISCAL',
      status: 'COMPLETED',
      version: draft.version + 1,
    },
    retry_safe: false,
    replay_ready: false,
  }));

  await expect(
    service.handle({ type: 'reconcilePayment', saleId: sale.id }),
  ).resolves.toMatchObject({
    fiscal_receipt: null,
    fiscalization_mode: 'NON_FISCAL',
    status: 'COMPLETED',
  });
  expect(db.sale(ids.session, sale.id)?.payment).toBeNull();
});
