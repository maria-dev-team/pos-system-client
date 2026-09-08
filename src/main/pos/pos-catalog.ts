import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ProductSearchResponse } from '../../shared/api/responses/product.response';
import {
  PosError,
  type PosStatus,
  type ProductResponse,
} from '../../shared/pos/contracts';
import { PosApiError, PosConnectionError } from './pos-api-client';
import { PosDatabase } from './pos-database';

const productSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  store_id: z.string().uuid(),
  barcode: z.string().max(512),
  name: z.string().max(1000),
  sku: z.string().nullable(),
  category_id: z.string().uuid().nullable(),
  nkt_product_id: z.string().uuid().nullable(),
  unit: z.enum(['pcs', 'kg', 'l', 'm']),
  is_active: z.boolean(),
  retail_price: z
    .string()
    .regex(/^\d+(?:\.\d{1,2})?$/)
    .nullable(),
  vat_rate: z.enum(['NONE', '0', '5', '10', '16']).nullable(),
  created_at: z.string(),
  updated_at: z.string().refine((s): boolean => Number.isFinite(Date.parse(s))),
  deleted_at: z.string().nullable(),
  nkt: z
    .object({
      gtin: z.string().nullable(),
      ntin_code: z
        .string()
        .nullable()
        .transform((v): string => v ?? ''),
      name_ru: z.string(),
      name_kk: z.string().nullable(),
      is_marked: z.boolean(),
      is_social: z.boolean(),
      is_deactivated: z.boolean().optional(),
    })
    .nullable(),
});
type Progress = {
  cursor: string;
  cycle: string;
  after: string | null;
  loaded: number;
  complete?: boolean;
};
const pause = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });
const empty = (limit: number, offset: number): ProductSearchResponse => ({
  products: [],
  meta: { limit, offset, total: offset, has_more: false },
});

/** Cache-aside reads and paced catalog hydration. No sale mutations or React dependencies. */
export class PosCatalog {
  private scope = '';
  private organization = '';
  private store = '';
  private epoch = 0;
  private job: Promise<void> | null = null;
  private nextRefresh = 0;
  private failures = 0;
  private jobs = new Map<string, Promise<ProductResponse[]>>();
  private misses = new Map<string, number>();
  private foregroundRetryAt = 0;
  private searchSequence = 0;
  private searchJob: Promise<ProductSearchResponse> | null = null;
  private error: string | null = null;
  private revision: string | null = null;
  private loaded = 0;
  private phase: PosStatus['catalogPhase'] = null;
  private mode: 'bootstrap' | 'delta' = 'bootstrap';
  private writes = 0;
  private waitingForTransactions = false;
  private pending = false;
  private prunedAt = 0;
  // Only track races while foreground requests exist, not an ever-growing 97k history.
  private touched = new Map<string, number>();

  constructor(
    private readonly db: PosDatabase,
    private readonly request: <T>(path: string, timeout: number) => Promise<T>,
    private readonly changed: () => void,
    private readonly wait: (ms: number) => Promise<void> = pause,
  ) {}

