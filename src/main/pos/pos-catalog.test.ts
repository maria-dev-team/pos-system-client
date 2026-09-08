// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { type Mock, afterEach, expect, it, vi } from 'vitest';

import type { ProductResponse } from '../../shared/pos/contracts';
import { ids, productFixture } from '../../shared/pos/test-fixtures';
import { PosApiError } from './pos-api-client';
import { PosCatalog } from './pos-catalog';
import { PosDatabase } from './pos-database';

const scope = `${ids.organization}:${ids.store}`;
const product = (): ProductResponse & { store_id: string } => ({
  ...productFixture(),
  store_id: ids.store,
});
const resources: Array<{ db: PosDatabase; catalog: PosCatalog }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  resources.splice(0).forEach(({ db, catalog }) => {
    catalog.stop();
    db.close();
  });
});
function setup(
  handler: (path: string) => Promise<unknown> = async () => {
    throw new Error('Unexpected HTTP');
  },
): {
  db: PosDatabase;
  catalog: PosCatalog;
  request: Mock<(path: string) => Promise<unknown>>;
  changed: Mock<() => void>;
  wait: Mock<(ms: number) => Promise<void>>;
} {
  const db = new PosDatabase(':memory:', randomBytes(32));
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/sync-start')) return { cursor: 'baseline' };
    if (path.includes('/changes?'))
      return {
        products: [],
        deleted_ids: [],
        categories_changed: false,
        cursor: 'next',
        has_more: false,
      };
    return handler(path);
  });
  const changed = vi.fn<() => void>();
  const wait = vi
    .fn<(ms: number) => Promise<void>>()
    .mockResolvedValue(undefined);
  const catalog = new PosCatalog(
    db,
    async <T>(path: string) => (await request(path)) as T,
    changed,
    wait,
  );
  catalog.activate(ids.organization, ids.store);
  resources.push({ db, catalog });
  return { db, catalog, request, changed, wait };
}

it('serves cached barcode, product and text without HTTP or waiting for a complete catalog', async () => {
  const { db, catalog, request, wait } = setup();
  const p = product();
  await db.cacheProducts(scope, [p]);
  expect(await catalog.barcode(p.barcode)).toMatchObject({ id: p.id });
  expect(await catalog.product(p.id)).toMatchObject({ id: p.id });
  expect((await catalog.search('мол', undefined, 20, 0)).products).toHaveLength(
    1,
  );
  expect(request).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});

it('looks up a missing barcode once, caches it and keeps cache hits usable during a hung background download', async () => {
  const p = product();
  const { catalog, db, request } = setup(async (path) =>
    path.includes('/page?') ? new Promise(() => {}) : { products: [p] },
  );
  void catalog.refresh();
  const [a, b] = await Promise.all([
    catalog.barcode(p.barcode),
    catalog.barcode(p.barcode),
  ]);
  expect(a?.id).toBe(p.id);
  expect(b?.id).toBe(p.id);
  expect(
    request.mock.calls.filter(([path]) => path.includes('/lookup?')),
  ).toHaveLength(1);
  expect(db.barcode(scope, p.barcode)?.id).toBe(p.id);
  await catalog.barcode(p.barcode);
  expect(request).toHaveBeenCalledTimes(3);
});

it('hydrates sequential pages, publishes the first page immediately and never calls the full snapshot', async () => {
  const p = product();
  let finish!: (value: unknown) => void;
  const { catalog, db, request, wait } = setup(async (path) =>
    path.includes('after=')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { products: [p], next_cursor: p.id },
  );
  const loading = catalog.refresh();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(db.barcode(scope, p.barcode)?.id).toBe(p.id);
  expect(catalog.status().catalogSyncing).toBe(true);
  expect(wait).toHaveBeenCalledWith(expect.any(Number));
  expect(wait.mock.calls[0][0]).toBeGreaterThanOrEqual(250);
  expect(request.mock.calls[2][0]).toContain(`after=${p.id}`);
  finish({ products: [], next_cursor: null });
  await loading;
  expect(db.get(`catalog:${scope}`)).toBeTruthy();
  expect(db.get(`catalog-progress:${scope}`)).toBeNull();
  expect(
    request.mock.calls
      .filter(([path]) => path.includes('/page?'))
      .every(([path]) => path.startsWith('/v1/pos/catalog/page?limit=250')),
  ).toBe(true);
});

