import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { getProduct, getReceipt, getReceipts } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const receiptPageQueryOptions = (
  limit: number,
  offset: number,
  enabled: boolean,
  organizationId?: string | null,
  storeId?: string | null,
) =>
  queryOptions({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => getReceipts({ limit, offset }),
    queryKey: queryKeys.sales.receiptPage(
      limit,
      offset,
      organizationId,
      storeId,
    ),
  });

export const receiptQueryOptions = (
  receiptNumber: string,
  enabled: boolean,
  organizationId?: string | null,
  storeId?: string | null,
) =>
  queryOptions({
    enabled,
    queryFn: () => getReceipt(receiptNumber),
    queryKey: queryKeys.sales.receipt(receiptNumber, organizationId, storeId),
  });

export const productQueryOptions = (productId: string, enabled: boolean) =>
  queryOptions({
    enabled,
    queryFn: () => getProduct(productId),
    queryKey: queryKeys.products.detail(productId),
  });
