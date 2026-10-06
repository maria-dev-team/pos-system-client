import { createHash, randomUUID } from 'node:crypto';

import type { CategoryResponse } from '../../shared/api/responses/category.response';
import type {
  ArchivedLocalSale,
  LocalSale,
  OfflineCredentials,
  PosConflict,
  PosProfile,
  PosRequest,
  PosResult,
  PosStatus,
  ProductResponse,
  SaleCommand,
  SaleResponse,
} from '../../shared/pos/contracts';
import { PosError } from '../../shared/pos/contracts';
import type { SyncStage } from '../../shared/pos/contracts';
import { parseGs1DataMatrix } from '../../shared/pos/gs1-data-matrix';
import {
  completeNonFiscalSale,
  nonFiscalAllowed,
  nonFiscalSignature,
} from '../../shared/pos/non-fiscal-sale';
import type { PendingReturnCommand } from '../../shared/pos/return-command';
import {
  applyCommand,
  draftPayload,
  newSale,
  requirePermission,
} from '../../shared/pos/sale';
import {
  fiscalShiftExpired,
  offlineGrantExpiresAt,
} from '../../shared/pos/session-policy';
import {
  PosApiError as ApiError,
  PosConnectionError,
  requestPosApi,
} from './pos-api-client';
import { assertAuthorizedPosSession } from './pos-authorization';
import { PosCatalog } from './pos-catalog';
import { PosDatabase } from './pos-database';
import {
  assertSaleAcknowledgement,
  canSync,
  isWorkingSale,
  pendingStage,
  syncFailure,
} from './pos-outbox';
import {
  type PaymentState,
  assertCompletedPayment,
  assertPaymentState,
} from './pos-payment-response';

const hash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
const networkError = (e: unknown): boolean =>
  e instanceof PosConnectionError || (e instanceof ApiError && e.status >= 500);
const moneySignature = (sale: SaleResponse): string =>
  JSON.stringify([
    sale.total,
    sale.discount_percentage,
    sale.items.map((i) => [
      i.product_id,
      i.quantity,
      i.unit_price,
      i.line_total,
      i.vat_rate,
      i.marking_code,
    ]),
  ]);

