import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CategoryResponse,
  type ProductResponse,
  getCategories,
  searchProducts,
} from '@renderer/common/api';

import { CheckoutCategoryPicker } from './checkout-category-picker';

vi.mock('@renderer/common/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/common/api')>();
  return {
    ...actual,
    getCategories: vi.fn(),
    searchProducts: vi.fn(),
  };
});

const category = (
  overrides: Partial<CategoryResponse> = {},
): CategoryResponse => ({
  children: [],
  created_at: '2026-08-29T10:00:00.000Z',
  deleted_at: null,
  id: 'category-1',
  name: 'Напитки',
  organization_id: 'organization-1',
  parent_id: null,
  updated_at: '2026-08-29T10:00:00.000Z',
  ...overrides,
});

const product = (
  overrides: Partial<ProductResponse> = {},
): ProductResponse => ({
  barcode: '001234',
  category_id: 'tea',
  created_at: '2026-08-29T10:00:00.000Z',
  deleted_at: null,
  id: 'product-1',
  is_active: true,
  name: 'Чёрный чай',
  organization_id: 'organization-1',
  retail_price: '950.00',
  sku: 'TEA-1',
  unit: 'pcs',
  updated_at: '2026-08-29T10:00:00.000Z',
  ...overrides,
});

const tree = [
  category({
    children: [
      category({
        id: 'tea',
        name: 'Чай',
        parent_id: 'category-1',
      }),
    ],
  }),
];

const categoryPage = (categories = tree, hasMore = false, offset = 0) => ({
  categories,
  meta: { has_more: hasMore, limit: 100, offset, total: categories.length },
});

const productPage = (
  products: ProductResponse[],
  hasMore = false,
  offset = 0,
) => ({
  meta: { has_more: hasMore, limit: 100, offset, total: products.length },
  products,
});

const renderPicker = (
  open: boolean,
  onSelectProduct = vi.fn().mockResolvedValue(undefined),
  disabled = false,
  onOpenChange = vi.fn(),
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CheckoutCategoryPicker
        disabled={disabled}
        onOpenChange={onOpenChange}
        onSelectProduct={onSelectProduct}
        open={open}
        organizationId="organization-1"
        storeId="store-1"
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onSelectProduct, queryClient };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCategories).mockResolvedValue(categoryPage());
  vi.mocked(searchProducts).mockResolvedValue(productPage([product()]));
});

afterEach(cleanup);

describe('CheckoutCategoryPicker', () => {
  it('loads categories only when opened', async () => {
    const { queryClient } = renderPicker(false);

    expect(getCategories).not.toHaveBeenCalled();
    cleanup();
    queryClient.clear();
    renderPicker(true);

    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Напитки' }),
    ).toBeInTheDocument();
    expect(getCategories).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });

  it('shows only sellable products after drilling into a leaf category', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue(
      productPage([
        product(),
        product({ id: 'inactive', is_active: false, name: 'Старый чай' }),
        product({ id: 'no-price', name: 'Чай без цены', retail_price: null }),
      ]),
    );
    renderPicker(true);

    await user.click(
      await screen.findByRole('button', { name: 'Открыть категорию Напитки' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Открыть категорию Чай' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Добавить товар Чёрный чай' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Старый чай')).not.toBeInTheDocument();
    expect(screen.queryByText('Чай без цены')).not.toBeInTheDocument();
    expect(searchProducts).toHaveBeenCalledWith({
      categoryId: 'tea',
      limit: 100,
      offset: 0,
    });
  });

  it('keeps the dialog open and announces a successful add', async () => {
    const user = userEvent.setup();
    const { onSelectProduct } = renderPicker(true);

    await user.click(
      await screen.findByRole('button', { name: 'Открыть категорию Напитки' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Открыть категорию Чай' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Добавить товар Чёрный чай' }),
    );

    await waitFor(() =>
      expect(onSelectProduct).toHaveBeenCalledWith(product()),
    );
    expect(screen.getByText('Товар «Чёрный чай» добавлен')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Товары по категориям' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(
      screen.getByRole('button', { name: 'Открыть категорию Напитки' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Товар «Чёрный чай» добавлен'),
    ).not.toBeInTheDocument();
  });

  it('can be closed while product selection is disabled', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPicker(true, undefined, true, onOpenChange);

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('retries a failed category request', async () => {
    const user = userEvent.setup();
    vi.mocked(getCategories)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(categoryPage());
    renderPicker(true);

    expect(
      await screen.findByText('Не удалось загрузить категории'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Напитки' }),
    ).toBeInTheDocument();
  });

  it('loads the next product page inside a leaf category', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockImplementation(async ({ offset }) =>
      offset === 0
        ? productPage([product()], true)
        : productPage(
            [product({ id: 'product-2', name: 'Зелёный чай' })],
            false,
            100,
          ),
    );
    renderPicker(true);

    await user.click(
      await screen.findByRole('button', { name: 'Открыть категорию Напитки' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Открыть категорию Чай' }),
    );
    await screen.findByText('Чёрный чай');
    await user.click(screen.getByRole('button', { name: 'Загрузить ещё' }));

    expect(await screen.findByText('Зелёный чай')).toBeInTheDocument();
    expect(searchProducts).toHaveBeenLastCalledWith({
      categoryId: 'tea',
      limit: 100,
      offset: 100,
    });
  });
});
