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
const time = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const timestamp = (value: string | null | undefined): string | null => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return dateTime.format(new Date(value));
};
const clockTime = (value: string | null | undefined): string | null => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return time.format(new Date(value));
};

/** Presentation only: do not infer completion from network availability or a loaded row count. */
export function syncIndicators(state: PosStatus): SyncIndicator[] {
  const loaded = count.format(state.catalogLoaded ?? 0);
  const updated = timestamp(state.catalogUpdatedAt);
  const retry = timestamp(state.catalogRetryAt);
  const nextRefresh = clockTime(state.catalogNextRefreshAt);
  const catalog: SyncIndicator = state.catalogSyncing
    ? {
        id: 'catalog',
        tone: 'working',
        label: `Обновляем каталог · ${loaded}`,
        detail: `Обновлено товаров: ${loaded}. Можно продолжать работу.`,
      }
    : state.catalogError
      ? {
          id: 'catalog',
          tone: 'warning',
          label: 'Не удалось обновить каталог',
          detail: `Уже загруженные товары доступны.${retry ? ` Повторим попытку после ${retry}.` : ' Повторим попытку автоматически.'}`,
        }
      : state.catalogWaiting
        ? {
            id: 'catalog',
            tone: 'waiting',
            label: 'Каталог скоро обновится',
            detail:
              'Новые данные ещё обрабатываются. Обновление продолжится автоматически, а доступные товары уже можно продавать.',
          }
        : state.catalogPending
          ? {
              id: 'catalog',
              tone: 'waiting',
              label: 'Продолжаем обновление каталога',
              detail:
                'Осталось загрузить часть товаров. Продолжим автоматически после короткой паузы.',
            }
          : state.catalogReady
            ? {
                id: 'catalog',
                tone: 'ready',
                label: `Каталог синхронизирован${nextRefresh ? ` · следующая проверка в ${nextRefresh}` : ''}`,
                detail: updated
                  ? `Последнее обновление: ${updated}.`
                  : 'Все товары загружены.',
              }
            : {
                id: 'catalog',
                tone: 'waiting',
                label: 'Загружаем каталог',
                detail:
                  'Можно работать с уже доступными товарами. Остальные появятся после загрузки.',
              };
  const receipts: SyncIndicator = state.syncing
    ? {
        id: 'receipts',
        tone: 'working',
        label: `Отправляем чеки · ${state.pending}`,
        detail: 'Чеки сохранены и отправляются. Можно продолжать работу.',
      }
    : state.pending
      ? {
          id: 'receipts',
          tone:
            state.error ||
            !state.connected ||
            state.authorizationRequired ||
            state.conflicts.length ||
            state.outbox?.some((item) => item.code)
              ? 'warning'
              : 'waiting',
          label: `Чеки ожидают отправки · ${state.pending}`,
          detail: state.authorizationRequired
            ? 'Подтвердите вход, чтобы чеки отправились.'
            : state.error
              ? 'Не удалось отправить некоторые чеки. Они сохранены, повторите отправку из очереди.'
              : state.outbox?.some((item) => item.code)
                ? 'Некоторые чеки не отправлены. Откройте очередь, чтобы посмотреть подробности и повторить отправку.'
                : state.connected
                  ? 'Чеки сохранены и отправятся автоматически.'
                  : 'Нет связи. Чеки сохранены и отправятся автоматически после восстановления связи.',
        }
      : state.error
        ? {
            id: 'receipts',
            tone: 'warning',
            label: 'Не удалось отправить чеки',
            detail:
              'Чеки сохранены на кассе. Повторите отправку или обратитесь за помощью.',
          }
        : {
            id: 'receipts',
            tone: 'ready',
            label: 'Все чеки отправлены',
            detail: 'Неотправленных чеков нет.',
          };
  const indicators = [catalog, receipts];
  if (state.categoriesSyncing)
    indicators.push({
      id: 'categories',
      tone: 'working',
      label: 'Обновляем категории',
      detail: 'Категории товаров обновляются. Можно продолжать работу.',
    });
  if (state.productLookups)
    indicators.push({
      id: 'lookup',
      tone: 'working',
      label: `Ищем товар · ${state.productLookups}`,
      detail:
        'Поиск продолжается. Можно сканировать или добавлять следующий товар.',
    });
  if (state.paymentPending || state.paymentReviews?.length)
    indicators.push({
      id: 'payments',
      tone: 'warning',
      label: `Проверьте оплату${state.paymentReviews?.length ? ` · ${state.paymentReviews.length}` : ''}`,
      detail:
        'Для некоторых чеков нужно проверить результат оплаты. Откройте раздел продаж.',
    });
  if (state.authorizationRequired)
    indicators.push({
      id: 'access',
      tone: 'warning',
      label: 'Подтвердите вход',
      detail:
        'Подтвердите вход в разделе продаж, чтобы продолжить отправку чеков.',
    });
  if (state.conflicts.length)
    indicators.push({
      id: 'conflicts',
      tone: 'warning',
      label: `Проверьте чеки · ${state.conflicts.length}`,
      detail:
        'Данные некоторых чеков отличаются. Выберите правильный вариант в разделе продаж.',
    });
  return indicators;
}

/** Global and workspace banners stay out of the way until attention is needed. */
export function syncAlerts(state: PosStatus): SyncIndicator[] {
  return syncIndicators(state).filter(({ tone }) => tone === 'warning');
}

/** Compact status keeps active work and warnings visible without showing success rows. */
export function syncNotices(state: PosStatus): SyncIndicator[] {
  return syncIndicators(state).filter(
    ({ id, tone }) =>
      tone === 'warning' ||
      id === 'catalog' ||
      (id === 'receipts' && tone !== 'ready'),
  );
}
