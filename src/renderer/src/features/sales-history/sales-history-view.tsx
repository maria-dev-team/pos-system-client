import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  ReceiptText,
  RotateCcw,
  Search,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type ReceiptResponse,
  type ReceiptSummaryResponse,
  getReceipt,
  getReceipts,
} from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import { Input } from '@renderer/common/components/ui/input';
import { queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import { formatQuantity } from '@renderer/common/lib/quantity';
import { receiptNumberSchema } from '@renderer/common/schemas/receipt-number.schema';
import { ReceiptPrintButton } from '@renderer/features/receipt-printing';

const pageSize = 20;
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short',
  timeStyle: 'short',
});
const paymentLabels = { CASH: 'Наличные', CASHLESS: 'Безналичные' } as const;

export type SalesHistoryViewProps = {
  cashierSession: CashierSessionResponse;
  context: AuthContextResponse;
  onBackToCheckout: () => void;
  onOpenReturn: (receiptNumber: string) => void;
  onOpenReturnWithoutReceipt?: () => void;
  onPageChange: (page: number) => void;
  onReceiptNumberChange: (receiptNumber?: string) => void;
  page: number;
  receiptNumber?: string;
};

const formatDateTime = (value: string) =>
  dateTimeFormatter.format(new Date(value));

const summaryPayment = (receipt: ReceiptSummaryResponse) =>
  [
    ...new Set(receipt.payments.map(({ method }) => paymentLabels[method])),
  ].join(' + ');

