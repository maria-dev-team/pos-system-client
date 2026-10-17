// @vitest-environment node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

import { buildScanCandidates } from '../../shared/pos/barcode-scan';
import type { ScanAmbiguity } from '../../shared/pos/barcode-scan';
import type {
  PosProfile,
  ProductResponse,
  SaleResponse,
} from '../../shared/pos/contracts';
import { applyCommand } from '../../shared/pos/sale';
import {
  ids,
  productFixture,
  profileFixture,
} from '../../shared/pos/test-fixtures';
import type { ScaleProfile } from '../../shared/pos/weighted-barcode';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const services: PosService[] = [];
const directories: string[] = [];
const scope = `${ids.organization}:${ids.store}`;
const barcode = '2704245001850';
const scaleProfile: ScaleProfile = {
  format: 'ean13-weight-v1',
  prefix: '27',
  enabled: false,
  blocked_reason: null,
  revision: 3,
  issued_plu_ranges: [[4245, 4245]],
};
const weighted: ProductResponse = {
  ...productFixture(),
  unit: 'kg',
  scale_plu: 4245,
  retail_price: '1000.00',
};
const ordinary: ProductResponse = {
  ...productFixture(),
  id: '88888888-8888-4888-8888-888888888888',
  barcode,
};
const ok = (data: unknown): Response => new Response(JSON.stringify({ data }));
const reject = (error: unknown): Response =>
  new Response(JSON.stringify(error), { status: 409 });
const close = (service: PosService): void => {
  services.splice(services.indexOf(service), 1);
  service.close();
};
afterEach(() => {
  services.splice(0).forEach((service) => service.close());
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true }));
  vi.restoreAllMocks();
});

type Handler = (
  path: string,
  body: Record<string, unknown>,
  db: PosDatabase,
) => Response | Promise<Response>;
async function setup({
  products = [weighted],
  online = false,
  handler,
  path = ':memory:',
  key = randomBytes(32),
}: {
  products?: ProductResponse[];
  online?: boolean;
  handler?: Handler;
  path?: string;
  key?: Buffer;
} = {}): Promise<{
  db: PosDatabase;
  service: PosService;
  fetcher: Mock<typeof fetch>;
  profile: PosProfile;
}> {
  const db = new PosDatabase(path, key);
  const profile = profileFixture();
  profile.register.fiscalization.enabled = false;
  profile.tokenHash = createHash('sha256').update('token').digest('hex');
  db.set(`profile:${profile.tokenHash}:${ids.register}`, profile);
  db.set(`adopted:${ids.session}`, true);
  await db.replaceCatalog(scope, products);
  db.set(`scale-profile:organization:${ids.organization}`, scaleProfile);
  db.set(`catalog-cursor:${scope}`, 'complete');
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >;
      if (url.pathname === '/v1/pos/catalog/changes')
        return ok({
          products: [],
          deleted_ids: [],
          categories_changed: false,
          cursor: 'complete',
          has_more: false,
          scale_profile: scaleProfile,
        });
      if (url.pathname === '/v1/pos/catalog/lookup')
        return ok({
          products: products
            .filter((product) =>
              url.searchParams.has('scale_plu')
                ? product.scale_plu ===
                  Number(url.searchParams.get('scale_plu'))
                : [
                    product.barcode,
                    product.additional_barcode,
                    product.nkt?.gtin,
                  ].includes(url.searchParams.get('barcode')),
            )
            .map((product) => ({ ...product, store_id: ids.store })),
          scale_profile: scaleProfile,
        });
      if (url.pathname === '/v1/categories')
        return ok({ categories: [], meta: { has_more: false } });
      if (url.pathname === `/v1/registers/${ids.register}`)
        return ok({ register: profile.register });
      if (url.pathname === '/v1/sales/deferred-checkouts')
        return ok({ sales: [] });
      if (online && url.pathname === '/v1/sales/local-draft')
        return ok({
          sale: {
            ...db.sale(ids.session, String(body.sale_id))!.sale,
            version: Number(body.expected_version) + 1,
          },
        });
      if (handler) return handler(url.pathname, body, db);
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
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { db, service, fetcher, profile };
}

