import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, LoaderCircle, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  type CategoryResponse,
  type ProductResponse,
  getCategories,
  searchProducts,
} from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@renderer/common/components/ui/tabs';
import { queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { LocalPosSyncBar } from '@renderer/features/local-pos';

const PAGE_SIZE = 100;
type BrowseMode = 'groups' | 'categories';
const modeKey = (organizationId: string, storeId: string) =>
  `quick-products-mode:${organizationId}:${storeId}`;
const readMode = (key: string): BrowseMode => {
  try {
    return localStorage.getItem(key) === 'groups' ? 'groups' : 'categories';
  } catch {
    return 'categories';
  }
};

type CheckoutCategoryPickerProps = {
  canReadCategories?: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProduct: (product: ProductResponse) => Promise<unknown>;
  open: boolean;
  organizationId: string;
  storeId: string;
};

const pruneCategoryTree = (
  categories: CategoryResponse[],
  categoryIds: Set<string>,
): CategoryResponse[] =>
  categories.flatMap((category) => {
    const children = pruneCategoryTree(category.children, categoryIds);
    return categoryIds.has(category.id) || children.length
      ? [{ ...category, children }]
      : [];
  });

export function CheckoutCategoryPicker(props: CheckoutCategoryPickerProps) {
  return (
    <QuickProductPicker
      key={`${props.organizationId}:${props.storeId}:${props.canReadCategories ?? true}`}
      {...props}
    />
  );
}

function QuickProductPicker({
  canReadCategories = true,
  disabled,
  onOpenChange,
  onSelectProduct,
  open,
  organizationId,
  storeId,
}: CheckoutCategoryPickerProps) {
  const storageKey = modeKey(organizationId, storeId);
  const [mode, setMode] = useState<BrowseMode>(() =>
    canReadCategories ? readMode(storageKey) : 'groups',
  );
  const [path, setPath] = useState<CategoryResponse[]>([]);
  const [addingProductId, setAddingProductId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const selectedCategory = path.at(-1);
  const categories = useInfiniteQuery({
    enabled: open && mode === 'categories',
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      getCategories({ limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (page) =>
      page.meta.has_more ? page.meta.offset + page.meta.limit : undefined,
    queryKey: queryKeys.categories.tree(organizationId),
  });
  const quickProducts = useInfiniteQuery({
    enabled: open,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      searchProducts({
        isQuick: true,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (page) =>
      page.meta.has_more ? page.meta.offset + page.meta.limit : undefined,
    queryKey: queryKeys.products.quick(organizationId, storeId),
  });

  const {
    fetchNextPage: fetchCategories,
    hasNextPage: moreCategories,
    isFetchingNextPage: fetchingCategories,
    isError: categoriesError,
  } = categories;
  const {
    fetchNextPage: fetchProducts,
    hasNextPage: moreProducts,
    isFetchingNextPage: fetchingProducts,
    isError: productsError,
  } = quickProducts;
  useEffect(() => {
    if (
      open &&
      mode === 'categories' &&
      moreCategories &&
      !fetchingCategories &&
      !categoriesError
    )
      void fetchCategories();
  }, [
    open,
    moreCategories,
    mode,
    fetchingCategories,
    categoriesError,
    fetchCategories,
  ]);
  useEffect(() => {
    if (open && moreProducts && !fetchingProducts && !productsError)
      void fetchProducts();
  }, [open, moreProducts, fetchingProducts, productsError, fetchProducts]);

  const sellableQuickProducts = useMemo(
    () =>
      (quickProducts.data?.pages.flatMap((page) => page.products) ?? []).filter(
        (product) =>
          product.is_quick &&
          product.is_active &&
          product.retail_price !== null,
      ),
    [quickProducts.data],
  );
  const rootCategories = useMemo(() => {
    const categoryIds = new Set(
      sellableQuickProducts.flatMap((product) =>
        product.category_id ? [product.category_id] : [],
      ),
    );
    const roots = pruneCategoryTree(
      categories.data?.pages.flatMap((page) => page.categories) ?? [],
      categoryIds,
    );
    return roots;
  }, [categories.data, sellableQuickProducts]);
  const rootGroups = useMemo(() => {
    const groups = new Map<string, CategoryResponse>();
    for (const product of sellableQuickProducts) {
      for (const group of product.quick_groups ?? []) {
        groups.set(group.id, {
          ...group,
          children: [],
          organization_id: organizationId,
          parent_id: null,
          created_at: '',
          updated_at: '',
          deleted_at: null,
        });
      }
    }
    return [...groups.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'ru'),
    );
  }, [sellableQuickProducts, organizationId]);
  const visibleCategories = selectedCategory
    ? selectedCategory.children
    : mode === 'groups'
      ? rootGroups
      : rootCategories;
  const visibleProducts = sellableQuickProducts.filter((product) => {
    if (mode === 'groups')
      return selectedCategory
        ? product.quick_groups?.some(
            (group) => group.id === selectedCategory.id,
          )
        : !product.quick_groups?.length;
    return selectedCategory
      ? product.category_id === selectedCategory.id
      : !product.category_id;
  });
  const busy = addingProductId !== undefined;
  const pending = disabled || busy;
  const loading =
    (mode === 'categories' && categories.isPending) || quickProducts.isPending;

  const selectProduct = async (product: ProductResponse) => {
    if (pending) return;
    setAnnouncement('');
    setAddingProductId(product.id);
    try {
      await onSelectProduct(product);
      setAnnouncement(`Товар «${product.name}» добавлен`);
    } catch {
      // The checkout mutation already reports the actionable API error.
    } finally {
      setAddingProductId(undefined);
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) {
          setPath([]);
          setAnnouncement('');
          setAddingProductId(undefined);
        }
        if (nextOpen || !busy) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent
        className="flex max-h-[calc(100svh-2rem)] min-h-[min(42rem,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton={!busy}
      >
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>Быстрые товары</DialogTitle>
          <DialogDescription>
            Выберите папку или товар. Товары без группы или категории показаны
            на главном экране.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            if (pending || (value !== 'groups' && value !== 'categories'))
              return;
            setMode(value);
            setPath([]);
            setAnnouncement('');
            try {
              localStorage.setItem(storageKey, value);
            } catch {
              /* The selection still persists while this checkout is mounted. */
            }
          }}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            className="mx-6 my-3 shrink-0"
            aria-label="Способ выбора быстрых товаров"
          >
            <TabsTrigger value="groups" disabled={pending}>
              По группам
            </TabsTrigger>
            <TabsTrigger
              value="categories"
              disabled={pending || !canReadCategories}
            >
              По категориям
            </TabsTrigger>
          </TabsList>
          <TabsContent value={mode} className="flex min-h-0 flex-1 flex-col">
            <LocalPosSyncBar />

            {path.length ? (
              <nav
                aria-label="Путь быстрого выбора"
                className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/35 px-4 py-1"
              >
                <Button
                  className="min-h-10 px-3"
                  disabled={pending}
                  onClick={() => {
                    setPath([]);
                    setAnnouncement('');
                  }}
                  type="button"
                  variant="ghost"
                >
                  {mode === 'groups' ? 'Все группы' : 'Все категории'}
                </Button>
                {path.map((category, index) => (
                  <span
                    className="flex min-w-0 items-center gap-1"
                    key={category.id}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    {index === path.length - 1 ? (
                      <span
                        aria-current="page"
                        className="px-3 py-2 text-sm font-medium"
                      >
                        {category.name}
                      </span>
                    ) : (
                      <Button
                        className="min-h-10 px-3"
                        disabled={pending}
                        onClick={() => {
                          setPath(path.slice(0, index + 1));
                          setAnnouncement('');
                        }}
                        type="button"
                        variant="ghost"
                      >
                        {category.name}
                      </Button>
                    )}
                  </span>
                ))}
              </nav>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {loading ? (
                <LoadingState label="Загружаем быстрые товары" />
              ) : (mode === 'categories' && categories.isError) ||
                quickProducts.isError ? (
                <ErrorState
                  label="Не удалось загрузить быстрые товары"
                  onRetry={() =>
                    void Promise.all([
                      ...(mode === 'categories' ? [categories.refetch()] : []),
                      quickProducts.refetch(),
                    ])
                  }
                />
              ) : visibleCategories.length || visibleProducts.length ? (
                <div className="space-y-6">
                  {(mode === 'categories' && fetchingCategories) ||
                  fetchingProducts ? (
                    <p role="status">Загружаем остальные товары…</p>
                  ) : null}
                  {visibleCategories.length ? (
                    <section
                      aria-label={
                        mode === 'groups'
                          ? 'Группы быстрых товаров'
                          : 'Категории быстрых товаров'
                      }
                    >
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                        {mode === 'groups' ? 'Группы' : 'Категории'}
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleCategories.map((category) => (
                          <button
                            aria-label={`Открыть ${mode === 'groups' ? 'группу' : 'категорию'} ${category.name}`}
                            className="flex min-h-28 items-center justify-between gap-4 rounded-xl border border-border bg-background p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/30 hover:bg-primary/[0.025] hover:shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-55"
                            disabled={pending}
                            key={category.id}
                            onClick={() => {
                              setPath([...path, category]);
                              setAnnouncement('');
                            }}
                            type="button"
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                                <Folder aria-hidden="true" className="size-5" />
                              </span>
                              <span className="font-semibold leading-snug">
                                {category.name}
                              </span>
                            </span>
                            <ChevronRight
                              aria-hidden="true"
                              className="size-5 shrink-0 text-muted-foreground"
                            />
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {visibleProducts.length ? (
                    <section aria-label="Быстрые товары в текущем разделе">
                      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                        {selectedCategory
                          ? 'Товары'
                          : mode === 'groups'
                            ? 'Товары без группы'
                            : 'Товары без категории'}
                      </h3>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleProducts.map((product) => (
                          <button
                            aria-label={`Добавить товар ${product.name}`}
                            className="min-h-28 rounded-xl border border-border bg-background p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/30 hover:bg-primary/[0.025] hover:shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={pending}
                            key={product.id}
                            onClick={() => void selectProduct(product)}
                            type="button"
                          >
                            <span className="flex items-start justify-between gap-3">
                              <span className="font-semibold leading-snug">
                                {product.name}
                              </span>
                              {addingProductId === product.id ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  className="size-5 shrink-0 animate-spin text-primary"
                                />
                              ) : (
                                <span className="shrink-0 font-bold tabular-nums text-primary">
                                  {formatCash(product.retail_price)}
                                </span>
                              )}
                            </span>
                            <span className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                              <Star
                                aria-hidden="true"
                                className="size-3.5 fill-primary/15 text-primary"
                              />
                              {[
                                product.sku,
                                product.barcode,
                                product.additional_barcode
                                  ? `Доп.: ${product.additional_barcode}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'Быстрый товар'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  label={
                    selectedCategory
                      ? 'В этом разделе нет доступных товаров'
                      : 'Быстрые товары пока не настроены'
                  }
                />
              )}
            </div>

            <p
              aria-live="polite"
              className={
                announcement
                  ? 'shrink-0 border-t border-border bg-card px-6 py-3 text-sm font-semibold text-success'
                  : 'sr-only'
              }
            >
              {announcement}
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <p className="flex min-h-52 items-center justify-center gap-2 text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="animate-spin" />
      {label}
    </p>
  );
}

function ErrorState({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid min-h-52 place-items-center text-center">
      <div>
        <p className="text-sm font-medium text-destructive">{label}</p>
        <Button
          data-error-retry="true"
          className="mt-3 min-h-12 border-border bg-background"
          onClick={onRetry}
          type="button"
          variant="ghost"
        >
          Повторить
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-52 place-items-center text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