it('resumes a persisted cursor and prunes unseen products only after completion', async () => {
  const p = product();
  const deleted = { ...p, id: randomUUID(), barcode: 'deleted', nkt: null };
  const { db, catalog, request } = setup(async () => ({
    products: [],
    next_cursor: null,
  }));
  await db.cacheProducts(scope, [deleted]);
  db.set(`catalog-progress:${scope}`, {
    cursor: 'baseline',
    cycle: 'cycle',
    after: p.id,
    loaded: 1,
  });
  await db.cacheProducts(scope, [p]);
  await catalog.refresh();
  expect(request.mock.calls[0][0]).toContain(`after=${p.id}`);
  expect(db.product(scope, p.id)).toBeDefined();
  expect(db.product(scope, deleted.id)).toBeUndefined();
});

it('backs off after a rejected page and preserves both the previous cache and the resume cursor', async () => {
  const p = product();
  const { db, catalog, request } = setup(async (path) => {
    if (path.includes('after='))
      throw new PosApiError('TOO_MANY_REQUESTS', 429);
    return { products: [p], next_cursor: p.id };
  });
  await catalog.refresh();
  await catalog.refresh(true);
  expect(request).toHaveBeenCalledTimes(3);
  expect(db.product(scope, p.id)).toBeDefined();
  expect(db.get(`catalog-progress:${scope}`)).toMatchObject({ after: p.id });
  expect(catalog.status().catalogError).toBeTruthy();
  expect(catalog.status()).toMatchObject({
    catalogSyncing: false,
    catalogLoaded: 1,
    catalogPhase: null,
  });
  expect(Date.parse(catalog.status().catalogRetryAt!)).toBeGreaterThan(
    Date.now(),
  );
});

it.each(['store', 'barcode', 'oversized'] as const)(
  'does not cache invalid %s lookup results',
  async (kind) => {
    const p = product();
    const bad =
      kind === 'store'
        ? { ...p, store_id: randomUUID() }
        : kind === 'barcode'
          ? { ...p, barcode: 'wrong', nkt: null }
          : p;
    const { catalog, db } = setup(async () => ({
      products: kind === 'oversized' ? [bad, bad, bad] : [bad],
    }));
    await expect(catalog.barcode(p.barcode)).rejects.toMatchObject({
      code: 'POS_API_INVALID_RESPONSE',
    });
    expect(db.product(scope, p.id)).toBeUndefined();
  },
);

it('rejects an oversized page without writing it or declaring the catalog complete', async () => {
  const { catalog, db } = setup(async () => ({
    products: Array.from({ length: 251 }, product),
    next_cursor: null,
  }));
  await catalog.refresh();
  expect(db.get(`catalog:${scope}`)).toBeNull();
  expect(db.search(scope, '', undefined, 20, 0).products).toHaveLength(0);
});

