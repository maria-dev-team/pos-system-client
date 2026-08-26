import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useState } from 'react';

import {
  type HeldSaleResponse,
  type SalePaymentPayload,
  type SaleResponse,
  checkoutSale,
  createSale,
  getCurrentSale,
  getSale,
  holdSale,
  resumeSale,
} from '@renderer/common/api';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { getHttpErrorCode } from '@renderer/common/helpers/http-error.helper';

import {
  type PendingOperation,
  useCheckoutCartStore,
} from './checkout-cart-store';

const isAmbiguous = (error: unknown) =>
  axios.isAxiosError(error) &&
  (!error.response ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.response.status >= 500);

const isTerminalFor = (sale: SaleResponse, pending: PendingOperation) =>
  (pending.type === 'checkout' && sale.status === 'COMPLETED') ||
  (pending.type === 'hold' && sale.status === 'HELD');

const paymentFingerprint = (pending: PendingOperation | undefined) =>
  pending?.type === 'checkout'
    ? JSON.stringify(
        pending.payments.map(({ amount, method, received }) => [
          method,
          amount,
          received ?? null,
        ]),
      )
    : null;

const isSamePending = (
  left: PendingOperation | undefined,
  right: PendingOperation | undefined,
) =>
  left?.type === right?.type &&
  left?.saleId === right?.saleId &&
  left?.expectedVersion === right?.expectedVersion &&
  paymentFingerprint(left) === paymentFingerprint(right);

