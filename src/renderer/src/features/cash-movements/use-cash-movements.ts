import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import {
  type CashMovementPayload,
  type CashierSessionResponse,
  createCashMovement,
  getCashMovements,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
} from '@renderer/common/helpers/http-error.helper';

import { PosError } from '../../../../shared/pos/contracts';
import {
  clearPendingCashMovement,
  readPendingCashMovement,
  savePendingCashMovement,
} from './cash-movement-pending';
import { cashMovementSchema } from './cash-movement.schema';
import { prepareCashMovement } from './prepare-cash-movement';

export function useCashMovements(
  session: CashierSessionResponse,
  initialType: CashMovementPayload['type'],
) {
  const queryClient = useQueryClient();
  const [restored] = useState(() => {
    try {
      return { pending: readPendingCashMovement(session.id), error: null };
    } catch {
      return {
        pending: null,
        error:
          'Не удалось прочитать сохранённую операцию. Проверьте локальное хранилище перед продолжением.',
      };
    }
  });
  const [pending, setPending] = useState(restored.pending);
  const [type, setType] = useState(pending?.type ?? initialType);
  const [amount, setAmount] = useState(pending?.amount ?? '');
  const [reason, setReason] = useState(pending?.reason ?? '');
  const [error, setError] = useState<string | null>(restored.error);
  const [success, setSuccess] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const busyRef = useRef(false);
  const list = useQuery({
    queryKey: queryKeys.cashierSessions.cashMovements(session.id, offset),
    queryFn: async () => {
      await prepareCashMovement();
      return getCashMovements(session.id, offset);
    },
    retry: false,
    staleTime: 0,
  });
  const submit = useMutation({
    retry: false,
    mutationFn: async (command: CashMovementPayload) => {
      // A preparation failure cannot have sent this command to the server.
      // Preserve restored commands, but don't mark a new one as uncertain yet.
      await prepareCashMovement();
      try {
        savePendingCashMovement(session.id, command);
      } catch {
        throw new PosError(
          'CASH_MOVEMENT_STORAGE_UNAVAILABLE',
          'Не удалось сохранить операцию на кассе. Запрос на сервер не отправлен.',
        );
      }
      setPending(command);
      const result = await createCashMovement(session.id, command);
      if (
        result.id !== command.operationId ||
        result.cashier_session_id !== session.id ||
        result.organization_id !== session.organization_id ||
        result.store_id !== session.store_id ||
        result.type !== command.type ||
        result.amount !== command.amount ||
        result.reason !== command.reason
      ) {
        throw new PosError(
          'CASH_MOVEMENT_CONFIRMATION_REQUIRED',
          'Сервер не подтвердил операцию. Повторите проверку с тем же номером.',
        );
      }
      return result;
    },
    onSuccess: (result) => {
      clearPendingCashMovement(session.id);
      setPending(null);
      setSuccess(
        `${result.type === 'DEPOSIT' ? 'Внесение' : 'Изъятие'} выполнено`,
      );
      setAmount('');
      setReason('');
      setOffset(0);
      void queryClient
        .invalidateQueries({
          queryKey: queryKeys.cashierSessions.cashMovements(session.id),
        })
        .catch(() => undefined);
    },
    onError: (failure) => {
      // Only explicit business rejections prove no movement was committed.
      if (
        [
          'CASH_MOVEMENT_INSUFFICIENT',
          'CASH_MOVEMENT_INVALID',
          'INVALID_CASH_AMOUNT',
        ].includes(getHttpErrorCode(failure) ?? '')
      ) {
        clearPendingCashMovement(session.id);
        setPending(null);
      }
      setError(
        getHttpErrorMessage(
          failure,
          'Операция не подтверждена. Повторите проверку, не выполняя её заново.',
        ),
      );
    },
  });
  const confirm = async () => {
    if (busyRef.current || restored.error) return;
    setError(null);
    setSuccess(null);
    const parsed = cashMovementSchema.safeParse({ type, amount, reason });
    if (!pending && !parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте сумму и причину');
      return;
    }
    busyRef.current = true;
    const command = pending ?? {
      ...parsed.data!,
      operationId: crypto.randomUUID(),
    };
    try {
      await submit.mutateAsync(command);
    } catch {
      /* Error stays in the dialog for recovery. */
    } finally {
      busyRef.current = false;
    }
  };
  return {
    type,
    setType,
    amount,
    setAmount,
    reason,
    setReason,
    error,
    success,
    pending,
    offset,
    setOffset,
    list,
    confirm,
    busy: submit.isPending,
    blocked: Boolean(restored.error),
  };
}
