import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { queryKeys } from '@renderer/common/constants';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import {
  callLocalPos,
  connectLocalPos,
  localPosProfile,
} from '@renderer/common/lib/local-pos';
import {
  localPosStatusKey,
  useLocalPosSync,
} from '@renderer/features/local-pos';

import type { PosStatus, SaleResponse } from '../../../../shared/pos/contracts';

function reportRetry(result: PosStatus | null, saleId?: string) {
  if (!result) return;
  const item = saleId
    ? result.outbox?.find((entry) => entry.saleId === saleId)
    : result.outbox?.find((entry) => entry.code);
  if (result.authorizationRequired) {
    toast.warning('Для отправки чеков подтвердите доступ к кассе.');
  } else if (item?.nextAttemptAt && item.nextAttemptAt > Date.now()) {
    toast.info(
      `Чек сохранён. Следующая попытка отправки — после ${new Date(item.nextAttemptAt).toLocaleTimeString('ru-RU')}.`,
    );
  } else if (item?.code) {
    toast.warning(
      item.message ?? 'Чек не отправлен. Проверьте причину в очереди отправки.',
    );
  } else if (result.pending === 0) {
    toast.success('Все изменения чеков отправлены.');
  } else if (saleId && !item && result.outbox && result.outbox.length < 50) {
    toast.success('Изменения чека отправлены.');
  } else {
    toast.info('Чеки сохранены. Отправка продолжается в фоне.');
  }
}

export function useLocalPosStatus(sessionId: string) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string[]>([]);
  const jobs = useRef(new Set<string>());
  const lastAuthAttempt = useRef(0);
  const snapshot = useLocalPosSync();
  const status = { data: snapshot.state, dataUpdatedAt: snapshot.updatedAt };
  const reload = useCallback(async () => {
    const sale = await callLocalPos<SaleResponse | null>({ type: 'current' });
    await client.cancelQueries({
      queryKey: queryKeys.sales.current(sessionId),
      exact: true,
    });
    client.setQueryData(queryKeys.sales.current(sessionId), sale);
    await client.invalidateQueries({ queryKey: localPosStatusKey });
  }, [client, sessionId]);
  const authorize = useCallback(async () => {
    const registerId = localPosProfile()?.session.register_id;
    if (!registerId) return;
    // Share HTTP's single-flight refresh; verify the new token's cashier scope.
    const profile = await connectLocalPos(registerId, true);
    client.setQueryData(queryKeys.auth.context(), profile.context);
  }, [client]);
  const run = useCallback(
    async (key: string, operation: () => Promise<void>) => {
      if (jobs.current.has(key)) return false;
      jobs.current.add(key);
      setBusy([...jobs.current]);
      try {
        await operation();
        return true;
      } catch (error) {
        toast.error(getHttpErrorMessage(error));
        return false;
      } finally {
        jobs.current.delete(key);
        setBusy([...jobs.current]);
        await reload().catch(() => undefined);
      }
    },
    [reload],
  );
  useEffect(() => {
    if (
      !status.data?.tokenRefreshRequired ||
      Date.now() - lastAuthAttempt.current < 30_000
    )
      return;
    lastAuthAttempt.current = Date.now();
    void run('refresh', async () => {
      await authorize();
      await callLocalPos({ type: 'retry' });
    });
  }, [status.data?.tokenRefreshRequired, status.dataUpdatedAt, run, authorize]);
  const refresh = () =>
    run('refresh', async () => {
      if (status.data?.authorizationRequired) await authorize();
      reportRetry(await callLocalPos<PosStatus>({ type: 'retry' }));
    });
  const review = (
    type: 'deferPayment' | 'resumePayment' | 'reconcilePayment',
    saleId: string,
  ) =>
    run(saleId, async () => {
      if (type !== 'deferPayment' && status.data?.authorizationRequired)
        await authorize();
      const result = await callLocalPos<SaleResponse | null>({ type, saleId });
      if (type === 'deferPayment')
        toast.info('Чек сохранён в очереди проверки. Можно начать следующий.');
      else if (result?.status === 'COMPLETED')
        toast.success('Оплата подтверждена. Чек доступен в истории продаж.');
      else if (type === 'reconcilePayment')
        toast.info(
          'Проверка выполнена. Текущий результат показан в очереди чеков.',
        );
    });
  return {
    state: status.data,
    busy,
    refresh,
    review,
    archiveSale: (saleId: string) =>
      run(saleId, async () => {
        if (status.data?.authorizationRequired) await authorize();
        await callLocalPos({ type: 'archiveCancelledSale', saleId });
        toast.success(
          'Отменённый чек убран из очереди. Копия сохранена на кассе.',
        );
      }),
    retrySale: (saleId: string) =>
      run(saleId, async () => {
        if (status.data?.authorizationRequired) await authorize();
        reportRetry(
          await callLocalPos<PosStatus>({ type: 'retrySale', saleId }),
          saleId,
        );
      }),
    active: snapshot.active,
  };
}
