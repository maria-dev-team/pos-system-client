import { queryOptions } from '@tanstack/react-query';

import { getCurrentCashierSession } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const currentCashierSessionQueryOptions = (registerId: string) =>
  queryOptions({
    queryFn: () => getCurrentCashierSession(registerId),
    queryKey: queryKeys.cashierSessions.current(registerId),
    retry: false,
  });
