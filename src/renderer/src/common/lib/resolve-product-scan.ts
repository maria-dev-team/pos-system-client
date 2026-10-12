import type { QueryClient } from '@tanstack/react-query';

import { type ProductResponse, searchProducts } from '@renderer/common/api';
import {
  assertAuthCurrent,
  captureAuth,
  request,
} from '@renderer/common/api/request';

import {
  PosError,
  type ScannedProduct,
} from '../../../../shared/pos/contracts';
import { parseGs1DataMatrix } from '../../../../shared/pos/gs1-data-matrix';
import { selectExactBarcodeProduct } from '../../../../shared/pos/product-policy';
import {
  assertWeightedProduct,
  parseWeightedBarcode,
  scaleProfileSchema,
} from '../../../../shared/pos/weighted-barcode';
import { callLocalPos, localPosActive } from './local-pos';

export async function browserWeightedBarcode(
  barcode: string,
  queryClient: QueryClient,
) {
  if (!/^\d{13}$/.test(barcode)) return null;
  const auth = captureAuth();
  const profile = await queryClient.fetchQuery({
    queryKey: ['products', 'scale-profile', auth.generation, auth.context],
    staleTime: 15_000,
    retry: false,
    queryFn: async () => {
      const { data } = await request.get('/v1/pos/catalog/sync-start');
      assertAuthCurrent(auth);
      const parsed = scaleProfileSchema
        .optional()
        .safeParse(data.data?.scale_profile);
      if (!parsed.success)
        throw new PosError(
          'POS_API_INVALID_RESPONSE',
          'Сервер вернул некорректные настройки весовых товаров.',
        );
      return parsed.data ?? null;
    },
  });
  assertAuthCurrent(auth);
  return parseWeightedBarcode(barcode, profile);
}

/** Resolve a scan without changing the cart, also used by price checking. */
export async function resolveProductScan(
  barcode: string,
  organizationId: string,
  queryClient: QueryClient,
): Promise<ScannedProduct> {
  const auth = captureAuth();
  let resolved: ScannedProduct;
  if (localPosActive()) {
    resolved = await callLocalPos<ScannedProduct>({
      type: 'resolveScan',
      barcode,
    });
  } else {
    if (window.localPos)
      throw new PosError(
        'LOCAL_NOT_READY',
        'Локальная касса ещё не подключена. Повторите вход в кассовую сессию.',
      );
    const weighted = await browserWeightedBarcode(barcode, queryClient);
    assertAuthCurrent(auth);
    if (weighted) {
      const { data } = await request.get('/v1/pos/catalog/lookup', {
        params: { scale_plu: weighted.scalePlu },
      });
      assertAuthCurrent(auth);
      const products = data.data?.products as ProductResponse[] | undefined;
      if (!Array.isArray(products) || products.length > 1)
        throw new PosError(
          'POS_API_INVALID_RESPONSE',
          'Сервер вернул неоднозначный ответ для весового товара.',
        );
      const product = products[0];
      if (!product)
        throw new PosError('PRODUCT_NOT_FOUND', 'Весовой товар не найден.');
      assertWeightedProduct(product, weighted);
      resolved = { product, quantity: weighted.quantity };
    } else {
      const dataMatrix = parseGs1DataMatrix(barcode);
      const search = dataMatrix?.gtin ?? barcode;
      const result = await searchProducts({ limit: 20, offset: 0, search });
      resolved = {
        product: selectExactBarcodeProduct(result.products, search),
        quantity: '1',
        ...(dataMatrix ? { markingCode: dataMatrix.markingCode } : {}),
      };
    }
  }
  assertAuthCurrent(auth);
  if (resolved.product.organization_id !== organizationId)
    throw new PosError(
      'LOCAL_CONTEXT_CHANGED',
      'Ответ поиска относится к другой организации. Повторите поиск.',
    );
  return resolved;
}