  activate(organization: string, store: string): void {
    this.stop();
    this.organization = organization;
    this.store = store;
    this.scope = `${organization}:${store}`;
    this.nextRefresh = 0;
    this.foregroundRetryAt = 0;
    this.failures = 0;
    this.error = null;
    this.loaded =
      this.db.get<Progress>(`catalog-progress:${this.scope}`)?.loaded ?? 0;
    this.revision =
      this.db.get<string>(`catalog:${this.scope}`) ?? `empty:${this.scope}`;
    this.pending =
      this.db.get<boolean>(`catalog-pending:${this.scope}`) ?? false;
    this.mode = this.db.get<string>(`catalog-cursor:${this.scope}`)
      ? 'delta'
      : 'bootstrap';
  }
  stop(): void {
    this.epoch++;
    this.scope = '';
    this.job = null;
    this.jobs.clear();
    this.misses.clear();
    this.touched.clear();
    this.searchSequence++;
    this.searchJob = null;
    this.phase = null;
    this.waitingForTransactions = false;
  }
  status(): Pick<
    PosStatus,
    | 'catalogSyncing'
    | 'catalogLoaded'
    | 'catalogError'
    | 'catalogRevision'
    | 'catalogPhase'
    | 'catalogRetryAt'
    | 'productLookups'
    | 'catalogMode'
    | 'catalogWaiting'
    | 'catalogPending'
  > {
    return {
      catalogSyncing: !!this.job,
      catalogMode: this.mode,
      catalogWaiting: this.waitingForTransactions,
      catalogPending: this.pending,
      catalogLoaded: this.loaded,
      catalogError: this.error,
      catalogRevision: this.revision,
      catalogPhase: this.phase,
      catalogRetryAt:
        this.error && !this.job && this.nextRefresh
          ? new Date(this.nextRefresh).toISOString()
          : null,
      productLookups: this.jobs.size + Number(!!this.searchJob),
    };
  }
  private check(epoch: number): void {
    if (epoch !== this.epoch || !this.scope)
      throw new PosError(
        'LOCAL_CONTEXT_CHANGED',
        'Контекст кассы изменился. Повторите поиск.',
      );
  }
  private products(input: unknown, max: number): ProductResponse[] {
    const parsed = z.array(productSchema).max(max).safeParse(input);
    if (
      !parsed.success ||
      parsed.data.some(
        (p) =>
          p.organization_id !== this.organization || p.store_id !== this.store,
      )
    )
      throw new PosError(
        'POS_API_INVALID_RESPONSE',
        'Сервер вернул некорректный каталог или товары другого магазина.',
      );
    return parsed.data;
  }
  private async cache(
    products: ProductResponse[],
    epoch: number,
    foreground?: number,
  ): Promise<void> {
    this.check(epoch);
    if (!products.length) return;
    if (foreground === undefined) {
      this.touch(products.map((p) => p.id));
      this.misses.clear();
    }
    await this.db.cacheProducts(
      this.scope,
      products,
      () => epoch === this.epoch,
      foreground === undefined ? 'authoritative' : 'missing',
      (id) =>
        foreground === undefined ||
        (foreground >= this.prunedAt &&
          (this.touched.get(id) ?? 0) <= foreground),
    );
    this.check(epoch);
    this.revision = `${Date.now()}:${randomUUID()}`;
    this.changed();
  }

  private touch(ids: string[]): void {
    this.writes++;
    if (this.jobs.size || this.searchJob)
      for (const id of ids) this.touched.set(id, this.writes);
  }

