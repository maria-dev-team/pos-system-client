import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import {
  type SaleResponse,
  addSaleItem,
  cancelSale,
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
  | { productId: string; quantity?: string; type: 'add' }
  | { itemId: string; quantity: string; type: 'setQuantity' }
  | { itemId: string; type: 'remove' }
  | {
      itemId: string;
      reason: string;
      type: 'overridePrice';
      unitPrice: string;
    }
  | { itemId: string; type: 'resetPrice' }
  | { reason?: string; type: 'cancel' };

type SaleCommandMutationOptions = {
  onError?: (
    error: Error,
    command: SaleCommand,
    reconciledSale?: SaleResponse,
  ) => void;
  onSuccess?: (sale: SaleResponse, command: SaleCommand) => void;
};

const shouldReconcile = (error: unknown) =>
  getHttpErrorCode(error) === ErrorCode.SaleVersionConflict ||
  (axios.isAxiosError(error) &&
    (!error.response ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT'));

export function useSaleCommandMutation(
  cashierSessionId: string,
  sale: SaleResponse | null,
  options: SaleCommandMutationOptions = {},
) {
  const queryClient = useQueryClient();
  const saleKey = queryKeys.sales.current(cashierSessionId);
  const replaceCurrentSale = (updatedSale: SaleResponse) =>
    queryClient.setQueryData<SaleResponse | null>(saleKey, (currentSale) =>
      sale && currentSale?.id === sale.id ? updatedSale : currentSale,
    );

  return useMutation({
    mutationFn: (command: SaleCommand) => {
      const currentSale = queryClient.getQueryData<SaleResponse | null>(
        saleKey,
      );
      if (!sale || currentSale?.id !== sale.id) {
        throw new Error('Current sale is no longer active');
      }

      const expectedVersion = currentSale.version;
      switch (command.type) {
        case 'scan':
          return scanSaleItem(sale.id, {
            barcode: command.barcode,
            expectedVersion,
            quantityDelta: '1',
          });
        case 'add':
          return addSaleItem(sale.id, {
            expectedVersion,
            productId: command.productId,
            quantity: command.quantity ?? '1',
          });
        case 'setQuantity':
          return setSaleItemQuantity(sale.id, command.itemId, {
            expectedVersion,
            quantity: command.quantity,
          });
        case 'remove':
          return removeSaleItem(sale.id, command.itemId, { expectedVersion });
        case 'overridePrice':
          return overrideSaleItemPrice(sale.id, command.itemId, {
            expectedVersion,
            reason: command.reason,
            unitPrice: command.unitPrice,
          });
        case 'resetPrice':
          return resetSaleItemPrice(sale.id, command.itemId, {
            expectedVersion,
          });
        case 'cancel':
          return cancelSale(sale.id, {
            expectedVersion,
            ...(command.reason ? { reason: command.reason } : {}),
          });
      }
    },
    onError: async (error, command) => {
      let reconciledSale: SaleResponse | undefined;
      if (sale && shouldReconcile(error)) {
        try {
          const refreshedSale = await getSale(sale.id);
          const currentSale = replaceCurrentSale(refreshedSale);
          if (currentSale?.id === refreshedSale.id) {
            reconciledSale = currentSale;
          }
        } catch {
          // Preserve the original mutation error for the command consumer.
        }
      }
      options.onError?.(error, command, reconciledSale);
    },
    onSuccess: (updatedSale, command) => {
      replaceCurrentSale(updatedSale);
      options.onSuccess?.(updatedSale, command);
    },
    scope: { id: sale?.id ?? `no-sale:${cashierSessionId}` },
  });
}
