import { request } from '../../request';
import type { CategorySearchResponse } from '../../responses';

type GetCategoriesPayload = {
  limit?: number;
  offset?: number;
};

export const getCategories = async (
  params: GetCategoriesPayload,
): Promise<CategorySearchResponse> => {
  const response = await request.get('/v1/categories', { params });
  return response.data.data as CategorySearchResponse;
};
