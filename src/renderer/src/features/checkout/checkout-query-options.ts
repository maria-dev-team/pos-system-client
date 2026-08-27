import { queryOptions } from '@tanstack/react-query';

import { getCurrentSale, getHeldSales, getSale } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const currentSaleQueryOptions = (cashierSessionId: string) =>
  queryOptions({
    queryFn: getCurrentSale,
    queryKey: queryKeys.sales.current(cashierSessionId),
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  });

export const heldSalesQueryOptions = (cashierSessionId: string) =>
  queryOptions({
    queryFn: getHeldSales,
    queryKey: queryKeys.sales.held(cashierSessionId),
  });

export const saleDetailsQueryOptions = (saleId: string) =>
  queryOptions({
    queryFn: () => getSale(saleId),
    queryKey: queryKeys.sales.detail(saleId),
  });
