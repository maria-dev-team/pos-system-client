// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ArchivedLocalSale,
  PosStatus,
  SaleResponse,
} from '../../shared/pos/contracts';
import { newSale } from '../../shared/pos/sale';
import {
  fiscalReceiptFixture,
  ids,
  productFixture,
  profileFixture,
} from '../../shared/pos/test-fixtures';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const services: PosService[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  services.splice(0).forEach((s) => s.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true }));
});
const response = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), { status: 200 });
const tick = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));
async function fixture(
  handler?: (path: string, body: Record<string, unknown>) => Promise<Response>,
  path = ':memory:',
  key = randomBytes(32),
  history = 0,
): Promise<{
  service: PosService;
  db: PosDatabase;
  fetcher: Mock<typeof fetch>;
}> {
  const db = new PosDatabase(path, key);
  const profile = profileFixture();
  profile.tokenHash = createHash('sha256').update('token').digest('hex');
  db.set(`profile:${profile.tokenHash}:${ids.register}`, profile);
  db.set(`adopted:${ids.session}`, true);
  await db.replaceCatalog(`${ids.organization}:${ids.store}`, [
    productFixture(),
  ]);
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input).replace('https://api.test', '');
      if (path === '/v1/pos/catalog/sync-start')
        return response({ cursor: 'baseline' });
      if (path.startsWith('/v1/pos/catalog/changes?'))
        return response({
          products: [],
          deleted_ids: [],
          categories_changed: false,
          cursor: 'next',
          has_more: false,
        });
      if (path.startsWith('/v1/pos/catalog/page'))
        return response({
          products: [{ ...productFixture(), store_id: ids.store }],
          next_cursor: null,
        });
      if (path.startsWith('/v1/categories'))
        return response({ categories: [], meta: { has_more: false } });
      if (path === `/v1/registers/${ids.register}`)
        return response({ register: profile.register });
      if (path === '/v1/sales/deferred-checkouts')
        return response({ sales: [] });
      if (handler)
        return handler(path, JSON.parse((init?.body as string) ?? '{}'));
      throw new TypeError('offline');
    },
  );
  for (let index = 0; index < history; index++) {
    const sale = newSale(profile, randomUUID(), new Date().toISOString());
    sale.status = 'COMPLETED';
    sale.completed_at = new Date().toISOString();
    db.save({
      sale,
      sequence: index + 1,
      revision: 1,
      syncedRevision: 1,
      serverVersion: 1,
      inFlight: null,
      payment: null,
      error: null,
    });
  }
  const service = new PosService(
    db,
    'https://api.test',
    vi.fn(),
    fetcher as typeof fetch,
  );
  services.push(service);
  await service.connect('token', ids.register);
  await tick();
  return { service, db, fetcher };
}

