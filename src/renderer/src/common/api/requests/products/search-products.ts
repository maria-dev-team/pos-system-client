import { request } from '../../request';
import type { ProductSearchResponse } from '../../responses/product.response';
import type { SearchProductsPayload } from '../../types/product.types';

export const searchProducts = async (
  params: SearchProductsPayload,
): Promise<ProductSearchResponse> => {
  const response = await request.get('/v1/products', { params });
  return response.data.data as ProductSearchResponse;
};
