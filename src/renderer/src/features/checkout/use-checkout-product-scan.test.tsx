import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import {
  type ProductSearchResponse,
  searchProducts,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

import { ids, productFixture } from '../../../../shared/pos/test-fixtures';
import { useCheckoutProductScan } from './use-checkout-product-scan';

vi.mock('@renderer/common/api', () => ({ searchProducts: vi.fn() }));
vi.mock('@renderer/common/lib/local-pos', () => ({
  localPosActive: () => false,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const options = {
    cashierSessionId: ids.session,
    organizationId: ids.organization,
    execute: vi.fn(async () => null),
    onIssue: vi.fn(),
    onResolved: vi.fn(),
    refocus: vi.fn(),
  };
  const hook = renderHook(() => useCheckoutProductScan(options), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, ...options, queryClient };
}
const response = (
  ...products: ReturnType<typeof productFixture>[]
): ProductSearchResponse => ({
  products,
  meta: { has_more: false, total: products.length, limit: 20, offset: 0 },
});

it('refuses ambiguous barcode/GTIN matches instead of adding the first product', async () => {
  const product = productFixture();
  vi.mocked(searchProducts).mockResolvedValue(
    response(product, { ...product, id: ids.shift }),
  );
  const f = fixture();
  await act(() => f.result.current(product.barcode));
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.onIssue).toHaveBeenLastCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('нескольким товарам'),
    }),
  );
});
it('does not put a late result into another cart', async () => {
  let respond!: (value: ProductSearchResponse) => void;
  vi.mocked(searchProducts).mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const f = fixture();
  const pending = f.result.current(productFixture().barcode);
  f.queryClient.setQueryData(queryKeys.sales.current(ids.session), {
    id: 'another-cart',
  });
  await act(async () => {
    respond(response(productFixture()));
    await pending;
  });
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.onIssue).toHaveBeenLastCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('Чек изменился'),
    }),
  );
});
it('ignores a response after leaving the workspace', async () => {
  let respond!: (value: ProductSearchResponse) => void;
  vi.mocked(searchProducts).mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const f = fixture();
  const pending = f.result.current(productFixture().barcode);
  f.unmount();
  respond(response(productFixture()));
  await pending;
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.refocus).not.toHaveBeenCalled();
});
it('shares a barcode lookup while preserving each distinct scan command', async () => {
  let respond!: (value: ProductSearchResponse) => void;
  vi.mocked(searchProducts).mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const f = fixture();
  const pending = [
    f.result.current(productFixture().barcode),
    f.result.current(productFixture().barcode),
  ];
  await act(async () => {
    respond(response(productFixture()));
    await Promise.all(pending);
  });
  expect(searchProducts).toHaveBeenCalledTimes(1);
  expect(f.execute).toHaveBeenCalledTimes(2);
});
it('rejects a product belonging to another organization', async () => {
  vi.mocked(searchProducts).mockResolvedValue(
    response({ ...productFixture(), organization_id: ids.store }),
  );
  const f = fixture();
  await act(() => f.result.current(productFixture().barcode));
  expect(f.execute).not.toHaveBeenCalled();
});
