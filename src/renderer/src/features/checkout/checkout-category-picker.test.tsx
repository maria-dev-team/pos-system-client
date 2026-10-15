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
  name: 'Выпечка',
  organization_id: 'organization-1',
  parent_id: null,
  updated_at: '2026-08-29T10:00:00.000Z',
  ...overrides,
});

const product = (
  overrides: Partial<ProductResponse> = {},
): ProductResponse => ({
  barcode: '001234',
  category_id: 'bread',
  created_at: '2026-08-29T10:00:00.000Z',
  deleted_at: null,
  id: 'product-1',
  is_active: true,
  is_quick: true,
  name: 'Хлеб',
  nkt: null,
  nkt_product_id: null,
  organization_id: 'organization-1',
  retail_price: '450.00',
  sku: 'BREAD-1',
  unit: 'pcs',
  updated_at: '2026-08-29T10:00:00.000Z',
  vat_rate: null,
  ...overrides,
});

const tree = [
  category({
    children: [
      category({
        id: 'bread',
        name: 'Хлеб',
        parent_id: 'category-1',
      }),
    ],
  }),
  category({ id: 'drinks', name: 'Напитки' }),
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
  localStorage.clear();
  vi.mocked(getCategories).mockResolvedValue(categoryPage());
  vi.mocked(searchProducts).mockResolvedValue(productPage([product()]));
});

afterEach(cleanup);

describe('CheckoutCategoryPicker', () => {
  it('loads only quick products when opened', async () => {
    const { queryClient } = renderPicker(false);

    expect(getCategories).not.toHaveBeenCalled();
    expect(searchProducts).not.toHaveBeenCalled();
    cleanup();
    queryClient.clear();
    renderPicker(true);

    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Путь быстрого выбора' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Быстрые товары' }),
    ).not.toBeInTheDocument();
    expect(getCategories).toHaveBeenCalledWith({ limit: 100, offset: 0 });
    expect(searchProducts).toHaveBeenCalledWith({
      isQuick: true,
      limit: 100,
      offset: 0,
    });
  });

  it('shows only categories that contain sellable quick products', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue(
      productPage([
        product(),
        product({ id: 'inactive', is_active: false, name: 'Старый хлеб' }),
        product({ id: 'no-price', name: 'Хлеб без цены', retail_price: null }),
        product({
          category_id: 'drinks',
          id: 'ordinary',
          is_quick: false,
          name: 'Обычный напиток',
        }),
      ]),
    );
    renderPicker(true);

    const bakery = await screen.findByRole('button', {
      name: 'Открыть категорию Выпечка',
    });
    expect(
      screen.queryByRole('button', { name: 'Открыть категорию Напитки' }),
    ).not.toBeInTheDocument();
    await user.click(bakery);
    await user.click(
      screen.getByRole('button', { name: 'Открыть категорию Хлеб' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Добавить товар Хлеб' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Старый хлеб')).not.toBeInTheDocument();
    expect(screen.queryByText('Хлеб без цены')).not.toBeInTheDocument();
    expect(screen.queryByText('Обычный напиток')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Хлеб' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Выпечка' }));
    expect(
      screen.getByRole('button', { name: 'Открыть категорию Хлеб' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Все категории' }));
    expect(
      screen.getByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Путь быстрого выбора' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the dialog open and announces a successful add', async () => {
    const user = userEvent.setup();
    const { onSelectProduct } = renderPicker(true);

    await user.click(
      await screen.findByRole('button', {
        name: 'Открыть категорию Выпечка',
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Открыть категорию Хлеб' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Добавить товар Хлеб' }),
    );

    await waitFor(() =>
      expect(onSelectProduct).toHaveBeenCalledWith(product()),
    );
    expect(screen.getByText('Товар «Хлеб» добавлен')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Быстрые товары' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(
      screen.getByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Товар «Хлеб» добавлен')).not.toBeInTheDocument();
  });

  it('shows uncategorized quick products directly beside category folders', async () => {
    vi.mocked(searchProducts).mockResolvedValue(
      productPage([
        product(),
        product({ category_id: null, id: 'kurt', name: 'Курт', sku: null }),
      ]),
    );
    renderPicker(true);
    expect(
      await screen.findByRole('button', { name: 'Добавить товар Курт' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Открыть категорию Без категории' }),
    ).not.toBeInTheDocument();
  });

  it('uses independent groups, keeps ungrouped products at the root, and supports multiple groups', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts).mockResolvedValue(
      productPage([
        product({
          quick_groups: [
            { id: 'breakfast', name: 'Завтрак' },
            { id: 'popular', name: 'Популярное' },
          ],
        }),
        product({ id: 'kurt', name: 'Курт', quick_groups: [] }),
      ]),
    );
    renderPicker(true);
    await user.click(screen.getByRole('tab', { name: 'По группам' }));
    expect(
      await screen.findByRole('button', { name: 'Добавить товар Курт' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Добавить товар Хлеб' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Открыть группу Завтрак' }),
    );
    expect(
      screen.getByRole('button', { name: 'Добавить товар Хлеб' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Добавить товар Курт' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Все группы' }));
    await user.click(
      screen.getByRole('button', { name: 'Открыть группу Популярное' }),
    );
    expect(
      screen.getByRole('button', { name: 'Добавить товар Хлеб' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'По категориям' }));
    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
  });

  it('remembers either tab after closing and remounting and does not fetch categories for groups', async () => {
    const user = userEvent.setup();
    renderPicker(true);
    await user.click(screen.getByRole('tab', { name: 'По группам' }));
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    cleanup();
    vi.mocked(getCategories).mockClear();
    renderPicker(true);
    expect(screen.getByRole('tab', { name: 'По группам' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await screen.findByRole('button', { name: 'Добавить товар Хлеб' }),
    ).toBeInTheDocument();
    expect(getCategories).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'По категориям' }));
    cleanup();
    renderPicker(true);
    expect(screen.getByRole('tab', { name: 'По категориям' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
  });

  it('allows group browsing if category loading fails', async () => {
    const user = userEvent.setup();
    vi.mocked(getCategories).mockRejectedValue(new Error('offline'));
    renderPicker(true);
    await screen.findByText('Не удалось загрузить быстрые товары');
    await user.click(screen.getByRole('tab', { name: 'По группам' }));
    expect(
      await screen.findByRole('button', { name: 'Добавить товар Хлеб' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Не удалось загрузить быстрые товары'),
    ).not.toBeInTheDocument();
  });

  it('can be closed while product selection is disabled', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPicker(true, undefined, true, onOpenChange);

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('retries a failed quick-products request', async () => {
    const user = userEvent.setup();
    vi.mocked(searchProducts)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(productPage([product()]));
    renderPicker(true);

    expect(
      await screen.findByText('Не удалось загрузить быстрые товары'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Выпечка' }),
    ).toBeInTheDocument();
  });

  it('loads every quick-product page before building categories', async () => {
    vi.mocked(searchProducts).mockImplementation(async ({ offset }) =>
      offset === 0
        ? productPage([product()], true)
        : productPage(
            [
              product({
                category_id: 'drinks',
                id: 'product-2',
                name: 'Вода',
              }),
            ],
            false,
            100,
          ),
    );
    renderPicker(true);

    expect(
      await screen.findByRole('button', { name: 'Открыть категорию Напитки' }),
    ).toBeInTheDocument();
    expect(searchProducts).toHaveBeenLastCalledWith({
      isQuick: true,
      limit: 100,
      offset: 100,
    });
  });
});
