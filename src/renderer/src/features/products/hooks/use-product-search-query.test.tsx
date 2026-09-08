import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { searchProducts } from '@renderer/common/api';

import { useProductSearchQuery } from './use-product-search-query';

vi.mock('@renderer/common/api', () => ({
  searchProducts: vi.fn(async () => ({ products: [], meta: {} })),
}));
vi.mock('@renderer/common/lib/local-pos', () => ({
  localPosActive: () => true,
}));

it('starts local search on each input change without the HTTP debounce', () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always' } },
  });
  const { rerender, unmount } = renderHook(
    ({ term }) => useProductSearchQuery(term, true, 'org', 'store'),
    {
      initialProps: { term: 'мол' },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  expect(searchProducts).toHaveBeenLastCalledWith({
    search: 'мол',
    limit: 20,
    offset: 0,
  });
  rerender({ term: 'моло' });
  expect(searchProducts).toHaveBeenLastCalledWith({
    search: 'моло',
    limit: 20,
    offset: 0,
  });
  unmount();
  client.clear();
});
