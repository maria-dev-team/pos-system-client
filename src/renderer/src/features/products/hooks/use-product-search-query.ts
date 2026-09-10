import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { searchProducts } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';
import { localPosActive } from '@renderer/common/lib/local-pos';
import { shouldRetryQuery } from '@renderer/common/lib/query-client';

export function useProductSearchQuery(
  term: string,
  canSearch: boolean,
  organizationId?: string,
  storeId?: string | null,
) {
  const normalizedTerm = term.trim();
  const local = localPosActive();
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    if (local) return;
    const timeout = window.setTimeout(
      () => setDebouncedTerm(normalizedTerm),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [normalizedTerm, local]);

  const searchTerm = local ? normalizedTerm : debouncedTerm;

  const isReady =
    canSearch && searchTerm === normalizedTerm && searchTerm.length >= 2;
  const query = useQuery({
    enabled: isReady,
    queryFn: () => searchProducts({ search: searchTerm, limit: 20, offset: 0 }),
    retry: local ? false : shouldRetryQuery,
    queryKey: queryKeys.products.search(
      organizationId,
      storeId,
      normalizedTerm,
    ),
  });

  return {
    ...query,
    data:
      isReady && (localPosActive() || !query.isFetching)
        ? query.data
        : undefined,
  };
}
