import {
  type LocalSale,
  PosError,
  type SaleResponse,
  type SyncFailure,
  type SyncStage,
} from '../../shared/pos/contracts';
import { PosApiError, PosConnectionError } from './pos-api-client';

export function assertSaleAcknowledgement(
  value: unknown,
  record: LocalSale,
): asserts value is SaleResponse {
  const sale = value as SaleResponse | null | undefined;
  const local = record.sale;
  if (
    !sale ||
    sale.id !== local.id ||
    sale.organization_id !== local.organization_id ||
    sale.store_id !== local.store_id ||
    sale.register_id !== local.register_id ||
    sale.register_shift_id !== local.register_shift_id ||
    sale.cashier_membership_id !== local.cashier_membership_id ||
    sale.transaction_type !== local.transaction_type ||
    sale.currency !== local.currency ||
    sale.cashier_session_id !== local.cashier_session_id ||
    !Number.isSafeInteger(sale.version) ||
    sale.version < record.serverVersion ||
    !Array.isArray(sale.items) ||
    !['DRAFT', 'HELD', 'COMPLETED', 'CANCELLED'].includes(sale.status)
  )
    throw new PosError(
      'POS_API_INVALID_RESPONSE',
      'Сервер вернул некорректное подтверждение чека. Локальная команда сохранена для безопасной проверки.',
    );
}

export function pendingStage(record: LocalSale): SyncStage | null {
  if (record.deferredPayment && !record.deferSynced) return 'defer';
  if (record.revision > record.syncedRevision) return 'draft';
  return null;
}

export function canSync(
  record: LocalSale,
  stage: SyncStage,
  now = Date.now(),
): boolean {
  const failure = record.syncFailures?.[stage];
  return !failure || (failure.temporary && (failure.nextAttemptAt ?? 0) <= now);
}

export function syncFailure(
  error: unknown,
  previous?: SyncFailure,
): SyncFailure {
  const temporary =
    error instanceof PosConnectionError ||
    (error instanceof PosApiError &&
      (error.status >= 500 || [408, 425, 429].includes(error.status))) ||
    (error instanceof PosError && error.code === 'POS_API_INVALID_RESPONSE');
  const attempts = Math.min((previous?.attempts ?? 0) + 1, 1000);
  const delay = Math.max(
    error instanceof PosApiError ? error.retryAfterMs : 0,
    Math.min(300_000, 5000 * 2 ** Math.min(attempts - 1, 6)) +
      Math.floor(Math.random() * 2000),
  );
  return {
    temporary,
    attempts,
    authorization:
      error instanceof PosApiError && [401, 403].includes(error.status),
    nextAttemptAt: temporary ? Date.now() + delay : null,
    code: error instanceof PosError ? error.code : 'LOCAL_SYNC_ERROR',
    message:
      error instanceof PosError
        ? error.message
        : 'Не удалось отправить изменения. Чек сохранён на кассе.',
  };
}