  refresh(force = false): Promise<void> {
    if (!this.scope || this.job || Date.now() < this.nextRefresh)
      return this.job ?? Promise.resolve();
    // Explicit retries do not restart a full snapshot or bypass server cooldowns.
    void force;
    const epoch = this.epoch;
    const scope = this.scope;
    const job = Promise.resolve().then(async () => {
      try {
        this.check(epoch);
        this.error = null;
        let cursor = this.db.get<string>(`catalog-cursor:${scope}`);
        this.mode = cursor ? 'delta' : 'bootstrap';
        if (!cursor) {
          let progress = this.db.get<Progress>(`catalog-progress:${scope}`);
          if (!progress?.cursor) {
            // Capture the journal BEFORE walking UUID pages. Catch-up covers writes behind that walk.
            const start = await this.request<{ cursor: unknown }>(
              '/v1/pos/catalog/sync-start',
              5000,
            );
            this.check(epoch);
            const baseline = this.cursor(start.cursor);
            progress = {
              cycle: randomUUID(),
              after: null,
              loaded: 0,
              cursor: baseline,
            };
            this.db.set(`categories-dirty:${scope}`, randomUUID());
          }
          this.loaded = progress.loaded;
          this.db.set(`catalog-progress:${scope}`, progress);
          while (!progress.complete) {
            this.check(epoch);
            this.phase = 'downloading';
            this.changed();
            const params = new URLSearchParams({ limit: '250' });
            if (progress.after) params.set('after', progress.after);
            const page = await this.request<{
              products: unknown;
              next_cursor: unknown;
            }>(`/v1/pos/catalog/page?${params}`, 5000);
            this.check(epoch);
            const products = this.products(page.products, 250);
            if (
              products.some(
                (p, index) =>
                  p.id <=
                  (index ? products[index - 1].id : (progress!.after ?? '')),
              )
            )
              throw new PosError(
                'POS_API_INVALID_RESPONSE',
                'Нарушен порядок товаров в странице каталога.',
              );
            if (
              page.next_cursor !== null &&
              (typeof page.next_cursor !== 'string' ||
                !z.string().uuid().safeParse(page.next_cursor).success ||
                !products.length ||
                page.next_cursor !== products.at(-1)?.id ||
                (progress.after && page.next_cursor <= progress.after))
            )
              throw new PosError(
                'POS_API_INVALID_RESPONSE',
                'Некорректная страница каталога.',
              );
            this.phase = 'saving';
            this.changed();
            await this.cache(products, epoch);
            progress = {
              ...progress,
              after: page.next_cursor as string | null,
              loaded: progress.loaded + products.length,
              complete: page.next_cursor === null,
            };
            this.loaded = progress.loaded;
            // Cursor is persisted only after its whole page has committed. Replay is an upsert.
            this.db.set(`catalog-progress:${scope}`, progress);
            this.changed();
            if (!progress.after) break;
            // One request at a time, plus jitter: startup on many tills must not stampede PostgreSQL.
            await this.wait(250 + Math.floor(Math.random() * 250));
          }
          this.phase = 'finalizing';
          this.changed();
          this.prunedAt = ++this.writes;
          await this.db.pruneCatalog(
            scope,
            progress.cycle,
            () => epoch === this.epoch,
          );
          this.check(epoch);
          cursor = progress.cursor;
          this.db.set(`catalog-cursor:${scope}`, cursor);
          this.db.set(`catalog-progress:${scope}`, null);
        }
        this.mode = 'delta';
        this.loaded = 0;
        // Bound each pump even during continuous import; the next tick resumes the persisted cursor.
        let complete = false;
        for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
          this.check(epoch);
          this.phase = 'downloading';
          this.changed();
          const params = new URLSearchParams({ cursor, limit: '250' });
          const page = await this.request<{
            products: unknown;
            deleted_ids: unknown;
            cursor: unknown;
            has_more: unknown;
            categories_changed: unknown;
            waiting_for_transactions?: unknown;
          }>(`/v1/pos/catalog/changes?${params}`, 5000);
          this.check(epoch);
          const products = this.products(page.products, 250);
          const deleted = z
            .array(z.string().uuid())
            .max(250)
            .safeParse(page.deleted_ids);
          const next = this.cursor(page.cursor);
          if (
            !deleted.success ||
            typeof page.has_more !== 'boolean' ||
            typeof page.categories_changed !== 'boolean' ||
            (page.waiting_for_transactions !== undefined &&
              typeof page.waiting_for_transactions !== 'boolean') ||
            (page.has_more && next === cursor) ||
            products.some((p) => deleted.data.includes(p.id))
          )
            throw new PosError(
              'POS_API_INVALID_RESPONSE',
              'Некорректный пакет изменений каталога.',
            );
          this.phase = 'saving';
          this.changed();
          await this.cache(products, epoch);
          if (deleted.data.length) {
            this.touch(deleted.data);
            this.misses.clear();
            await this.db.deleteProducts(
              scope,
              deleted.data,
              () => epoch === this.epoch,
            );
            this.check(epoch);
            this.revision = `${Date.now()}:${randomUUID()}`;
          }
          if (page.categories_changed)
            this.db.set(`categories-dirty:${scope}`, randomUUID());
          // A crash during apply replays the same batch. Never acknowledge a partially saved page.
          this.db.set(`catalog-cursor:${scope}`, next);
          this.pending = page.has_more;
          this.db.set(`catalog-pending:${scope}`, this.pending);
          cursor = next;
          this.waitingForTransactions = page.waiting_for_transactions === true;
          this.loaded += products.length + deleted.data.length;
          this.changed();
          if (!page.has_more) {
            complete = true;
            break;
          }
          await this.wait(250 + Math.floor(Math.random() * 250));
        }
        if (complete && !this.waitingForTransactions)
          this.db.set(`catalog:${scope}`, new Date().toISOString());
        this.error = null;
        this.failures = 0;
        this.nextRefresh =
          Date.now() +
          (complete ? 15_000 : 1000) +
          Math.floor(Math.random() * 5000);
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (
          error instanceof PosApiError &&
          error.code === 'POS_CATALOG_CURSOR_EXPIRED'
        ) {
          this.db.set(`catalog-cursor:${scope}`, null);
          this.db.set(`catalog-progress:${scope}`, null);
          this.mode = 'bootstrap';
        }
        this.failures++;
        this.nextRefresh =
          Date.now() +
          Math.max(
            error instanceof PosApiError ? error.retryAfterMs : 0,
            Math.min(300_000, 30_000 * 2 ** Math.min(this.failures - 1, 4)),
          ) +
          Math.floor(Math.random() * 5000);
        this.error =
          error instanceof PosApiError && [404, 410].includes(error.status)
            ? 'Требуется восстановление синхронизации или обновление backend. Локальные товары доступны; повторим автоматически.'
            : 'Фоновая загрузка каталога приостановлена. Локальные товары доступны; поиск отсутствующих выполняется отдельно.';
      } finally {
        if (epoch === this.epoch) {
          this.job = null;
          this.phase = null;
          this.changed();
        }
      }
    });
    this.job = job;
    this.changed();
    return job;
  }

  private cursor(value: unknown): string {
    if (typeof value !== 'string' || !/^[\w-]{1,1024}$/.test(value))
      throw new PosError(
        'POS_API_INVALID_RESPONSE',
        'Некорректный курсор синхронизации.',
      );
    return value;
  }

  private lookup(params: URLSearchParams): Promise<ProductResponse[]> {
    const key = params.toString();
    const shared = this.jobs.get(key);
    if (shared) return shared;
    if ((this.misses.get(key) ?? 0) > Date.now()) return Promise.resolve([]);
    if (this.jobs.size >= 4 || Date.now() < this.foregroundRetryAt)
      return Promise.reject(
        new PosError(
          'CATALOG_BUSY',
          'Сервер поиска занят. Локальные товары доступны; повторите этот поиск чуть позже.',
        ),
      );
    const epoch = this.epoch;
    const writes = this.writes;
    const job = (async () => {
      try {
        const result = await this.request<{ products: unknown }>(
          `/v1/pos/catalog/lookup?${params}`,
          5000,
        );
        this.check(epoch);
        const products = this.products(result.products, 2);
        if (
          products.some((p) =>
            params.has('product_id')
              ? p.id !== params.get('product_id')
              : p.barcode !== params.get('barcode') &&
                p.nkt?.gtin !== params.get('barcode'),
          )
        )
          throw new PosError(
            'POS_API_INVALID_RESPONSE',
            'Сервер вернул товар, не соответствующий запросу.',
          );
        if (!products.length) {
          if (this.misses.size >= 128)
            this.misses.delete(this.misses.keys().next().value!);
          this.misses.set(key, Date.now() + 10_000);
        }
        await this.cache(products, epoch, writes);
        return products.flatMap((p) => {
          const local = this.db.product(this.scope, p.id);
          return local &&
            (params.has('product_id') ||
              local.barcode === params.get('barcode') ||
              local.nkt?.gtin === params.get('barcode'))
            ? [local]
            : [];
        });
      } catch (error) {
        this.check(epoch);
        if (
          error instanceof PosConnectionError ||
          (error instanceof PosApiError &&
            (error.status >= 500 || error.status === 429))
        )
          this.foregroundRetryAt =
            Date.now() +
            Math.max(
              5000,
              error instanceof PosApiError ? error.retryAfterMs : 0,
            );
        throw error;
      } finally {
        if (epoch === this.epoch) {
          this.jobs.delete(key);
          if (!this.jobs.size && !this.searchJob) this.touched.clear();
          this.changed();
        }
      }
    })();
    this.jobs.set(key, job);
    this.changed();
    return job;
  }

  async product(id: string): Promise<ProductResponse | undefined> {
    const local = this.db.product(this.scope, id);
    if (local) return local;
    const products = await this.lookup(new URLSearchParams({ product_id: id }));
    if (products.some((p) => p.id !== id))
      throw new PosError(
        'POS_API_INVALID_RESPONSE',
        'Сервер вернул другой товар.',
      );
    return products[0];
  }
  async barcode(code: string): Promise<ProductResponse | undefined> {
    const local = this.db.barcode(this.scope, code);
    if (local) return local;
    const products = await this.lookup(new URLSearchParams({ barcode: code }));
    if (products.some((p) => p.barcode !== code && p.nkt?.gtin !== code))
      throw new PosError(
        'POS_API_INVALID_RESPONSE',
        'Сервер вернул другой штрихкод.',
      );
    if (products.length > 1)
      throw new PosError(
        'PRODUCT_BARCODE_AMBIGUOUS',
        'Код соответствует нескольким товарам. Выберите товар по названию.',
      );
    return products[0];
  }

  async search(
    term: string,
    category: string | undefined,
    limit: number,
    offset: number,
  ): Promise<ProductSearchResponse> {
    const epoch = this.epoch;
    const sequence = ++this.searchSequence;
    const local = this.db.search(this.scope, term, category, limit, offset);
    if (local.products.length) return local;
    // Only a local miss waits for the backend. Rapid text input does not issue one HTTP request per key.
    await this.wait(200);
    this.check(epoch);
    if (sequence !== this.searchSequence) return empty(limit, offset);
    if (offset > 1000) return local;
    // At most one text lookup is active; only the newest waiting term may follow it.
    if (this.searchJob) await this.searchJob.catch(() => undefined);
    this.check(epoch);
    if (sequence !== this.searchSequence) return empty(limit, offset);
    const hydrated = this.db.search(this.scope, term, category, limit, offset);
    if (hydrated.products.length) return hydrated;
    const params = new URLSearchParams({
      search: term,
      limit: String(limit),
      offset: String(offset),
    });
    if (category) params.set('category_id', category);
    if (Date.now() < this.foregroundRetryAt)
      throw new PosError(
        'CATALOG_BUSY',
        'Сервер поиска временно недоступен. Локальные товары доступны.',
      );
    const key = `search:${params}`;
    if ((this.misses.get(key) ?? 0) > Date.now()) return local;
    const job = (async () => {
      const writes = this.writes;
      try {
        const result = await this.request<ProductSearchResponse>(
          `/v1/pos/catalog/search?${params}`,
          5000,
        );
        this.check(epoch);
        const products = this.products(result.products, limit);
        if (category && products.some((p) => p.category_id !== category))
          throw new PosError(
            'POS_API_INVALID_RESPONSE',
            'Сервер вернул другую категорию.',
          );
        if (!result.meta || typeof result.meta.has_more !== 'boolean')
          throw new PosError(
            'POS_API_INVALID_RESPONSE',
            'Некорректный результат поиска.',
          );
        await this.cache(products, epoch, writes);
        if (writes !== this.writes)
          return this.db.search(this.scope, term, category, limit, offset);
        if (!products.length) {
          if (this.misses.size >= 128)
            this.misses.delete(this.misses.keys().next().value!);
          this.misses.set(key, Date.now() + 10_000);
        }
        return {
          products,
          meta: {
            limit,
            offset,
            has_more: result.meta.has_more,
            total: offset + products.length + Number(result.meta.has_more),
          },
        };
      } catch (error) {
        this.check(epoch);
        if (
          error instanceof PosConnectionError ||
          (error instanceof PosApiError &&
            (error.status >= 500 || error.status === 429))
        )
          this.foregroundRetryAt =
            Date.now() +
            Math.max(
              5000,
              error instanceof PosApiError ? error.retryAfterMs : 0,
            );
        throw error;
      } finally {
        if (epoch === this.epoch) {
          this.searchJob = null;
          if (!this.jobs.size) this.touched.clear();
          this.changed();
        }
      }
    })();
    this.searchJob = job;
    this.changed();
    return job;
  }
}
