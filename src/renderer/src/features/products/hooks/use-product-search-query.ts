import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { searchProducts } from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export function useProductSearchQuery(
  term: string,
  canSearch: boolean,
  organizationId?: string,
  storeId?: string | null,
) {
  const normalizedTerm = term.trim();
  const [debouncedTerm, setDebouncedTerm] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedTerm(normalizedTerm),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [normalizedTerm]);

  const isReady =
    canSearch && debouncedTerm === normalizedTerm && debouncedTerm.length >= 2;
  const query = useQuery({
    enabled: isReady,
    queryFn: () =>
      searchProducts({ search: debouncedTerm, limit: 20, offset: 0 }),
    queryKey: queryKeys.products.search(
      organizationId,
      storeId,
      normalizedTerm,
    ),
  });

  return {
    ...query,
    data: isReady && !query.isFetching ? query.data : undefined,
  };
}