it('does not cache a late response after changing store', async () => {
  const p = product();
  let finish!: (value: unknown) => void;
  const { catalog, db } = setup(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const lookup = catalog.barcode(p.barcode);
  const rejected = expect(lookup).rejects.toMatchObject({
    code: 'LOCAL_CONTEXT_CHANGED',
  });
  catalog.activate(ids.organization, randomUUID());
  finish({ products: [p] });
  await rejected;
  expect(db.product(scope, p.id)).toBeUndefined();
});

it('bounds concurrent misses and reports activity without invalidating products for negative cache hits', async () => {
  const { catalog, request, changed } = setup(async () => ({ products: [] }));
  const revision = catalog.status().catalogRevision;
  await catalog.barcode('missing');
  expect(changed).toHaveBeenCalledTimes(2); // request start and finish, no catalog write
  changed.mockClear();
  await catalog.barcode('missing');
  expect(request).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
  expect(catalog.status().catalogRevision).toBe(revision);
  request.mockImplementation(async () => new Promise(() => {}));
  for (let i = 0; i < 4; i++) void catalog.barcode(`code-${i}`);
  expect(catalog.status().productLookups).toBe(4);
  await expect(catalog.barcode('overflow')).rejects.toMatchObject({
    code: 'CATALOG_BUSY',
  });
});

it('debounces text misses, caches server matches and suppresses repeated empty queries', async () => {
  const p = product();
  const { catalog, request, wait, changed } = setup(async () => ({
    products: [p],
    meta: { has_more: false },
  }));
  const first = catalog.search('мо', undefined, 20, 0);
  const second = catalog.search('мол', undefined, 20, 0);
  expect((await first).products).toHaveLength(0);
  expect((await second).products).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(1);
  expect(wait).toHaveBeenCalledWith(200);
  request.mockResolvedValue({ products: [], meta: { has_more: false } });
  changed.mockClear();
  await catalog.search('unknown', undefined, 20, 0);
  expect(changed).toHaveBeenCalledTimes(2);
  const revision = catalog.status().catalogRevision;
  changed.mockClear();
  await catalog.search('unknown', undefined, 20, 0);
  expect(request).toHaveBeenCalledTimes(2);
  expect(changed).not.toHaveBeenCalled();
  expect(catalog.status().catalogRevision).toBe(revision);
});

it('reports simultaneous barcode and text misses, deduplicates counts and clears activity after failure', async () => {
  let finishBarcode!: (value: unknown) => void;
  let failText!: (error: Error) => void;
  const { catalog, request, changed } = setup(
    async (path) =>
      new Promise((resolve, reject) => {
        if (path.includes('/lookup?')) finishBarcode = resolve;
        else failText = reject;
      }),
  );
  const barcode = catalog.barcode(product().barcode);
  const duplicate = catalog.barcode(product().barcode);
  const search = catalog.search('unknown', undefined, 20, 0);
  const rejected = expect(search).rejects.toThrow('offline');
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(catalog.status().productLookups).toBe(2);
  expect(changed).toHaveBeenCalledTimes(2);
  finishBarcode({ products: [] });
  await Promise.all([barcode, duplicate]);
  expect(catalog.status().productLookups).toBe(1);
  failText(new Error('offline'));
  await rejected;
  expect(catalog.status().productLookups).toBe(0);
});

it('publishes bootstrap progress then only polls changes, even after five minutes or a manual retry', async () => {
  const { catalog, db, changed, request } = setup(async () => ({
    products: [product()],
    next_cursor: null,
  }));
  const states: ReturnType<PosCatalog['status']>[] = [];
  changed.mockImplementation(() => states.push(catalog.status()));
  await catalog.refresh();
  expect(states.some((s) => s.catalogPhase === 'saving')).toBe(true);
  expect(
    states.some(
      (s) =>
        s.catalogPhase === 'finalizing' &&
        s.catalogLoaded === 1 &&
        s.catalogSyncing,
    ),
  ).toBe(true);
  expect(catalog.status()).toMatchObject({
    catalogSyncing: false,
    catalogLoaded: 0,
    catalogMode: 'delta',
    catalogPhase: null,
    catalogRetryAt: null,
  });
  expect(db.get(`catalog:${scope}`)).toBeTruthy();
  states.length = 0;
  await catalog.refresh(true);
  expect(states).toHaveLength(0);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000);
  await catalog.refresh();
  expect(
    states.some(
      (s) => s.catalogPhase === 'downloading' && s.catalogLoaded === 0,
    ),
  ).toBe(true);
  expect(catalog.status().catalogLoaded).toBe(0);
  expect(
    request.mock.calls.filter(([path]) => path.includes('/page?')),
  ).toHaveLength(1);
});

it('does not clear the new session lookup indicator when an old response arrives', async () => {
  const finishes: ((value: unknown) => void)[] = [];
  const { catalog } = setup(
    async () => new Promise((resolve) => finishes.push(resolve)),
  );
  const old = catalog.barcode('old');
  const rejected = expect(old).rejects.toMatchObject({
    code: 'LOCAL_CONTEXT_CHANGED',
  });
  catalog.activate(ids.organization, randomUUID());
  expect(catalog.status().productLookups).toBe(0);
  const current = catalog.barcode('current');
  finishes[0]({ products: [] });
  await rejected;
  expect(catalog.status().productLookups).toBe(1);
  finishes[1]({ products: [] });
  await current;
  expect(catalog.status().productLookups).toBe(0);
});

