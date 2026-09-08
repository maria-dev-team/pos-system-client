import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import { queryKeys } from '@renderer/common/constants';
import { executeLocalSale } from '@renderer/common/lib/local-pos';

import type { SaleResponse } from '../../../../shared/pos/contracts';
import { newSale } from '../../../../shared/pos/sale';
import { ids, profileFixture } from '../../../../shared/pos/test-fixtures';
import { useSaleCommandMutation } from './use-sale-command-mutation';

vi.mock('@renderer/common/lib/local-pos', () => ({
  localPosActive: () => true,
  executeLocalSale: vi.fn(),
}));

it('does not queue a cached cart operation behind a remote barcode lookup in React Query', async () => {
  const sale = newSale(profileFixture(), ids.product, new Date().toISOString());
  let finish!: (sale: SaleResponse) => void;
  vi.mocked(executeLocalSale)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(sale);
  const client = new QueryClient({
    defaultOptions: { mutations: { networkMode: 'always', retry: false } },
  });
  client.setQueryData(queryKeys.sales.current(ids.session), null);
  const { result, unmount } = renderHook(
    () => useSaleCommandMutation(ids.session, null),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  let pending!: Promise<SaleResponse>;
  await act(async () => {
    pending = result.current.mutateAsync({ type: 'scan', barcode: 'remote' });
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.mutateAsync({ type: 'add', productId: ids.product });
  });
  expect(executeLocalSale).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish(sale);
    await pending;
  });
  unmount();
  client.clear();
});
