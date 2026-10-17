import type { QueryClient } from '@tanstack/react-query';

import type { ProductResponse } from '@renderer/common/api';
import {
  assertAuthCurrent,
  captureAuth,
  request,
} from '@renderer/common/api/request';

import { buildScanCandidates } from '../../../../shared/pos/barcode-scan';
import {
  PosError,
  type ScannedProduct,
} from '../../../../shared/pos/contracts';
import { parseGs1DataMatrix } from '../../../../shared/pos/gs1-data-matrix';
import { productMatchesBarcode } from '../../../../shared/pos/product-policy';
import {
  type ScaleProfile,
  isIssuedPlu,
  mergeScaleProfiles,
  parseWeightedBarcode,
  scaleProfileSchema,
} from '../../../../shared/pos/weighted-barcode';
import { callLocalPos, localPosActive } from './local-pos';

const profileKey = (organizationId: string) =>
  ['products', 'scale-profile', organizationId] as const;

function scopedProducts(
  value: unknown,
  organizationId: string,
): ProductResponse[] {
  if (!Array.isArray(value))
    throw new PosError(
      'POS_API_INVALID_RESPONSE',
      'Сервер вернул некорректный каталог.',
    );
  if (value.some((product) => product?.organization_id !== organizationId))
    throw new PosError(
      'LOCAL_CONTEXT_CHANGED',
      'Ответ поиска относится к другой организации. Повторите поиск.',
    );
  return value;
}

function rememberProfile(
  value: unknown,
  auth: ReturnType<typeof captureAuth>,
  queryClient: QueryClient,
  organizationId: string,
) {
  assertAuthCurrent(auth);
  const parsed = scaleProfileSchema.safeParse(value);
  if (!parsed.success)
    throw new PosError(
      'POS_API_INVALID_RESPONSE',
      'Сервер вернул некорректные настройки весовых товаров.',
    );
  const profile = mergeScaleProfiles(
    queryClient.getQueryData<ScaleProfile>(profileKey(organizationId)),
    parsed.data,
  );
  queryClient.setQueryData(profileKey(organizationId), profile);
  return profile;
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
    const dataMatrix = parseGs1DataMatrix(barcode);
    const search = dataMatrix?.gtin ?? barcode;
    {
      const response = await request.get('/v1/pos/catalog/lookup', {
        params: { barcode: search },
      });
      const staticProducts = scopedProducts(
        response.data.data?.products,
        organizationId,
      );
      let profile = rememberProfile(
        response.data.data?.scale_profile,
        auth,
        queryClient,
        organizationId,
      );
      let label: ReturnType<typeof parseWeightedBarcode> = null;
      try {
        label = parseWeightedBarcode(search, profile);
      } catch (error) {
        if (!staticProducts.length) throw error;
      }
      let weightedProduct: ProductResponse | undefined;
      if (label && isIssuedPlu(label.scalePlu, profile)) {
        const response = await request.get('/v1/pos/catalog/lookup', {
          params: { scale_plu: label.scalePlu },
        });
        const products = scopedProducts(
          response.data.data?.products,
          organizationId,
        );
        if (products.length > 1)
          throw new PosError(
            'POS_API_INVALID_RESPONSE',
            'Сервер вернул неоднозначный ответ для весового товара.',
          );
        profile = rememberProfile(
          response.data.data?.scale_profile,
          auth,
          queryClient,
          organizationId,
        );
        weightedProduct = products[0];
      }
      const allProducts = [
        ...staticProducts,
        ...(weightedProduct ? [weightedProduct] : []),
      ];
      const candidates = buildScanCandidates(
        search,
        profile,
        staticProducts.filter((product) =>
          productMatchesBarcode(product, search),
        ),
        weightedProduct,
      );
      if (candidates.length > 1)
        throw new PosError(
          'PRODUCT_BARCODE_AMBIGUOUS',
          'Выберите трактовку штрихкода.',
          { current_version: 0, candidates },
        );
      const candidate = candidates[0];
      if (!candidate)
        throw new PosError('PRODUCT_NOT_FOUND', 'Товар не найден.');
      if (candidate.unavailable_reason === 'SCALE_BARCODE_INVALID')
        throw new PosError(
          candidate.unavailable_reason,
          'Товар недоступен для продажи.',
        );
      const product = allProducts.find(
        (product) => product.id === candidate.product_id,
      );
      if (!product) throw new PosError('PRODUCT_NOT_FOUND', 'Товар не найден.');
      resolved = {
        product,
        kind: candidate.kind,
        quantity: candidate.quantity ?? '1',
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
