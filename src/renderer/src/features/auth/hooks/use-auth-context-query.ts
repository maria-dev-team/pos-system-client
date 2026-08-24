import { queryOptions, useQuery } from '@tanstack/react-query';

import { getAuthContext } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

import { useAuthSession } from './use-auth-session';

export const authContextQueryOptions = () =>
  queryOptions({
    queryFn: getAuthContext,
    queryKey: queryKeys.auth.context(),
    retry: false,
  });

export const useAuthContextQuery = () => {
  const { isAuthenticated } = useAuthSession();

  return useQuery({ ...authContextQueryOptions(), enabled: isAuthenticated });
};
