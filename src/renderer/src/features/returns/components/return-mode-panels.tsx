import { ChevronRight, LoaderCircle, Search } from 'lucide-react';
import {
  type Dispatch,
  type FormEventHandler,
  Fragment,
  type SetStateAction,
} from 'react';

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

function ReceiptDetailContent({
  disabled,
  onSelectionsChange,
  receiptDetail,
  selections,
}: {
  disabled: boolean;
  onSelectionsChange: Dispatch<
    SetStateAction<Record<string, ReceiptSelection>>
  >;
  receiptDetail: QueryState<ReceiptResponse>;
  selections: Record<string, ReceiptSelection>;
}) {
  if (receiptDetail.isPending) {
    return (
      <p className="py-8 text-center text-muted-foreground">Загружаем чек</p>
    );
  }
  if (receiptDetail.isError) {
    return (
      <div className="py-5 text-center">
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
    );
  }
  if (!receiptDetail.data) return null;

  return (
    <ReceiptItems
      disabled={disabled}
      onChange={onSelectionsChange}
      receipt={receiptDetail.data}
      selections={selections}
    />
  );
}

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
  const selectedReceiptIsVisible = Boolean(
    receipts.data?.receipts.some(
      (receipt) => receipt.receipt_number === selectedReceiptNumber,
    ),
  );

  return (
    <>
      <section>
        <h2 className="font-bold">Найти чек продажи</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Номер напечатан в верхней части бумажного чека после знака №. Введите
          только цифры.
        </p>
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row"
          onSubmit={onSearch}
        >
          <FormField className="flex-1">
            <Label htmlFor="return-receipt-number">Номер чека</Label>
            <Input
              aria-invalid={Boolean(receiptSearchError)}
              id="return-receipt-number"
              inputMode="numeric"
              onChange={(event) => onReceiptNumberChange(event.target.value)}
              placeholder="Например: 42"
              value={receiptNumber}
            />
          </FormField>
          <Button className="self-end" type="submit">
            <Search aria-hidden="true" />
            Открыть чек
          </Button>
        </form>
      </section>
      {receiptSearchError ? (
        <p className="text-sm font-medium text-destructive">
          {receiptSearchError}
        </p>
      ) : null}

      {selectedReceiptNumber && !selectedReceiptIsVisible ? (
        <div className="rounded-xl border border-border bg-muted/15 p-4">
          <h2 className="mb-3 font-bold">
            Товары из чека №{selectedReceiptNumber}
          </h2>
          <ReceiptDetailContent
            disabled={disabled}
            onSelectionsChange={onSelectionsChange}
            receiptDetail={receiptDetail}
            selections={selections}
          />
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold">Или выберите недавний чек</h2>
            <p className="text-xs text-muted-foreground">
              Сначала показаны самые новые операции
            </p>
          </div>
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
          <div className="overflow-hidden rounded-xl border border-border bg-background divide-y divide-border">
            {receipts.data.receipts.map((receiptSummary) => {
              const selected =
                selectedReceiptNumber === receiptSummary.receipt_number;
              const detailId = `return-receipt-${receiptSummary.receipt_number}`;
              return (
                <Fragment key={receiptSummary.id}>
                  <button
                    aria-controls={detailId}
                    aria-expanded={selected}
                    aria-label={`Открыть чек №${receiptSummary.receipt_number}`}
                    aria-pressed={selected}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-primary/5 ${
                      selected ? 'bg-primary/10' : ''
                    }`}
                    onClick={() =>
                      onSelectReceipt(receiptSummary.receipt_number)
                    }
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold">
                        Чек №{receiptSummary.receipt_number}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {readableDate(receiptSummary.completed_at)}
                      </span>
                    </span>
                    <span className="font-extrabold tabular-nums text-primary">
                      {formatCash(receiptSummary.total)}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className={`size-5 transition-transform ${
                        selected ? 'rotate-90' : ''
                      }`}
                    />
                  </button>
                  {selected ? (
                    <div className="bg-muted/15 p-4" id={detailId}>
                      <ReceiptDetailContent
                        disabled={disabled}
                        onSelectionsChange={onSelectionsChange}
                        receiptDetail={receiptDetail}
                        selections={selections}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
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
      <section>
        <h2 className="font-bold">Найти товар</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Введите минимум 2 символа названия, артикул SKU или отсканируйте
          штрихкод.
        </p>
        <FormField className="mt-3">
          <Label htmlFor="return-product-search">Поиск товаров</Label>
          <Input
            id="return-product-search"
            onChange={(event) => onProductSearchChange(event.target.value)}
            placeholder="Например: молоко или 4870000000012"
            value={productSearch}
          />
        </FormField>
      </section>
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
          <div className="overflow-hidden rounded-xl border border-border bg-background divide-y divide-border">
            {products.data.products.map((product) => (
              <button
                aria-label={`Добавить товар ${product.name}`}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  product.retail_price === null ||
                  lines.some((line) => line.product.id === product.id)
                }
                key={product.id}
                onClick={() => onAddProduct(product)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{product.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    SKU {product.sku} · {product.barcode}
                  </span>
                  {!product.is_active ? (
                    <span className="mt-1 inline-block text-xs font-semibold text-amber-700">
                      Неактивен
                    </span>
                  ) : null}
                </span>
                <span className="font-bold tabular-nums text-primary">
                  {product.retail_price === null
                    ? 'Цена не указана'
                    : formatCash(product.retail_price)}
                </span>
                <ChevronRight aria-hidden="true" className="size-5" />
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
