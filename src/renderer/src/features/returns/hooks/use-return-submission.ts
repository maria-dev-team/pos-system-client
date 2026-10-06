import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect } from 'react';

import {
  type CreateReceiptReturnPayload,
  type CreateWithoutReceiptReturnPayload,
  createReceiptReturn,
  createWithoutReceiptReturn,
} from '@renderer/common/api';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { getHttpErrorCode } from '@renderer/common/helpers/http-error.helper';
import { callLocalPos } from '@renderer/common/lib/local-pos';

import { assertCompletedReturn } from '../../../../../shared/pos/return-response';
import { reportSaleAntiFraud } from '../../anti-fraud';
import {
  type PendingReturnCommand,
  useReturnsPendingStore,
} from '../stores/returns-pending-store';

type ReturnDraft =
  | {
      payload: CreateReceiptReturnPayload;
      receiptNumber: string;
      type: 'receipt';
    }
  | {
      payload: CreateWithoutReceiptReturnPayload;
      type: 'withoutReceipt';
    };

const isAmbiguousReturnError = (error: unknown) =>
  !axios.isAxiosError(error) ||
  !error.response ||
  error.code === 'ECONNABORTED' ||
  error.code === 'ETIMEDOUT' ||
  error.response.data?.reconciliation_required === true ||
  [401, 403, 408, 425, 429].includes(error.response.status) ||
  error.response.data?.error_code === ErrorCode.SaleNotEditable ||
  error.response.status >= 500;

export function useReturnSubmission(
  cashierSessionId: string,
  organizationId: string,
  storeId: string,
) {
  const queryClient = useQueryClient();
  const pendingCommand = useReturnsPendingStore(
    (state) => state.pendingBySession[cashierSessionId],
  );
  const store = () => useReturnsPendingStore.getState();

  const loadPending = async () => {
    if (store().storageError) throw store().storageError;
    if (!window.localPos) return store().pendingBySession[cashierSessionId];
    const saved = await callLocalPos<PendingReturnCommand | null>({
      type: 'pendingReturn',
      sessionId: cashierSessionId,
    });
    const legacy = store().pendingBySession[cashierSessionId];
    // Copy legacy commands to SQLite before sending or clearing their old copy.
    const command = saved ?? legacy;
    if (command && !saved)
      await callLocalPos({
        type: 'savePendingReturn',
        sessionId: cashierSessionId,
        command,
      });
    if (command) store().publishPending(cashierSessionId, command);
    return command;
  };
  useEffect(() => {
    void loadPending().catch(() => {
      /* Submission retries this read before accepting a new command. */
    });
    // Session identity, not render closures, owns restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashierSessionId]);

  const clearPending = async (command: PendingReturnCommand) => {
    // Clear the legacy copy first. On failure retain both copies and the same UUID.
    store().clearPending(cashierSessionId, command.idempotencyKey);
    if (window.localPos) {
      try {
        await callLocalPos({
          type: 'clearPendingReturn',
          sessionId: cashierSessionId,
          commandId: command.idempotencyKey,
        });
      } catch (error) {
        const newer = store().pendingBySession[cashierSessionId];
        if (!newer || newer.idempotencyKey === command.idempotencyKey)
          store().publishPending(cashierSessionId, command);
        throw error;
      }
    }
  };

  const finish = async (command: PendingReturnCommand) => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.sales.receiptPages(),
    });
    if (command.type === 'receipt') {
      const receiptKey = queryKeys.sales.receipt(
        command.receiptNumber,
        organizationId,
        storeId,
      );
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: receiptKey,
        refetchType: 'none',
      });
      await queryClient.refetchQueries({
        exact: true,
        queryKey: receiptKey,
        type: 'all',
      });
    }
  };

  const send = async (command: PendingReturnCommand) => {
    try {
      const result =
        command.type === 'receipt'
          ? await createReceiptReturn(
              command.receiptNumber,
              command.idempotencyKey,
              command.payload,
            )
          : await createWithoutReceiptReturn(
              command.idempotencyKey,
              command.payload,
            );
      assertCompletedReturn(result, command, organizationId, storeId);
      void reportSaleAntiFraud(result, command.payload.reason);
      // A confirmed refund remains successful even when housekeeping fails.
      // The retained intent prevents a fresh UUID; retry safely replays this command.
      await clearPending(command).catch(() => undefined);
      // Cache refresh is not part of the fiscal transaction and cannot turn a
      // confirmed refund into an error or hold its completion UI indefinitely.
      void finish(command).catch(() => undefined);
      return result;
    } catch (error) {
      if (isAmbiguousReturnError(error)) throw error;

      const errorCode = getHttpErrorCode(error);
      if (errorCode === ErrorCode.ReturnIdempotencyConflict) throw error;

      await clearPending(command);
      if (
        errorCode === ErrorCode.ReturnQuantityExceeded &&
        command.type === 'receipt'
      ) {
        await queryClient.invalidateQueries({
          exact: true,
          queryKey: queryKeys.sales.receipt(
            command.receiptNumber,
            organizationId,
            storeId,
          ),
        });
      }
      throw error;
    }
  };

  const submit = useMutation({
    mutationFn: async (draft: ReturnDraft) => {
      if (await loadPending()) {
        throw new Error('Pending return command requires recovery');
      }
      const idempotencyKey = crypto.randomUUID();
      const command: PendingReturnCommand =
        draft.type === 'receipt'
          ? {
              ...draft,
              endpoint: `/v1/returns/receipts/${draft.receiptNumber}`,
              idempotencyKey,
            }
          : {
              ...draft,
              endpoint: '/v1/returns/without-receipt',
              idempotencyKey,
            };
      if (window.localPos) {
        await callLocalPos({
          type: 'savePendingReturn',
          sessionId: cashierSessionId,
          command,
        });
        store().publishPending(cashierSessionId, command);
      } else if (!store().setPending(cashierSessionId, command)) {
        throw new Error('Pending return command requires recovery');
      }
      return send(command);
    },
    retry: false,
  });

  const retry = useMutation({
    mutationFn: async () => {
      const command = await loadPending();
      if (!command) throw new Error('No pending return command');
      return send(command);
    },
    retry: false,
  });

  return { pendingCommand, retry, submit };
}
