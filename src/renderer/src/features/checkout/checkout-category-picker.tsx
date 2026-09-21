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
import { queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { LocalPosSyncBar } from '@renderer/features/local-pos';

const PAGE_SIZE = 100;
const UNCATEGORIZED_ID = '__uncategorized__';

type CheckoutCategoryPickerProps = {
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

export function CheckoutCategoryPicker({
  disabled,
  onOpenChange,
  onSelectProduct,
  open,
  organizationId,
  storeId,
}: CheckoutCategoryPickerProps) {
  const [path, setPath] = useState<CategoryResponse[]>([]);
  const [addingProductId, setAddingProductId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const selectedCategory = path.at(-1);
  const categories = useInfiniteQuery({
    enabled: open,
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

  useEffect(() => {
    if (open && categories.hasNextPage && !categories.isFetchingNextPage)
      void categories.fetchNextPage();
  }, [
    categories.fetchNextPage,
    categories.hasNextPage,
    categories.isFetchingNextPage,
    open,
  ]);

  useEffect(() => {
    if (open && quickProducts.hasNextPage && !quickProducts.isFetchingNextPage)
      void quickProducts.fetchNextPage();
  }, [
    open,
    quickProducts.fetchNextPage,
    quickProducts.hasNextPage,
    quickProducts.isFetchingNextPage,
  ]);

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
    if (sellableQuickProducts.some((product) => !product.category_id)) {
      roots.push({
        children: [],
        created_at: '',
        deleted_at: null,
        id: UNCATEGORIZED_ID,
        name: 'Без категории',
        organization_id: organizationId,
        parent_id: null,
        updated_at: '',
      });
    }
    return roots;
  }, [categories.data, organizationId, sellableQuickProducts]);
  const visibleCategories = selectedCategory
    ? selectedCategory.children
    : rootCategories;
  const visibleProducts = selectedCategory
    ? sellableQuickProducts.filter((product) =>
        selectedCategory.id === UNCATEGORIZED_ID
          ? !product.category_id
          : product.category_id === selectedCategory.id,
      )
    : [];
  const busy = addingProductId !== undefined;
  const pending = disabled || busy;
  const loading =
    categories.isPending ||
    quickProducts.isPending ||
    categories.hasNextPage ||
    quickProducts.hasNextPage ||
    categories.isFetchingNextPage ||
    quickProducts.isFetchingNextPage;

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
            Показаны только категории, в которых настроены быстрые товары.
          </DialogDescription>
        </DialogHeader>
        <LocalPosSyncBar />

        <nav
          aria-label="Путь категории"
          className="flex min-h-14 flex-wrap items-center gap-1 border-b border-border bg-muted/35 px-4 py-2"
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
            Быстрые товары
          </Button>
          {path.map((category, index) => (
            <span className="flex items-center gap-1" key={category.id}>
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              <Button
                aria-current={index === path.length - 1 ? 'page' : undefined}
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
            </span>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {loading ? (
            <LoadingState label="Загружаем быстрые товары" />
          ) : categories.isError || quickProducts.isError ? (
            <ErrorState
              label="Не удалось загрузить быстрые товары"
              onRetry={() =>
                void Promise.all([
                  categories.refetch(),
                  quickProducts.refetch(),
                ])
              }
            />
          ) : visibleCategories.length || visibleProducts.length ? (
            <div className="space-y-6">
              {visibleCategories.length ? (
                <section aria-label="Категории быстрых товаров">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {visibleCategories.map((category) => (
                      <button
                        aria-label={`Открыть категорию ${category.name}`}
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
                <section aria-label="Товары выбранной категории">
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
            <EmptyState label="Быстрые товары пока не настроены" />
          )}
        </div>

        <p
          aria-live="polite"
          className="min-h-12 border-t border-border bg-card px-6 py-3 text-sm font-semibold text-success"
        >
          {announcement}
        </p>
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
