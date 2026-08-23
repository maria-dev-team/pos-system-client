import { queryOptions, useQuery } from '@tanstack/react-query';

import { getCurrentUser } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const currentUserQueryOptions = () =>
  queryOptions({
    queryFn: getCurrentUser,
    queryKey: queryKeys.auth.currentUser(),
  });

export const useCurrentUserQuery = () => useQuery(currentUserQueryOptions());
