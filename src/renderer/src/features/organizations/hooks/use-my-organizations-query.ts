import { queryOptions, useQuery } from '@tanstack/react-query';

import { getMyOrganizations } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const organizationsQueryOptions = () =>
  queryOptions({
    queryFn: getMyOrganizations,
    queryKey: queryKeys.organizations.mine(),
  });

export const useMyOrganizationsQuery = (enabled = true) =>
  useQuery({ ...organizationsQueryOptions(), enabled });
