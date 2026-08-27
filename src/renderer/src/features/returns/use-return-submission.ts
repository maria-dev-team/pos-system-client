import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import {
  type CreateReceiptReturnPayload,
  type CreateWithoutReceiptReturnPayload,
  createReceiptReturn,
  createWithoutReceiptReturn,
} from '@renderer/common/api';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { getHttpErrorCode } from '@renderer/common/helpers/http-error.helper';

import {
  type PendingReturnCommand,
  useReturnsPendingStore,
} from './returns-pending-store';

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
  axios.isAxiosError(error) &&
  (!error.response ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.response.status >= 500);

export function useReturnSubmission(cashierSessionId: string) {
  const queryClient = useQueryClient();
  const pendingCommand = useReturnsPendingStore(
    (state) => state.pendingBySession[cashierSessionId],
  );
  const store = () => useReturnsPendingStore.getState();

  const finish = async (command: PendingReturnCommand) => {
    store().clearPending(cashierSessionId);
    await queryClient.invalidateQueries({
      queryKey: queryKeys.sales.receiptPages(),
    });
    if (command.type === 'receipt') {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sales.receipt(command.receiptNumber),
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
      await finish(command);
      return result;
    } catch (error) {
      if (isAmbiguousReturnError(error)) throw error;

      const errorCode = getHttpErrorCode(error);
      if (errorCode === ErrorCode.ReturnIdempotencyConflict) throw error;

      store().clearPending(cashierSessionId);
      if (
        errorCode === ErrorCode.ReturnQuantityExceeded &&
        command.type === 'receipt'
      ) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.sales.receipt(command.receiptNumber),
        });
      }
      throw error;
    }
  };

  const submit = useMutation({
    mutationFn: async (draft: ReturnDraft) => {
      if (store().pendingBySession[cashierSessionId]) {
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
      if (!store().setPending(cashierSessionId, command)) {
        throw new Error('Pending return command requires recovery');
      }
      return send(command);
    },
    retry: false,
  });

  const retry = useMutation({
    mutationFn: async () => {
      const command = store().pendingBySession[cashierSessionId];
      if (!command) throw new Error('No pending return command');
      return send(command);
    },
    retry: false,
  });

  return { pendingCommand, retry, submit };
}
