import { z } from 'zod';

import { callLocalPos } from '@renderer/common/lib/local-pos';

import {
  POS_STATUS_TIMEOUT_MS,
  PosError,
  type PosStatus,
} from '../../../../shared/pos/contracts';

export const LOCAL_POS_STATUS_TIMEOUT_MS = POS_STATUS_TIMEOUT_MS;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const statusSchema = z.object({
  sessionId: z.string().uuid().nullable().optional(),
  connected: z.boolean(),
  pending: count,
  outbox: z
    .array(
      z.object({
        saleId: z.string().uuid(),
        total: z.string(),
        stage: z.enum(['draft', 'defer']),
        code: z.string().nullable(),
        message: z.string().nullable(),
        attempts: count,
        nextAttemptAt: z.number().nullable(),
        retryable: z.boolean(),
      }),
    )
    .max(50)
    .optional(),
  syncing: z.boolean().optional(),
  productLookups: count.optional(),
  categoriesSyncing: z.boolean().optional(),
  categoriesRevision: z.string().nullable().optional(),
  catalogReady: z.boolean(),
  catalogUpdatedAt: z.string().nullable(),
  catalogSyncing: z.boolean().optional(),
  catalogLoaded: count.optional(),
  catalogMode: z.enum(['bootstrap', 'delta']).optional(),
  catalogWaiting: z.boolean().optional(),
  catalogPending: z.boolean().optional(),
  catalogError: z.string().nullable().optional(),
  catalogRevision: z.string().nullable().optional(),
  catalogPhase: z
    .enum(['downloading', 'saving', 'finalizing'])
    .nullable()
    .optional(),
  catalogRetryAt: z.string().nullable().optional(),
  error: z.string().nullable(),
  conflicts: z.array(z.object({ saleId: z.string(), total: z.string() })),
  paymentPending: z.boolean(),
  paymentReviews: z.array(
    z.object({
      saleId: z.string(),
      total: z.string(),
      deferred: z.boolean(),
      canResume: z.boolean(),
    }),
  ),
  tokenRefreshRequired: z.boolean(),
  authorizationRequired: z.boolean(),
  fiscalShiftExpired: z.boolean(),
});

function validateStatus(value: unknown, sessionId: string): PosStatus {
  const parsed = statusSchema.safeParse(value);
  if (!parsed.success)
    throw new PosError(
      'LOCAL_POS_STATUS_INVALID',
      'Локальный процесс вернул некорректный статус. Полностью перезапустите POS; не удаляйте данные кассы.',
    );
  if (parsed.data.sessionId === undefined)
    throw new PosError(
      'LOCAL_POS_RESTART_REQUIRED',
      'Локальный процесс использует старый формат статуса. Полностью остановите и запустите POS заново; обновления страницы недостаточно.',
    );
  if (parsed.data.sessionId === null)
    throw new PosError(
      'LOCAL_POS_SESSION_MISSING',
      'Локальный процесс не подключён к смене. Перезапустите POS, чтобы восстановить подключение; не удаляйте данные кассы.',
    );
  if (parsed.data.sessionId !== sessionId)
    throw new PosError(
      'LOCAL_POS_SESSION_MISMATCH',
      'Локальный процесс вернул статус другой смены. Перезапустите POS, чтобы восстановить подключение к текущей смене.',
    );
  return parsed.data;
}

/** Read-only deadline; never retry payments or restart the worker. Keep at most one
 * underlying IPC request alive even when an older main process has no timeout. */
export class LocalPosStatusReader {
  private flight: Promise<unknown> | null = null;
  private readonly request: () => Promise<unknown>;

  constructor(
    request: () => Promise<unknown> = () => callLocalPos({ type: 'status' }),
  ) {
    this.request = request;
  }

  async read(sessionId: string): Promise<PosStatus> {
    if (!this.flight) {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const flight = new Promise<unknown>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      this.flight = flight;
      const timer = setTimeout(() => {
        reject(
          new PosError(
            'LOCAL_POS_STATUS_TIMEOUT',
            'Локальный процесс не ответил за 5 секунд. Статус синхронизации неизвестен. Проверка повторится автоматически; если ошибка сохраняется, полностью перезапустите POS.',
          ),
        );
      }, LOCAL_POS_STATUS_TIMEOUT_MS);
      const settle = (): void => {
        clearTimeout(timer);
        if (this.flight === flight) this.flight = null;
      };
      void Promise.resolve()
        .then(this.request)
        .then(
          (value) => {
            settle();
            resolve(value);
          },
          (error: unknown) => {
            settle();
            reject(error);
          },
        );
    }
    return validateStatus(await this.flight, sessionId);
  }
}

export function statusReadIssue(error: unknown): {
  label: string;
  detail: string;
} {
  const labels: Record<string, string> = {
    LOCAL_POS_STATUS_TIMEOUT: 'Синхронизация: локальный процесс не отвечает',
    LOCAL_POS_RESTART_REQUIRED: 'Синхронизация: требуется перезапуск POS',
    LOCAL_POS_SESSION_MISSING: 'Синхронизация: нет подключения к смене',
    LOCAL_POS_SESSION_MISMATCH: 'Синхронизация: не совпадает смена',
    LOCAL_POS_STATUS_INVALID: 'Синхронизация: некорректный статус',
  };
  return {
    label:
      error instanceof PosError
        ? (labels[error.code] ?? 'Синхронизация: состояние неизвестно')
        : 'Синхронизация: состояние неизвестно',
    detail:
      error instanceof PosError
        ? error.message
        : 'Не удалось получить состояние локального хранилища. Проверка повторится автоматически; не удаляйте данные кассы.',
  };
}
