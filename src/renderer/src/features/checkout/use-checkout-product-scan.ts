import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { SaleResponse } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import { localPosActive } from '@renderer/common/lib/local-pos';
import { resolveProductScan } from '@renderer/common/lib/resolve-product-scan';

import { PosError, type SaleCommand } from '../../../../shared/pos/contracts';
import { parseGs1DataMatrix } from '../../../../shared/pos/gs1-data-matrix';
import { assertProductSellable } from '../../../../shared/pos/product-policy';

type Options = {
  cashierSessionId: string;
  organizationId: string;
  execute: (command: SaleCommand) => Promise<unknown>;
  onIssue: (issue: { barcode: string; message: string } | null) => void;
  onResolved: (barcode: string) => void;
  refocus: () => void;
};

/** Orchestrates lookup outside the component; never applies a late lookup to another cart. */
export function useCheckoutProductScan(options: Options) {
  const queryClient = useQueryClient();
  const lifecycle = useRef({ version: 0 });
  const lookups = useRef(
    new Map<string, ReturnType<typeof resolveProductScan>>(),
  );
  useEffect(() => {
    const session = lifecycle.current;
    const pending = lookups.current;
    session.version++;
    return () => {
      session.version++;
      pending.clear();
    };
  }, [options.cashierSessionId, options.organizationId]);

  return async (barcode: string): Promise<void> => {
    options.onIssue(null);
    if (localPosActive()) {
      // Local commands already own their epoch, scan resolution and error presentation.
      await options.execute({ type: 'scan', barcode }).catch(() => undefined);
      return;
    }
    const epoch = lifecycle.current.version;
    const key = queryKeys.sales.current(options.cashierSessionId);
    const currentId = (): string | null =>
      queryClient.getQueryData<SaleResponse | null>(key)?.id ?? null;
    const saleId = currentId();
    const dataMatrix = parseGs1DataMatrix(barcode);
    const searchValue = dataMatrix?.gtin ?? barcode;
    try {
      let lookup = lookups.current.get(searchValue);
      if (!lookup) {
        if (lookups.current.size >= 16)
          throw new PosError(
            'PRODUCT_LOOKUP_BUSY',
            'Поиск ещё обрабатывает предыдущие коды. Повторите сканирование после ответа.',
          );
        lookup = resolveProductScan(
          barcode,
          options.organizationId,
          queryClient,
        );
        lookups.current.set(searchValue, lookup);
        const pending = lookup;
        void lookup
          .finally(() => {
            if (lookups.current.get(searchValue) === pending)
              lookups.current.delete(searchValue);
          })
          .catch(() => undefined);
      }
      const result = await lookup;
      if (epoch !== lifecycle.current.version) return;
      if (localPosActive() || currentId() !== saleId)
        throw new PosError(
          'LOCAL_CONTEXT_CHANGED',
          'Чек изменился во время поиска. Повторите сканирование для текущего покупателя.',
        );
      const { product, quantity } = result;
      const markingCode = dataMatrix?.markingCode;
      assertProductSellable(product, markingCode);
      await options.execute({
        type: 'add',
        productId: product.id,
        ...(quantity !== '1' ? { quantity } : {}),
        ...(markingCode ? { markingCode } : {}),
      });
      if (epoch !== lifecycle.current.version) return;
      options.onIssue(null);
      options.onResolved(barcode);
    } catch (error) {
      if (epoch === lifecycle.current.version)
        options.onIssue({
          barcode,
          message: getHttpErrorMessage(
            error,
            `Не удалось добавить товар с кодом ${searchValue}`,
          ),
        });
    } finally {
      if (epoch === lifecycle.current.version) options.refocus();
    }
  };
}
