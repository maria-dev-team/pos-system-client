import { PosError } from '../../../../../../shared/pos/contracts';
import { callLocalPos, localPosActive } from '../../../lib/local-pos';
import { request } from '../../request';
import type { ProductSearchResponse } from '../../responses/product.response';
import type { SearchProductsPayload } from '../../types/product.types';

export const searchProducts = async (
  params: SearchProductsPayload,
): Promise<ProductSearchResponse> => {
  if (localPosActive())
    return callLocalPos<ProductSearchResponse>({ type: 'search', ...params });
  if (window.localPos)
    throw new PosError(
      'LOCAL_NOT_READY',
      'Локальная касса ещё не подключена. Повторите вход в кассовую сессию.',
    );
  const response = await request.get('/v1/products', { params });
  return response.data.data as ProductSearchResponse;
};
