import { Button } from '@renderer/common/components/ui/button';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { SyncIndicator } from '@renderer/features/local-pos';
import { syncAlerts } from '@renderer/features/local-pos';

import { LocalConflictDialog } from './local-conflict-dialog';
import { useLocalPosStatus } from './use-local-pos-status';

const outboxFailureMessages: Record<string, string> = {
  PRODUCT_NOT_ACTIVE: 'Товар недоступен.',
  PRODUCT_NOT_FOUND: 'Один из товаров больше недоступен.',
  SALE_DRAFT_ALREADY_EXISTS: 'На кассе уже открыт другой чек.',
  SALE_NOT_EDITABLE: 'Чек уже завершён или отложен.',
  SALE_VERSION_CONFLICT: 'Чек был изменён. Проверьте его перед отправкой.',
};
const outboxFailureMessage = (code: string): string =>
  outboxFailureMessages[code] ??
  'Не удалось отправить чек. Повторите попытку или обратитесь за помощью.';

export function LocalPosStatus({ sessionId }: { sessionId: string }) {
  const { state, busy, refresh, review, retrySale, active } =
    useLocalPosStatus(sessionId);
  if (!active || !state) return null;
  const reviews = state.paymentReviews ?? [];
  const indicators = syncAlerts(state).filter(
    ({ id }) => id === 'catalog' || (id === 'receipts' && !state.error),
  );
  const showOutbox = Boolean(
    state.outbox?.some((item) => item.code) ||
    (!state.connected && state.pending),
  );
  const needsAttention = Boolean(
    indicators.length ||
    state.paymentPending ||
    state.authorizationRequired ||
    state.fiscalShiftExpired ||
    state.error ||
    showOutbox ||
    !state.paymentReviews ||
    reviews.length ||
    state.conflicts.length,
  );
  if (!needsAttention) return null;
  return (
    <section
      aria-label="Состояние кассы"
      className="shrink-0 space-y-2 rounded-xl border border-border bg-card px-4 py-2 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div role="status" className="space-y-1">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {indicators.map((indicator) => (
              <SyncIndicator
                key={indicator.id}
                indicator={indicator}
                detailed
              />
            ))}
          </div>
          {state.paymentPending ? (
            <p>
              Есть чеки с неподтверждённой оплатой. Их можно перенести в очередь
              проверки и продолжить работу.
            </p>
          ) : null}
          {state.error ? (
            <p className="text-warning">
              Не удалось отправить некоторые чеки. Они сохранены на кассе.
            </p>
          ) : null}
          {state.fiscalShiftExpired ? (
            <p className="text-warning">
              Смена кассы открыта больше 24 часов. Рекомендуем закрыть её и
              открыть новую. Можно повторить оплату; ККМ может её отклонить.
            </p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          type="button"
          disabled={busy.includes('refresh')}
          onClick={() => void refresh()}
        >
          {busy.includes('refresh')
            ? 'Проверяем…'
            : state.authorizationRequired
              ? 'Подтвердить доступ'
              : 'Повторить проверку'}
        </Button>
      </div>
      {showOutbox && state.outbox?.length ? (
        <details>
          <summary className="cursor-pointer">
            Очередь отправки: {state.pending}
          </summary>
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {state.outbox.map((item) => (
              <li key={item.saleId} className="rounded-lg bg-workspace p-2">
                <p>
                  {formatCash(item.total)} ·{' '}
                  {item.stage === 'draft'
                    ? 'Изменения чека'
                    : item.stage === 'defer'
                      ? 'Перенос оплаты на проверку'
                      : 'Событие отмены'}
                </p>
                {item.code ? (
                  <p className="text-warning">
                    {outboxFailureMessage(item.code)}
                  </p>
                ) : (
                  <p>Ожидает отправки</p>
                )}
                {item.nextAttemptAt ? (
                  <p>
                    Следующая попытка отправки — не раньше{' '}
                    {new Date(item.nextAttemptAt).toLocaleTimeString('ru-RU')}.
                  </p>
                ) : null}
                {item.code && item.retryable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy.includes(item.saleId)}
                    onClick={() => void retrySale(item.saleId)}
                  >
                    Повторить отправку чека
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {state.pending > state.outbox.length ? (
            <p>
              Показаны первые {state.outbox.length} чеков; остальные сохранены и
              будут обработаны по очереди.
            </p>
          ) : null}
        </details>
      ) : null}
      {!state.paymentReviews ? (
        <p className="text-warning">
          Полностью перезапустите POS, чтобы обновить очередь проверки чеков.
        </p>
      ) : null}
      {reviews.length ? (
        <details open>
          <summary className="cursor-pointer">
            Очередь проверки чеков: {reviews.length}
          </summary>
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {reviews.map((item) => (
              <li
                key={item.saleId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-workspace p-2"
              >
                <div>
                  <p>
                    {formatCash(item.total)} ·{' '}
                    {item.canResume
                      ? 'Можно вернуться к чеку и повторить оплату'
                      : 'Ожидает подтверждения'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!item.deferred ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy.includes(item.saleId)}
                      onClick={() => void review('deferPayment', item.saleId)}
                    >
                      Новый чек
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy.includes(item.saleId)}
                    onClick={() =>
                      void review(
                        item.canResume ? 'resumePayment' : 'reconcilePayment',
                        item.saleId,
                      )
                    }
                  >
                    {busy.includes(item.saleId)
                      ? 'Проверяем…'
                      : item.canResume
                        ? 'Вернуться к чеку'
                        : 'Проверить оплату'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {state.conflicts.map((conflict) => (
        <LocalConflictDialog key={conflict.saleId} saleId={conflict.saleId} />
      ))}
    </section>
  );
}
