// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PosStatus, SaleResponse } from '../../shared/pos/contracts';
import {
  ids,
  productFixture,
  profileFixture,
} from '../../shared/pos/test-fixtures';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const services: PosService[] = [];
const directories: string[] = [];
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true }));
});
const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));
const response = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), { status: 200 });

async function fixture(): Promise<{
  service: PosService;
  db: PosDatabase;
  restart: () => Promise<PosService>;
  fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  remote: Map<string, SaleResponse>;
  calls: string[];
  mode: {
    offline: boolean;
    unauthorized: boolean;
    safe: boolean;
    paid: Set<string>;
    failReview: Set<string>;
  };
}> {
  const directory = mkdtempSync(join(tmpdir(), 'pos-recovery-test-'));
  directories.push(directory);
  const key = randomBytes(32),
    path = join(directory, 'pos.sqlite');
  let db = new PosDatabase(path, key);
  const profile = profileFixture();
  profile.tokenHash = createHash('sha256').update('token').digest('hex');
  db.set(`profile:${profile.tokenHash}:${ids.register}`, profile);
  db.set(`adopted:${ids.session}`, true);
  await db.replaceCatalog(`${ids.organization}:${ids.store}`, [
    productFixture(),
  ]);
  const mode = {
    offline: false,
    unauthorized: false,
    safe: false,
    paid: new Set<string>(),
    failReview: new Set<string>(),
  };
  const remote = new Map<string, SaleResponse>();
  const calls: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname;
    if (mode.offline) throw new TypeError('offline');
    if (mode.unauthorized)
      return new Response(JSON.stringify({ error_code: 'INVALID_TOKEN' }), {
        status: 401,
      });
    if (path === '/v1/auth/context')
      return response({ context: profile.context });
    if (path.includes('/cashier-sessions/current'))
      return response({ cashier_session: profile.session });
    if (path === '/v1/register-shifts/current')
      return response({ register_shift: profile.shift });
    if (path === `/v1/registers/${ids.register}`)
      return response({ register: profile.register });
    if (path === '/v1/pos/catalog/page')
      return response({
        products: [{ ...productFixture(), store_id: profile.session.store_id }],
        next_cursor: null,
      });
    if (path === '/v1/pos/catalog/sync-start')
      return response({ cursor: 'baseline' });
    if (path === '/v1/pos/catalog/changes')
      return response({
        products: [],
        deleted_ids: [],
        categories_changed: false,
        cursor: 'next',
        has_more: false,
      });
    if (path === '/v1/categories')
      return response({ categories: [], meta: { has_more: false } });
    if (path === '/v1/sales/deferred-checkouts')
      return response({
        sales: [...remote.values()].filter(
          (sale) => sale.checkout_deferred_at && sale.status === 'DRAFT',
        ),
      });
    if (path === '/v1/sales/local-draft') {
      const payload = JSON.parse(init?.body as string);
      const current = [...remote.values()].find(
        (sale) =>
          sale.status === 'DRAFT' &&
          !sale.checkout_deferred_at &&
          sale.id !== payload.sale_id,
      );
      if (payload.status === 'DRAFT' && current)
        return new Response(
          JSON.stringify({ error_code: 'SALE_DRAFT_ALREADY_EXISTS' }),
          { status: 409 },
        );
      const sale = {
        ...db.sale(ids.session, payload.sale_id)!.sale,
        status: payload.status,
        version: (remote.get(payload.sale_id)?.version ?? 0) + 1,
      };
      remote.set(sale.id, sale);
      return response({ sale });
    }
    const id = path.split('/')[3];
    let sale = remote.get(id)!;
    if (path.endsWith('/checkout')) {
      calls.push(id);
      if (!mode.paid.has(id)) throw new TypeError('lost payment response');
    }
    if (path.endsWith('/defer-checkout')) {
      sale = { ...sale, checkout_deferred_at: new Date().toISOString() };
      remote.set(id, sale);
      return response({ sale });
    }
    if (path.endsWith('/resume-checkout')) {
      sale = { ...sale, checkout_deferred_at: null };
      remote.set(id, sale);
      return response({ sale });
    }
    if (
      path.endsWith('/checkout-state') ||
      path.endsWith('/reconcile') ||
      path.endsWith('/checkout')
    ) {
      if (mode.failReview.has(id)) throw new TypeError('review failed');
      if (mode.paid.has(id)) {
        sale = {
          ...sale,
          status: 'COMPLETED',
          version: 2,
          fiscal_receipt: {
            address: 'Test store',
            buyer_bin_iin: null,
            cashbox_unique_number: 'test-cashbox',
            currency: 'KZT',
            fiscal_sign: 'test-sign',
            fiscalized_at: new Date().toISOString(),
            offline: false,
            ofd_name: 'Test OFD',
            ofd_website: 'https://ofd.test',
            operation_type: 'SALE',
            print_url: null,
            provider: 'WEBKASSA',
            qr_url: 'https://ofd.test/receipt',
            receipt_number: '1',
            registration_number: 'test-register',
            shift_number: '1',
            status: 'FISCALIZED',
            taxpayer_bin_iin: '000000000000',
            taxpayer_name: 'Test',
            total: sale.total,
            vat_total: '0.00',
          },
        };
        remote.set(id, sale);
      }
      return response({ sale, retry_safe: mode.safe, replay_ready: false });
    }
    throw new Error(`Unexpected test API path: ${path}`);
  });
  let service = new PosService(db, 'https://api.test', vi.fn(), fetcher);
  services.push(service);
  await service.connect('token', ids.register);
  await tick();
  return {
    service,
    db,
    fetcher,
    mode,
    remote,
    calls,
    restart: async () => {
      service.close();
      services.splice(services.indexOf(service), 1);
      db = new PosDatabase(path, key);
      service = new PosService(db, 'https://api.test', vi.fn(), fetcher);
      services.push(service);
      await service.connect('token', ids.register);
      await tick();
      return service;
    },
  };
}
const scan = (service: PosService): Promise<SaleResponse> =>
  service.handle({
    type: 'execute',
    command: { type: 'scan', barcode: productFixture().barcode },
  }) as Promise<SaleResponse>;
