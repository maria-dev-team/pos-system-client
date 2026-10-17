import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import {
  type SaleResponse,
  addSaleItem,
  applySaleDiscount,
  createSale,
  getCurrentSale,
  getSale,
  overrideSaleItemPrice,
  removeSaleItem,
  resetSaleDiscount,
  resetSaleItemPrice,
  scanSaleItem,
  setSaleItemQuantity,
} from '@renderer/common/api';
import { assertAuthCurrent, captureAuth } from '@renderer/common/api/request';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { getHttpErrorCode } from '@renderer/common/helpers/http-error.helper';
import {
  executeLocalSale,
  localPosActive,
} from '@renderer/common/lib/local-pos';
import { resolveProductScan } from '@renderer/common/lib/resolve-product-scan';
import { getScanAmbiguity } from '@renderer/common/lib/scan-ambiguity';

import { PosError, type SaleCommand } from '../../../../shared/pos/contracts';
import { assertProductSellable } from '../../../../shared/pos/product-policy';

export type { SaleCommand } from '../../../../shared/pos/contracts';

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
      currentSale?.id === updatedSale.id &&
      (currentSale.local_revision ?? 0) > (updatedSale.local_revision ?? 0)
        ? currentSale
        : updatedSale.status === 'DRAFT'
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
      if (localPosActive()) return executeLocalSale(command);
      const currentSale = queryClient.getQueryData<SaleResponse | null>(
        saleKey,
      );

      if (
        command.type === 'add' &&
        command.saleId !== undefined &&
        command.saleId !== (currentSale?.id ?? null)
      ) {
        throw new Error('Current sale is no longer active');
      }

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

      const expectedVersion =
        command.type === 'add'
          ? (command.expectedVersion ?? currentSale.version)
          : currentSale.version;
      switch (command.type) {
        case 'scan': {
          const auth = captureAuth();
          let quantityDelta = command.quantity ?? '1';
          {
            try {
              const resolved = await resolveProductScan(
                command.barcode,
                currentSale.organization_id,
                queryClient,
              );
              if (resolved.kind === 'weighted')
                quantityDelta = resolved.quantity;
              if (
                resolved.kind === 'static' &&
                resolved.product.unit === 'kg' &&
                command.quantity === undefined
              ) {
                assertProductSellable(resolved.product, command.markingCode);
                throw new PosError(
                  'PRODUCT_BARCODE_AMBIGUOUS',
                  'Введите вес товара.',
                  {
                    current_version: expectedVersion,
                    candidates: [
                      {
                        kind: 'static',
                        product_id: resolved.product.id,
                        name: resolved.product.name,
                        unit: 'kg',
                        quantity: null,
                        retail_price: resolved.product.retail_price,
                        unavailable_reason: null,
                      },
                    ],
                  },
                );
              }
            } catch (error) {
              const ambiguity = getScanAmbiguity(error);
              if (!ambiguity || ambiguity.candidates.length === 1) throw error;
              // The scan endpoint supplies the authoritative candidates/version.
            }
          }
          assertAuthCurrent(auth);
          if (
            localPosActive() ||
            queryClient.getQueryData<SaleResponse | null>(saleKey)?.id !==
              currentSale.id
          )
            throw new Error('Current sale is no longer active');
          return scanSaleItem(currentSale.id, {
            barcode: command.barcode,
            expectedVersion,
            quantityDelta,
            ...(command.markingCode
              ? { markingCode: command.markingCode }
              : {}),
          });
        }
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
        case 'applyDiscount':
          return applySaleDiscount(currentSale.id, {
            expectedVersion,
            percentage: command.percentage,
            reason: command.reason,
          });
        case 'resetDiscount':
          return resetSaleDiscount(currentSale.id, { expectedVersion });
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
    // Local commands are serialized at their durable write, not behind a remote cache miss.
    scope: localPosActive() ? undefined : { id: cashierSessionId },
    retry: false,
  });
}
