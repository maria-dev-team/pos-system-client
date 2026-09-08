import type { PosStatus } from '../../../../shared/pos/contracts';

export type SyncIndicator = {
  id: string;
  label: string;
  detail: string;
  tone: 'working' | 'ready' | 'waiting' | 'warning';
};
const count = new Intl.NumberFormat('ru-RU');
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const timestamp = (value: string | null | undefined): string | null => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return dateTime.format(new Date(value));
};

/** Presentation only: do not infer completion from network availability or a loaded row count. */
export function syncIndicators(state: PosStatus): SyncIndicator[] {
  const loaded = count.format(state.catalogLoaded ?? 0);
  const updated = timestamp(state.catalogUpdatedAt);
  const retry = timestamp(state.catalogRetryAt);
  const catalog: SyncIndicator = state.catalogSyncing
    ? {
        id: 'catalog',
        tone: 'working',
        label: `Каталог: ${state.catalogMode === 'delta' ? 'проверяем изменения' : state.catalogPhase === 'finalizing' ? 'завершаем' : state.catalogPhase === 'saving' ? 'сохраняем' : 'загружаем'} · ${loaded}`,
        detail: `Обработано ${state.catalogMode === 'delta' ? 'изменений' : 'товаров за начальную загрузку'}: ${loaded}. Синхронизация идёт в фоне, можно продолжать работу.`,
      }
    : state.catalogError
      ? {
          id: 'catalog',
          tone: 'warning',
          label: `Каталог: пауза · ${loaded}`,
          detail: `${state.catalogError}${retry ? ` Автоповтор не ранее ${retry}.` : ''}`,
        }
      : state.catalogWaiting
        ? {
            id: 'catalog',
            tone: 'waiting',
            label: 'Каталог: ожидаем транзакции сервера',
            detail:
              'Есть изменения, для которых сервер ещё не может безопасно продвинуть курсор. Продолжим автоматически. Локальные товары доступны.',
          }
        : state.catalogPending
          ? {
              id: 'catalog',
              tone: 'waiting',
              label: 'Каталог: догоняем изменения',
              detail:
                'Остались порции изменений. Продолжим автоматически после короткой паузы; локальные товары доступны.',
            }
          : state.catalogReady
            ? {
                id: 'catalog',
                tone: 'ready',
                label: 'Каталог: синхронизирован',
                detail: updated
                  ? `Последняя успешная синхронизация: ${updated}.`
                  : 'Полная загрузка каталога завершена.',
              }
            : {
                id: 'catalog',
                tone: 'waiting',
                label: 'Каталог: ожидает загрузки',
                detail:
                  'Локальные товары доступны. Отсутствующие товары ищем на сервере.',
              };
  const receipts: SyncIndicator = state.syncing
    ? {
        id: 'receipts',
        tone: 'working',
        label: `Чеки: отправляем · ${state.pending}`,
        detail:
          'Изменения сохранены на кассе и отправляются на сервер. Можно продолжать работу.',
      }
    : state.pending
      ? {
          id: 'receipts',
          tone:
            state.error ||
            state.authorizationRequired ||
            state.conflicts.length ||
            state.outbox?.some((item) => item.code)
              ? 'warning'
              : 'waiting',
          label: `Чеки: в очереди · ${state.pending}`,
          detail: state.authorizationRequired
            ? 'Чеки сохранены на кассе. Для отправки требуется подтвердить доступ.'
            : (state.error ??
              (state.outbox?.some((item) => item.code)
                ? 'Причины задержки и повтор отправки отдельных чеков доступны в очереди отправки рабочей зоны.'
                : state.connected
                  ? 'Изменения сохранены на кассе и ожидают отправки.'
                  : 'Локальный режим: изменения сохранены на кассе. Отправим при восстановлении связи.')),
        }
      : {
          id: 'receipts',
          tone: 'ready',
          label: 'Чеки: изменения отправлены',
          detail:
            'Очередь отправки пуста. Подтверждение оплаты проверяется отдельно.',
        };
  const indicators = [catalog, receipts];
  if (state.categoriesSyncing)
    indicators.push({
      id: 'categories',
      tone: 'working',
      label: 'Категории: загружаем',
      detail: 'Справочник категорий обновляется в фоне.',
    });
  if (state.productLookups)
    indicators.push({
      id: 'lookup',
      tone: 'working',
      label: `Поиск на сервере · ${state.productLookups}`,
      detail:
        'Ищем отсутствующие в SQLite товары и сохраняем результат на кассе. Локальные товары доступны сразу.',
    });
  if (state.paymentPending || state.paymentReviews?.length)
    indicators.push({
      id: 'payments',
      tone: 'warning',
      label: `Оплаты: проверка${state.paymentReviews?.length ? ` · ${state.paymentReviews.length}` : ''}`,
      detail:
        'Есть чеки в очереди проверки оплаты. Действия доступны в рабочей зоне продаж.',
    });
  if (state.authorizationRequired)
    indicators.push({
      id: 'access',
      tone: 'warning',
      label: 'Доступ: подтвердите вход',
      detail:
        'Подтвердите доступ в рабочей зоне продаж для продолжения обмена с сервером.',
    });
  if (state.conflicts.length)
    indicators.push({
      id: 'conflicts',
      tone: 'warning',
      label: `Расхождения чеков · ${state.conflicts.length}`,
      detail: 'Проверьте расхождения с сервером в рабочей зоне продаж.',
    });
  return indicators;
}