function ReceiptDetail({ receipt }: { receipt: ReceiptResponse }) {
  return (
    <div className="space-y-4 p-4">
      <div className="border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Чек</p>
            <h2 className="text-2xl font-extrabold">
              №{receipt.receipt_number}
            </h2>
          </div>
          <p className="text-right text-sm text-muted-foreground">
            {formatDateTime(receipt.completed_at ?? receipt.created_at)}
          </p>
        </div>
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Кассир: </span>
          <span className="font-semibold">
            {receipt.cashier_name ?? 'Имя не указано'}
          </span>
        </p>
      </div>

      <div>
        <h3 className="mb-3 font-bold">Позиции</h3>
        <div className="space-y-3">
          {receipt.items.map((item) => (
            <article
              className="rounded-xl border border-border/70 bg-muted/25 p-4"
              key={item.id}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-words font-semibold [overflow-wrap:anywhere]">
                    {item.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatQuantity(item.quantity, item.unit_code)} ×{' '}
                    {formatCash(item.unit_price)}
                  </p>
                  {Number(item.returned_quantity) > 0 ? (
                    <p className="mt-1 text-xs font-medium text-warning">
                      {`Возвращено: ${formatQuantity(item.returned_quantity, item.unit_code)}`}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  {item.discount_amount !== '0.00' ? (
                    <>
                      <p className="text-xs text-muted-foreground line-through">
                        {formatCash(item.line_subtotal)}
                      </p>
                      <p className="text-xs font-semibold text-destructive">
                        −{formatCash(item.discount_amount)}
                      </p>
                    </>
                  ) : null}
                  <p className="font-bold">{formatCash(item.line_total)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t border-border/70 pt-4">
        <h3 className="mb-3 font-bold">Оплата</h3>
        <div className="space-y-2">
          {receipt.payments.map((payment) => (
            <div
              className="flex items-center justify-between gap-4 text-sm"
              key={payment.id}
            >
              <span className="text-muted-foreground">
                {paymentLabels[payment.method]}
              </span>
              <span className="font-semibold tabular-nums">
                {formatCash(payment.amount)}
              </span>
            </div>
          ))}
        </div>
        {receipt.discount_percentage ? (
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Подытог</span>
              <span className="font-semibold tabular-nums">
                {formatCash(receipt.subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                Скидка{' '}
                {Number(receipt.discount_percentage).toLocaleString('ru-RU', {
                  maximumFractionDigits: 2,
                })}
                %
              </span>
              <span className="font-semibold tabular-nums text-destructive">
                −{formatCash(receipt.discount_amount)}
              </span>
            </div>
            {receipt.discount_reason ? (
              <p className="break-words text-xs text-muted-foreground">
                {receipt.discount_reason}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-border pt-4">
          <span className="font-bold">Итого</span>
          <span className="text-2xl font-extrabold tabular-nums text-primary">
            {formatCash(receipt.total)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function SalesHistoryView({
  cashierSession,
  context,
  onBackToCheckout,
  onOpenReturn,
  onOpenReturnWithoutReceipt,
  onPageChange,
  onReceiptNumberChange,
  page,
  receiptNumber,
}: SalesHistoryViewProps) {
  const [search, setSearch] = useState(receiptNumber ?? '');
  const [searchError, setSearchError] = useState<string>();
  const offset = page * pageSize;
  const receipts = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => getReceipts({ limit: pageSize, offset }),
    queryKey: queryKeys.sales.receiptPage(
      pageSize,
      offset,
      cashierSession.organization_id,
      cashierSession.store_id,
    ),
  });
  const detail = useQuery({
    enabled: Boolean(receiptNumber),
    queryFn: () => getReceipt(receiptNumber!),
    queryKey: queryKeys.sales.receipt(
      receiptNumber ?? '',
      cashierSession.organization_id,
      cashierSession.store_id,
    ),
  });
  const canReturn = Boolean(
    context.isSystemPosition ||
    (context.permissions.includes('returns.create') &&
      context.permissions.includes('sales.read')),
  );
  const canReturnWithoutReceipt = Boolean(
    onOpenReturnWithoutReceipt &&
    (context.isSystemPosition ||
      (context.permissions.includes('returns.create') &&
        context.permissions.includes('returns.without_receipt') &&
        context.permissions.includes('product.read'))),
  );
  const fullyReturned = Boolean(
    detail.data?.items.every(
      ({ returnable_quantity }) => Number(returnable_quantity) === 0,
    ),
  );
  const from = receipts.data?.receipts.length ? offset + 1 : 0;
  const to = receipts.data
    ? Math.min(offset + receipts.data.receipts.length, receipts.data.meta.total)
    : 0;

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = receiptNumberSchema.safeParse(search);
    if (!parsed.success) {
      setSearchError(
        parsed.error.issues[0]?.message ?? 'Введите корректный номер чека',
      );
      return;
    }
    setSearchError(undefined);
    onReceiptNumberChange(parsed.data);
  };

  const changePage = (nextPage: number) => {
    setSearch('');
    onPageChange(nextPage);
  };

  return (
    <main className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden bg-workspace p-4 sm:p-5">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-surface)]">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="Вернуться к продажам"
            onClick={onBackToCheckout}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight">
              Чеки и возвраты
            </h1>
            <p className="text-sm text-muted-foreground">
              История продаж и оформление возвратов
            </p>
          </div>
        </div>
        {canReturnWithoutReceipt ? (
          <Button onClick={onOpenReturnWithoutReceipt} type="button">
            <RotateCcw aria-hidden="true" />
            Возврат без чека
          </Button>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[var(--shadow-surface)]">
          <form
            className="shrink-0 border-b border-border/70 p-4"
            onSubmit={submitSearch}
          >
            <div className="flex gap-2">
              <Input
                aria-invalid={Boolean(searchError)}
                aria-label="Номер чека"
                inputMode="numeric"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSearchError(undefined);
                }}
                placeholder="Точный номер чека"
                value={search}
              />
              <Button type="submit" variant="ghost">
                <Search aria-hidden="true" />
                Найти чек
              </Button>
            </div>
            {searchError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {searchError}
              </p>
            ) : null}
          </form>

          <div className="min-h-0 flex-1 overflow-auto">
            {receipts.isPending ? (
              <div className="grid min-h-60 place-items-center text-muted-foreground">
                <p className="flex items-center gap-2">
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                  Загружаем историю продаж
                </p>
              </div>
            ) : receipts.isError ? (
              <div className="grid min-h-60 place-items-center p-6 text-center">
                <div>
                  <p className="font-semibold">Не удалось загрузить чеки</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {getHttpErrorMessage(receipts.error)}
                  </p>
                  <Button
                    className="mt-4"
                    onClick={() => void receipts.refetch()}
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" />
                    Повторить
                  </Button>
                </div>
              </div>
            ) : receipts.data.receipts.length === 0 ? (
              <div className="grid min-h-60 place-items-center p-6 text-center text-muted-foreground">
                <div>
                  <ReceiptText aria-hidden="true" className="mx-auto mb-3" />
                  {receipts.data.meta.total === 0
                    ? 'В магазине пока нет завершённых продаж'
                    : 'На этой странице нет продаж'}
                </div>
              </div>
            ) : (
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-xs uppercase text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Чек</th>
                    <th className="px-4 py-3 font-semibold">Дата и время</th>
                    <th className="px-4 py-3 font-semibold">Оплата</th>
                    <th className="px-4 py-3 text-right font-semibold">
                      Сумма
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.data.receipts.map((item) => {
                    const selected = item.receipt_number === receiptNumber;
                    return (
                      <tr
                        aria-selected={selected}
                        className={
                          selected
                            ? 'cursor-pointer border-b border-border/70 bg-primary/10'
                            : 'cursor-pointer border-b border-border/70 hover:bg-muted/35'
                        }
                        key={item.id}
                        onClick={() =>
                          onReceiptNumberChange(item.receipt_number)
                        }
                      >
                        <td className="p-2">
                          <Button
                            aria-label={`Открыть чек №${item.receipt_number}`}
                            aria-pressed={selected}
                            className="w-full justify-start"
                            onClick={(event) => {
                              event.stopPropagation();
                              onReceiptNumberChange(item.receipt_number);
                            }}
                            type="button"
                            variant="ghost"
                          >
                            №{item.receipt_number}
                          </Button>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {formatDateTime(item.completed_at)}
                        </td>
                        <td className="px-4 py-3">{summaryPayment(item)}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums">
                          {formatCash(item.total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border/70 p-4">
            <p className="text-sm text-muted-foreground">
              {receipts.data
                ? receipts.data.receipts.length
                  ? `${from}–${to} из ${receipts.data.meta.total}`
                  : `0 из ${receipts.data.meta.total}`
                : ''}
            </p>
            <div className="flex gap-2">
              <Button
                disabled={page === 0 || receipts.isPlaceholderData}
                onClick={() => changePage(page - 1)}
                type="button"
                variant="ghost"
              >
                <ChevronLeft aria-hidden="true" />
                Назад
              </Button>
              <Button
                disabled={
                  !receipts.data?.meta.has_more || receipts.isPlaceholderData
                }
                onClick={() => changePage(page + 1)}
                type="button"
                variant="ghost"
              >
                Далее
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </footer>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[var(--shadow-surface)]">
          <div className="min-h-0 flex-1 overflow-auto">
            {!receiptNumber ? (
              <div className="grid h-full min-h-60 place-items-center p-8 text-center text-muted-foreground">
                <div>
                  <ReceiptText
                    aria-hidden="true"
                    className="mx-auto mb-3 size-8"
                  />
                  Выберите чек слева, чтобы посмотреть его содержимое
                </div>
              </div>
            ) : detail.isPending ? (
              <div className="grid h-full min-h-60 place-items-center text-muted-foreground">
                <p className="flex items-center gap-2">
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                  Загружаем чек
                </p>
              </div>
            ) : detail.isError ? (
              <div className="grid h-full min-h-60 place-items-center p-6 text-center">
                <div>
                  <p className="font-semibold">Не удалось загрузить чек</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {getHttpErrorMessage(detail.error)}
                  </p>
                  <Button
                    aria-label="Повторить загрузку чека"
                    className="mt-4"
                    onClick={() => void detail.refetch()}
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" />
                    Повторить
                  </Button>
                </div>
              </div>
            ) : detail.data ? (
              <ReceiptDetail receipt={detail.data} />
            ) : null}
          </div>

          {detail.data ? (
            <footer className="grid shrink-0 gap-3 border-t border-border/70 bg-card p-4 sm:grid-cols-2">
              <ReceiptPrintButton
                cashierSession={cashierSession}
                className="min-h-12 w-full"
                context={context}
                sale={detail.data}
              />
              {canReturn ? (
                <Button
                  className="min-h-12 w-full"
                  disabled={fullyReturned}
                  onClick={() => onOpenReturn(detail.data.receipt_number)}
                  title={
                    fullyReturned ? 'Все позиции уже возвращены' : undefined
                  }
                  type="button"
                >
                  <RotateCcw aria-hidden="true" />
                  Оформить возврат
                </Button>
              ) : null}
            </footer>
          ) : null}
        </section>
      </div>
    </main>
  );
}