describe('local POS application service', () => {
  it.skipIf(process.env.POS_BENCHMARK !== '1')(
    'measures full durable scans with 0/1000/3000/10000 historical receipts',
    async () => {
      const results: unknown[] = [];
      for (const history of [0, 1000, 3000, 10000]) {
        const directory = mkdtempSync(join(tmpdir(), 'pos-shift-benchmark-'));
        directories.push(directory);
        const { service, db } = await fixture(
          undefined,
          join(directory, 'pos.sqlite'),
          randomBytes(32),
          history,
        );
        const samples: number[] = [];
        for (let i = 0; i < 200; i++) {
          const start = performance.now();
          await service.handle({
            type: 'execute',
            command: { type: 'scan', barcode: productFixture().barcode },
          });
          samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        expect(db.workingSales(ids.session)).toHaveLength(1);
        results.push({
          history,
          p50: samples[100],
          p95: samples[190],
          p99: samples[198],
          max: samples[199],
        });
      }
      console.log(JSON.stringify({ durableScanMs: results }));
    },
    60_000,
  );
  it('probes a recovered connection for foreground checkout without waiting for global backoff', async () => {
    let online = false;
    let drafts = 0;
    const { service, db } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft') {
        drafts++;
        if (!online) throw new TypeError('offline');
        return response({
          sale: {
            ...db.sale(ids.session, String(body.sale_id))!.sale,
            version: Number(body.expected_version) + 1,
          },
        });
      }
      if (path.endsWith('/checkout')) {
        const record = db.sale(ids.session, path.split('/')[3])!;
        return response({
          sale: {
            ...record.sale,
            status: 'COMPLETED',
            version: record.serverVersion + 1,
            fiscal_receipt: fiscalReceiptFixture(record.sale.total),
          },
        });
      }
      throw new TypeError('offline');
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await tick();
    expect(db.get<number>(`outbox-retry:${ids.session}`)).toBeGreaterThan(
      Date.now(),
    );
    const before = drafts;
    online = true;
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(drafts).toBe(before + 1);
  });
  it('contains a storage error while persisting a background access revocation', async () => {
    const { service, db, fetcher } = await fixture();
    vi.useFakeTimers();
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ error_code: 'FORBIDDEN' }), {
        status: 403,
      }),
    );
    const write = db.set.bind(db);
    vi.spyOn(db, 'set').mockImplementation((key, value) => {
      if (key.startsWith('revoked:')) throw new Error('disk full');
      write(key, value);
    });
    try {
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await service.handle({ type: 'status' })).toMatchObject({
        authorizationRequired: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('restores OS-protected credentials offline and rejects expired or revoked grants', async () => {
    const { service, db, fetcher } = await fixture();
    fetcher.mockClear();
    expect(await service.handle({ type: 'restoreCredentials' })).toEqual({
      accessToken: 'token',
      registerId: ids.register,
    });
    expect(fetcher).not.toHaveBeenCalled();
    db.set(`revoked:${ids.session}`, true);
    expect(await service.handle({ type: 'restoreCredentials' })).toBeNull();
    db.set(`revoked:${ids.session}`, false);
    const key = `profile:${createHash('sha256').update('token').digest('hex')}:${ids.register}`;
    db.set(key, { ...profileFixture(), expiresAt: Date.now() - 1 });
    expect(await service.handle({ type: 'restoreCredentials' })).toBeNull();
  });
  it('persists refund intent and blocks disconnect until the same command is cleared', async () => {
    const { service, db } = await fixture();
    const command = {
      type: 'receipt' as const,
      receiptNumber: '42',
      endpoint: '/v1/returns/receipts/42',
      idempotencyKey: randomUUID(),
      payload: {
        reason: 'Возврат',
        payments: [{ amount: '10.00', method: 'CASH' as const }],
        items: [
          {
            saleItemId: randomUUID(),
            quantity: '1',
            returnDisposition: 'RESTOCK' as const,
          },
        ],
      },
    };
    await service.handle({
      type: 'savePendingReturn',
      sessionId: ids.session,
      command,
    });
    expect(db.get(`pending-return:${ids.session}`)).toEqual(command);
    await expect(service.handle({ type: 'disconnect' })).rejects.toMatchObject({
      code: 'RETURN_PENDING',
    });
    await expect(
      service.handle({
        type: 'savePendingReturn',
        sessionId: ids.session,
        command: { ...command, idempotencyKey: randomUUID() },
      }),
    ).rejects.toThrow();
    await service.handle({
      type: 'clearPendingReturn',
      sessionId: ids.session,
      commandId: command.idempotencyKey,
    });
    expect(
      await service.handle({ type: 'pendingReturn', sessionId: ids.session }),
    ).toBeNull();
  });
  it.each(['synced', 'pending', 'edited-in-flight'] as const)(
    'checkout waits only for its own latest draft (%s), not a slow cancelled receipt',
    async (mode) => {
      let releaseDraft!: () => void;
      let releaseCancellation!: () => void;
      const draftGate = new Promise<void>((resolve) => {
        releaseDraft = resolve;
      });
      const cancellationGate = new Promise<void>((resolve) => {
        releaseCancellation = resolve;
      });
      let currentId: string | undefined;
      let blockDraft = false;
      let cancellationStarted = false;
      let paymentStarted = false;
      const { service, db } = await fixture(async (path, body) => {
        if (path === '/v1/sales/local-draft') {
          const id = String(body.sale_id);
          const snapshot = structuredClone(db.sale(ids.session, id)!.sale);
          if (body.status === 'CANCELLED') {
            cancellationStarted = true;
            await cancellationGate;
          } else if (blockDraft && body.status === 'DRAFT') {
            blockDraft = false;
            currentId = id;
            await draftGate;
          }
          return response({
            sale: { ...snapshot, version: Number(body.expected_version) + 1 },
          });
        }
        if (path.endsWith('/checkout')) {
          paymentStarted = true;
          const record = db.sale(ids.session, path.split('/')[3])!;
          expect(record.revision).toBe(record.syncedRevision);
          expect(record.sale.total).toBe(
            mode === 'edited-in-flight' ? '1300.00' : '650.00',
          );
          return response({
            sale: {
              ...record.sale,
              status: 'COMPLETED',
              version: record.serverVersion + 1,
              fiscal_receipt: fiscalReceiptFixture(record.sale.total),
            },
          });
        }
        throw new TypeError('offline');
      });
      const first = (await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      })) as SaleResponse;
      await service.handle({ type: 'retry' });
      await service.handle({
        type: 'transition',
        action: 'hold',
        saleId: first.id,
      });
      await service.handle({ type: 'retry' });
      blockDraft = mode !== 'synced';
      let current = (await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      })) as SaleResponse;
      if (mode === 'synced') await service.handle({ type: 'retry' });
      else await vi.waitFor(() => expect(currentId).toBe(current.id));
      await service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: first.id,
        reason: 'Покупатель передумал',
      });
      if (mode === 'synced')
        await vi.waitFor(() => expect(cancellationStarted).toBe(true));
      if (mode === 'edited-in-flight')
        current = (await service.handle({
          type: 'execute',
          command: {
            type: 'setQuantity',
            itemId: current.items[0].id,
            quantity: '2',
          },
        })) as SaleResponse;
      const checkout = service.handle({
        type: 'checkout',
        saleId: current.id,
        total: current.total,
        payments: [{ method: 'CASH', amount: current.total }],
      });
      try {
        if (mode !== 'synced') {
          await tick();
          expect(paymentStarted).toBe(false);
          releaseDraft();
        }
        await vi.waitFor(() => expect(paymentStarted).toBe(true));
        await expect(checkout).resolves.toMatchObject({
          status: 'COMPLETED',
          id: current.id,
        });
        expect(db.sale(ids.session, first.id)!.syncedRevision).toBeLessThan(
          db.sale(ids.session, first.id)!.revision,
        );
      } finally {
        releaseDraft();
        releaseCancellation();
        await checkout.catch(() => undefined);
        await service.handle({ type: 'flush' });
      }
    },
  );
  it('allows a new receipt to be paid and preserves it when archiving an older rejected cancellation', async () => {
    let rejectedId: string | undefined;
    const { service, db } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft') {
        const id = String(body.sale_id);
        rejectedId ??= id;
        if (id === rejectedId)
          return new Response(
            JSON.stringify({ error_code: 'PRODUCT_NOT_FOUND' }),
            { status: 404 },
          );
        return response({
          sale: {
            ...db.sale(ids.session, id)!.sale,
            version: Number(body.expected_version) + 1,
          },
        });
      }
      if (path.endsWith('/checkout')) {
        const sale = db.sale(ids.session, path.split('/')[3])!.sale;
        return response({
          sale: {
            ...sale,
            status: 'COMPLETED',
            version: 2,
            fiscal_receipt: fiscalReceiptFixture(sale.total),
          },
        });
      }
      if (path === `/v1/sales/${rejectedId}`)
        return new Response(JSON.stringify({ error_code: 'SALE_NOT_FOUND' }), {
          status: 404,
        });
      throw new TypeError('offline');
    });
    const first = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, first.id)?.error).toBe('PRODUCT_NOT_FOUND'),
    );
    await service.handle({
      type: 'transition',
      action: 'cancel',
      saleId: first.id,
      reason: 'Покупатель передумал',
    });
    await vi.waitFor(() =>
      expect(db.sale(ids.session, first.id)?.error).toBe('PRODUCT_NOT_FOUND'),
    );
    const second = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, second.id)?.syncedRevision).toBe(1),
    );
    await expect(
      service.handle({
        type: 'checkout',
        saleId: second.id,
        total: second.total,
        payments: [{ method: 'CASH', amount: second.total }],
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    const completed = db.sale(ids.session, second.id);
    await service.handle({ type: 'archiveCancelledSale', saleId: first.id });
    expect(db.sale(ids.session, second.id)).toEqual(completed);
    await expect(service.handle({ type: 'flush' })).resolves.toBeNull();
  });
  it.each(['absent', 'DRAFT', 'HELD', 'CANCELLED'] as const)(
    'archives only the cancelled receipt after checking the server (%s)',
    async (remoteStatus) => {
      const { service, db, fetcher } = await fixture(async (path) => {
        if (path === '/v1/sales/local-draft')
          return new Response(
            JSON.stringify({ error_code: 'PRODUCT_NOT_FOUND' }),
            { status: 404 },
          );
        const id = path.split('/')[3];
        const record = db.sale(ids.session, id);
        if (!record) throw new TypeError('offline');
        if (path.endsWith('/cancel'))
          return response({ sale: { ...record.sale, version: 2 } });
        if (remoteStatus === 'absent')
          return new Response(
            JSON.stringify({ error_code: 'SALE_NOT_FOUND' }),
            { status: 404 },
          );
        return response({
          sale: { ...record.sale, status: remoteStatus, version: 1 },
        });
      });
      const sale = (await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      })) as SaleResponse;
      await vi.waitFor(() =>
        expect(db.sale(ids.session, sale.id)?.error).toBe('PRODUCT_NOT_FOUND'),
      );
      await service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: sale.id,
        reason: 'Покупатель передумал',
      });
      await vi.waitFor(() =>
        expect(db.sale(ids.session, sale.id)?.error).toBe('PRODUCT_NOT_FOUND'),
      );
      const before = db.sale(ids.session, sale.id)!;
      expect(await service.handle({ type: 'status' })).toMatchObject({
        outbox: [{ archivable: true }],
      });
      await expect(
        service.handle({ type: 'archiveCancelledSale', saleId: sale.id }),
      ).resolves.toMatchObject({ pending: 0, outbox: [] });
      expect(db.sale(ids.session, sale.id)).toBeNull();
      expect(
        db.get<ArchivedLocalSale>(`sale-archive:${ids.session}:${sale.id}`),
      ).toMatchObject({
        record: before,
        archivedByMembershipId: profileFixture().session.membership_id,
        serverSale: remoteStatus === 'absent' ? null : { status: 'CANCELLED' },
      });
      const cancellations = fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/cancel'),
      );
      expect(cancellations).toHaveLength(
        ['DRAFT', 'HELD'].includes(remoteStatus) ? 1 : 0,
      );
      if (cancellations.length)
        expect(JSON.parse(cancellations[0][1]!.body as string)).toEqual({
          expected_version: 1,
          reason: 'Покупатель передумал',
        });
      const count = fetcher.mock.calls.length;
      await service.handle({ type: 'archiveCancelledSale', saleId: sale.id });
      expect(fetcher.mock.calls).toHaveLength(count);
      await expect(service.handle({ type: 'flush' })).resolves.toBeNull();
    },
  );

  it.each(['offline', 'proxy404', 'COMPLETED', 'cancel-uncertain'] as const)(
    'keeps the cancelled receipt when archival is not confirmed (%s)',
    async (mode) => {
      const { service, db } = await fixture(async (path) => {
        if (path === '/v1/sales/local-draft')
          return new Response(
            JSON.stringify({ error_code: 'PRODUCT_NOT_FOUND' }),
            { status: 404 },
          );
        if (mode === 'offline' || path.endsWith('/cancel'))
          throw new TypeError('offline');
        if (mode === 'proxy404')
          return new Response('Not found', { status: 404 });
        const record = db.sale(ids.session, path.split('/')[3]);
        if (!record) throw new TypeError('offline');
        return response({
          sale: {
            ...record.sale,
            version: 1,
            status: mode === 'COMPLETED' ? 'COMPLETED' : 'DRAFT',
          },
        });
      });
      const sale = (await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      })) as SaleResponse;
      await vi.waitFor(() =>
        expect(db.sale(ids.session, sale.id)?.error).toBe('PRODUCT_NOT_FOUND'),
      );
      await service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: sale.id,
        reason: 'Покупатель передумал',
      });
      await vi.waitFor(() =>
        expect(db.sale(ids.session, sale.id)?.error).toBe('PRODUCT_NOT_FOUND'),
      );
      await expect(
        service.handle({ type: 'archiveCancelledSale', saleId: sale.id }),
      ).rejects.toThrow();
      expect(db.sale(ids.session, sale.id)?.sale.status).toBe('CANCELLED');
      expect(db.get(`sale-archive:${ids.session}:${sale.id}`)).toBeNull();
      expect(await service.handle({ type: 'status' })).toMatchObject({
        pending: 1,
      });
    },
  );

  it('does not allow archiving an active receipt or its uncertain in-flight command', async () => {
    const { service, db } = await fixture();
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await expect(
      service.handle({ type: 'archiveCancelledSale', saleId: sale.id }),
    ).rejects.toMatchObject({ code: 'SALE_NOT_ARCHIVABLE' });
    await service.handle({
      type: 'transition',
      action: 'cancel',
      saleId: sale.id,
      reason: 'Покупатель передумал',
    });
    await expect(
      service.handle({ type: 'archiveCancelledSale', saleId: sale.id }),
    ).rejects.toMatchObject({ code: 'SALE_NOT_ARCHIVABLE' });
    expect(db.sale(ids.session, sale.id)?.inFlight).not.toBeNull();
  });
  it('requires synchronization before cash movements but permits an already synchronized draft', async () => {
    const { service, db } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft')
        return response({
          sale: {
            ...db.sale(ids.session, String(body.sale_id))!.sale,
            version: Number(body.expected_version) + 1,
          },
        });
      throw new TypeError('offline');
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, sale.id)?.syncedRevision).toBe(1),
    );
    await expect(
      service.handle({ type: 'prepareCashMovement' }),
    ).resolves.toBeNull();
    await expect(service.handle({ type: 'flush' })).rejects.toMatchObject({
      code: 'SYNC_REQUIRED',
    });
  });
  it('blocks cash movements while an offline sale has unsynchronized changes', async () => {
    const { service } = await fixture();
    await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    });
    await expect(
      service.handle({ type: 'prepareCashMovement' }),
    ).rejects.toMatchObject({ code: 'SYNC_REQUIRED' });
  });
  it('scans primary and generated additional codes into one durable offline receipt line', async () => {
    const { service, db, fetcher } = await fixture();
    const p = {
      ...productFixture(),
      additional_barcode: '2900000000018',
      nkt: null,
    };
    await db.cacheProducts(
      `${ids.organization}:${ids.store}`,
      [p],
      () => true,
      'authoritative',
    );
    fetcher.mockRejectedValue(new TypeError('offline'));
    const first = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: p.barcode },
    })) as SaleResponse;
    const second = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: p.additional_barcode },
    })) as SaleResponse;
    expect(second.id).toBe(first.id);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      product_id: p.id,
      barcode: p.barcode,
      quantity: '2.000',
    });
    expect(db.sale(ids.session, second.id)?.sale.items).toEqual(second.items);
  });

  it.each(['foreign', 'invalid-flag', 'empty-continuation', 'repeated-page'])(
    'keeps the old category snapshot on %s and stops pagination',
    async (mode) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { service, db, fetcher } = await fixture();
        const scope = `${ids.organization}:${ids.store}`;
        const previous = [
          { id: 'old', name: 'Previous category', children: [] },
        ];
        db.set(`categories:${scope}`, previous);
        db.set(`categories-dirty:${scope}`, randomUUID());
        let requests = 0;
        const original = fetcher.getMockImplementation()!;
        fetcher.mockImplementation(async (url, init) => {
          if (!String(url).includes('/v1/categories?'))
            return original(url, init);
          requests++;
          return response({
            categories:
              mode === 'empty-continuation'
                ? []
                : [
                    {
                      id: ids.product,
                      organization_id:
                        mode === 'foreign' ? ids.store : ids.organization,
                      children: [],
                    },
                  ],
            meta: {
              has_more: mode === 'invalid-flag' ? 'false' : mode !== 'foreign',
            },
          });
        });
        await vi.advanceTimersByTimeAsync(15000);
        expect(db.get(`categories:${scope}`)).toEqual(previous);
        expect(requests).toBe(mode === 'repeated-page' ? 2 : 1);
        service.close();
        services.splice(services.indexOf(service), 1);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('does not crash the worker when optional category metadata cannot be read', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { service, db } = await fixture();
      const get = db.get.bind(db);
      vi.spyOn(db, 'get').mockImplementation((key) => {
        if (key.startsWith('categories-updated:'))
          throw new Error('simulated I/O failure');
        return get(key);
      });
      await vi.advanceTimersByTimeAsync(15000);
      expect(await service.handle({ type: 'status' })).toMatchObject({
        error: expect.stringContaining('категории'),
      });
      await expect(
        service.handle({ type: 'search', search: 'мол' }),
      ).resolves.toMatchObject({
        products: [expect.objectContaining({ id: ids.product })],
      });
      service.close();
      services.splice(services.indexOf(service), 1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('synchronizes cancellation only as sale state, without anti-fraud requests', async () => {
    const { service, db, fetcher } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft')
        return response({
          sale: {
            ...db.sale(ids.session, String(body.sale_id))!.sale,
            version: Number(body.expected_version) + 1,
          },
        });
      const profile = profileFixture();
      if (path === '/v1/auth/context')
        return response({ context: profile.context });
      if (path.includes('/cashier-sessions/current'))
        return response({ cashier_session: profile.session });
      if (path.includes('/register-shifts/current'))
        return response({ register_shift: profile.shift });
      throw new TypeError('offline');
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, sale.id)?.syncedRevision).toBe(1),
    );
    await service.handle({
      type: 'transition',
      action: 'cancel',
      saleId: sale.id,
      reason: 'Customer cancellation',
    });
    await vi.waitFor(() =>
      expect(db.sale(ids.session, sale.id)?.syncedRevision).toBe(2),
    );
    const saved = db.sale(ids.session, sale.id)!;
    expect(saved.sale).toMatchObject({
      status: 'CANCELLED',
      cancellation_reason: 'Customer cancellation',
    });
    expect(saved).not.toHaveProperty('cancellationEvent');
    // Opaque legacy metadata is retained on disk, but no longer represents work.
    const legacy = Object.assign({}, saved, {
      cancellationEvent: {
        occurredAt: saved.sale.cancelled_at!,
        reason: 'Customer cancellation',
      },
      syncFailures: {
        cancellation: {
          code: 'ANTI_FRAUD_CAMERA_UNAVAILABLE',
          message: 'No camera',
          temporary: false,
          attempts: 1,
          nextAttemptAt: null,
        },
      },
    });
    db.save(legacy);
    await service.connect('token', ids.register, true);
    await service.handle({ type: 'retry' });
    await service.handle({ type: 'retrySale', saleId: sale.id });
    expect(await service.handle({ type: 'status' })).toMatchObject({
      pending: 0,
      outbox: [],
    });
    expect(db.sale(ids.session, sale.id)).toMatchObject({
      cancellationEvent: legacy.cancellationEvent,
    });
    await expect(service.handle({ type: 'flush' })).resolves.toBeNull();
    await expect(service.handle({ type: 'disconnect' })).resolves.toBeNull();
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('/anti-fraud/')),
    ).toBe(false);
  });

  it('does not acknowledge a response belonging to another sale or a non-confirming version', async () => {
    const { service, db } = await fixture(async (path, body) => {
      if (path !== '/v1/sales/local-draft') throw new TypeError('offline');
      const sent = db.sale(ids.session, String(body.sale_id))!;
      return response({ sale: { ...sent.sale, id: randomUUID(), version: 1 } });
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, sale.id)?.syncFailures?.draft?.code).toBe(
        'POS_API_INVALID_RESPONSE',
      ),
    );
    expect(db.sale(ids.session, sale.id)?.syncedRevision).toBe(0);
    expect(db.sale(ids.session, sale.id)?.inFlight).not.toBeNull();
  });
  it('keeps a 429 command immutable and durable, honors Retry-After and does not retry on every local edit', async () => {
    const payloads: Record<string, unknown>[] = [];
    const { service, db } = await fixture(async (path, body) => {
      if (path !== '/v1/sales/local-draft') throw new TypeError('offline');
      payloads.push(body);
      return new Response(JSON.stringify({ error_code: 'TOO_MANY_REQUESTS' }), {
        status: 429,
        headers: { 'Retry-After': '120' },
      });
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, sale.id)?.syncFailures?.draft).toBeDefined(),
    );
    const record = db.sale(ids.session, sale.id)!;
    expect(record.error).toBeNull();
    expect(record.inFlight).not.toBeNull();
    expect(
      record.syncFailures!.draft!.nextAttemptAt! - Date.now(),
    ).toBeGreaterThan(119000);
    await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    });
    await service.handle({ type: 'retrySale', saleId: sale.id });
    expect(payloads).toHaveLength(1);
    expect(await service.handle({ type: 'status' })).toMatchObject({
      pending: 1,
      outbox: [{ saleId: sale.id, code: 'TOO_MANY_REQUESTS', attempts: 1 }],
    });
    vi.spyOn(Date, 'now').mockReturnValue(
      record.syncFailures!.draft!.nextAttemptAt! + 1,
    );
    await service.handle({ type: 'retrySale', saleId: sale.id });
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(db.sale(ids.session, sale.id)?.revision).toBe(2);
  });

  it('isolates a validation rejection, keeps its reason and allows retrying only that receipt', async () => {
    let rejectedId: string | undefined;
    let fail = true;
    const sent: string[] = [];
    const { service, db } = await fixture(async (path, body) => {
      if (path !== '/v1/sales/local-draft') throw new TypeError('offline');
      const id = String(body.sale_id);
      rejectedId ??= id;
      sent.push(id);
      if (id === rejectedId && fail)
        return new Response(
          JSON.stringify({ error_code: 'PRODUCT_NOT_ACTIVE' }),
          { status: 422 },
        );
      return response({
        sale: { ...db.sale(ids.session, id)!.sale, version: 1 },
      });
    });
    const first = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, first.id)?.error).toBe('PRODUCT_NOT_ACTIVE'),
    );
    await service.handle({
      type: 'transition',
      action: 'hold',
      saleId: first.id,
    });
    const second = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, second.id)?.syncedRevision).toBe(1),
    );
    expect(db.sale(ids.session, first.id)?.error).toBe('PRODUCT_NOT_ACTIVE');
    const count = sent.length;
    await service.handle({ type: 'retry' });
    expect(sent).toHaveLength(count); // generic status/payment check cannot clear every failed receipt
    fail = false;
    await service.handle({ type: 'retrySale', saleId: first.id });
    expect(db.sale(ids.session, first.id)?.syncedRevision).toBe(2);
    expect(db.sale(ids.session, first.id)?.error).toBeNull();
  });
  it.each([false, true])(
    'synchronizes cancellation after a catalog rejection (cancel during request=%s)',
    async (duringRequest) => {
      let rejectDraft!: (value: Response) => void;
      const missing = (): Response =>
        new Response(JSON.stringify({ error_code: 'PRODUCT_NOT_FOUND' }), {
          status: 404,
        });
      const { service, db } = await fixture(async (path, body) => {
        if (path !== '/v1/sales/local-draft') throw new TypeError('offline');
        if (body.status === 'DRAFT')
          return duringRequest
            ? new Promise((resolve) => {
                rejectDraft = resolve;
              })
            : missing();
        return response({
          sale: {
            ...db.sale(ids.session, String(body.sale_id))!.sale,
            version: Number(body.expected_version) + 1,
          },
        });
      });
      const sale = (await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      })) as SaleResponse;
      if (duringRequest) await tick();
      else
        await vi.waitFor(() =>
          expect(db.sale(ids.session, sale.id)?.error).toBe(
            'PRODUCT_NOT_FOUND',
          ),
        );
      await service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: sale.id,
        reason: 'Покупатель передумал',
      });
      if (duringRequest) rejectDraft(missing());
      await vi.waitFor(() =>
        expect(db.sale(ids.session, sale.id)?.syncedRevision).toBe(2),
      );
      expect(db.sale(ids.session, sale.id)).toMatchObject({
        error: null,
        inFlight: null,
        sale: {
          status: 'CANCELLED',
          cancellation_reason: 'Покупатель передумал',
        },
      });
      expect(await service.handle({ type: 'current' })).toBeNull();
      expect(await service.handle({ type: 'status' })).toMatchObject({
        pending: 0,
      });
    },
  );
  it('retries an already cancelled catalog rejection from the general recovery button', async () => {
    let fixed = false;
    let cancellations = 0;
    const { service, db, fetcher } = await fixture(async (path, body) => {
      if (path !== '/v1/sales/local-draft') throw new TypeError('offline');
      if (body.status === 'CANCELLED') cancellations++;
      if (!fixed)
        return new Response(
          JSON.stringify({ error_code: 'PRODUCT_NOT_FOUND' }),
          { status: 404 },
        );
      return response({
        sale: {
          ...db.sale(ids.session, String(body.sale_id))!.sale,
          version: 1,
        },
      });
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await vi.waitFor(() =>
      expect(db.sale(ids.session, sale.id)?.error).toBe('PRODUCT_NOT_FOUND'),
    );
    await service.handle({
      type: 'transition',
      action: 'cancel',
      saleId: sale.id,
      reason: 'Покупатель передумал',
    });
    await vi.waitFor(() => {
      expect(cancellations).toBe(1);
      expect(db.sale(ids.session, sale.id)?.error).toBe('PRODUCT_NOT_FOUND');
    });
    expect(await service.handle({ type: 'status' })).toMatchObject({
      outbox: [
        { saleId: sale.id, saleStatus: 'CANCELLED', code: 'PRODUCT_NOT_FOUND' },
      ],
    });
    fixed = true;
    expect(await service.handle({ type: 'retry' })).toMatchObject({
      pending: 0,
    });
    expect(cancellations).toBe(2);
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith('/checkout')),
    ).toBe(false);
  });
  it.each([false, true])(
    'reports active outbox work separately from its durable queue (failure=%s)',
    async (fails) => {
      let finish!: (response: Response) => void;
      const { service, db } = await fixture(async (path) => {
        if (path === '/v1/sales/local-draft')
          return new Promise((resolve) => {
            finish = resolve;
          });
        throw new TypeError('offline');
      });
      expect(await service.handle({ type: 'status' })).toMatchObject({
        sessionId: ids.session,
        syncing: false,
        pending: 0,
      });
      const sale = (await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      })) as SaleResponse;
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      expect(await service.handle({ type: 'status' })).toMatchObject({
        syncing: true,
        pending: 1,
      });
      finish(
        fails
          ? new Response('{}', { status: 503 })
          : response({
              sale: { ...db.sale(ids.session, sale.id)!.sale, version: 1 },
            }),
      );
      await vi.waitFor(async () =>
        expect(await service.handle({ type: 'status' })).toMatchObject({
          syncing: false,
          pending: fails ? 1 : 0,
        }),
      );
    },
  );
  it.each([0, 25])(
    'initializes an existing active server session with a %s-hour register shift without a pre-seeded local grant',
    async (hours) => {
      const db = new PosDatabase(':memory:', randomBytes(32));
      const profile = profileFixture();
      profile.shift.opened_at = new Date(
        Date.now() - hours * 3600000,
      ).toISOString();
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/v1/auth/context'))
          return response({ context: profile.context });
        if (url.includes('/cashier-sessions/current'))
          return response({ cashier_session: profile.session });
        if (url.includes('/register-shifts/current'))
          return response({ register_shift: profile.shift });
        if (url.endsWith(`/v1/registers/${ids.register}`))
          return response({ register: profile.register });
        if (url.endsWith('/v1/sales/current')) return response({ sale: null });
        if (url.endsWith('/v1/sales/held')) return response({ sales: [] });
        if (url.includes('/v1/pos/catalog/page?'))
          return response({ products: [], next_cursor: null });
        return response({ categories: [], meta: { has_more: false } });
      });
      const service = new PosService(db, 'https://api.test', vi.fn(), fetcher);
      services.push(service);
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      try {
        await expect(
          service.connect('token', ids.register),
        ).resolves.toMatchObject({
          session: { id: ids.session, status: 'ACTIVE' },
        });
        expect(await service.handle({ type: 'status' })).toMatchObject({
          authorizationRequired: false,
          fiscalShiftExpired: hours >= 24,
        });
        expect(timeout.mock.calls.slice(0, 4)).toEqual([
          [15000],
          [15000],
          [15000],
          [15000],
        ]);
        expect(db.get(`adopted:${ids.session}`)).toBe(true);
        await tick();
      } finally {
        timeout.mockRestore();
      }
    },
  );
  it('warns about an old shift but lets the backend decide whether payment is available', async () => {
    const profile = profileFixture();
    profile.shift.opened_at = new Date(Date.now() - 25 * 3600000).toISOString();
    const { service, fetcher, db } = await fixture(async (path, body) => {
      if (path === '/v1/auth/context')
        return response({ context: profile.context });
      if (path.includes('/cashier-sessions/current'))
        return response({ cashier_session: profile.session });
      if (path.includes('/register-shifts/current'))
        return response({ register_shift: profile.shift });
      if (path === '/v1/sales/local-draft')
        return response({
          sale: {
            ...db.sale(ids.session, body.sale_id as string)!.sale,
            status: body.status,
            version: 1,
          },
        });
      if (path.endsWith('/checkout'))
        return new Response(
          JSON.stringify({ error_code: 'FISCAL_SHIFT_EXPIRED' }),
          { status: 409 },
        );
      if (path.endsWith('/checkout-state'))
        return response({
          sale: db.sales(ids.session)[0]!.sale,
          retry_safe: true,
          replay_ready: false,
        });
      throw new TypeError('offline');
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await service.connect('token', ids.register, true);
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      }),
    ).rejects.toMatchObject({ code: 'FISCAL_SHIFT_EXPIRED' });
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith('/checkout')),
    ).toBe(true);
    await expect(
      service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: sale.id,
        reason: 'Закрытие старой смены',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await tick();
  });
  it('forces a server check when requested and revokes a cached session that ended remotely', async () => {
    const { service, fetcher } = await fixture();
    const profile = profileFixture();
    fetcher.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/context'))
        return response({ context: profile.context });
      if (url.includes('/cashier-sessions/current'))
        return response({ cashier_session: null });
      if (url.includes('/register-shifts/current'))
        return response({ register_shift: profile.shift });
      if (url.endsWith(`/v1/registers/${ids.register}`))
        return response({ register: profile.register });
      throw new TypeError('offline');
    });
    await expect(
      service.handle({
        type: 'connect',
        accessToken: 'token',
        registerId: ids.register,
        forceOnline: true,
      }),
    ).rejects.toMatchObject({ code: 'CASHIER_SESSION_NOT_ACTIVE' });
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_SESSION_EXPIRED' });
  });
  it('does not replace backend or contract errors with a request to connect to the internet', async () => {
    const { service, fetcher } = await fixture();
    fetcher.mockResolvedValue(
      new Response('<html>Wrong backend address</html>', { status: 200 }),
    );
    await expect(
      service.connect('new-token', ids.register),
    ).rejects.toMatchObject({ code: 'POS_API_INVALID_RESPONSE' });
    fetcher.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error_code: 'INTERNAL_SERVER_ERROR' }), {
          status: 500,
        }),
    );
    await expect(
      service.connect('new-token', ids.register),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
  });
  it('restores an unsynchronized cart and the same pending command after a real SQLite restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pos-restart-test-'));
    directories.push(directory);
    const path = join(directory, 'pos.sqlite');
    const key = randomBytes(32);
    const { service, db } = await fixture(undefined, path, key);
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await service.handle({ type: 'retry' });
    const flight = db.sale(ids.session, sale.id)!.inFlight;
    expect(flight).not.toBeNull();
    services.splice(services.indexOf(service), 1);
    service.close();
    const reopened = new PosDatabase(path, key);
    const restored = new PosService(
      reopened,
      'https://api.test',
      vi.fn(),
      async () => {
        throw new TypeError('offline');
      },
    );
    services.push(restored);
    await restored.handle({ type: 'restore', accessToken: 'token' });
    await tick();
    expect(await restored.handle({ type: 'current' })).toMatchObject({
      id: sale.id,
      total: '650.00',
      items: [{ quantity: '1.000' }],
    });
    expect(reopened.sale(ids.session, sale.id)!.inFlight).toEqual(flight);
  });
  it('requires successful initial draft adoption before permitting offline edits', async () => {
    const { service, db, fetcher } = await fixture();
    await service.handle({ type: 'disconnect' });
    const profile = profileFixture();
    profile.tokenHash = createHash('sha256').update('token').digest('hex');
    db.set(`profile:${profile.tokenHash}:${ids.register}`, profile);
    db.set(`adopted:${ids.session}`, false);
    await expect(service.connect('token', ids.register)).rejects.toThrow();
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_SESSION_EXPIRED' });
    fetcher.mockImplementation(async (input) => {
      const path = String(input);
      if (path.endsWith('/v1/sales/current')) return response({ sale: null });
      if (path.endsWith('/v1/sales/held')) return response({ sales: [] });
      throw new TypeError('offline');
    });
    await service.connect('token', ids.register);
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).resolves.toMatchObject({ total: '650.00' });
    await tick();
  });
  it('backs up the local cart before explicitly adopting a conflicting server version', async () => {
    const { service, db } = await fixture(async (path) => {
      if (path === '/v1/sales/local-draft')
        return new Response(
          JSON.stringify({ error_code: 'SALE_VERSION_CONFLICT' }),
          { status: 409 },
        );
      if (path.startsWith('/v1/sales/')) return response({ sale: remote });
      throw new TypeError('offline');
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await tick();
    const remote = { ...sale, version: 10, total: '700.00' };
    const local = db.sale(ids.session, sale.id)!;
    await expect(
      service.handle({
        type: 'resolveConflict',
        choice: 'server',
        saleId: sale.id,
        localRevision: local.sale.local_revision!,
        serverVersion: 9,
        serverId: sale.id,
      }),
    ).rejects.toMatchObject({ code: 'SALE_VERSION_CONFLICT' });
    await expect(
      service.handle({
        type: 'resolveConflict',
        choice: 'server',
        saleId: sale.id,
        localRevision: local.sale.local_revision!,
        serverVersion: 10,
        serverId: sale.id,
      }),
    ).resolves.toMatchObject({ total: '700.00' });
    expect(
      db.get(`conflict-backup:${ids.session}:${sale.id}:${local.revision}`),
    ).toMatchObject({ sale: { total: '650.00' } });
  });
  it('never resubmits an ambiguous payment and keeps the durable intent locked', async () => {
    let checkoutCalls = 0;
    const { service, db } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft')
        return response({
          sale: {
            ...database.sale(ids.session, body.sale_id as string)!.sale,
            version: 1,
          },
        });
      if (path.endsWith('/checkout-state') || path.endsWith('/reconcile'))
        return response({
          sale: database.sales(ids.session)[0]!.sale,
          retry_safe: false,
          replay_ready: false,
        });
      if (path.endsWith('/checkout')) {
        checkoutCalls++;
        throw new TypeError('response lost');
      }
      throw new Error('unexpected request');
    });
    const database = db;
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await tick();
    const command = {
      type: 'checkout' as const,
      saleId: sale.id,
      total: sale.total,
      payments: [{ method: 'CASH' as const, amount: sale.total }],
    };
    await expect(service.handle(command)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    await expect(service.handle(command)).rejects.toMatchObject({
      code: 'PAYMENT_UNCERTAIN',
    });
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    expect(checkoutCalls).toBe(1);
    expect(db.sale(ids.session, sale.id)!.payment?.stage).toBe('SENT');
  });

  it('adopts a completed fiscal receipt after losing the checkout response', async () => {
    let completed = false;
    const { service, db } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft')
        return response({
          sale: {
            ...database.sale(ids.session, body.sale_id as string)!.sale,
            version: 1,
          },
        });
      if (path.endsWith('/checkout')) {
        completed = true;
        throw new TypeError('response lost');
      }
      if (path.endsWith('/checkout-state'))
        return response({
          sale: {
            ...database.sales(ids.session)[0]!.sale,
            status: completed ? 'COMPLETED' : 'DRAFT',
            version: completed ? 2 : 1,
            fiscal_receipt: completed ? fiscalReceiptFixture() : null,
          },
          retry_safe: false,
          replay_ready: false,
        });
      throw new Error('unexpected request');
    });
    const database = db;
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await tick();
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(await service.handle({ type: 'current' })).toBeNull();
    expect(db.sale(ids.session, sale.id)!.payment).toBeNull();
  });

  it('requires confirmation again when the server changes the payable amount', async () => {
    let checkoutCalls = 0;
    const { service, db } = await fixture(async (path, body) => {
      if (path === '/v1/sales/local-draft')
        return response({
          sale: {
            ...database.sale(ids.session, body.sale_id as string)!.sale,
            version: 1,
            total: '700.00',
          },
        });
      if (path.endsWith('/checkout')) checkoutCalls++;
      throw new Error('unexpected request');
    });
    const database = db;
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: '650.00',
        payments: [{ method: 'CASH', amount: '650.00' }],
      }),
    ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    expect(checkoutCalls).toBe(0);
    expect(db.sale(ids.session, sale.id)!.payment).toBeNull();
  });

  it('allows cancellation after a proven WebKassa rejection and shows the provider reason', async () => {
    const { service, db } = await fixture(async (path, body) => {
      const sale = database.sales(ids.session)[0]!.sale;
      if (path === '/v1/sales/local-draft')
        return response({
          sale: { ...sale, status: body.status, version: sale.version + 1 },
        });
      if (path.endsWith('/checkout'))
        return new Response(
          JSON.stringify({
            error_code: 'FISCALIZATION_REJECTED',
            provider_errors: [{ code: 9, text: 'Некорректная позиция' }],
          }),
          { status: 422 },
        );
      if (path.endsWith('/checkout-state'))
        return response({
          sale,
          retry_safe: true,
          replay_ready: false,
          fiscal_state: 'REJECTED',
        });
      throw new TypeError('offline');
    });
    const database = db;
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      }),
    ).rejects.toMatchObject({ message: 'ККМ: Некорректная позиция' });
    expect(db.sale(ids.session, sale.id)!.payment).toBeNull();
    await expect(
      service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: sale.id,
        reason: 'Отказ ККМ',
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED' });
    await tick();
  });

  it('explicitly reconciles an uncertain payment without another checkout request', async () => {
    let paid = false;
    let checkoutCalls = 0;
    const { service, db } = await fixture(async (path) => {
      const draft = database.sales(ids.session)[0]!.sale;
      const sale = paid
        ? {
            ...draft,
            status: 'COMPLETED',
            version: 2,
            fiscal_receipt: fiscalReceiptFixture(),
          }
        : draft;
      if (path === '/v1/sales/local-draft')
        return response({ sale: { ...draft, version: 1 } });
      if (path.endsWith('/checkout')) {
        checkoutCalls++;
        throw new TypeError('lost response');
      }
      if (path.endsWith('/checkout-state'))
        return response({
          sale,
          retry_safe: false,
          replay_ready: false,
          fiscal_state: 'SENT',
        });
      if (path.endsWith('/reconcile')) {
        paid = true;
        return response({
          sale: {
            ...draft,
            status: 'COMPLETED',
            version: 2,
            fiscal_receipt: fiscalReceiptFixture(),
          },
          retry_safe: false,
          replay_ready: false,
          fiscal_state: 'COMPLETED',
        });
      }
      throw new TypeError('offline');
    });
    const database = db;
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    await service.handle({ type: 'retry' });
    expect(checkoutCalls).toBe(1);
    expect(db.sale(ids.session, sale.id)!).toMatchObject({
      payment: null,
      sale: { status: 'COMPLETED' },
    });
    await expect(
      service.handle({
        type: 'transition',
        action: 'cancel',
        saleId: sale.id,
        reason: 'Нельзя отменять пробитый чек',
      }),
    ).rejects.toMatchObject({ code: 'SALE_NOT_EDITABLE' });
  });

  it('does not wait for a hung catalog request when searching or scanning', async () => {
    const { service, db, fetcher } = await fixture();
    db.set(`catalog:${ids.organization}:${ids.store}`, null);
    fetcher.mockImplementation(() => new Promise<Response>(() => undefined));
    await expect(
      service.handle({ type: 'search', search: 'мол' }),
    ).resolves.toMatchObject({
      products: [expect.objectContaining({ id: productFixture().id })],
    });
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ product_id: productFixture().id })],
    });
  });

  it('keeps the existing offline catalog usable when forced reauthorization loses the network', async () => {
    const { service } = await fixture();
    await expect(
      service.connect('token', ids.register, true),
    ).rejects.toMatchObject({ code: 'LOCAL_SESSION_UNAVAILABLE' });
    await expect(
      service.handle({ type: 'search', search: 'мол' }),
    ).resolves.toMatchObject({
      products: [expect.objectContaining({ id: ids.product })],
    });
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ product_id: ids.product })],
    });
  });

  it('cannot edit or renew an expired offline authorization without the backend', async () => {
    const { service, db } = await fixture();
    db.set('clock', Date.now() + 120_000);
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_SESSION_EXPIRED' });
  });
  it('continues cached scans while a missing barcode is being fetched', async () => {
    const remote = {
      ...productFixture(),
      id: randomUUID(),
      barcode: 'remote',
      nkt: { ...productFixture().nkt!, gtin: null },
      store_id: ids.store,
    };
    let finish!: (response: Response) => void;
    const { service } = await fixture(async (path) => {
      if (path.includes('/catalog/lookup?'))
        return new Promise((resolve) => {
          finish = resolve;
        });
      throw new TypeError('offline');
    });
    const pending = service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: 'remote' },
    });
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ quantity: '1.000' })],
    });
    finish(response({ products: [remote] }));
    const sale = (await pending) as SaleResponse;
    expect(sale.items).toHaveLength(2);
  });
  it('does not add a late lookup result to a different checkout workspace', async () => {
    const remote = {
      ...productFixture(),
      id: randomUUID(),
      barcode: 'remote',
      nkt: { ...productFixture().nkt!, gtin: null },
      store_id: ids.store,
    };
    let finish!: (response: Response) => void;
    const { service } = await fixture(async (path) => {
      if (path.includes('/catalog/lookup?'))
        return new Promise((resolve) => {
          finish = resolve;
        });
      throw new TypeError('offline');
    });
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    const pending = service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: 'remote' },
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'LOCAL_CONTEXT_CHANGED',
    });
    await service.handle({
      type: 'transition',
      action: 'hold',
      saleId: sale.id,
    });
    finish(response({ products: [remote] }));
    await rejected;
    expect(await service.handle({ type: 'current' })).toBeNull();
  });
  it('accepts 100 ordered scans while the backend never replies', async () => {
    const { service, db } = await fixture(
      () => new Promise<Response>(() => undefined),
    );
    for (let i = 0; i < 100; i++)
      await service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      });
    const sale = (await service.handle({ type: 'current' })) as SaleResponse;
    expect(sale.items[0]!.quantity).toBe('100.000');
    expect(sale.total).toBe('65000.00');
    expect(db.sale(ids.session, sale.id)!.revision).toBe(100);
    expect(
      ((await service.handle({ type: 'status' })) as PosStatus).pending,
    ).toBe(1);
  });
  it('retries exactly the same command after a lost response and preserves newer edits', async () => {
    const payloads: Record<string, unknown>[] = [];
    let resolveFirst!: (response: Response) => void;
    const { service, db } = await fixture(async (_path, body) => {
      payloads.push(body);
      if (payloads.length === 1)
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      throw new TypeError('offline');
    });
    const first = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await tick();
    await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    });
    resolveFirst(response({ sale: { ...first, version: 1 } }));
    await tick();
    await tick();
    expect(
      ((await service.handle({ type: 'current' })) as SaleResponse).items[0]!
        .quantity,
    ).toBe('2.000');
    const record = db.sale(ids.session, first.id)!;
    expect(record.syncedRevision).toBe(1);
    expect(record.serverVersion).toBe(1);
    await service.handle({ type: 'retry' });
    expect(payloads).toHaveLength(2);
    vi.spyOn(Date, 'now').mockReturnValue(
      record.syncFailures!.draft!.nextAttemptAt! + 1,
    );
    await service.handle({ type: 'retry' });
    expect(payloads[2]).toEqual(payloads[1]);
  });
  it('does not send a payment while edits remain unsynchronized', async () => {
    const { service, fetcher } = await fixture();
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await expect(
      service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: sale.total,
        payments: [{ method: 'CASH', amount: sale.total }],
      }),
    ).rejects.toMatchObject({ code: 'SYNC_REQUIRED' });
    expect(
      fetcher.mock.calls.some(([path]) => String(path).endsWith('/checkout')),
    ).toBe(false);
  });
  it('preserves held carts and prevents logout with an unsynchronized sale', async () => {
    const { service } = await fixture();
    const sale = (await service.handle({
      type: 'execute',
      command: { type: 'scan', barcode: productFixture().barcode },
    })) as SaleResponse;
    await service.handle({
      type: 'transition',
      action: 'hold',
      saleId: sale.id,
    });
    expect(await service.handle({ type: 'current' })).toBeNull();
    expect(await service.handle({ type: 'held' })).toHaveLength(1);
    await expect(service.handle({ type: 'disconnect' })).rejects.toMatchObject({
      code: 'SYNC_REQUIRED',
    });
  });
  it('does not authorize a different token using the saved offline session', async () => {
    const { service } = await fixture();
    await expect(
      service.connect('untrusted-token', ids.register),
    ).rejects.toMatchObject({ code: 'LOCAL_SESSION_UNAVAILABLE' });
  });
});
