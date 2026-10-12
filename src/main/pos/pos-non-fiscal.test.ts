// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PosRequest,
  PosStatus,
  SaleResponse,
} from '../../shared/pos/contracts';
import {
  ids,
  productFixture,
  profileFixture,
} from '../../shared/pos/test-fixtures';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const response = (data: unknown): Response =>
  new Response(JSON.stringify({ data }));
const tick = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));
const services: PosService[] = [];
const paths: string[] = [];
afterEach(() => {
  services.splice(0).forEach((s) => s.close());
  paths.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
  vi.restoreAllMocks();
});

async function fixture(policy: 'ALWAYS' | 'SELECTIVE' = 'SELECTIVE'): Promise<{
  service: PosService;
  db: PosDatabase;
  imports: Record<string, unknown>[];
  accepted: Map<string, SaleResponse>;
  fetcher: Mock<typeof fetch>;
  holdDraft(): () => void;
  online(): void;
  loseResponse(): void;
  reject(value: boolean): void;
  restart(): Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'pos-non-fiscal-'));
  paths.push(dir);
  const path = join(dir, 'pos.sqlite');
  const key = randomBytes(32);
  let db = new PosDatabase(path, key);
  const profile = profileFixture();
  profile.register.fiscalization.policy = policy;
  profile.tokenHash = createHash('sha256').update('token').digest('hex');
  db.set(`profile:${profile.tokenHash}:${ids.register}`, profile);
  db.set(`adopted:${ids.session}`, true);
  await db.replaceCatalog(`${ids.organization}:${ids.store}`, [
    productFixture(),
  ]);
  let online = false;
  let loseResponse = false;
  let reject = false;
  let draftGate: Promise<void> | undefined;
  const imports: Record<string, unknown>[] = [];
  const accepted = new Map<string, SaleResponse>();
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input).replace('https://api.test', '');
      if (!online) throw new TypeError('offline');
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (path === '/v1/sales/local-draft') {
        const record = db.sale(ids.session, body.sale_id)!;
        await draftGate;
        return response({
          sale: {
            ...record.sale,
            status: body.status,
            version: body.expected_version + 1,
          },
        });
      }
      if (path === '/v1/sales/local-non-fiscal') {
        imports.push(body);
        if (reject)
          return new Response(
            JSON.stringify({ error_code: 'SALE_VERSION_CONFLICT' }),
            { status: 409 },
          );
        let sale = accepted.get(body.command_id);
        if (!sale) {
          sale = {
            ...db.sale(ids.session, body.sale_id)!.sale,
            receipt_number: '42',
            version: body.expected_version + 2,
          };
          accepted.set(body.command_id, sale);
        }
        if (loseResponse) {
          loseResponse = false;
          throw new TypeError('lost acknowledgement');
        }
        return response({ sale });
      }
      if (path === '/v1/sales/deferred-checkouts')
        return response({ sales: [] });
      throw new TypeError('offline');
    },
  );
  let service = new PosService(db, 'https://api.test', () => {}, fetcher);
  services.push(service);
  await service.connect('token', ids.register);
  await tick();
  return {
    get service() {
      return service;
    },
    get db() {
      return db;
    },
    imports,
    accepted,
    fetcher,
    holdDraft() {
      let release!: () => void;
      draftGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    online() {
      online = true;
    },
    loseResponse() {
      loseResponse = true;
    },
    reject(value: boolean) {
      reject = value;
    },
    async restart() {
      services.splice(services.indexOf(service), 1);
      service.close();
      db = new PosDatabase(path, key);
      service = new PosService(db, 'https://api.test', () => {}, fetcher);
      services.push(service);
      await service.connect('token', ids.register);
      await tick();
    },
  };
}
async function cart(service: PosService): Promise<SaleResponse> {
  const sale = (await service.handle({
    type: 'execute',
    command: { type: 'scan', barcode: productFixture().barcode },
  })) as SaleResponse;
  await tick();
  return sale;
}
function payment(
  sale: SaleResponse,
): Extract<PosRequest, { type: 'checkout' }> {
  return {
    type: 'checkout',
    saleId: sale.id,
    total: sale.total,
    fiscalizationMode: 'NON_FISCAL',
    payments: [{ method: 'CASH', amount: sale.total, received: '1000.00' }],
  };
}
function advanceRetry(): void {
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 310_000);
}

