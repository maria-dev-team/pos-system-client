import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  type ProductSearchResponse,
  searchProducts,
} from '@renderer/common/api';
import { captureAuth, request } from '@renderer/common/api/request';
import { queryKeys } from '@renderer/common/constants';

import { ids, productFixture } from '../../../../shared/pos/test-fixtures';
import { useCheckoutProductScan } from './use-checkout-product-scan';

vi.mock('@renderer/common/api/request', () => ({
  request: { get: vi.fn() },
  captureAuth: vi.fn(),
  assertAuthCurrent: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(captureAuth).mockReturnValue({
    token: null,
    root: null,
    generation: 0,
    context: 'store-1',
  });
  vi.mocked(request.get).mockResolvedValue({
    data: {
      data: {
        scale_profile: {
          format: 'ean13-weight-v1',
          prefix: '20',
          enabled: true,
          blocked_reason: null,
        },
      },
    },
  });
});
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
  await waitFor(() => expect(respond).toBeTypeOf('function'));
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
  await waitFor(() => expect(respond).toBeTypeOf('function'));
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
  await waitFor(() => expect(respond).toBeTypeOf('function'));
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

it.each(['000456', '2900000000018'])(
  'adds a product by its additional barcode %s in the browser fallback',
  async (barcode) => {
    const product = {
      ...productFixture(),
      additional_barcode: barcode,
      nkt: null,
    };
    vi.mocked(searchProducts).mockResolvedValue(response(product));
    const f = fixture();
    await act(() => f.result.current(barcode));
    expect(f.execute).toHaveBeenCalledWith({
      type: 'add',
      productId: product.id,
    });
    expect(f.onResolved).toHaveBeenCalledWith(barcode);
  },
);

it('refuses a secondary code matching another product primary code in the browser fallback', async () => {
  const product = { ...productFixture(), additional_barcode: '000456' };
  vi.mocked(searchProducts).mockResolvedValue(
    response(product, {
      ...productFixture(),
      id: ids.shift,
      barcode: '000456',
      nkt: null,
    }),
  );
  const f = fixture();
  await act(() => f.result.current('000456'));
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.onIssue).toHaveBeenLastCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('нескольким товарам'),
    }),
  );
});

it('resolves a weighted label by PLU and preserves grams on each scan', async () => {
  const product = { ...productFixture(), unit: 'kg' as const, scale_plu: 1 };
  vi.mocked(request.get).mockImplementation(async (path) => ({
    data: {
      data:
        path === '/v1/pos/catalog/sync-start'
          ? {
              scale_profile: {
                format: 'ean13-weight-v1',
                prefix: '20',
                enabled: true,
                blocked_reason: null,
              },
            }
          : { products: [product] },
    },
  }));
  const f = fixture();
  await act(() =>
    Promise.all([
      f.result.current('2000001001851'),
      f.result.current('2000001001851'),
    ]),
  );
  expect(searchProducts).not.toHaveBeenCalled();
  expect(request.get).toHaveBeenCalledWith('/v1/pos/catalog/lookup', {
    params: { scale_plu: 1 },
  });
  expect(f.execute).toHaveBeenCalledTimes(2);
  expect(f.execute).toHaveBeenNthCalledWith(1, {
    type: 'add',
    productId: product.id,
    quantity: '0.185',
  });
  expect(f.execute).toHaveBeenNthCalledWith(2, {
    type: 'add',
    productId: product.id,
    quantity: '0.185',
  });
});

it('rejects a blocked reserved label before product lookup or addition', async () => {
  vi.mocked(request.get).mockResolvedValue({
    data: {
      data: {
        scale_profile: {
          format: 'ean13-weight-v1',
          prefix: '20',
          enabled: false,
          blocked_reason: 'barcode_conflict',
        },
      },
    },
  });
  const f = fixture();
  await act(() => f.result.current('2000001001851'));
  expect(searchProducts).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.onIssue).toHaveBeenLastCalledWith(
    expect.objectContaining({ message: expect.any(String) }),
  );
});

it('shares a GTIN lookup without mixing the marking codes of different packages', async () => {
  const product = productFixture();
  product.nkt!.is_marked = true;
  vi.mocked(searchProducts).mockResolvedValue(response(product));
  const f = fixture();
  const first = '(01)04870000000012(21)FIRST';
  const second = '(01)04870000000012(21)SECOND';
  await act(() =>
    Promise.all([f.result.current(first), f.result.current(second)]),
  );
  expect(searchProducts).toHaveBeenCalledTimes(1);
  expect(f.execute).toHaveBeenNthCalledWith(1, {
    type: 'add',
    productId: product.id,
    markingCode: first,
  });
  expect(f.execute).toHaveBeenNthCalledWith(2, {
    type: 'add',
    productId: product.id,
    markingCode: second,
  });
  expect(request.get).not.toHaveBeenCalled();
});

