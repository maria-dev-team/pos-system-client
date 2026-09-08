// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

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
      if (path === '/v1/pos/catalog')
        return response({ products: [productFixture()] });
      if (path.startsWith('/v1/categories'))
        return response({ categories: [], meta: { has_more: false } });
      if (path === '/v1/sales/deferred-checkouts')
        return response({ sales: [] });
      if (handler)
        return handler(path, JSON.parse((init?.body as string) ?? '{}'));
      throw new TypeError('offline');
    },
  );
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
        if (url.endsWith('/v1/sales/current')) return response({ sale: null });
        if (url.endsWith('/v1/sales/held')) return response({ sales: [] });
        if (url.endsWith('/v1/pos/catalog')) return response({ products: [] });
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
        expect(timeout.mock.calls.slice(0, 3)).toEqual([
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
            fiscal_receipt: completed ? { status: 'FISCALIZED' } : null,
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
            fiscal_receipt: { id: 'receipt' },
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
            fiscal_receipt: { id: 'receipt' },
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
    ).rejects.toMatchObject({ code: 'CATALOG_LOADING' });
    await expect(
      service.handle({
        type: 'execute',
        command: { type: 'scan', barcode: productFixture().barcode },
      }),
    ).rejects.toMatchObject({ code: 'CATALOG_LOADING' });
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