it('keeps a newer on-demand price when an older background page arrives', async () => {
  const { db } = setup();
  const p = { ...product(), updated_at: '2026-09-08T12:00:00.000Z' };
  await db.cacheProducts(scope, [p]);
  await db.cacheProducts(scope, [
    { ...p, updated_at: '2026-09-08T11:00:00.000Z', retail_price: '100.00' },
  ]);
  expect(db.product(scope, p.id)?.retail_price).toBe('650.00');
});
it('resumes cleanup after the final committed page without downloading the catalog again', async () => {
  const { db, catalog, request } = setup();
  db.set(`catalog-progress:${scope}`, {
    cursor: 'baseline',
    cycle: 'finished',
    after: null,
    loaded: 1,
    complete: true,
  });
  await db.cacheProducts(scope, [product()]);
  await catalog.refresh();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toContain('/changes?');
  expect(db.get(`catalog:${scope}`)).toBeTruthy();
  expect(db.product(scope, product().id)).toBeDefined();
});

const delta = (
  products: ProductResponse[] = [],
  deleted_ids: string[] = [],
  cursor = 'next',
): {
  products: ProductResponse[];
  deleted_ids: string[];
  cursor: string;
  has_more: boolean;
  categories_changed: boolean;
} => ({
  products,
  deleted_ids,
  cursor,
  has_more: false,
  categories_changed: false,
});

it('applies authoritative deltas and tombstones to SQLite and FTS without walking the full catalog', async () => {
  const { db, catalog, request } = setup();
  const p = product(),
    deleted = {
      ...p,
      id: randomUUID(),
      barcode: 'deleted',
      name: 'Удалённый',
      nkt: null,
    };
  await db.cacheProducts(scope, [p, deleted]);
  db.set(`catalog-cursor:${scope}`, 'baseline');
  // Removing a source relation can lower GREATEST(updated_at): journal ordering wins over timestamps.
  request.mockResolvedValue(
    delta(
      [{ ...p, retail_price: '777.00', updated_at: '2020-01-01T00:00:00Z' }],
      [deleted.id],
    ),
  );
  await catalog.refresh();
  expect(db.product(scope, p.id)?.retail_price).toBe('777.00');
  expect(db.barcode(scope, deleted.barcode)).toBeUndefined();
  expect(db.search(scope, 'удалён', undefined, 20, 0).products).toHaveLength(0);
  expect(db.get(`catalog-cursor:${scope}`)).toBe('next');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toContain('/changes?cursor=baseline');
});

it('captures a baseline before bootstrap and catches changes behind the UUID page cursor', async () => {
  const { db, catalog, request } = setup();
  const p = product();
  request.mockImplementation(async (path) =>
    path.endsWith('/sync-start')
      ? { cursor: 'baseline' }
      : path.includes('/page?')
        ? { products: [p], next_cursor: null }
        : delta([{ ...p, retail_price: '900.00' }]),
  );
  await catalog.refresh();
  expect(request.mock.calls.map(([path]) => path.split('?')[0])).toEqual([
    '/v1/pos/catalog/sync-start',
    '/v1/pos/catalog/page',
    '/v1/pos/catalog/changes',
  ]);
  expect(db.product(scope, p.id)?.retail_price).toBe('900.00');
});

it('replays a partially saved delta after failure without acknowledging or losing the batch', async () => {
  const { db, catalog, request } = setup();
  db.set(`catalog-cursor:${scope}`, 'baseline');
  request.mockResolvedValue(delta([product()]));
  const cache = db.cacheProducts.bind(db);
  vi.spyOn(db, 'cacheProducts').mockImplementationOnce(async (...args) => {
    await cache(...args);
    throw new Error('interrupted');
  });
  await catalog.refresh();
  expect(db.get(`catalog-cursor:${scope}`)).toBe('baseline');
  expect(db.get(`catalog:${scope}`)).toBeNull();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
  await catalog.refresh();
  expect(db.get(`catalog-cursor:${scope}`)).toBe('next');
  expect(db.search(scope, '', undefined, 20, 0).products).toHaveLength(1);
  expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
});

