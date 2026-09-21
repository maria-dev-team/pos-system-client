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

import type { SaleResponse } from '../../../../shared/pos/contracts';

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
      if (jobs.current.has(key)) return;
      jobs.current.add(key);
      setBusy([...jobs.current]);
      try {
        await operation();
      } catch (error) {
        toast.error(getHttpErrorMessage(error));
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
      await callLocalPos({ type: 'retry' });
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
    retrySale: (saleId: string) =>
      run(saleId, async () => {
        if (status.data?.authorizationRequired) await authorize();
        await callLocalPos({ type: 'retrySale', saleId });
      }),
    active: snapshot.active,
  };
}
