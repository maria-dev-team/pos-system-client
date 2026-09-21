import { queryOptions } from '@tanstack/react-query';

import { getCurrentCashierSession } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const currentCashierSessionQueryOptions = (
  registerId: string,
  includeOther = false,
) =>
  queryOptions({
    queryFn: () => getCurrentCashierSession(registerId, includeOther),
    queryKey: includeOther
      ? queryKeys.cashierSessions.currentIncludingOthers(registerId)
      : queryKeys.cashierSessions.current(registerId),
    retry: false,
  });
