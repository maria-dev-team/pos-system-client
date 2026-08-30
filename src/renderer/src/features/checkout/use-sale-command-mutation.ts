import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import {
  type SaleResponse,
  addSaleItem,
  createSale,
  getCurrentSale,
  getSale,
  overrideSaleItemPrice,
  removeSaleItem,
  resetSaleItemPrice,
  scanSaleItem,
  setSaleItemQuantity,
} from '@renderer/common/api';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { getHttpErrorCode } from '@renderer/common/helpers/http-error.helper';

export type SaleCommand =
  | { barcode: string; type: 'scan' }
  | {
      markingCode?: string;
      productId: string;
      quantity?: string;
      type: 'add';
    }
  | { itemId: string; quantity: string; type: 'setQuantity' }
  | { itemId: string; type: 'remove' }
  | {
      itemId: string;
      reason: string;
      type: 'overridePrice';
      unitPrice: string;
    }
  | { itemId: string; type: 'resetPrice' };

type SaleCommandMutationOptions = {
  onError?: (
    error: Error,
    command: SaleCommand,
    reconciledSale?: SaleResponse,
  ) => void;
  onSuccess?: (sale: SaleResponse, command: SaleCommand) => void;
};

const isAmbiguous = (error: unknown) =>
  axios.isAxiosError(error) &&
  (!error.response ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT' ||
    error.response.status >= 500);

const shouldReconcile = (error: unknown) =>
  isAmbiguous(error) ||
  getHttpErrorCode(error) === ErrorCode.SaleVersionConflict ||
  getHttpErrorCode(error) === ErrorCode.SaleNotEditable ||
  getHttpErrorCode(error) === ErrorCode.SaleDraftAlreadyExists;

export function useSaleCommandMutation(
  cashierSessionId: string,
  sale: SaleResponse | null,
  options: SaleCommandMutationOptions = {},
) {
  const queryClient = useQueryClient();
  const saleKey = queryKeys.sales.current(cashierSessionId);

  const reconcileCurrent = (updatedSale: SaleResponse) => {
    queryClient.setQueryData<SaleResponse | null>(saleKey, (currentSale) =>
      updatedSale.status === 'DRAFT'
        ? currentSale === null || currentSale?.id === updatedSale.id
          ? updatedSale
          : currentSale
        : currentSale?.id === updatedSale.id
          ? null
          : currentSale,
    );
    return queryClient.getQueryData<SaleResponse | null>(saleKey);
  };

  return useMutation({
    mutationFn: async (command: SaleCommand) => {
      const currentSale = queryClient.getQueryData<SaleResponse | null>(
        saleKey,
      );

      if (!currentSale) {
        if (command.type !== 'add') {
          throw new Error('Current sale is no longer active');
        }
        try {
          return await createSale({
            items: [
              {
                productId: command.productId,
                ...(command.markingCode
                  ? { markingCode: command.markingCode }
                  : {}),
                quantity: command.quantity ?? '1',
              },
            ],
          });
        } catch (error) {
          if (shouldReconcile(error)) {
            try {
              const reconciled = await getCurrentSale();
              if (reconciled?.status === 'DRAFT') return reconciled;
            } catch {
              // Keep the original create error when reconciliation is unavailable.
            }
          }
          throw error;
        }
      }

      if (
        (sale && currentSale.id !== sale.id) ||
        (!sale && command.type !== 'add')
      ) {
        throw new Error('Current sale is no longer active');
      }

      const expectedVersion = currentSale.version;
      switch (command.type) {
        case 'scan':
          return scanSaleItem(currentSale.id, {
            barcode: command.barcode,
            expectedVersion,
            quantityDelta: '1',
          });
        case 'add':
          return addSaleItem(currentSale.id, {
            expectedVersion,
            ...(command.markingCode
              ? { markingCode: command.markingCode }
              : {}),
            productId: command.productId,
            quantity: command.quantity ?? '1',
          });
        case 'setQuantity':
          return setSaleItemQuantity(currentSale.id, command.itemId, {
            expectedVersion,
            quantity: command.quantity,
          });
        case 'remove':
          return removeSaleItem(currentSale.id, command.itemId, {
            expectedVersion,
          });
        case 'overridePrice':
          return overrideSaleItemPrice(currentSale.id, command.itemId, {
            expectedVersion,
            reason: command.reason,
            unitPrice: command.unitPrice,
          });
        case 'resetPrice':
          return resetSaleItemPrice(currentSale.id, command.itemId, {
            expectedVersion,
          });
      }
    },
    onError: async (error, command) => {
      let reconciledSale: SaleResponse | undefined;
      if (sale && shouldReconcile(error)) {
        try {
          const refreshedSale = await getSale(sale.id);
          const currentSale = reconcileCurrent(refreshedSale);
          if (
            refreshedSale.status === 'DRAFT' &&
            currentSale?.id === refreshedSale.id
          ) {
            reconciledSale = currentSale;
          }
        } catch {
          // Keep the original command error as the actionable failure.
        }
      }
      options.onError?.(error, command, reconciledSale);
    },
    onSuccess: (updatedSale, command) => {
      reconcileCurrent(updatedSale);
      options.onSuccess?.(updatedSale, command);
    },
    scope: { id: cashierSessionId },
  });
}