describe('durable non-fiscal checkout', () => {
  it('returns the completed receipt while a slow draft HTTP request is still unanswered', async () => {
    const f = await fixture();
    f.online();
    const release = f.holdDraft();
    const sale = await cart(f.service);
    expect(f.db.sale(ids.session, sale.id)?.inFlight).toBeTruthy();
    try {
      await expect(f.service.handle(payment(sale))).resolves.toMatchObject({
        status: 'COMPLETED',
        fiscalization_mode: 'NON_FISCAL',
      });
      expect(f.imports).toHaveLength(0);
      expect(await f.service.handle({ type: 'current' })).toBeNull();
    } finally {
      release();
      await f.service.handle({ type: 'retry' });
    }
    expect(f.db.sale(ids.session, sale.id)?.nonFiscalCompletion?.synced).toBe(
      true,
    );
  });
  it('completes and frees the cart offline, survives restart and imports once without fiscal checkout', async () => {
    const f = await fixture();
    const sale = await cart(f.service);
    const request = payment(sale);
    const completed = (await f.service.handle(request)) as SaleResponse;
    expect(completed).toMatchObject({
      status: 'COMPLETED',
      fiscalization_mode: 'NON_FISCAL',
      fiscal_receipt: null,
      payments: [{ amount: '650.00', received: '1000.00', change: '350.00' }],
    });
    expect(completed.receipt_number).toBe(`НФ-${sale.id}`);
    expect(await f.service.handle({ type: 'current' })).toBeNull();
    expect((await cart(f.service)).id).not.toBe(sale.id);
    await f.restart();
    expect(await f.service.handle({ type: 'localReceipts' })).toEqual([
      expect.objectContaining({
        id: sale.id,
        receipt_number: completed.receipt_number,
      }),
    ]);
    expect(await f.service.handle(request)).toMatchObject({
      id: sale.id,
      completed_at: completed.completed_at,
    });
    advanceRetry();
    f.online();
    await f.service.handle({ type: 'retry' });
    expect(f.imports).toHaveLength(1);
    expect(f.imports[0]).toMatchObject({
      status: 'DRAFT',
      completed_at: completed.completed_at,
      total: completed.total,
    });
    expect(f.db.sale(ids.session, sale.id)?.nonFiscalCompletion).toMatchObject({
      synced: true,
      serverSale: { receipt_number: '42' },
    });
    expect(f.db.sale(ids.session, sale.id)?.sale.receipt_number).toBe(
      completed.receipt_number,
    );
    expect(
      f.fetcher.mock.calls.some(([url]) => String(url).endsWith('/checkout')),
    ).toBe(false);
  });
  it('replays the identical import after an acknowledgement is lost and the POS restarts', async () => {
    const f = await fixture();
    const sale = await cart(f.service);
    await f.service.handle(payment(sale));
    advanceRetry();
    f.online();
    f.loseResponse();
    await f.service.handle({ type: 'retry' });
    expect(f.accepted.size).toBe(1);
    expect(
      f.db.sale(ids.session, sale.id)?.nonFiscalCompletion?.synced,
    ).toBeFalsy();
    await f.restart();
    advanceRetry();
    await f.service.handle({ type: 'retry' });
    expect(f.imports).toHaveLength(2);
    expect(f.imports[1]).toEqual(f.imports[0]);
    expect(f.accepted.size).toBe(1);
    expect(f.db.sale(ids.session, sale.id)?.nonFiscalCompletion?.synced).toBe(
      true,
    );
  });
  it('retains an immutable paid receipt on server rejection, and sends independent sales', async () => {
    const f = await fixture();
    const sale = await cart(f.service);
    const completed = await f.service.handle(payment(sale));
    advanceRetry();
    f.online();
    f.reject(true);
    await f.service.handle({ type: 'retry' });
    const status = (await f.service.handle({ type: 'status' })) as PosStatus;
    expect(status.conflicts).toEqual([]);
    expect(status.paymentPending).toBe(false);
    expect(status.outbox).toEqual([
      expect.objectContaining({
        saleStatus: 'COMPLETED',
        stage: 'nonFiscal',
        code: 'SALE_VERSION_CONFLICT',
        archivable: false,
      }),
    ]);
    expect(f.db.sale(ids.session, sale.id)?.sale).toEqual({
      ...(completed as SaleResponse),
      local_revision: expect.any(Number),
    });
    await expect(
      f.service.handle({ type: 'archiveCancelledSale', saleId: sale.id }),
    ).rejects.toMatchObject({ code: 'SALE_NOT_ARCHIVABLE' });
    await expect(
      f.service.handle({ type: 'conflict', saleId: sale.id }),
    ).rejects.toMatchObject({ code: 'SALE_NOT_EDITABLE' });
    f.reject(false);
    const next = await cart(f.service);
    await f.service.handle(payment(next));
    await f.service.handle({ type: 'retry' });
    expect(f.db.sale(ids.session, next.id)?.nonFiscalCompletion?.synced).toBe(
      true,
    );
    await f.service.handle({ type: 'retrySale', saleId: sale.id });
    expect(f.db.sale(ids.session, sale.id)?.nonFiscalCompletion?.synced).toBe(
      true,
    );
  });
  it('does not bypass mandatory fiscalization', async () => {
    const f = await fixture('ALWAYS');
    const sale = await cart(f.service);
    await expect(f.service.handle(payment(sale))).rejects.toMatchObject({
      code: 'SALE_NOT_EDITABLE',
    });
    expect(f.db.sale(ids.session, sale.id)?.sale.status).toBe('DRAFT');
  });
  it('does not complete or enqueue invalid payment amounts', async () => {
    const f = await fixture();
    const sale = await cart(f.service);
    const request = payment(sale);
    request.payments[0].received = '100.00';
    await expect(f.service.handle(request)).rejects.toMatchObject({
      code: 'PAYMENT_DETAILS_INVALID',
    });
    expect(
      f.db.sale(ids.session, sale.id)?.nonFiscalCompletion,
    ).toBeUndefined();
  });
});
