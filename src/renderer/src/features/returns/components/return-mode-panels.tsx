import { LoaderCircle, Search } from 'lucide-react';
import type { Dispatch, FormEventHandler, SetStateAction } from 'react';

import type {
  ProductResponse,
  ProductSearchResponse,
  ReceiptResponse,
  ReceiptsResponse,
} from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';

import type { ReceiptSelection, WithoutReceiptLine } from '../returns.types';
import { ReceiptItems, WithoutReceiptItems } from './return-items';

type QueryState<T> = {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isFetching: boolean;
  isPending: boolean;
  refetch: () => unknown;
};

const readableDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

export type ReceiptReturnPanelProps = {
  disabled: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onReceiptNumberChange: (value: string) => void;
  onSearch: FormEventHandler<HTMLFormElement>;
  onSelectReceipt: (value: string) => void;
  onSelectionsChange: Dispatch<
    SetStateAction<Record<string, ReceiptSelection>>
  >;
  page: number;
  receiptDetail: QueryState<ReceiptResponse>;
  receiptNumber: string;
  receiptSearchError: string | null;
  receipts: QueryState<ReceiptsResponse>;
  selections: Record<string, ReceiptSelection>;
  selectedReceiptNumber: string;
};

export function ReceiptReturnPanel({
  disabled,
  onNextPage,
  onPreviousPage,
  onReceiptNumberChange,
  onSearch,
  onSelectReceipt,
  onSelectionsChange,
  page,
  receiptDetail,
  receiptNumber,
  receiptSearchError,
  receipts,
  selections,
  selectedReceiptNumber,
}: ReceiptReturnPanelProps) {
  return (
    <>
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSearch}>
        <FormField className="flex-1">
          <Label htmlFor="return-receipt-number">Точный номер чека</Label>
          <Input
            aria-invalid={Boolean(receiptSearchError)}
            id="return-receipt-number"
            inputMode="numeric"
            onChange={(event) => onReceiptNumberChange(event.target.value)}
            placeholder="Например, 42"
            value={receiptNumber}
          />
        </FormField>
        <Button className="self-end" type="submit">
          <Search aria-hidden="true" />
          Найти чек
        </Button>
      </form>
      {receiptSearchError ? (
        <p className="text-sm font-medium text-destructive">
          {receiptSearchError}
        </p>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Последние чеки магазина</h2>
          {receipts.isFetching && !receipts.isPending ? (
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
          ) : null}
        </div>
        {receipts.isPending ? (
          <p className="py-8 text-center text-muted-foreground">
            Загружаем последние чеки
          </p>
        ) : receipts.isError ? (
          <div className="rounded-xl border border-destructive/20 p-5 text-center">
            <p className="font-semibold">Не удалось загрузить чеки</p>
            <Button
              className="mt-3"
              onClick={() => void receipts.refetch()}
              type="button"
              variant="ghost"
            >
              Повторить
            </Button>
          </div>
        ) : !receipts.data ? null : receipts.data.receipts.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            В магазине пока нет завершённых чеков
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {receipts.data.receipts.map((receiptSummary) => (
              <button
                aria-label={`Открыть чек №${receiptSummary.receipt_number}`}
                className="rounded-xl border border-border bg-background p-4 text-left hover:border-primary/35"
                key={receiptSummary.id}
                onClick={() => onSelectReceipt(receiptSummary.receipt_number)}
                type="button"
              >
                <span className="font-bold">
                  Чек №{receiptSummary.receipt_number}
                </span>
                <span className="mt-2 block text-xl font-extrabold text-primary">
                  {formatCash(receiptSummary.total)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {readableDate(receiptSummary.completed_at)}
                </span>
              </button>
            ))}
          </div>
        )}
        {!receipts.isPending && !receipts.isError && receipts.data ? (
          <div className="mt-4 flex justify-between gap-3">
            <Button
              disabled={page === 0 || receipts.isFetching}
              onClick={onPreviousPage}
              type="button"
              variant="ghost"
            >
              Предыдущая
            </Button>
            <Button
              disabled={!receipts.data.meta.has_more || receipts.isFetching}
              onClick={onNextPage}
              type="button"
              variant="ghost"
            >
              Следующая
            </Button>
          </div>
        ) : null}
      </div>

      {selectedReceiptNumber ? (
        <div className="border-t border-border pt-5">
          <h2 className="mb-3 font-bold">Чек №{selectedReceiptNumber}</h2>
          {receiptDetail.isPending ? (
            <p className="py-8 text-center text-muted-foreground">
              Загружаем чек
            </p>
          ) : receiptDetail.isError ? (
            <div className="rounded-xl border border-destructive/20 p-5 text-center">
              <p>
                {getHttpErrorMessage(
                  receiptDetail.error,
                  'Не удалось загрузить чек.',
                )}
              </p>
              <Button
                className="mt-3"
                onClick={() => void receiptDetail.refetch()}
                type="button"
                variant="ghost"
              >
                Повторить
              </Button>
            </div>
          ) : !receiptDetail.data ? null : (
            <ReceiptItems
              disabled={disabled}
              onChange={onSelectionsChange}
              receipt={receiptDetail.data}
              selections={selections}
            />
          )}
        </div>
      ) : null}
    </>
  );
}

export type WithoutReceiptReturnPanelProps = {
  canOverridePrice: boolean;
  lines: WithoutReceiptLine[];
  onAddProduct: (product: ProductResponse) => void;
  onOverride: (line: WithoutReceiptLine) => void;
  onProductSearchChange: (value: string) => void;
  onRemove: (productId: string) => void;
  onUpdate: (productId: string, update: Partial<WithoutReceiptLine>) => void;
  productSearch: string;
  products: QueryState<ProductSearchResponse>;
};

export function WithoutReceiptReturnPanel({
  canOverridePrice,
  lines,
  onAddProduct,
  onOverride,
  onProductSearchChange,
  onRemove,
  onUpdate,
  productSearch,
  products,
}: WithoutReceiptReturnPanelProps) {
  return (
    <>
      <FormField>
        <Label htmlFor="return-product-search">Поиск товаров</Label>
        <Input
          id="return-product-search"
          onChange={(event) => onProductSearchChange(event.target.value)}
          placeholder="Название, SKU или штрихкод"
          value={productSearch}
        />
      </FormField>
      {products.isPending && productSearch.trim().length >= 2 ? (
        <p className="py-5 text-center text-muted-foreground">Ищем товары</p>
      ) : products.isError ? (
        <div className="rounded-xl border border-destructive/20 p-4 text-center">
          <p>Не удалось найти товары</p>
          <Button
            onClick={() => void products.refetch()}
            type="button"
            variant="ghost"
          >
            Повторить
          </Button>
        </div>
      ) : products.data ? (
        products.data.products.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {products.data.products.map((product) => (
              <button
                aria-label={`Добавить товар ${product.name}`}
                className="rounded-xl border border-border bg-background p-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  product.retail_price === null ||
                  lines.some((line) => line.product.id === product.id)
                }
                key={product.id}
                onClick={() => onAddProduct(product)}
                type="button"
              >
                <span className="font-semibold">{product.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {product.sku} · {product.barcode}
                </span>
                <span className="mt-2 block font-bold text-primary">
                  {product.retail_price === null
                    ? 'Цена не указана'
                    : formatCash(product.retail_price)}
                </span>
                {!product.is_active ? (
                  <span className="mt-1 inline-block text-xs font-semibold text-amber-700">
                    Неактивен
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="py-5 text-center text-muted-foreground">
            Ничего не найдено
          </p>
        )
      ) : null}

      <WithoutReceiptItems
        canOverridePrice={canOverridePrice}
        lines={lines}
        onOverride={onOverride}
        onRemove={onRemove}
        onUpdate={onUpdate}
      />
    </>
  );
}