it('does not reuse a package marking code when a raw GTIN shares its lookup', async () => {
  const product = productFixture();
  product.nkt!.is_marked = true;
  vi.mocked(searchProducts).mockResolvedValue(response(product));
  const f = fixture();
  const markingCode = '(01)04870000000012(21)FIRST';
  await act(() =>
    Promise.all([
      f.result.current(markingCode),
      f.result.current('04870000000012'),
    ]),
  );
  expect(searchProducts).toHaveBeenCalledTimes(1);
  expect(f.execute).toHaveBeenCalledExactlyOnceWith({
    type: 'add',
    productId: product.id,
    markingCode,
  });
  expect(f.onIssue).toHaveBeenCalledWith(
    expect.objectContaining({
      barcode: '04870000000012',
      message: expect.stringContaining('Data Matrix'),
    }),
  );
});

it('shares an in-flight profile request but refreshes it for the next scan', async () => {
  const product = { ...productFixture(), additional_barcode: '2900000000018' };
  vi.mocked(searchProducts).mockResolvedValue(response(product));
  const f = fixture();
  await act(() =>
    Promise.all([
      f.result.current(product.barcode),
      f.result.current('2900000000018'),
    ]),
  );
  expect(request.get).toHaveBeenCalledExactlyOnceWith(
    '/v1/pos/catalog/sync-start',
  );
  await act(() => f.result.current(product.barcode));
  expect(f.execute).toHaveBeenCalledTimes(3);
  expect(request.get).toHaveBeenCalledTimes(2);
});

it.each(['barcode conflict', 'prefix change', 'profile refresh failure'])(
  'refuses another weighted addition after a %s',
  async (change) => {
    const barcode = '2000001001851';
    const product = { ...productFixture(), unit: 'kg' as const, scale_plu: 1 };
    let changed = false;
    vi.mocked(searchProducts).mockResolvedValue(response());
    vi.mocked(request.get).mockImplementation(async (path) => {
      if (path === '/v1/pos/catalog/lookup')
        return { data: { data: { products: [product] } } };
      if (changed && change === 'profile refresh failure')
        throw new Error('profile unavailable');
      return {
        data: {
          data: {
            scale_profile: {
              format: 'ean13-weight-v1',
              prefix: changed && change === 'prefix change' ? '21' : '20',
              enabled: true,
              blocked_reason:
                changed && change === 'barcode conflict'
                  ? 'barcode_conflict'
                  : null,
            },
          },
        },
      };
    });
    const f = fixture();
    await act(() => f.result.current(barcode));
    expect(f.execute).toHaveBeenCalledExactlyOnceWith({
      type: 'add',
      productId: product.id,
      quantity: '0.185',
    });

    changed = true;
    await act(() => f.result.current(barcode));
    expect(f.execute).toHaveBeenCalledOnce();
    expect(
      vi
        .mocked(request.get)
        .mock.calls.filter(([path]) => path === '/v1/pos/catalog/lookup'),
    ).toHaveLength(1);
    expect(f.onIssue).toHaveBeenLastCalledWith({
      barcode,
      message: expect.any(String),
    });
    if (change === 'prefix change')
      expect(searchProducts).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
        search: barcode,
      });
    else expect(searchProducts).not.toHaveBeenCalled();
  },
);

it('does not reuse the previous authentication context profile', async () => {
  vi.mocked(searchProducts).mockResolvedValue(response(productFixture()));
  const f = fixture();
  await act(() => f.result.current(productFixture().barcode));
  vi.mocked(captureAuth).mockReturnValue({
    token: null,
    root: null,
    generation: 1,
    context: 'store-2',
  });
  await act(() => f.result.current(productFixture().barcode));
  expect(request.get).toHaveBeenCalledTimes(2);
});

it('does not guess a barcode type when the initial profile request fails', async () => {
  vi.mocked(request.get).mockRejectedValue(new Error('profile unavailable'));
  const f = fixture();
  await act(() => f.result.current('2000001001851'));
  expect(request.get).toHaveBeenCalledOnce();
  expect(searchProducts).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});

it('rejects an explicitly null profile instead of treating a reserved label as ordinary', async () => {
  vi.mocked(request.get).mockResolvedValue({
    data: { data: { scale_profile: null } },
  });
  vi.mocked(searchProducts).mockResolvedValue(response(productFixture()));
  const f = fixture();
  await act(() => f.result.current(productFixture().barcode));
  expect(searchProducts).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});