export function useCheckoutSaleTransitions(cashierSessionId: string) {
  const queryClient = useQueryClient();
  const pendingOperation = useCheckoutCartStore(
    (state) => state.sessions[cashierSessionId]?.pendingOperation,
  );
  const [recoveryIdentity, setRecoveryIdentity] = useState(() => ({
    cashierSessionId,
    latestPending: pendingOperation,
    pendingOnEntry: pendingOperation,
  }));
  if (recoveryIdentity.cashierSessionId !== cashierSessionId) {
    setRecoveryIdentity({
      cashierSessionId,
      latestPending: pendingOperation,
      pendingOnEntry: pendingOperation,
    });
  } else if (
    pendingOperation &&
    !isSamePending(recoveryIdentity.latestPending, pendingOperation)
  ) {
    setRecoveryIdentity({
      ...recoveryIdentity,
      latestPending: pendingOperation,
    });
  }
  const activeRecoveryIdentity =
    recoveryIdentity.cashierSessionId === cashierSessionId
      ? recoveryIdentity
      : {
          cashierSessionId,
          latestPending: pendingOperation,
          pendingOnEntry: pendingOperation,
        };
  const recoveryOperation =
    pendingOperation ?? activeRecoveryIdentity.latestPending;
  const currentKey = queryKeys.sales.current(cashierSessionId);
  const heldKey = queryKeys.sales.held(cashierSessionId);
  const scope = { id: cashierSessionId };
  const cartStore = () => useCheckoutCartStore.getState();

  const adoptDraft = (sale: SaleResponse) => {
    if (sale.status === 'DRAFT') {
      queryClient.setQueryData<SaleResponse | null>(currentKey, (current) =>
        current === undefined || current === null || current.id === sale.id
          ? sale
          : current,
      );
    }
    return queryClient.getQueryData<SaleResponse | null>(currentKey);
  };

  const adoptPreparedDraft = (sale: SaleResponse) => {
    const authoritative = adoptDraft(sale);
    if (authoritative?.status === 'DRAFT' && authoritative.id === sale.id) {
      return authoritative;
    }
    throw new Error('Current sale changed while preparing');
  };

  const finishTerminal = (sale: SaleResponse) => {
    void queryClient.cancelQueries({ exact: true, queryKey: currentKey });
    cartStore().deleteSession(cashierSessionId);
    queryClient.setQueryData<SaleResponse | null>(currentKey, (current) =>
      current === undefined || current === null || current.id === sale.id
        ? null
        : current,
    );
    if (sale.status === 'HELD') {
      void queryClient.invalidateQueries({ queryKey: heldKey });
    }
  };

  const assertNoPending = () => {
    if (cartStore().sessions[cashierSessionId]?.pendingOperation) {
      throw new Error('Pending sale operation requires recovery');
    }
  };

  const prepareSale = async () => {
    assertNoPending();
    const current = queryClient.getQueryData<SaleResponse | null>(currentKey);
    if (current?.status === 'DRAFT') return current;

    const items = cartStore().sessions[cashierSessionId]?.items ?? [];
    try {
      const sale = await createSale({
        items: items.map(({ priceOverride, productId, quantity }) => ({
          ...(priceOverride ? { priceOverride } : {}),
          productId,
          quantity,
        })),
      });
      return adoptPreparedDraft(sale);
    } catch (error) {
      if (
        isAmbiguous(error) ||
        getHttpErrorCode(error) === ErrorCode.SaleDraftAlreadyExists
      ) {
        try {
          const currentSale = await getCurrentSale();
          if (currentSale?.status === 'DRAFT') {
            return adoptPreparedDraft(currentSale);
          }
        } catch {
          // The original create result remains the actionable error.
        }
      }
      throw error;
    }
  };

  const reconcilePending = async (pending: PendingOperation) => {
    try {
      const sale = await getSale(pending.saleId);
      const currentPending =
        cartStore().sessions[cashierSessionId]?.pendingOperation;
      if (!isSamePending(currentPending, pending)) return undefined;

      if (isTerminalFor(sale, pending)) {
        finishTerminal(sale);
      } else if (sale.status === 'DRAFT') {
        adoptDraft(sale);
        cartStore().clearPendingOperation(cashierSessionId);
      } else {
        cartStore().clearPendingOperation(cashierSessionId);
      }
      return sale;
    } catch {
      return undefined;
    }
  };

  const sendPending = async (pending: PendingOperation) => {
    try {
      const sale =
        pending.type === 'checkout'
          ? await checkoutSale(pending.saleId, {
              expectedVersion: pending.expectedVersion,
              payments: pending.payments,
            })
          : await holdSale(pending.saleId, {
              expectedVersion: pending.expectedVersion,
            });

      if (isTerminalFor(sale, pending)) finishTerminal(sale);
      else adoptDraft(sale);
      return sale;
    } catch (error) {
      if (isAmbiguous(error)) throw error;

      const errorCode = getHttpErrorCode(error);
      if (
        errorCode === ErrorCode.SaleVersionConflict ||
        errorCode === ErrorCode.SaleNotEditable
      ) {
        const reconciled = await reconcilePending(pending);
        if (reconciled && isTerminalFor(reconciled, pending)) {
          return reconciled;
        }
      } else if (
        isSamePending(
          cartStore().sessions[cashierSessionId]?.pendingOperation,
          pending,
        )
      ) {
        cartStore().clearPendingOperation(cashierSessionId);
      }
      throw error;
    }
  };

  const recovery = useQuery({
    enabled:
      pendingOperation !== undefined &&
      pendingOperation === activeRecoveryIdentity.pendingOnEntry,
    queryFn: () => {
      if (!recoveryOperation) throw new Error('No pending sale operation');
      return getSale(recoveryOperation.saleId);
    },
    queryKey: queryKeys.sales.recovery(
      cashierSessionId,
      recoveryOperation?.type,
      recoveryOperation?.saleId,
      recoveryOperation?.expectedVersion,
      paymentFingerprint(recoveryOperation),
    ),
    retry: false,
  });

  useEffect(() => {
    const recoveredSale = recovery.data;
    const currentPending =
      cartStore().sessions[cashierSessionId]?.pendingOperation;
    if (
      !pendingOperation ||
      !isSamePending(currentPending, pendingOperation) ||
      recoveredSale?.id !== pendingOperation.saleId
    ) {
      return;
    }
    if (isTerminalFor(recoveredSale, pendingOperation)) {
      void queryClient.cancelQueries({ exact: true, queryKey: currentKey });
      cartStore().deleteSession(cashierSessionId);
      queryClient.setQueryData<SaleResponse | null>(currentKey, (current) =>
        current === undefined ||
        current === null ||
        current.id === recoveredSale.id
          ? null
          : current,
      );
      if (recoveredSale.status === 'HELD') {
        void queryClient.invalidateQueries({ queryKey: heldKey });
      }
    } else if (recoveredSale.status === 'DRAFT') {
      queryClient.setQueryData<SaleResponse | null>(currentKey, (current) =>
        current === undefined ||
        current === null ||
        current.id === recoveredSale.id
          ? recoveredSale
          : current,
      );
    }
  }, [
    cashierSessionId,
    currentKey,
    heldKey,
    pendingOperation,
    queryClient,
    recovery.data,
  ]);

  useEffect(() => {
    const currentPending =
      cartStore().sessions[cashierSessionId]?.pendingOperation;
    if (
      pendingOperation &&
      isSamePending(currentPending, pendingOperation) &&
      getHttpErrorCode(recovery.error) === ErrorCode.SaleNotFound
    ) {
      cartStore().clearPendingOperation(cashierSessionId);
    }
  }, [cashierSessionId, pendingOperation, recovery.error]);

  const prepare = useMutation({ mutationFn: prepareSale, scope });

  const hold = useMutation({
    mutationFn: async () => {
      assertNoPending();
      const sale = await prepareSale();
      const pending: PendingOperation = {
        expectedVersion: sale.version,
        saleId: sale.id,
        type: 'hold',
      };
      cartStore().setPendingOperation(cashierSessionId, pending);
      return sendPending(pending);
    },
    scope,
  });

  const checkout = useMutation({
    mutationFn: async (payments: SalePaymentPayload[]) => {
      assertNoPending();
      const sale = await prepareSale();
      const pending: PendingOperation = {
        expectedVersion: sale.version,
        payments,
        saleId: sale.id,
        type: 'checkout',
      };
      cartStore().setPendingOperation(cashierSessionId, pending);
      return sendPending(pending);
    },
    scope,
  });

  const resume = useMutation({
    mutationFn: async (held: HeldSaleResponse) => {
      assertNoPending();
      const sale = await resumeSale(held.id, {
        expectedVersion: held.version,
      });
      adoptDraft(sale);
      await queryClient.invalidateQueries({ queryKey: heldKey });
      return sale;
    },
    scope,
  });

  const retry = useMutation({
    mutationFn: async () => {
      const pending = cartStore().sessions[cashierSessionId]?.pendingOperation;
      if (!pending) throw new Error('No pending sale operation');
      return sendPending(pending);
    },
    scope,
  });

  return {
    abandonPending: () => cartStore().clearPendingOperation(cashierSessionId),
    checkout,
    hold,
    isRetryPending: retry.isPending,
    isRecoveryRequired: pendingOperation !== undefined,
    prepare,
    recovery,
    resume,
    retryPending: retry.mutateAsync,
  };
}
