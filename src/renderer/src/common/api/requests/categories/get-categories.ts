import { callLocalPos, localPosActive } from '../../../lib/local-pos';
import { request } from '../../request';
import type { CategorySearchResponse } from '../../responses';

type GetCategoriesPayload = {
  limit?: number;
  offset?: number;
};

export const getCategories = async (
  params: GetCategoriesPayload,
): Promise<CategorySearchResponse> => {
  if (localPosActive())
    return callLocalPos<CategorySearchResponse>({
      type: 'categories',
      ...params,
    });
  const response = await request.get('/v1/categories', { params });
  return response.data.data as CategorySearchResponse;
};
