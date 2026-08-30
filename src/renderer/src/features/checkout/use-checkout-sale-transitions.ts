import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import {
  type HeldSaleResponse,
  type SalePaymentPayload,
  type SaleResponse,
  cancelSale,
  checkoutSale,
  getSale,
  holdSale,
  resumeSale,
} from '@renderer/common/api';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { getHttpErrorCode } from '@renderer/common/helpers/http-error.helper';

import { reportCancellation } from './report-cancellation';

type TerminalCommand =
  | {
      buyerBinIin?: string;
      payments: SalePaymentPayload[];
      type: 'checkout';
    }
  | { type: 'hold' }
  | { reason: string; type: 'cancel' };

const isAmbiguous = (error: unknown) =>
  axios.isAxiosError(error) &&
  (!error.response ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.response.status >= 500);

const shouldReconcile = (error: unknown) =>
  isAmbiguous(error) ||
  getHttpErrorCode(error) === ErrorCode.SaleVersionConflict ||
  getHttpErrorCode(error) === ErrorCode.SaleNotEditable;

const hasExpectedStatus = (sale: SaleResponse, command: TerminalCommand) =>
  (command.type === 'checkout' && sale.status === 'COMPLETED') ||
  (command.type === 'hold' && sale.status === 'HELD') ||
  (command.type === 'cancel' && sale.status === 'CANCELLED');

export function useCheckoutSaleTransitions(cashierSessionId: string) {
  const queryClient = useQueryClient();
  const currentKey = queryKeys.sales.current(cashierSessionId);
  const heldKey = queryKeys.sales.held(cashierSessionId);
  const scope = { id: cashierSessionId };

  const adoptDraft = (sale: SaleResponse) => {
    if (sale.status !== 'DRAFT') return;
    queryClient.setQueryData<SaleResponse | null>(currentKey, (current) =>
      current === null || current?.id === sale.id ? sale : current,
    );
  };

  const finishTerminal = (sale: SaleResponse) => {
    void queryClient.cancelQueries({ exact: true, queryKey: currentKey });
    queryClient.setQueryData<SaleResponse | null>(currentKey, (current) =>
      current === undefined || current === null || current.id === sale.id
        ? null
        : current,
    );
    if (sale.status === 'HELD') {
      void queryClient.invalidateQueries({ queryKey: heldKey });
    }
  };

  const finishCommand = (sale: SaleResponse, command: TerminalCommand) => {
    if (hasExpectedStatus(sale, command)) {
      if (command.type === 'cancel') {
        reportCancellation(sale, command.reason);
      }
      finishTerminal(sale);
    } else {
      adoptDraft(sale);
    }
    return sale;
  };

  const runTerminal = async (command: TerminalCommand) => {
    const sale = queryClient.getQueryData<SaleResponse | null>(currentKey);
    if (!sale || sale.status !== 'DRAFT' || sale.items.length === 0) {
      throw new Error('Current sale is no longer active');
    }

    try {
      const result =
        command.type === 'checkout'
          ? await checkoutSale(sale.id, {
              ...(command.buyerBinIin
                ? { buyerBinIin: command.buyerBinIin }
                : {}),
              expectedVersion: sale.version,
              payments: command.payments,
            })
          : command.type === 'hold'
            ? await holdSale(sale.id, { expectedVersion: sale.version })
            : await cancelSale(sale.id, {
                expectedVersion: sale.version,
                reason: command.reason,
              });
      return finishCommand(result, command);
    } catch (error) {
      if (shouldReconcile(error)) {
        try {
          const reconciled = await getSale(sale.id);
          if (hasExpectedStatus(reconciled, command)) {
            return finishCommand(reconciled, command);
          }
          if (reconciled.status === 'DRAFT') adoptDraft(reconciled);
          else finishTerminal(reconciled);
        } catch {
          // Keep the original command error when reconciliation is unavailable.
        }
      }
      throw error;
    }
  };

  const cancel = useMutation({
    mutationFn: (reason: string) => runTerminal({ reason, type: 'cancel' }),
    scope,
  });

  const hold = useMutation({
    mutationFn: () => runTerminal({ type: 'hold' }),
    scope,
  });

  const checkout = useMutation({
    mutationFn: ({
      buyerBinIin,
      payments,
    }: {
      buyerBinIin?: string;
      payments: SalePaymentPayload[];
    }) => runTerminal({ buyerBinIin, payments, type: 'checkout' }),
    scope,
  });

  const resume = useMutation({
    mutationFn: async (held: HeldSaleResponse) => {
      const current = queryClient.getQueryData<SaleResponse | null>(currentKey);
      if (current?.status === 'DRAFT') {
        throw new Error('Finish the current sale before resuming another one');
      }
      const sale = await resumeSale(held.id, {
        expectedVersion: held.version,
      });
      adoptDraft(sale);
      await queryClient.invalidateQueries({ queryKey: heldKey });
      return sale;
    },
    scope,
  });

  return { cancel, checkout, hold, resume };
}
