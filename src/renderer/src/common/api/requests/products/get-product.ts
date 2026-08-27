import { request } from '../../request';
import type { ProductResponse } from '../../responses/product.response';

export const getProduct = async (
  productId: string,
): Promise<ProductResponse> => {
  const response = await request.get(`/v1/products/${productId}`);
  return response.data.data.product as ProductResponse;
};
