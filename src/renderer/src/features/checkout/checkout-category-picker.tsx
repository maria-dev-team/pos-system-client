import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

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

const PAGE_SIZE = 100;

type CheckoutCategoryPickerProps = {
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectProduct: (product: ProductResponse) => Promise<unknown>;
  open: boolean;
  organizationId: string;
  storeId: string;
};

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
  const isLeaf = Boolean(
    selectedCategory && selectedCategory.children.length === 0,
  );
  const categories = useInfiniteQuery({
    enabled: open,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      getCategories({ limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (page) =>
      page.meta.has_more ? page.meta.offset + page.meta.limit : undefined,
    queryKey: queryKeys.categories.tree(organizationId),
  });
  const products = useInfiniteQuery({
    enabled: open && isLeaf,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      searchProducts({
        categoryId: selectedCategory!.id,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (page) =>
      page.meta.has_more ? page.meta.offset + page.meta.limit : undefined,
    queryKey: queryKeys.products.category(
      organizationId,
      storeId,
      selectedCategory?.id ?? '',
    ),
  });

  const rootCategories =
    categories.data?.pages.flatMap((page) => page.categories) ?? [];
  const visibleCategories = selectedCategory
    ? selectedCategory.children
    : rootCategories;
  const visibleProducts =
    products.data?.pages
      .flatMap((page) => page.products)
      .filter(
        (product) => product.is_active && product.retail_price !== null,
      ) ?? [];
  const busy = addingProductId !== undefined;
  const pending = disabled || busy;

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
          <DialogTitle>Товары по категориям</DialogTitle>
          <DialogDescription>
            Выберите категорию, затем нажмите на товар, чтобы добавить его в
            чек.
          </DialogDescription>
        </DialogHeader>

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
            Все категории
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
          {categories.isPending ? (
            <LoadingState label="Загружаем категории" />
          ) : categories.isError ? (
            <ErrorState
              label="Не удалось загрузить категории"
              onRetry={() => void categories.refetch()}
            />
          ) : isLeaf ? (
            products.isPending ? (
              <LoadingState label="Загружаем товары" />
            ) : products.isError ? (
              <ErrorState
                label="Не удалось загрузить товары"
                onRetry={() => void products.refetch()}
              />
            ) : (
              <>
                {visibleProducts.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {visibleProducts.map((product) => (
                      <button
                        aria-label={`Добавить товар ${product.name}`}
                        className="min-h-28 rounded-xl border border-border bg-background p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/30 hover:bg-primary/[0.025] hover:shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-55"
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
                        <span className="mt-3 block text-xs text-muted-foreground">
                          {product.sku} · {product.barcode}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState label="В этой категории нет доступных товаров" />
                )}
                {products.hasNextPage ? (
                  <LoadMoreButton
                    loading={products.isFetchingNextPage}
                    onClick={() => void products.fetchNextPage()}
                  />
                ) : null}
              </>
            )
          ) : (
            <>
              {visibleCategories.length ? (
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
              ) : (
                <EmptyState label="Категорий пока нет" />
              )}
              {!selectedCategory && categories.hasNextPage ? (
                <LoadMoreButton
                  loading={categories.isFetchingNextPage}
                  onClick={() => void categories.fetchNextPage()}
                />
              ) : null}
            </>
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
    <p className="grid min-h-52 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {label}
    </p>
  );
}

function LoadMoreButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="mx-auto mt-5 min-h-12 border-border bg-background"
      disabled={loading}
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" />
      ) : null}
      {loading ? 'Загружаем' : 'Загрузить ещё'}
    </Button>
  );
}