const pay = (service: PosService, sale: SaleResponse): Promise<unknown> =>
  service.handle({
    type: 'checkout',
    saleId: sale.id,
    total: sale.total,
    payments: [{ method: 'CASH', amount: sale.total }],
  });

describe('non-blocking checkout recovery', () => {
  it('durably defers an uncertain receipt offline and keeps the next cart usable after restart', async () => {
    const { service, db, mode, calls, restart } = await fixture();
    const first = await scan(service);
    await expect(pay(service, first)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    mode.offline = true;
    await service.handle({ type: 'deferPayment', saleId: first.id });
    const second = await scan(service);
    expect(second.id).not.toBe(first.id);
    expect(db.sale(ids.session, first.id)).toMatchObject({
      deferredPayment: true,
      payment: { stage: 'SENT' },
      sale: { total: first.total },
    });
    await tick();
    const restored = await restart();
    expect(await restored.handle({ type: 'current' })).toMatchObject({
      id: second.id,
    });
    const status = (await restored.handle({ type: 'status' })) as PosStatus;
    expect(status.paymentReviews).toEqual([
      {
        saleId: first.id,
        total: first.total,
        deferred: true,
        canResume: false,
      },
    ]);
    expect((await scan(restored)).items[0].quantity).toBe('2.000');
    expect(calls).toEqual([first.id]);
  });

  it('synchronizes and pays a new cart without replaying the deferred payment', async () => {
    const { service, calls, mode, remote } = await fixture();
    const first = await scan(service);
    await expect(pay(service, first)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    await service.handle({ type: 'deferPayment', saleId: first.id });
    const second = await scan(service);
    mode.paid.add(second.id);
    await expect(pay(service, second)).resolves.toMatchObject({
      id: second.id,
      status: 'COMPLETED',
    });
    expect(remote.get(first.id)?.checkout_deferred_at).toBeTruthy();
    expect(calls).toEqual([first.id, second.id]);
    expect(
      ((await service.handle({ type: 'status' })) as PosStatus)
        .paymentReviews[0].saleId,
    ).toBe(first.id);
  });

  it('requires explicit resumption after a safe rejection and never overwrites the new current cart', async () => {
    const { service, calls, mode } = await fixture();
    const first = await scan(service);
    await expect(pay(service, first)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    await service.handle({ type: 'deferPayment', saleId: first.id });
    mode.safe = true;
    await service.handle({ type: 'reconcilePayment', saleId: first.id });
    expect(
      ((await service.handle({ type: 'status' })) as PosStatus)
        .paymentReviews[0].canResume,
    ).toBe(true);
    const second = await scan(service);
    await expect(
      service.handle({ type: 'resumePayment', saleId: first.id }),
    ).rejects.toMatchObject({ code: 'SALE_DRAFT_ALREADY_EXISTS' });
    expect(await service.handle({ type: 'current' })).toMatchObject({
      id: second.id,
    });
    await service.handle({
      type: 'transition',
      action: 'hold',
      saleId: second.id,
    });
    await expect(
      service.handle({ type: 'resumePayment', saleId: first.id }),
    ).resolves.toMatchObject({ id: first.id });
    expect(calls).toEqual([first.id]);
    mode.paid.add(first.id);
    await expect(pay(service, first)).resolves.toMatchObject({
      status: 'COMPLETED',
    });
    expect(calls).toEqual([first.id, first.id]);
  });

  it('keeps valid offline permissions when a bearer token expires and recovers sync after reauthorization', async () => {
    const { service, mode, db } = await fixture();
    mode.unauthorized = true;
    const first = await scan(service);
    await tick();
    expect(await service.handle({ type: 'status' })).toMatchObject({
      tokenRefreshRequired: true,
      authorizationRequired: true,
    });
    expect((await scan(service)).items[0].quantity).toBe('2.000');
    await expect(
      service.handle({ type: 'search', search: 'Молоко' }),
    ).resolves.toHaveProperty('products');
    expect(db.get(`revoked:${ids.session}`)).not.toBe(true);
    mode.unauthorized = false;
    await service.connect('renewed-token', ids.register, true);
    await service.handle({ type: 'retry' });
    expect(await service.handle({ type: 'status' })).toMatchObject({
      tokenRefreshRequired: false,
      authorizationRequired: false,
      pending: 0,
    });
    expect(await service.handle({ type: 'current' })).toMatchObject({
      id: first.id,
    });
  });

  it('continues reviewing other receipts when one reconciliation endpoint fails', async () => {
    const { service, mode, calls } = await fixture();
    const first = await scan(service);
    await expect(pay(service, first)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    await service.handle({ type: 'deferPayment', saleId: first.id });
    const second = await scan(service);
    await expect(pay(service, second)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    await service.handle({ type: 'deferPayment', saleId: second.id });
    const third = await scan(service);
    mode.failReview.add(first.id);
    mode.paid.add(second.id);
    await service.handle({ type: 'retry' });
    expect(
      await service.handle({ type: 'sale', saleId: second.id }),
    ).toMatchObject({ status: 'COMPLETED' });
    expect(await service.handle({ type: 'current' })).toMatchObject({
      id: third.id,
    });
    expect(calls).toEqual([first.id, second.id]);
  });
});