async function seedOnline(
  fixture: Awaited<ReturnType<typeof setup>>,
): Promise<SaleResponse> {
  const sale = (await fixture.service.handle({
    type: 'execute',
    command: { type: 'add', productId: weighted.id, quantity: '1' },
  })) as SaleResponse;
  await vi.waitFor(() =>
    expect(fixture.db.sale(ids.session, sale.id)?.syncedRevision).toBe(1),
  );
  return (await fixture.service.handle({ type: 'current' })) as SaleResponse;
}

type AmbiguityError = {
  code: string;
  details: ScanAmbiguity & { saleId: string | null };
};
async function scanAmbiguity(service: PosService): Promise<AmbiguityError> {
  const result = await service
    .handle({ type: 'execute', command: { type: 'scan', barcode } })
    .catch((error: unknown) => error);
  expect(result).toMatchObject({
    code: 'PRODUCT_BARCODE_AMBIGUOUS',
    details: { candidates: expect.any(Array) },
  });
  return result as AmbiguityError;
}

describe('weighted scan decisions and durable online commands', () => {
  it.each([false, true])(
    'keeps both interpretations without changing the offline cart (missing card: %s)',
    async (missing) => {
      const { service, db } = await setup({
        products: missing ? [ordinary] : [ordinary, weighted],
      });
      const error = await scanAmbiguity(service);
      expect(error.details).toMatchObject({
        saleId: null,
        candidates: [
          { kind: 'static', product_id: ordinary.id, quantity: null },
          {
            kind: 'weighted',
            product_id: missing ? null : weighted.id,
            quantity: '0.185',
            unavailable_reason: missing ? 'PRODUCT_NOT_FOUND' : null,
          },
        ],
      });
      expect(await service.handle({ type: 'current' })).toBeNull();
      expect(db.sales(ids.session)).toEqual([]);
    },
  );

  it('confirms the selected exact weight once and rejects the old selection after the cart changes', async () => {
    const { service, db } = await setup({ products: [ordinary, weighted] });
    const error = await scanAmbiguity(service);
    const command = {
      type: 'add' as const,
      productId: weighted.id,
      quantity: '0.185',
      saleId: error.details.saleId,
      expectedVersion: error.details.current_version,
    };
    const sale = (await service.handle({
      type: 'execute',
      command,
    })) as SaleResponse;
    expect(sale).toMatchObject({
      total: '185.00',
      items: [{ product_id: weighted.id, quantity: '0.185' }],
    });
    await expect(
      service.handle({ type: 'execute', command }),
    ).rejects.toMatchObject({ code: 'SALE_VERSION_CONFLICT' });
    expect(db.sale(ids.session, sale.id)?.sale.items).toEqual(sale.items);
  });

  it('sends encoded quantity to the existing online scan endpoint', async () => {
    let remote: SaleResponse;
    const fixture = await setup({
      online: true,
      handler: (path, body) => {
        if (path.endsWith('/items/scan')) {
          expect(body).toEqual({
            barcode,
            quantity_delta: '0.185',
            expected_version: remote.version,
          });
          remote = {
            ...applyCommand(
              remote,
              { type: 'add', productId: weighted.id, quantity: '0.185' },
              profileFixture(),
              weighted,
              randomUUID(),
              new Date().toISOString(),
            ),
            version: remote.version + 1,
          };
          return ok({ sale: remote });
        }
        throw new Error(`Unexpected ${path}`);
      },
    });
    remote = await seedOnline(fixture);
    fixture.fetcher.mockClear();
    const sale = (await fixture.service.handle({
      type: 'execute',
      command: { type: 'scan', barcode },
    })) as SaleResponse;
    expect(sale).toMatchObject({
      version: 2,
      total: '1185.00',
      items: [{ quantity: '1.185' }],
    });
    expect(fixture.db.sale(ids.session, sale.id)).toMatchObject({
      serverVersion: 2,
      error: null,
    });
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/items/scan'),
      ),
    ).toHaveLength(1);
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/local-draft'),
      ),
    ).toHaveLength(0);
  });

  it('keeps backend ambiguity non-optimistic and confirms through items with its version', async () => {
    let remote: SaleResponse;
    const candidates = buildScanCandidates(
      barcode,
      scaleProfile,
      [ordinary],
      weighted,
    );
    const fixture = await setup({
      products: [ordinary, weighted],
      online: true,
      handler: (path, body) => {
        if (path.endsWith('/items/scan'))
          return reject({
            error_code: 'PRODUCT_BARCODE_AMBIGUOUS',
            current_version: remote.version,
            candidates,
          });
        if (path.endsWith('/items')) {
          expect(body).toEqual({
            product_id: weighted.id,
            quantity: '0.185',
            expected_version: remote.version,
          });
          remote = {
            ...applyCommand(
              remote,
              { type: 'add', productId: weighted.id, quantity: '0.185' },
              profileFixture(),
              weighted,
              randomUUID(),
              new Date().toISOString(),
            ),
            version: remote.version + 1,
          };
          return ok({ sale: remote });
        }
        throw new Error(`Unexpected ${path}`);
      },
    });
    remote = await seedOnline(fixture);
    const before = fixture.db.sale(ids.session, remote.id)!.sale;
    const ambiguity = await scanAmbiguity(fixture.service);
    expect(
      ((await fixture.service.handle({ type: 'current' })) as SaleResponse)
        .items,
    ).toEqual(before.items);
    expect(fixture.db.sale(ids.session, remote.id)?.error).toBeNull();
    const confirmation = {
      type: 'add' as const,
      productId: weighted.id,
      quantity: '0.185',
      saleId: ambiguity.details.saleId,
      expectedVersion: ambiguity.details.current_version,
    };
    const confirming = fixture.service.handle({
      type: 'execute',
      command: confirmation,
    });
    await expect(
      fixture.service.handle({ type: 'execute', command: confirmation }),
    ).rejects.toBeDefined();
    const sale = (await confirming) as SaleResponse;
    expect(sale.total).toBe('1185.00');
    await expect(
      fixture.service.handle({ type: 'execute', command: confirmation }),
    ).rejects.toMatchObject({ code: 'SALE_VERSION_CONFLICT' });
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/items'),
      ),
    ).toHaveLength(1);
  });

  it('retains GS1 marking through an ambiguous NKT match and explicit static confirmation', async () => {
    const markingCode = '(01)04870000000012(21)serial';
    const gtin = '04870000000012';
    const marked = {
      ...ordinary,
      barcode: 'marked-product',
      nkt: { ...ordinary.nkt!, is_marked: true },
    };
    const candidates = buildScanCandidates(
      gtin,
      scaleProfile,
      [weighted, marked],
      undefined,
    );
    let remote: SaleResponse;
    const fixture = await setup({
      products: [weighted, marked],
      online: true,
      handler: (path, body) => {
        if (path.endsWith('/items/scan')) {
          expect(body).toEqual({
            barcode: gtin,
            quantity_delta: '1',
            expected_version: remote.version,
            marking_code: markingCode,
          });
          return reject({
            error_code: 'PRODUCT_BARCODE_AMBIGUOUS',
            current_version: remote.version,
            candidates,
          });
        }
        if (path.endsWith('/items')) {
          expect(body).toEqual({
            product_id: marked.id,
            quantity: '1',
            expected_version: remote.version,
            marking_code: markingCode,
          });
          remote = {
            ...applyCommand(
              remote,
              { type: 'add', productId: marked.id, quantity: '1', markingCode },
              profileFixture(),
              marked,
              randomUUID(),
              new Date().toISOString(),
            ),
            version: remote.version + 1,
          };
          return ok({ sale: remote });
        }
        throw new Error(`Unexpected ${path}`);
      },
    });
    remote = await seedOnline(fixture);
    const result = await fixture.service
      .handle({
        type: 'execute',
        command: { type: 'scan', barcode: markingCode },
      })
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: 'PRODUCT_BARCODE_AMBIGUOUS' });
    const { details } = result as AmbiguityError;
    const sale = (await fixture.service.handle({
      type: 'execute',
      command: {
        type: 'add',
        productId: marked.id,
        quantity: '1',
        markingCode,
        saleId: details.saleId,
        expectedVersion: details.current_version,
      },
    })) as SaleResponse;
    expect(sale).toMatchObject({
      total: '1650.00',
      items: [
        { product_id: weighted.id, quantity: '1.000', marking_code: null },
        { product_id: marked.id, quantity: '1.000', marking_code: markingCode },
      ],
    });
  });

  it('refreshes a conflicting server version without replaying the scan', async () => {
    const fixture = await setup({
      online: true,
      handler: (path) => {
        if (path.endsWith('/items/scan'))
          return reject({ error_code: 'SALE_VERSION_CONFLICT' });
        if (path === `/v1/sales/${remote.id}`)
          return ok({ sale: { ...remote, version: 5 } });
        throw new Error(`Unexpected ${path}`);
      },
    });
    const remote = await seedOnline(fixture);
    fixture.fetcher.mockClear();
    await expect(
      fixture.service.handle({
        type: 'execute',
        command: { type: 'scan', barcode },
      }),
    ).rejects.toMatchObject({ code: 'SALE_VERSION_CONFLICT' });
    expect(await fixture.service.handle({ type: 'current' })).toMatchObject({
      version: 5,
      items: remote.items,
    });
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/items/scan'),
      ),
    ).toHaveLength(1);
    expect(
      fixture.fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith('/local-draft'),
      ),
    ).toHaveLength(0);
  });

  it('preserves an uncertain online command after restart and blocks checkout, edits and background replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pos-pending-scan-'));
    directories.push(directory);
    const path = join(directory, 'pos.sqlite');
    const key = randomBytes(32);
    const fixture = await setup({
      path,
      key,
      online: true,
      handler: (path) => {
        if (path.endsWith('/items/scan'))
          throw new TypeError('response lost after server committed');
        throw new Error(`Unexpected ${path}`);
      },
    });
    const sale = await seedOnline(fixture);
    await expect(
      fixture.service.handle({
        type: 'execute',
        command: { type: 'scan', barcode },
      }),
    ).rejects.toBeDefined();
    expect(fixture.db.sale(ids.session, sale.id)).toMatchObject({
      pendingItemCommand: true,
      error: 'SALE_VERSION_CONFLICT',
    });
    close(fixture.service);
    const restored = await setup({ path, key });
    expect(restored.db.sale(ids.session, sale.id)).toMatchObject({
      pendingItemCommand: true,
      error: 'SALE_VERSION_CONFLICT',
    });
    await expect(
      restored.service.handle({
        type: 'execute',
        command: { type: 'add', productId: weighted.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      restored.service.handle({
        type: 'transition',
        action: 'hold',
        saleId: sale.id,
      }),
    ).rejects.toBeDefined();
    await expect(
      restored.service.handle({
        type: 'checkout',
        saleId: sale.id,
        total: '1000.00',
        fiscalizationMode: 'NON_FISCAL',
        payments: [{ method: 'CASH', amount: '1000.00', received: '1000.00' }],
      }),
    ).rejects.toBeDefined();
    expect(restored.db.sale(ids.session, sale.id)?.sale).toMatchObject({
      status: 'DRAFT',
      items: sale.items,
    });
    expect(
      restored.fetcher.mock.calls.filter(
        ([url]) =>
          String(url).endsWith('/local-draft') ||
          String(url).includes('/items'),
      ),
    ).toHaveLength(0);
  });
});