it('does not resurrect a tombstoned product from a late foreground lookup', async () => {
  const { db, catalog, request } = setup();
  db.set(`catalog-cursor:${scope}`, 'baseline');
  const p = product();
  let finish!: (value: unknown) => void;
  request.mockImplementation(async (path) =>
    path.includes('/lookup?')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : delta([], [p.id]),
  );
  const lookup = catalog.product(p.id);
  await catalog.refresh();
  finish({ products: [p] });
  expect(await lookup).toBeUndefined();
  expect(db.product(scope, p.id)).toBeUndefined();
});

it('keeps an unrelated foreground miss usable while a different product is synchronized', async () => {
  const { db, catalog, request } = setup();
  db.set(`catalog-cursor:${scope}`, 'baseline');
  const p = product(),
    other = { ...p, id: randomUUID(), barcode: 'other', nkt: null };
  let finish!: (value: unknown) => void;
  request.mockImplementation(async (path) =>
    path.includes('/lookup?')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : delta([other]),
  );
  const lookup = catalog.product(p.id);
  await catalog.refresh();
  finish({ products: [p] });
  expect((await lookup)?.id).toBe(p.id);
});

it('retains usable cache and resumes bootstrap only when the server expires the journal cursor', async () => {
  const { db, catalog, request } = setup();
  await db.cacheProducts(scope, [product()]);
  db.set(`catalog-cursor:${scope}`, 'expired');
  request.mockRejectedValue(new PosApiError('POS_CATALOG_CURSOR_EXPIRED', 410));
  await catalog.refresh();
  expect(db.get(`catalog-cursor:${scope}`)).toBeNull();
  expect(db.product(scope, product().id)).toBeDefined();
  expect(catalog.status().catalogMode).toBe('bootstrap');
  await catalog.refresh(true);
  expect(request).toHaveBeenCalledTimes(1); // no tight restart loop
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
  const fresh = { ...product(), id: randomUUID(), barcode: 'fresh', nkt: null };
  request.mockImplementation(async (path) =>
    path.endsWith('/sync-start')
      ? { cursor: 'fresh-baseline' }
      : path.includes('/page?')
        ? { products: [fresh], next_cursor: null }
        : delta([], [], 'fresh-next'),
  );
  await catalog.refresh();
  expect(
    request.mock.calls.slice(1).map(([path]) => path.split('?')[0]),
  ).toEqual([
    '/v1/pos/catalog/sync-start',
    '/v1/pos/catalog/page',
    '/v1/pos/catalog/changes',
  ]);
  expect(db.get(`catalog-cursor:${scope}`)).toBe('fresh-next');
  expect(db.get(`catalog:${scope}`)).toBeTruthy();
  expect(db.product(scope, fresh.id)).toBeDefined();
  expect(db.product(scope, product().id)).toBeUndefined();
});

it('reports a delayed transaction horizon without declaring all changes synchronized', async () => {
  const { db, catalog, request } = setup();
  db.set(`catalog-cursor:${scope}`, 'baseline');
  request.mockResolvedValue({ ...delta(), waiting_for_transactions: true });
  await catalog.refresh();
  expect(catalog.status()).toMatchObject({
    catalogWaiting: true,
    catalogSyncing: false,
  });
  expect(db.get(`catalog:${scope}`)).toBeNull();
  expect(db.get(`catalog-cursor:${scope}`)).toBe('next');
});

it('does not advance cursor for a malformed delta and bounds a busy feed to 20 pages per pump', async () => {
  const { db, catalog, request } = setup();
  db.set(`catalog-cursor:${scope}`, 'baseline');
  request.mockResolvedValue({ ...delta(), deleted_ids: ['bad'] });
  await catalog.refresh();
  expect(db.get(`catalog-cursor:${scope}`)).toBe('baseline');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
  let pages = 0;
  request.mockImplementation(async () => ({
    ...delta([], [], `next-${++pages}`),
    has_more: true,
  }));
  await catalog.refresh();
  expect(pages).toBe(20);
  expect(catalog.status().catalogPending).toBe(true);
  expect(db.get(`catalog-cursor:${scope}`)).toBe('next-20');
  expect(db.get(`catalog:${scope}`)).toBeNull();
});