/** Application service. Only this layer coordinates domain, storage and remote work. */
export class PosService {
  private profile: PosProfile | null = null;
  private initialized = false;
  private token = '';
  private records = new Map<string, LocalSale>();
  private sequence = 0;
  private epoch = 0;
  private online = false;
  private lastError: string | null = null;
  private tokenRefreshRequired = false;
  private deferredRestoreJob: Promise<void> | null = null;
  private pendingCheckJob: Promise<void> | null = null;
  private readonly resuming = new Set<string>();
  private readonly archiving = new Set<string>();
  private syncJob: Promise<void> | null = null;
  private readonly draftSyncWaiters = new Set<() => void>();
  private syncingEpoch: number | null = null;
  private readonly catalog: PosCatalog;
  private categoriesJob: Promise<void> | null = null;
  private outboxRetryAt = 0;
  private outboxHardRetryAt = 0;
  private checkoutProbeAt = 0;
  private workspaceRevision = 0;
  private readonly sending = new Set<string>();
  private readonly reconciliations = new Map<
    string,
    Promise<SaleResponse | null>
  >();
  private verification: Promise<void> | null = null;
  private lastMaintenanceAt = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: PosDatabase,
    private readonly apiUrl: string,
    private readonly changed: () => void,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.catalog = new PosCatalog(
      db,
      (path, timeout) => this.api(path, undefined, timeout),
      changed,
    );
    this.timer = setInterval(() => {
      if (Date.now() - this.lastMaintenanceAt > 60_000) {
        this.lastMaintenanceAt = Date.now();
        try {
          this.db.pruneHistory();
        } catch {
          this.lastError =
            'Не удалось обслужить локальную историю. Проверьте свободное место на диске.';
          this.changed();
        }
      }
      if (this.profile && this.initialized) {
        void this.synchronize();
        void this.refreshCatalog();
        void this.refreshCategories();
        void this.verifyAuthorization().catch(() => {
          this.lastError =
            'Ошибка локального хранилища при проверке доступа. Не удаляйте данные кассы.';
          this.changed();
        });
        void this.checkPendingPayments();
      }
    }, 15_000);
    this.timer.unref();
  }
  private get scope(): string {
    const p = this.active();
    return `${p.session.organization_id}:${p.session.store_id}`;
  }
  private active(requireInitialized = true): PosProfile {
    const p = this.profile;
    const now = Date.now();
    const highwater = this.db.get<number>('clock') ?? 0;
    if (
      !p ||
      (requireInitialized && !this.initialized) ||
      !Number.isFinite(p.expiresAt) ||
      p.expiresAt <= now ||
      now < highwater - 60_000 ||
      p.session.status !== 'ACTIVE'
    ) {
      throw new PosError(
        'LOCAL_SESSION_EXPIRED',
        'Для продолжения работы подтвердите смену через интернет.',
      );
    }
    return p;
  }
  private save(record: LocalSale): void {
    const previous = this.records.get(record.sale.id);
    if (
      previous &&
      record.revision > previous.revision &&
      !record.syncFailures?.draft?.temporary
    )
      record.syncFailures = { ...record.syncFailures, draft: undefined };
    record.sale = { ...record.sale, local_revision: ++this.sequence };
    this.db.saveSaleWithClock(record, Date.now()); // Publish only after the durable commit succeeds.
    if (isWorkingSale(record)) this.records.set(record.sale.id, record);
    else this.records.delete(record.sale.id);
    for (const notify of this.draftSyncWaiters) notify();
    this.changed();
  }
  private async api<T>(
    path: string,
    body?: unknown,
    timeout = 10_000,
    token = this.token,
  ): Promise<T> {
    const epoch = this.epoch;
    try {
      return await requestPosApi<T>(
        this.fetcher,
        this.apiUrl,
        token,
        path,
        body,
        timeout,
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 403 &&
        epoch === this.epoch &&
        token === this.token
      ) {
        this.revoke();
        this.changed();
      }
      // Expired bearer credentials do not revoke a previously verified offline grant.
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        epoch === this.epoch &&
        token === this.token
      ) {
        this.tokenRefreshRequired = true;
        this.lastError =
          'Нужно обновить авторизацию. Локальные изменения сохраняются на кассе.';
        this.changed();
      }
      throw error;
    }
  }
  private assertEpoch(epoch: number): void {
    if (epoch !== this.epoch)
      throw new PosError('LOCAL_CONTEXT_CHANGED', 'Контекст кассы изменился.');
  }
  private restoreActiveCatalog(): void {
    if (this.initialized && this.profile && this.profile.expiresAt > Date.now())
      this.catalog.activate(
        this.profile.session.organization_id,
        this.profile.session.store_id,
      );
  }

  async connect(
    accessToken: string,
    registerId: string,
    forceOnline = false,
  ): Promise<PosProfile> {
    if (
      !forceOnline &&
      this.profile?.tokenHash === hash(accessToken) &&
      this.profile.session.register_id === registerId &&
      this.profile.register?.id === registerId &&
      this.initialized &&
      this.profile.expiresAt > Date.now()
    ) {
      this.active();
      return this.profile;
    }
    this.epoch++;
    this.catalog.stop();
    const epoch = this.epoch;
    const tokenHash = hash(accessToken);
    const cached = this.db.get<PosProfile>(
      `profile:${tokenHash}:${registerId}`,
    );
    let profile: PosProfile;
    try {
      if (
        !forceOnline &&
        cached &&
        cached.register?.id === registerId &&
        cached.expiresAt > Date.now() &&
        !this.db.get<boolean>(`revoked:${cached.session.id}`)
      ) {
        // The encrypted, token-bound offline grant is immediately usable on restart.
        assertAuthorizedPosSession(
          cached.context,
          cached.session,
          cached.shift,
          registerId,
        );
        profile = cached;
        this.online = false;
      } else {
        const [
          { context },
          { register },
          { cashier_session: session },
          { register_shift: shift },
        ] = await Promise.all([
          this.api<{ context: PosProfile['context'] }>(
            '/v1/auth/context',
            undefined,
            15000,
            accessToken,
          ),
          this.api<{ register: PosProfile['register'] }>(
            `/v1/registers/${registerId}`,
            undefined,
            15000,
            accessToken,
          ),
          this.api<{ cashier_session: PosProfile['session'] | null }>(
            `/v1/registers/${registerId}/cashier-sessions/current`,
            undefined,
            15000,
            accessToken,
          ),
          this.api<{ register_shift: PosProfile['shift'] | null }>(
            `/v1/register-shifts/current?register_id=${registerId}`,
            undefined,
            15000,
            accessToken,
          ),
        ]);
        this.assertEpoch(epoch);
        assertAuthorizedPosSession(context, session, shift, registerId);
        // The validator rejects null before these values are used.
        if (!session || !shift)
          throw new PosError(
            'CASHIER_SESSION_NOT_ACTIVE',
            'Смена кассира недоступна.',
          );
        profile = {
          context,
          register,
          session,
          shift,
          tokenHash,
          verifiedAt: Date.now(),
          expiresAt: offlineGrantExpiresAt(Date.now()),
        };
        this.db.set(`revoked:${session.id}`, false);
        this.online = true;
      }
    } catch (error) {
      this.assertEpoch(epoch);
      // A server rejection is never treated as an offline authorization grant.
      if (
        (error instanceof ApiError && error.status === 403) ||
        (error instanceof PosError &&
          error.code === 'CASHIER_SESSION_NOT_ACTIVE')
      ) {
        if (cached) this.db.set(`revoked:${cached.session.id}`, true);
        if (
          this.profile?.tokenHash === tokenHash &&
          this.profile.session.register_id === registerId
        )
          this.revoke();
      }
      this.restoreActiveCatalog();
      if (error instanceof PosConnectionError)
        throw new PosError('LOCAL_SESSION_UNAVAILABLE', error.message);
      throw error;
    }
    this.assertEpoch(epoch);
    if (
      this.profile &&
      this.profile.session.id !== profile.session.id &&
      this.db.get(`pending-return:${this.profile.session.id}`)
    )
      throw new PosError(
        'RETURN_PENDING',
        'Сначала проверьте возврат предыдущей смены.',
      );
    if (
      this.profile &&
      this.profile.session.id !== profile.session.id &&
      [...this.records.values()].some(
        (r) =>
          r.payment ||
          r.fiscalBlocked ||
          r.deferredPayment ||
          r.revision > r.syncedRevision,
      )
    ) {
      this.restoreActiveCatalog();
      throw new PosError(
        'SYNC_REQUIRED',
        'Сначала синхронизируйте чеки предыдущей кассы.',
      );
    }
    this.token = accessToken;
    this.tokenRefreshRequired = false;
    this.lastError = null;
    this.profile = profile;
    this.initialized = false;
    this.active(false);
    this.db.set(`profile:${tokenHash}:${registerId}`, profile);
    this.db.set(`last-register:${tokenHash}`, registerId);
    this.records = new Map(
      this.db.workingSales(profile.session.id).map((r) => [r.sale.id, r]),
    );
    this.outboxRetryAt =
      this.db.get<number>(`outbox-retry:${profile.session.id}`) ?? 0;
    this.outboxHardRetryAt =
      this.db.get<number>(`outbox-hard-retry:${profile.session.id}`) ?? 0;
    this.sequence = this.db.sequence(profile.session.id);
    for (const record of this.records.values())
      this.sequence = Math.max(
        this.sequence,
        record.sequence,
        record.sale.local_revision ?? 0,
      );
    for (const record of this.records.values()) {
      // PREPARING is persisted before sync; no payment request can have been sent at this stage.
      if (record.payment?.stage === 'PREPARING')
        this.save({ ...record, payment: null });
    }
    // Adopting old server drafts is required once, before accepting local commands.
    if (!this.db.get<boolean>(`adopted:${profile.session.id}`)) {
      const [{ sale }, { sales }] = await Promise.all([
        this.api<{ sale: SaleResponse | null }>('/v1/sales/current'),
        this.api<{ sales: { id: string }[] }>('/v1/sales/held'),
      ]);
      this.assertEpoch(epoch);
      if (sale) this.adopt(sale);
      for (const held of sales) {
        const result = await this.api<{ sale: SaleResponse }>(
          `/v1/sales/${held.id}`,
        );
        this.assertEpoch(epoch);
        this.adopt(result.sale);
      }
      this.db.set(`adopted:${profile.session.id}`, true);
    }
    this.initialized = true;
    this.db.set('resume-credentials', { accessToken, registerId });
    if (this.online) {
      for (const record of this.records.values()) {
        const failures = { ...record.syncFailures };
        let reset = false;
        for (const stage of ['draft', 'defer', 'nonFiscal'] as const)
          if (failures[stage]?.authorization) {
            delete failures[stage];
            reset = true;
          }
        if (reset)
          this.save({
            ...record,
            error: record.syncFailures?.draft?.authorization
              ? null
              : record.error,
            syncFailures: failures,
          });
      }
    }
    this.catalog.activate(
      profile.session.organization_id,
      profile.session.store_id,
    );
    for (const record of this.records.values())
      if (
        record.error === 'INVALID_TOKEN' ||
        record.error === 'INVALID_SESSION'
      )
        this.save({ ...record, error: null });
    void this.restoreDeferredPayments();
    void this.refreshCatalog(true);
    void this.refreshCategories();
    void this.synchronize();
    void this.verifyAuthorization().catch(() => {
      this.lastError =
        'Ошибка локального хранилища при проверке доступа. Не удаляйте данные кассы.';
      this.changed();
    });
    return profile;
  }

  private async verifyAuthorization(): Promise<void> {
    if (
      !this.profile ||
      !this.initialized ||
      this.verification ||
      Date.now() - this.profile.verifiedAt < 30_000
    )
      return;
    const epoch = this.epoch;
    const p = this.profile;
    this.verification = Promise.resolve().then(async () => {
      try {
        const [
          { context },
          { register },
          { cashier_session: session },
          { register_shift: shift },
        ] = await Promise.all([
          this.api<{ context: PosProfile['context'] }>('/v1/auth/context'),
          this.api<{ register: PosProfile['register'] }>(
            `/v1/registers/${p.session.register_id}`,
          ),
          this.api<{ cashier_session: PosProfile['session'] | null }>(
            `/v1/registers/${p.session.register_id}/cashier-sessions/current`,
          ),
          this.api<{ register_shift: PosProfile['shift'] | null }>(
            `/v1/register-shifts/current?register_id=${p.session.register_id}`,
          ),
        ]);
        this.assertEpoch(epoch);
        assertAuthorizedPosSession(
          context,
          session,
          shift,
          p.session.register_id,
        );
        if (
          !session ||
          session.id !== p.session.id ||
          session.status !== 'ACTIVE' ||
          !shift ||
          shift.id !== p.shift.id ||
          shift.status !== 'OPEN' ||
          context.organizationId !== p.context.organizationId ||
          context.storeId !== p.context.storeId ||
          context.userOrganizationId !== p.context.userOrganizationId
        ) {
          this.revoke();
          this.lastError = 'Доступ к смене отозван. Подтвердите вход в кассу.';
          return;
        }
        this.profile = {
          ...p,
          context,
          register,
          session,
          shift,
          verifiedAt: Date.now(),
          expiresAt: offlineGrantExpiresAt(Date.now()),
        };
        this.db.set(
          `profile:${p.tokenHash}:${p.session.register_id}`,
          this.profile,
        );
        this.online = true;
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (
          (error instanceof ApiError && error.status === 403) ||
          (error instanceof PosError &&
            error.code === 'CASHIER_SESSION_NOT_ACTIVE')
        ) {
          this.revoke();
          this.lastError = 'Сервер отклонил доступ к кассе. Подтвердите вход.';
        } else if (!(error instanceof ApiError && error.status === 401)) {
          this.online = false;
          if (error instanceof PosError) this.lastError = error.message;
        }
      } finally {
        this.verification = null;
        this.changed();
      }
    });
    return this.verification;
  }
  private adopt(sale: SaleResponse): void {
    if (
      sale.cashier_session_id !== this.profile?.session.id ||
      sale.organization_id !== this.profile.session.organization_id ||
      sale.store_id !== this.profile.session.store_id
    )
      throw new PosError('SALE_NOT_FOUND', 'Чек принадлежит другой кассе.');
    if (this.records.has(sale.id)) return;
    this.save({
      sale,
      revision: 0,
      syncedRevision: 0,
      serverVersion: sale.version,
      sequence: ++this.sequence,
      inFlight: null,
      payment: null,
      deferredPayment: !!sale.checkout_deferred_at && sale.status === 'DRAFT',
      deferSynced: !!sale.checkout_deferred_at,
      fiscalBlocked: !!sale.checkout_deferred_at && sale.status === 'DRAFT',
      error: null,
    });
  }
  private current(): LocalSale | undefined {
    return [...this.records.values()].find(
      (r) => r.sale.status === 'DRAFT' && !r.deferredPayment,
    );
  }

  private async restoreDeferredPayments(): Promise<void> {
    if (this.deferredRestoreJob || this.tokenRefreshRequired) return;
    const epoch = this.epoch;
    this.deferredRestoreJob = (async () => {
      try {
        requirePermission(this.active(), 'sales.read');
        const { sales } = await this.api<{ sales: SaleResponse[] }>(
          '/v1/sales/deferred-checkouts',
        );
        this.assertEpoch(epoch);
        if (!Array.isArray(sales))
          throw new PosError(
            'POS_API_INVALID_RESPONSE',
            'Backend не вернул очередь проверки чеков. Обновите backend.',
          );
        for (const sale of sales) this.adopt(sale);
      } catch (error) {
        if (
          epoch === this.epoch &&
          error instanceof ApiError &&
          error.status === 404
        )
          this.lastError =
            'Обновите backend: серверная очередь проверки чеков пока недоступна.';
      } finally {
        this.deferredRestoreJob = null;
      }
    })();
    return this.deferredRestoreJob;
  }

  private deferPayment(id: string): null {
    requirePermission(this.active(), 'sales.hold');
    const record = this.record(id);
    if (record.deferredPayment) return null;
    if (
      (!record.payment && !record.fiscalBlocked) ||
      record.payment?.stage === 'PREPARING'
    )
      throw new PosError(
        'PAYMENT_PENDING',
        'Перенос доступен после отправки оплаты. Обычный чек можно отложить.',
      );
    // Persist before freeing the workspace. This never cancels or repeats payment.
    this.db.set(
      `review-backup:${record.sale.cashier_session_id}:${id}:${record.sequence}`,
      record,
    );
    this.save({ ...record, deferredPayment: true, deferSynced: false });
    this.workspaceRevision++;
    void this.synchronize();
    return null;
  }

  private async resumePayment(id: string): Promise<SaleResponse> {
    this.workspaceRevision++;
    requirePermission(this.active(), 'sales.hold');
    if (this.resuming.has(id))
      throw new PosError('PAYMENT_PENDING', 'Возврат чека уже выполняется.');
    if (this.current())
      throw new PosError(
        'SALE_DRAFT_ALREADY_EXISTS',
        'Сначала отложите или завершите текущий чек.',
      );
    const epoch = this.epoch;
    this.resuming.add(id);
    try {
      const completed = await this.reconcilePayment(id, true);
      if (completed) return completed;
      const record = this.record(id);
      if (!record.deferredPayment || record.payment || record.fiscalBlocked)
        throw new PosError(
          'PAYMENT_UNCERTAIN',
          'Этот чек ещё ожидает подтверждения. Вы можете продолжать работу с другими чеками.',
        );
      await this.synchronize();
      this.assertEpoch(epoch);
      if (this.current())
        throw new PosError(
          'SALE_DRAFT_ALREADY_EXISTS',
          'Сначала отложите или завершите текущий чек.',
        );
      this.save({ ...this.record(id), deferSynced: false });
      const { sale } = await this.api<{ sale: SaleResponse }>(
        `/v1/sales/${id}/resume-checkout`,
        {},
        30_000,
      );
      this.assertEpoch(epoch);
      assertSaleAcknowledgement(sale, this.record(id));
      if (this.current())
        throw new PosError(
          'SALE_DRAFT_ALREADY_EXISTS',
          'Пока выполнялась проверка, появился новый чек. Предыдущий сохранён в очереди.',
        );
      this.save({
        ...this.record(id),
        sale,
        serverVersion: sale.version,
        deferredPayment: false,
        deferSynced: true,
        error: null,
      });
      return sale;
    } finally {
      this.resuming.delete(id);
      // A lost response may have moved the server draft. Reapply the durable
      // local placement before synchronizing any newly created draft.
      void this.synchronize();
    }
  }

  private async checkPendingPayments(recover = false): Promise<void> {
    if (this.pendingCheckJob) {
      await this.pendingCheckJob;
      if (!recover) return;
    }
    if (this.tokenRefreshRequired || !this.profile || !this.initialized) return;
    const epoch = this.epoch;
    this.pendingCheckJob = (async () => {
      for (const record of this.records.values()) {
        if (
          (!record.payment && !record.fiscalBlocked) ||
          this.sending.has(record.sale.id)
        )
          continue;
        try {
          this.active();
          await this.reconcilePayment(record.sale.id, recover);
        } catch (error) {
          if (epoch !== this.epoch) return;
          this.lastError =
            error instanceof PosError
              ? error.message
              : 'Не удалось проверить один из чеков. Повторите проверку позже.';
          if (this.tokenRefreshRequired) break;
        }
      }
    })();
    try {
      await this.pendingCheckJob;
    } finally {
      this.pendingCheckJob = null;
      this.changed();
    }
  }
  private record(id: string): LocalSale {
    const record =
      this.records.get(id) ??
      (this.profile ? this.db.sale(this.profile.session.id, id) : null);
    if (!record)
      throw new PosError('SALE_NOT_FOUND', 'Чек не найден на этой кассе.');
    return record;
  }
  private async refreshCatalog(force = false): Promise<void> {
    if (!this.profile || !this.initialized) return;
    try {
      requirePermission(this.active(), 'product.read');
      await this.catalog.refresh(force);
    } catch {
      /* Expired access must not initiate background reads. */
    }
  }

  private refreshCategories(): Promise<void> {
    const epoch = this.epoch;
    // Optional background work must not terminate the worker if even recording
    // its retry marker fails (disk full, I/O failure, corrupted metadata).
    return this.updateCategories().catch(() => {
      if (epoch !== this.epoch) return;
      this.lastError =
        'Не удалось обновить категории. Проверьте локальное хранилище; сохранённые товары доступны.';
      this.changed();
    });
  }

  private async updateCategories(): Promise<void> {
    if (!this.profile || !this.initialized || this.categoriesJob) return;
    const epoch = this.epoch;
    let scope: string;
    try {
      scope = this.scope;
    } catch {
      return;
    }
    const updated = this.db.get<number>(`categories-updated:${scope}`) ?? 0;
    const dirty = this.db.get<string>(`categories-dirty:${scope}`);
    const applied = this.db.get<string>(`categories-applied:${scope}`);
    const ready =
      this.db.get<CategoryResponse[]>(`categories:${scope}`) !== null;
    if (
      ready &&
      dirty === applied &&
      this.db.get<string>(`catalog-cursor:${scope}`)
    )
      return;
    if (Date.now() < (this.db.get<number>(`categories-retry:${scope}`) ?? 0))
      return;
    if (dirty === applied && Date.now() - updated < 5 * 60000) return;
    this.categoriesJob = Promise.resolve().then(async () => {
      try {
        if (
          this.profile!.context.isSystemPosition ||
          this.profile!.context.permissions.includes('category.read')
        ) {
          const categories: CategoryResponse[] = [];
          let complete = false;
          const seen = new Set<string>();
          for (let offset = 0; offset < 100000; offset += 100) {
            const page = await this.api<{
              categories: CategoryResponse[];
              meta: { has_more: boolean };
            }>(`/v1/categories?limit=100&offset=${offset}`);
            this.assertEpoch(epoch);
            if (
              !Array.isArray(page.categories) ||
              page.categories.length > 100 ||
              typeof page.meta?.has_more !== 'boolean' ||
              (!page.categories.length && page.meta.has_more) ||
              page.categories.some(
                (category) =>
                  !category ||
                  typeof category.id !== 'string' ||
                  category.organization_id !==
                    this.profile!.session.organization_id ||
                  !Array.isArray(category.children),
              )
            )
              throw new PosError(
                'POS_API_INVALID_RESPONSE',
                'Некорректная страница категорий. Предыдущие категории сохранены.',
              );
            for (const category of page.categories) {
              if (seen.has(category.id))
                throw new PosError(
                  'POS_API_INVALID_RESPONSE',
                  'Сервер повторяет страницу категорий.',
                );
              seen.add(category.id);
            }
            categories.push(...page.categories);
            if (!page.meta.has_more) {
              complete = true;
              break;
            }
          }
          if (!complete)
            throw new PosError(
              'POS_API_INVALID_RESPONSE',
              'Снимок категорий не завершён. Предыдущие категории сохранены.',
            );
          this.db.set(`categories:${scope}`, categories);
          this.db.set(`categories-updated:${scope}`, Date.now());
          this.db.set(`categories-applied:${scope}`, dirty);
          this.db.set(`categories-version:${scope}`, randomUUID());
        }
      } catch {
        // Categories are optional for barcode checkout. Retry slowly on failure.
        if (epoch === this.epoch)
          this.db.set(`categories-retry:${scope}`, Date.now() + 60_000);
      } finally {
        this.categoriesJob = null;
        this.changed();
      }
    });
    this.changed();
    return this.categoriesJob;
  }

  private async execute(command: SaleCommand): Promise<SaleResponse> {
    this.active();
    if (this.current()?.payment || this.current()?.fiscalBlocked)
      throw new PosError(
        'PAYMENT_UNCERTAIN',
        'Этот чек ожидает проверки оплаты. Перенесите его в очередь проверки, чтобы начать следующий чек.',
      );
    const epoch = this.epoch;
    const workspace = this.workspaceRevision;
    let product: ProductResponse | undefined;
    if (command.type === 'scan') {
      requirePermission(this.active(), 'product.read');
      const matrix = parseGs1DataMatrix(command.barcode);
      const code = matrix?.gtin ?? command.barcode;
      product =
        this.db.barcode(this.scope, code) ?? (await this.catalog.barcode(code));
      if (!product)
        throw new PosError(
          'PRODUCT_NOT_FOUND',
          'Товар не найден в каталоге магазина.',
        );
      command = {
        type: 'add',
        productId: product.id,
        ...(matrix ? { markingCode: matrix.markingCode } : {}),
      };
    } else if (command.type === 'add') {
      requirePermission(this.active(), 'product.read');
      product =
        this.db.product(this.scope, command.productId) ??
        (await this.catalog.product(command.productId));
    }
    this.assertEpoch(epoch);
    if (workspace !== this.workspaceRevision)
      throw new PosError(
        'LOCAL_CONTEXT_CHANGED',
        'Пока выполнялся поиск, рабочий чек изменился. Повторите сканирование для текущего чека.',
      );
    const profile = this.active();
    const current = this.current();
    if (current?.payment || current?.fiscalBlocked)
      throw new PosError(
        'PAYMENT_UNCERTAIN',
        'Этот чек ожидает проверки оплаты. Перенесите его в очередь проверки, чтобы начать следующий чек.',
      );
    const now = new Date().toISOString();
    const sale = applyCommand(
      current?.sale ?? newSale(profile, randomUUID(), now),
      command,
      profile,
      product,
      randomUUID(),
      now,
    );
    this.save({
      sale,
      revision: (current?.revision ?? 0) + 1,
      syncedRevision: current?.syncedRevision ?? 0,
      serverVersion: current?.serverVersion ?? 0,
      sequence: ++this.sequence,
      inFlight: current?.inFlight ?? null,
      syncFailures: current?.syncFailures,
      payment: null,
      error:
        current?.error &&
        [
          'SALE_VERSION_CONFLICT',
          'SALE_DRAFT_ALREADY_EXISTS',
          'SALE_NOT_EDITABLE',
        ].includes(current.error)
          ? current.error
          : null,
    });
    // Network work is coalesced by the background pump, not awaited by a scan.
    void this.synchronize();
    return this.record(sale.id).sale;
  }
  private transition(
    request: Extract<PosRequest, { type: 'transition' }>,
  ): SaleResponse {
    const profile = this.active();
    requirePermission(
      profile,
      request.action === 'cancel' ? 'sales.cancel' : 'sales.hold',
    );
    const record = this.record(request.saleId);
    if (record.payment || record.fiscalBlocked)
      throw new PosError(
        'PAYMENT_UNCERTAIN',
        'Сначала проверьте результат оплаты.',
      );
    if (!['DRAFT', 'HELD'].includes(record.sale.status))
      throw new PosError('SALE_NOT_EDITABLE', 'Чек уже завершён.');
    if (
      request.action === 'resume' &&
      (this.current() || record.sale.status !== 'HELD')
    )
      throw new PosError('SALE_DRAFT_ALREADY_EXISTS', 'Завершите текущий чек.');
    if (request.action === 'hold' && record.sale.status !== 'DRAFT')
      throw new PosError('SALE_NOT_EDITABLE', 'Чек уже отложен.');
    if (
      request.action === 'hold' &&
      [...this.records.values()].filter((r) => r.sale.status === 'HELD')
        .length >= 20
    )
      throw new PosError(
        'SALE_HELD_LIMIT_EXCEEDED',
        'Достигнут лимит отложенных чеков.',
      );
    if (request.action === 'cancel' && !request.reason)
      throw new PosError(
        'SALE_CANCELLATION_REASON_INVALID',
        'Укажите причину отмены.',
      );
    const now = new Date().toISOString();
    const sale: SaleResponse = {
      ...record.sale,
      status:
        request.action === 'hold'
          ? 'HELD'
          : request.action === 'resume'
            ? 'DRAFT'
            : 'CANCELLED',
      held_at: request.action === 'hold' ? now : null,
      updated_at: now,
      cancelled_at: request.action === 'cancel' ? now : null,
      cancelled_by_membership_id:
        request.action === 'cancel' ? profile.session.membership_id : null,
      cancellation_reason: request.reason ?? null,
    };
    this.save({
      ...record,
      sale,
      revision: record.revision + 1,
      sequence: ++this.sequence,
      // Cancelling a rejected draft creates a new snapshot. Conflicts still
      // require explicit comparison; a catalog rejection must not block cancellation.
      error:
        request.action === 'cancel' &&
        ![
          'SALE_VERSION_CONFLICT',
          'SALE_DRAFT_ALREADY_EXISTS',
          'SALE_NOT_EDITABLE',
        ].includes(record.error ?? '')
          ? null
          : record.error,
    });
    this.workspaceRevision++;
    void this.synchronize();
    return this.record(sale.id).sale;
  }
  private async synchronize(): Promise<void> {
    if (this.syncJob) return this.syncJob;
    if (!this.profile || !this.initialized || this.tokenRefreshRequired) return;
    if (Date.now() < this.outboxRetryAt) return;
    const epoch = this.epoch;
    this.syncJob = Promise.resolve().then(async () => {
      try {
        this.active();
        let deferredSent = 0;
        let preparing = [...this.records.values()].some(
          (r) => r.payment?.stage === 'PREPARING',
        );
        for (const record of this.records.values()) {
          // Finish the paying customer's draft before background queue maintenance.
          if (preparing) break;
          if (deferredSent >= 20) break;
          if (
            !record.deferredPayment ||
            record.deferSynced ||
            !canSync(record, 'defer') ||
            this.resuming.has(record.sale.id)
          )
            continue;
          this.syncingEpoch = epoch;
          deferredSent++;
          this.changed();
          try {
            const { sale } = await this.api<{ sale: SaleResponse }>(
              `/v1/sales/${record.sale.id}/defer-checkout`,
              {},
              30_000,
            );
            this.assertEpoch(epoch);
            const latest = this.record(record.sale.id);
            assertSaleAcknowledgement(sale, latest);
            const completed =
              sale.status === 'COMPLETED' && !!sale.fiscal_receipt;
            if (sale.status === 'COMPLETED')
              assertCompletedPayment(sale, latest);
            this.save({
              ...latest,
              sale,
              deferSynced: true,
              ...(completed
                ? {
                    payment: null,
                    fiscalBlocked: false,
                    deferredPayment: false,
                    error: null,
                  }
                : {}),
              serverVersion: sale.version,
              syncFailures: { ...latest.syncFailures, defer: undefined },
            });
          } catch (error) {
            this.assertEpoch(epoch);
            if (this.outboxFailed(record.sale.id, 'defer', error)) throw error;
          }
          preparing = [...this.records.values()].some(
            (r) => r.payment?.stage === 'PREPARING',
          );
        }
        if (this.resuming.size) return;
        for (let sent = 0; sent < 50; sent++) {
          this.assertEpoch(epoch);
          const record = [...this.records.values()]
            .filter(
              (r) =>
                r.revision > r.syncedRevision &&
                !this.archiving.has(r.sale.id) &&
                !r.error &&
                !r.deferredPayment &&
                canSync(r, pendingStage(r) ?? 'draft'),
            )
            .sort(
              (a, b) =>
                Number(!!b.nonFiscalCompletion) -
                  Number(!!a.nonFiscalCompletion) ||
                Number(b.payment?.stage === 'PREPARING') -
                  Number(a.payment?.stage === 'PREPARING') ||
                a.sequence - b.sequence,
            )[0];
          if (!record) break;
          if (record.nonFiscalCompletion && !record.inFlight) {
            await this.syncNonFiscalSale(record, epoch);
            continue;
          }
          const flight = record.inFlight ?? {
            commandId: randomUUID(),
            revision: record.revision,
            payload: {},
          };
          if (!record.inFlight) {
            flight.payload = draftPayload(
              record.sale,
              record.serverVersion,
              flight.commandId,
            );
            this.save({ ...record, inFlight: flight });
          }
          try {
            this.syncingEpoch = epoch;
            this.changed();
            const result = await this.api<{ sale: SaleResponse }>(
              '/v1/sales/local-draft',
              flight.payload,
              30_000,
            );
            this.assertEpoch(epoch);
            const latest = this.record(record.sale.id);
            assertSaleAcknowledgement(result?.sale, latest);
            if (
              result.sale.status !== flight.payload.status ||
              result.sale.version !==
                Number(flight.payload.expected_version) + 1
            )
              throw new PosError(
                'POS_API_INVALID_RESPONSE',
                'Ответ сервера не подтверждает отправленную версию чека. Команда сохранена.',
              );
            const matches = latest.revision === flight.revision;
            const sale = matches
              ? {
                  ...result.sale,
                  items: result.sale.items.map((i, index) => ({
                    ...i,
                    id: latest.sale.items[index]?.id ?? i.id,
                  })),
                }
              : latest.sale;
            this.save({
              ...latest,
              sale,
              serverVersion: result.sale.version,
              syncedRevision: flight.revision,
              inFlight: null,
              error: null,
              syncFailures: { ...latest.syncFailures, draft: undefined },
            });
            this.online = true;
            this.lastError = null;
          } catch (error) {
            this.assertEpoch(epoch);
            const latest = this.record(record.sale.id);
            const stop = this.outboxFailed(record.sale.id, 'draft', error);
            if (
              error instanceof ApiError &&
              error.status < 500 &&
              ![408, 425, 429].includes(error.status)
            ) {
              const superseded =
                !stop &&
                latest.revision > flight.revision &&
                !error.details.reconciliation_required &&
                ![
                  'SALE_VERSION_CONFLICT',
                  'SALE_DRAFT_ALREADY_EXISTS',
                  'SALE_NOT_EDITABLE',
                ].includes(error.code);
              this.save({
                ...latest,
                inFlight: null,
                error: superseded ? null : error.code,
                fiscalBlocked:
                  latest.fiscalBlocked ||
                  error.details.reconciliation_required === true,
                syncFailures: {
                  ...this.record(record.sale.id).syncFailures,
                  ...(superseded ? { draft: undefined } : {}),
                },
              });
              if (error.status === 403) this.revoke();
              // A receipt conflict must not starve unrelated drafts.
              if (!stop) continue;
            }
            if (stop) throw error;
          }
        }
      } catch (error) {
        if (epoch === this.epoch) {
          this.online = !networkError(error);
          this.lastError =
            error instanceof PosError
              ? error.message
              : 'Нет связи с сервером. Чеки сохранены на кассе.';
        }
      } finally {
        if (this.syncingEpoch === epoch) this.syncingEpoch = null;
        this.syncJob = null;
        this.changed();
      }
    });
    return this.syncJob;
  }
  private async syncNonFiscalSale(
    record: LocalSale,
    epoch: number,
  ): Promise<void> {
    const completion = record.nonFiscalCompletion!;
    const payload = completion.payload ?? {
      ...draftPayload(
        { ...record.sale, status: 'DRAFT' },
        record.serverVersion,
        completion.commandId,
      ),
      completed_at: record.sale.completed_at,
      total: record.sale.total,
      snapshot_signature: completion.snapshotSignature,
      payments: completion.request.payments,
    };
    if (!completion.payload)
      this.save({ ...record, nonFiscalCompletion: { ...completion, payload } });
    this.syncingEpoch = epoch;
    this.changed();
    try {
      const { sale } = await this.api<{ sale: SaleResponse }>(
        '/v1/sales/local-non-fiscal',
        payload,
        30_000,
      );
      this.assertEpoch(epoch);
      const latest = this.record(record.sale.id);
      assertCompletedPayment(sale, latest);
      const paymentSignature = (value: SaleResponse): string =>
        JSON.stringify(
          value.payments
            .map((p) => [
              p.method,
              p.status,
              p.direction,
              p.amount,
              p.received,
              p.change,
            ])
            .sort(),
        );
      if (
        sale.fiscalization_mode !== 'NON_FISCAL' ||
        sale.fiscal_receipt ||
        nonFiscalSignature(sale) !== completion.snapshotSignature ||
        Date.parse(sale.completed_at ?? '') !==
          Date.parse(record.sale.completed_at!) ||
        paymentSignature(sale) !== paymentSignature(record.sale)
      )
        throw new PosError(
          'POS_API_INVALID_RESPONSE',
          'Сервер не подтвердил сохранённую нефискальную продажу. Чек остаётся на кассе.',
        );
      this.save({
        ...latest,
        sale: { ...latest.sale, version: sale.version },
        serverVersion: sale.version,
        syncedRevision: latest.revision,
        error: null,
        nonFiscalCompletion: {
          ...latest.nonFiscalCompletion!,
          synced: true,
          serverSale: sale,
        },
        syncFailures: { ...latest.syncFailures, nonFiscal: undefined },
      });
      this.online = true;
      this.lastError = null;
    } catch (error) {
      this.assertEpoch(epoch);
      if (
        error instanceof ApiError &&
        error.details.local_non_fiscal_policy_conflict
      ) {
        this.outboxFailed(
          record.sale.id,
          'nonFiscal',
          new PosError(
            'NON_FISCAL_POLICY_CONFLICT',
            'Нефискальная продажа сохранена на кассе. Настройки сервера требуют фискализацию: проверьте настройки кассы. Автоматическая фискализация не выполняется.',
          ),
        );
        return;
      }
      if (
        error instanceof ApiError &&
        error.details.local_non_fiscal_snapshot_conflict
      ) {
        this.outboxFailed(
          record.sale.id,
          'nonFiscal',
          new PosError(
            'NON_FISCAL_SNAPSHOT_CONFLICT',
            'Нефискальная продажа сохранена на кассе. Цены, налоги или время отличаются от данных сервера. Нужна сверка; оплаченная сумма не изменена.',
          ),
        );
        return;
      }
      if (this.outboxFailed(record.sale.id, 'nonFiscal', error)) throw error;
    }
  }

  private outboxFailed(id: string, stage: SyncStage, error: unknown): boolean {
    const latest = this.record(id);
    const failure = syncFailure(error, latest.syncFailures?.[stage]);
    this.save({
      ...latest,
      syncFailures: { ...latest.syncFailures, [stage]: failure },
    });
    const transportFailure =
      error instanceof PosConnectionError ||
      (error instanceof ApiError && failure.temporary);
    if (transportFailure) {
      if (error instanceof ApiError && error.retryAfterMs) {
        this.outboxHardRetryAt = Date.now() + error.retryAfterMs;
        this.db.set(
          `outbox-hard-retry:${this.profile!.session.id}`,
          this.outboxHardRetryAt,
        );
      }
      this.outboxRetryAt = failure.nextAttemptAt!;
      this.db.set(
        `outbox-retry:${this.profile!.session.id}`,
        this.outboxRetryAt,
      );
    }
    if (error instanceof ApiError && error.status === 403) this.revoke();
    // Back off the whole transport on an outage; isolate definitive per-receipt rejections.
    return (
      transportFailure ||
      (error instanceof ApiError && [401, 403].includes(error.status))
    );
  }
  private revoke(): void {
    if (!this.profile) return;
    this.profile.expiresAt = 0;
    this.db.set(`revoked:${this.profile.session.id}`, true);
    this.db.set(
      `profile:${this.profile.tokenHash}:${this.profile.session.register_id}`,
      null,
    );
  }
  private async reconcilePayment(
    id: string,
    recover = false,
  ): Promise<SaleResponse | null> {
    const pending = this.reconciliations.get(id);
    if (pending) {
      const result = await pending;
      if (!recover || result) return result;
    }
    const current = this.reconciliations.get(id);
    if (current) return current;
    const job = this.reconcilePaymentState(id, recover);
    this.reconciliations.set(id, job);
    try {
      return await job;
    } finally {
      if (this.reconciliations.get(id) === job) this.reconciliations.delete(id);
    }
  }
  private async reconcilePaymentState(
    id: string,
    recover: boolean,
  ): Promise<SaleResponse | null> {
    if (this.sending.has(id)) return null;
    if (this.record(id).payment?.stage === 'PREPARING') return null;
    const epoch = this.epoch;
    let result = await this.api<PaymentState>(`/v1/sales/${id}/checkout-state`);
    this.assertEpoch(epoch);
    assertPaymentState(result, this.record(id));
    if (
      recover &&
      !result.retry_safe &&
      result.sale.status === 'DRAFT' &&
      (this.active().context.isSystemPosition ||
        this.active().context.permissions.includes('sales.complete'))
    ) {
      result = await this.api<PaymentState>(
        `/v1/sales/${id}/reconcile`,
        {},
        75_000,
      );
      this.assertEpoch(epoch);
      assertPaymentState(result, this.record(id));
    }
    let sale = result.sale;
    const { retry_safe: retrySafe, replay_ready: replayReady } = result;
    this.assertEpoch(epoch);
    const intent = this.record(id).payment;
    if (replayReady && intent && !this.sending.has(id)) {
      this.sending.add(id);
      try {
        sale = await this.sendPayment(id, intent.request);
        this.assertEpoch(epoch);
      } finally {
        this.sending.delete(id);
      }
    }
    if (sale.status !== 'COMPLETED') {
      if (retrySafe)
        this.save({
          ...this.record(id),
          payment: null,
          fiscalBlocked: false,
          error: null,
        });
      return null;
    }
    const record = this.record(id);
    this.lastError = null;
    this.online = true;
    this.save({
      ...record,
      sale,
      payment: null,
      serverVersion: sale.version,
      syncedRevision: record.revision,
      deferredPayment: false,
      fiscalBlocked: false,
      error: null,
      inFlight: null,
    });
    return sale;
  }
  private async checkout(
    request: Extract<PosRequest, { type: 'checkout' }>,
  ): Promise<SaleResponse> {
    this.workspaceRevision++;
    requirePermission(this.active(), 'sales.complete');
    let record = this.record(request.saleId);
    if (record.nonFiscalCompletion) {
      if (
        JSON.stringify(request) !==
        JSON.stringify(record.nonFiscalCompletion.request)
      )
        throw new PosError(
          'SALE_NOT_EDITABLE',
          'Нефискальная продажа уже сохранена.',
        );
      return record.sale;
    }
    if (record.payment || record.fiscalBlocked) {
      if (
        record.payment?.stage === 'PREPARING' ||
        this.sending.has(request.saleId)
      )
        throw new PosError(
          'PAYMENT_PENDING',
          'Дождитесь результата текущей оплаты.',
        );
      const completed = await this.reconcilePayment(request.saleId, true);
      if (completed) return completed;
      if (
        this.record(request.saleId).payment ||
        this.record(request.saleId).fiscalBlocked
      )
        throw new PosError(
          'PAYMENT_UNCERTAIN',
          'Результат оплаты пока неизвестен. Повторите проверку или перенесите этот чек в очередь и начните следующий.',
        );
      throw new PosError(
        'PAYMENT_RETRY_SAFE',
        'Сервер подтвердил возможность безопасного повтора. Проверьте оплату и подтвердите ещё раз.',
      );
    }
    if (record.sale.status !== 'DRAFT' || !record.sale.items.length)
      throw new PosError('SALE_NOT_EDITABLE', 'Чек уже завершён.');
    if (nonFiscalAllowed(this.active(), request)) {
      const sale = completeNonFiscalSale(
        record.sale,
        request,
        new Date().toISOString(),
        randomUUID,
      );
      this.save({
        ...record,
        sale,
        revision: record.revision + 1,
        nonFiscalCompletion: {
          commandId: randomUUID(),
          request,
          snapshotSignature: nonFiscalSignature(sale),
        },
        error: null,
        syncFailures: record.inFlight ? record.syncFailures : undefined,
      });
      void this.synchronize();
      return this.record(sale.id).sale;
    }
    if (request.fiscalizationMode === 'NON_FISCAL')
      throw new PosError(
        'SALE_NOT_EDITABLE',
        'Настройки кассы требуют фискализацию.',
      );
    // Shift age warns in the UI. The backend/KKM decides whether a checkout
    // can be fiscalized; the client never fabricates a successful payment.
    const signature = moneySignature(record.sale);
    const preparationEpoch = this.epoch;
    // Freeze edits durably before syncing this draft or starting any external operation.
    this.save({ ...record, payment: { request, stage: 'PREPARING' } });
    try {
      await this.synchronizeForCheckout(request.saleId);
      this.assertEpoch(preparationEpoch);
      requirePermission(this.active(), 'sales.complete');
      record = this.record(request.saleId);
      if (record.revision !== record.syncedRevision || record.error)
        throw new PosError(
          'SYNC_REQUIRED',
          'Не удалось синхронизировать чек. Проверьте соединение и статус синхронизации.',
        );
      if (
        record.sale.total !== request.total ||
        signature !== moneySignature(record.sale)
      )
        throw new PosError(
          'PRICE_CHANGED',
          'Сервер уточнил цены или налоги. Проверьте обновлённый чек и подтвердите оплату ещё раз.',
        );
    } catch (error) {
      this.assertEpoch(preparationEpoch);
      this.save({ ...this.record(request.saleId), payment: null });
      throw error;
    }
    const epoch = this.epoch;
    this.save({
      ...this.record(request.saleId),
      payment: { request, stage: 'SENT' },
    });
    this.sending.add(record.sale.id);
    try {
      const sale = await this.sendPayment(record.sale.id, request);
      this.assertEpoch(epoch);
      if (sale.status !== 'COMPLETED')
        throw new PosError(
          'PAYMENT_UNCERTAIN',
          'Сервер не подтвердил завершение оплаты.',
        );
      this.save({
        ...this.record(record.sale.id),
        sale,
        payment: null,
        serverVersion: sale.version,
      });
      return sale;
    } catch (error) {
      this.sending.delete(record.sale.id);
      this.assertEpoch(epoch);
      // HTTP status alone cannot prove whether the provider accepted a fiscal request.
      // Only checkout-state, read under the sale lock, may unlock an unsuccessful attempt.
      try {
        const sale = await this.reconcilePayment(record.sale.id);
        if (sale) return sale;
      } catch {
        /* Keep the durable payment intent. */
      }
      if (!this.record(record.sale.id).payment) throw error;
      throw new PosError(
        'PAYMENT_UNCERTAIN',
        'Подтверждение оплаты не получено. Чек сохранён. Повторите проверку или перенесите его в очередь и начните следующий чек.',
      );
    } finally {
      this.sending.delete(record.sale.id);
    }
  }
  private async synchronizeForCheckout(id: string): Promise<void> {
    const now = Date.now();
    // One bounded half-open probe for a foreground customer, never bypass Retry-After.
    if (
      !this.syncJob &&
      now >= this.checkoutProbeAt &&
      now >= this.outboxHardRetryAt
    ) {
      this.checkoutProbeAt = now + 5000;
      this.outboxRetryAt = 0;
      const current = this.record(id);
      if (current.syncFailures?.draft?.temporary)
        this.save({
          ...current,
          syncFailures: { ...current.syncFailures, draft: undefined },
        });
    }
    const settled = (): boolean => {
      const record =
        this.records.get(id) ??
        (this.profile ? this.db.sale(this.profile.session.id, id) : null);
      return (
        !record || !!record.error || record.revision === record.syncedRevision
      );
    };
    // Scanning normally syncs this draft in advance. Do not wait for other receipts.
    if (settled()) return;
    let notify!: () => void;
    const ready = new Promise<void>((resolve) => {
      notify = () => {
        if (settled()) resolve();
      };
      this.draftSyncWaiters.add(notify);
    });
    try {
      // Stop waiting as soon as this receipt is acknowledged. A stopped pump
      // (network backoff, authorization, validation) is checked by checkout too.
      await Promise.race([ready, this.synchronize()]);
    } finally {
      this.draftSyncWaiters.delete(notify);
    }
  }
  private async sendPayment(
    id: string,
    request: Extract<PosRequest, { type: 'checkout' }>,
  ): Promise<SaleResponse> {
    const epoch = this.epoch;
    const record = this.record(id);
    const { sale } = await this.api<{ sale: SaleResponse }>(
      `/v1/sales/${id}/checkout`,
      {
        expected_version: this.record(id).serverVersion,
        fiscalization_mode: request.fiscalizationMode ?? 'FISCAL',
        payments: request.payments,
        ...(request.buyerBinIin ? { buyer_bin_iin: request.buyerBinIin } : {}),
      },
      75_000,
    );
    this.assertEpoch(epoch);
    assertCompletedPayment(sale, record);
    return sale;
  }
  private canArchiveCancelledSale(record: LocalSale): boolean {
    return (
      record.sale.status === 'CANCELLED' &&
      record.revision > record.syncedRevision &&
      !record.inFlight &&
      !record.payment &&
      !record.fiscalBlocked &&
      !record.deferredPayment &&
      !record.sale.fiscal_receipt &&
      !record.sale.payments.some((payment) => payment.status !== 'CANCELLED')
    );
  }

  private async archiveCancelledSale(id: string): Promise<PosStatus> {
    const profile = this.active();
    requirePermission(profile, 'sales.cancel');
    requirePermission(profile, 'sales.read');
    if (this.archiving.has(id))
      throw new PosError(
        'LOCAL_OPERATION_PENDING',
        'Дождитесь завершения проверки чека.',
      );
    if (
      !this.records.has(id) &&
      this.db.get<ArchivedLocalSale>(`sale-archive:${profile.session.id}:${id}`)
    )
      return this.status();
    const record = this.record(id);
    if (!this.canArchiveCancelledSale(record))
      throw new PosError(
        'SALE_NOT_ARCHIVABLE',
        'Можно убрать только отменённый чек без отправляемой команды и неподтверждённой оплаты. Дождитесь отправки или проверьте оплату.',
      );
    const epoch = this.epoch;
    this.archiving.add(id);
    this.changed();
    try {
      let remote: SaleResponse | null;
      try {
        const response = await this.api<{ sale: SaleResponse }>(
          `/v1/sales/${id}`,
        );
        this.assertEpoch(epoch);
        assertSaleAcknowledgement(response.sale, record);
        remote = response.sale;
      } catch (error) {
        // A timeout or generic proxy 404 is not evidence that the sale is absent.
        if (!(
          error instanceof ApiError &&
          error.status === 404 &&
          error.code === 'SALE_NOT_FOUND'
        ))
          throw error;
        remote = null;
      }
      this.assertEpoch(epoch);
      if (remote) {
        if (
          remote.status === 'COMPLETED' ||
          remote.fiscal_receipt ||
          remote.payments.some((payment) => payment.status !== 'CANCELLED')
        )
          throw new PosError(
            'PAYMENT_UNCERTAIN',
            'На сервере есть оплата этого чека. Его нельзя убрать из очереди без сверки.',
          );
        if (remote.status !== 'CANCELLED') {
          const result = await this.api<{ sale: SaleResponse }>(
            `/v1/sales/${id}/cancel`,
            {
              expected_version: remote.version,
              reason:
                record.sale.cancellation_reason ??
                'Отмена локального чека: исключён из очереди отправки',
            },
            30_000,
          );
          this.assertEpoch(epoch);
          assertSaleAcknowledgement(result.sale, record);
          if (
            result.sale.status !== 'CANCELLED' ||
            result.sale.fiscal_receipt ||
            result.sale.payments.some(
              (payment) => payment.status !== 'CANCELLED',
            )
          )
            throw new PosError(
              'POS_API_INVALID_RESPONSE',
              'Сервер не подтвердил отмену. Чек сохранён в очереди.',
            );
          remote = result.sale;
        }
      }
      const latest = this.record(id);
      if (latest.sale.local_revision !== record.sale.local_revision)
        throw new PosError(
          'SALE_VERSION_CONFLICT',
          'Чек изменился во время проверки. Повторите действие.',
        );
      this.db.archiveSale({
        record: latest,
        archivedAt: new Date().toISOString(),
        archivedByMembershipId: profile.session.membership_id,
        serverSale: remote,
      });
      this.records.delete(id);
      if (
        ![...this.records.values()].some(
          (r) => pendingStage(r) || r.payment || r.fiscalBlocked,
        )
      )
        this.lastError = null;
      void this.synchronize();
      return this.status();
    } finally {
      this.archiving.delete(id);
      this.changed();
    }
  }

  private status(): PosStatus {
    const records = [...this.records.values()];
    const catalog = this.profile
      ? this.db.get<string>(
          `catalog:${this.profile.session.organization_id}:${this.profile.session.store_id}`,
        )
      : null;
    return {
      ...this.catalog.status(),
      sessionId: this.profile?.session.id ?? null,
      syncing: this.syncingEpoch === this.epoch,
      categoriesSyncing: !!this.categoriesJob,
      categoriesRevision: this.profile
        ? this.db.get<string>(
            `categories-version:${this.profile.session.organization_id}:${this.profile.session.store_id}`,
          )
        : null,
      conflicts: records
        .filter(
          (r) =>
            !r.nonFiscalCompletion &&
            !r.fiscalBlocked &&
            r.error &&
            [
              'SALE_VERSION_CONFLICT',
              'SALE_DRAFT_ALREADY_EXISTS',
              'SALE_NOT_EDITABLE',
            ].includes(r.error),
        )
        .map((r) => ({ saleId: r.sale.id, total: r.sale.total })),
      connected: this.online,
      pending: records.filter(
        (r) =>
          r.revision > r.syncedRevision ||
          (r.deferredPayment && !r.deferSynced),
      ).length,
      outbox: records
        .filter((r) => pendingStage(r))
        .sort((a, b) => a.sequence - b.sequence)
        .slice(0, 50)
        .map((r) => {
          const stage = pendingStage(r)!;
          const failure = r.syncFailures?.[stage];
          return {
            saleId: r.sale.id,
            saleStatus: r.sale.status,
            total: r.sale.total,
            stage,
            code: failure?.code ?? r.error,
            message: failure?.message ?? null,
            attempts: failure?.attempts ?? 0,
            nextAttemptAt: failure?.nextAttemptAt ?? null,
            retryable: !r.fiscalBlocked && !r.payment,
            archivable:
              this.canArchiveCancelledSale(r) &&
              Boolean(
                this.profile?.context.isSystemPosition ||
                (this.profile?.context.permissions.includes('sales.cancel') &&
                  this.profile.context.permissions.includes('sales.read')),
              ),
          };
        }),
      catalogReady: !!catalog,
      catalogUpdatedAt: catalog,
      error: this.lastError,
      paymentPending: records.some((r) => !!r.payment || !!r.fiscalBlocked),
      paymentReviews: records
        .filter((r) => r.payment || r.fiscalBlocked || r.deferredPayment)
        .map((r) => ({
          saleId: r.sale.id,
          total: r.sale.total,
          deferred: !!r.deferredPayment,
          canResume: !!r.deferredPayment && !r.payment && !r.fiscalBlocked,
        })),
      tokenRefreshRequired: this.tokenRefreshRequired,
      authorizationRequired:
        !!this.profile &&
        (this.tokenRefreshRequired || this.profile.expiresAt <= Date.now()),
      fiscalShiftExpired:
        !!this.profile && fiscalShiftExpired(this.profile.shift.opened_at),
    };
  }
  async handle(request: PosRequest): Promise<PosResult> {
    if (request.type === 'diagnostics') return this.db.diagnostics();
    if (request.type === 'restoreCredentials') {
      const credentials = this.db.get<OfflineCredentials>('resume-credentials');
      if (!credentials) return null;
      const p = this.db.get<PosProfile>(
        `profile:${hash(credentials.accessToken)}:${credentials.registerId}`,
      );
      if (
        !p ||
        p.expiresAt <= Date.now() ||
        !Number.isFinite(p.expiresAt) ||
        p.session.status !== 'ACTIVE' ||
        this.db.get(`revoked:${p.session.id}`) ||
        Date.now() < (this.db.get<number>('clock') ?? 0) - 60_000
      )
        return null;
      assertAuthorizedPosSession(
        p.context,
        p.session,
        p.shift,
        credentials.registerId,
      );
      return credentials;
    }
    if (request.type === 'restartWorker')
      throw new PosError(
        'INVALID_REQUEST',
        'Перезапуск выполняется главным процессом.',
      );
    if (request.type === 'connect')
      return this.connect(
        request.accessToken,
        request.registerId,
        request.forceOnline,
      );
    if (request.type === 'restore') {
      const register = this.db.get<string>(
        `last-register:${hash(request.accessToken)}`,
      );
      return register ? this.connect(request.accessToken, register) : null;
    }
    if (request.type === 'disconnect') {
      if (
        this.profile &&
        this.db.get(`pending-return:${this.profile.session.id}`)
      )
        throw new PosError(
          'RETURN_PENDING',
          'Сначала проверьте неподтверждённый возврат.',
        );
      if (
        [...this.records.values()].some(
          (r) =>
            r.revision > r.syncedRevision ||
            r.payment ||
            r.fiscalBlocked ||
            r.deferredPayment,
        )
      )
        throw new PosError(
          'SYNC_REQUIRED',
          'Сначала синхронизируйте чеки и проверьте оплаты.',
        );
      if (this.profile)
        this.db.set(
          `profile:${this.profile.tokenHash}:${this.profile.session.register_id}`,
          null,
        );
      this.db.set('resume-credentials', null);
      this.epoch++;
      this.catalog.stop();
      this.token = '';
      this.profile = null;
      this.initialized = false;
      this.records.clear();
      this.changed();
      return null;
    }
    if (request.type === 'status') return this.status();
    this.active();
    switch (request.type) {
      case 'pendingReturn':
      case 'savePendingReturn':
      case 'clearPendingReturn': {
        if (request.sessionId !== this.active().session.id)
          throw new PosError(
            'LOCAL_CONTEXT_CHANGED',
            'Возврат относится к другой смене.',
          );
        const key = `pending-return:${request.sessionId}`;
        const current = this.db.get<PendingReturnCommand>(key);
        if (request.type === 'pendingReturn') return current;
        if (request.type === 'savePendingReturn') {
          if (
            request.command.type === 'receipt' &&
            request.command.endpoint !==
              `/v1/returns/receipts/${request.command.receiptNumber}`
          )
            throw new PosError(
              'INVALID_REQUEST',
              'Некорректная команда возврата.',
            );
          if (
            current &&
            JSON.stringify(current) !== JSON.stringify(request.command)
          )
            throw new PosError(
              'RETURN_PENDING',
              'Сначала проверьте сохранённый возврат.',
            );
          this.db.set(key, request.command);
          return request.command;
        }
        if (current?.idempotencyKey === request.commandId)
          this.db.set(key, null);
        return null;
      }
      case 'archiveCancelledSale':
        return this.archiveCancelledSale(request.saleId);
      case 'deferPayment':
        return this.deferPayment(request.saleId);
      case 'resumePayment':
        return this.resumePayment(request.saleId);
      case 'reconcilePayment':
        return this.reconcilePayment(request.saleId, true);
      case 'conflict':
        return this.conflict(request.saleId);
      case 'resolveConflict':
        return this.resolveConflict(request);
      case 'current':
        return this.current()?.sale ?? null;
      case 'localReceipts':
        requirePermission(this.active(), 'sales.read');
        return this.db
          .localReceipts(this.active().session.id, request.offset ?? 0)
          .map((r) => r.sale);
      case 'sale':
        return this.record(request.saleId).sale;
      case 'held':
        return [...this.records.values()]
          .filter((r) => r.sale.status === 'HELD')
          .map(({ sale }) => ({
            ...sale,
            status: 'HELD' as const,
            held_at: sale.held_at!,
            items_count: sale.items.length,
          }));
      case 'execute':
        return this.execute(request.command);
      case 'transition':
        if (
          this.record(request.saleId).payment ||
          this.record(request.saleId).fiscalBlocked
        )
          await this.reconcilePayment(request.saleId);
        return this.transition(request);
      case 'search':
        requirePermission(this.active(), 'product.read');
        return this.catalog.search(
          request.search?.trim() ?? '',
          request.categoryId,
          request.limit ?? 20,
          request.offset ?? 0,
          request.quickOnly,
        );
      case 'categories': {
        requirePermission(this.active(), 'category.read');
        const categories =
          this.db.get<CategoryResponse[]>(`categories:${this.scope}`) ?? [];
        const limit = request.limit ?? 100,
          offset = request.offset ?? 0;
        return {
          categories: categories.slice(offset, offset + limit),
          meta: {
            limit,
            offset,
            total: categories.length,
            has_more: offset + limit < categories.length,
          },
        };
      }
      case 'retry':
        await this.checkPendingPayments(true);
        // Safe replay uses the SAME command id and payload, including after a crash.
        for (const record of this.records.values())
          if (
            record.error &&
            !this.archiving.has(record.sale.id) &&
            (['INVALID_TOKEN', 'UNAUTHORIZED'].includes(record.error) ||
              (record.sale.status === 'CANCELLED' &&
                [
                  'PRODUCT_NOT_FOUND',
                  'PRODUCT_NOT_ACTIVE',
                  'PRODUCT_NOT_SELLABLE',
                ].includes(record.error))) &&
            !record.fiscalBlocked &&
            !record.payment
          )
            this.save({ ...record, error: null, syncFailures: undefined });
        await this.synchronize();
        void this.refreshCatalog(true);
        void this.restoreDeferredPayments();
        if (this.status().paymentPending)
          this.lastError = `Оплата не подтверждена. Нужна сверка с ККМ; ID чека: ${[
            ...this.records.values(),
          ]
            .filter((r) => r.payment || r.fiscalBlocked)
            .map((r) => r.sale.id)
            .join(', ')}.`;
        return this.status();
      case 'retrySale': {
        this.active();
        if (this.archiving.has(request.saleId))
          throw new PosError(
            'LOCAL_OPERATION_PENDING',
            'Дождитесь завершения проверки чека.',
          );
        const record = this.record(request.saleId);
        if (record.fiscalBlocked || record.payment)
          throw new PosError(
            'PAYMENT_UNCERTAIN',
            'Сначала проверьте результат оплаты этого чека.',
          );
        if (
          record.error &&
          !record.nonFiscalCompletion &&
          [
            'SALE_VERSION_CONFLICT',
            'SALE_DRAFT_ALREADY_EXISTS',
            'SALE_NOT_EDITABLE',
          ].includes(record.error)
        )
          throw new PosError(
            record.error,
            'Откройте сравнение чека с сервером и разрешите расхождение.',
          );
        const stage = pendingStage(record);
        if (stage) {
          const failure = record.syncFailures?.[stage];
          if (!failure?.temporary)
            this.save({
              ...record,
              error: null,
              syncFailures: { ...record.syncFailures, [stage]: undefined },
            });
        }
        await this.synchronize();
        return this.status();
      }
      case 'prepareCashMovement':
      case 'flush':
        if (this.db.get(`pending-return:${this.active().session.id}`))
          throw new PosError(
            'RETURN_PENDING',
            'Сначала проверьте неподтверждённый возврат.',
          );
        await this.synchronize();
        if (
          [...this.records.values()].some(
            (r) =>
              r.revision > r.syncedRevision ||
              r.payment ||
              r.fiscalBlocked ||
              (request.type === 'prepareCashMovement' && r.deferredPayment) ||
              (request.type === 'flush' &&
                (r.sale.status === 'DRAFT' || r.sale.status === 'HELD')),
          )
        )
          throw new PosError(
            'SYNC_REQUIRED',
            'Сначала завершите или отмените локальные чеки и дождитесь синхронизации.',
          );
        return null;
      case 'checkout':
        return this.checkout(request);
    }
  }

  private async conflict(id: string): Promise<PosConflict> {
    if (this.record(id).nonFiscalCompletion)
      throw new PosError(
        'SALE_NOT_EDITABLE',
        'Оплаченный нефискальный чек нельзя перезаписать.',
      );
    if (this.archiving.has(id))
      throw new PosError(
        'LOCAL_OPERATION_PENDING',
        'Дождитесь завершения проверки чека.',
      );
    requirePermission(this.active(), 'sales.read');
    const epoch = this.epoch;
    const record = this.record(id);
    if (record.payment || record.fiscalBlocked)
      throw new PosError(
        'PAYMENT_UNCERTAIN',
        'Сначала проверьте результат оплаты.',
      );
    let remote: SaleResponse | null;
    try {
      remote = (await this.api<{ sale: SaleResponse }>(`/v1/sales/${id}`)).sale;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      remote = (
        await this.api<{ sale: SaleResponse | null }>('/v1/sales/current')
      ).sale;
    }
    this.assertEpoch(epoch);
    return { local: this.record(id).sale, remote };
  }

  private async resolveConflict(
    request: Extract<PosRequest, { type: 'resolveConflict' }>,
  ): Promise<SaleResponse | null> {
    if (this.record(request.saleId).nonFiscalCompletion)
      throw new PosError(
        'SALE_NOT_EDITABLE',
        'Оплаченный нефискальный чек нельзя перезаписать.',
      );
    requirePermission(this.active(), 'sales.modify');
    const { remote } = await this.conflict(request.saleId);
    const record = this.record(request.saleId);
    if (
      record.sale.local_revision !== request.localRevision ||
      (remote?.version ?? null) !== request.serverVersion ||
      (remote?.id ?? null) !== request.serverId ||
      record.payment ||
      record.fiscalBlocked
    ) {
      throw new PosError(
        'SALE_VERSION_CONFLICT',
        'Чек изменился. Откройте сравнение ещё раз.',
      );
    }
    // Preserve the complete losing version before applying the cashier's explicit decision.
    this.db.set(
      `conflict-backup:${record.sale.cashier_session_id}:${record.sale.id}:${record.revision}`,
      record,
    );
    if (request.choice === 'server') {
      if (!remote)
        throw new PosError(
          'SALE_NOT_FOUND',
          'Серверный чек отсутствует. Сохраните локальную версию.',
        );
      if (remote.id !== record.sale.id) {
        requirePermission(this.active(), 'sales.cancel');
        this.transition({
          type: 'transition',
          action: 'cancel',
          saleId: record.sale.id,
          reason: 'Разрешение конфликта: открыт серверный чек',
        });
        this.save({
          ...this.record(record.sale.id),
          error: null,
          inFlight: null,
          serverVersion: 0,
        });
        this.adopt(remote);
      } else
        this.save({
          ...record,
          sale: remote,
          revision: record.revision + 1,
          syncedRevision: record.revision + 1,
          serverVersion: remote.version,
          error: null,
          inFlight: null,
        });
    } else {
      if (
        remote &&
        remote.id === record.sale.id &&
        !['DRAFT', 'HELD'].includes(remote.status)
      )
        throw new PosError(
          'SALE_NOT_EDITABLE',
          'Серверный чек уже завершён. Его нельзя перезаписать.',
        );
      if (remote && remote.id !== record.sale.id) {
        requirePermission(this.active(), 'sales.hold');
        this.transition({
          type: 'transition',
          action: 'hold',
          saleId: record.sale.id,
        });
        this.adopt(remote);
      }
      const latest = this.record(record.sale.id);
      this.save({
        ...latest,
        revision: latest.revision + 1,
        sequence: ++this.sequence,
        serverVersion: remote?.id === record.sale.id ? remote.version : 0,
        inFlight: null,
        error: null,
      });
    }
    void this.synchronize();
    return this.current()?.sale ?? null;
  }
  close(): void {
    this.epoch++;
    this.catalog.stop();
    this.profile = null;
    this.initialized = false;
    clearInterval(this.timer);
    this.db.close();
  }
}
