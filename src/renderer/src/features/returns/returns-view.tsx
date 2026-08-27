import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  Pencil,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';

import type {
  AuthContextResponse,
  CashierSessionResponse,
  ProductResponse,
  ReceiptResponse,
  ReturnDisposition,
  ReturnPaymentPayload,
  SaleResponse,
} from '@renderer/common/api';
import { getProduct } from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
import { NumericKeypad } from '@renderer/common/components/numeric-keypad';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/common/components/ui/dialog';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import {
  VirtualKeyboard,
  VirtualKeyboardOverlay,
} from '@renderer/common/components/virtual-keyboard';
import { ErrorCode } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
} from '@renderer/common/helpers/http-error.helper';
import { formatQuantity } from '@renderer/common/lib/quantity';
import { useProductSearchQuery } from '@renderer/features/products';

import { ReturnPaymentDialog } from './return-payment-dialog';
import {
  calculateReturnLineTotal,
  calculateReturnTotal,
  priceOverrideSchema,
  receiptNumberSchema,
  returnQuantitySchema,
  returnReasonSchema,
} from './returns-input';
import {
  productQueryOptions,
  receiptPageQueryOptions,
  receiptQueryOptions,
} from './returns-query-options';
import { useReturnSubmission } from './use-return-submission';

type ReturnsViewProps = {
  cashierSession: CashierSessionResponse;
  context: AuthContextResponse;
  onBackToSales: () => void;
};

type ReceiptSelection = {
  quantity: string;
  returnDisposition: ReturnDisposition | null;
};

type WithoutReceiptLine = {
  catalogUnitPrice: string;
  priceOverride?: { reason: string; unitPrice: string };
  product: ProductResponse;
  quantity: string;
  returnDisposition: ReturnDisposition | null;
};

const pageSize = 20;

const permission = (context: AuthContextResponse, value: string) =>
  Boolean(context.isSystemPosition || context.permissions.includes(value));

const dispositionOptions = [
  { label: 'На склад', value: 'RESTOCK' },
  { label: 'Списать', value: 'WRITE_OFF' },
] as const;

const itemPrice = (line: WithoutReceiptLine) =>
  line.priceOverride?.unitPrice ?? line.catalogUnitPrice;

const readableDate = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

export function ReturnsView({
  cashierSession,
  context,
  onBackToSales,
}: ReturnsViewProps) {
  const queryClient = useQueryClient();
  const canCreate = permission(context, 'returns.create');
  const canReceipt = canCreate && permission(context, 'sales.read');
  const canWithoutReceipt =
    canCreate &&
    permission(context, 'returns.without_receipt') &&
    permission(context, 'product.read');
  const canOverridePrice = permission(context, 'returns.price.override');
  const [mode, setMode] = useState<'receipt' | 'withoutReceipt'>(() =>
    canReceipt ? 'receipt' : 'withoutReceipt',
  );
  const [page, setPage] = useState(0);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [receiptSearchError, setReceiptSearchError] = useState<string | null>(
    null,
  );
  const [selectedReceiptNumber, setSelectedReceiptNumber] = useState('');
  const [receiptSelections, setReceiptSelections] = useState<
    Record<string, ReceiptSelection>
  >({});
  const [productSearch, setProductSearch] = useState('');
  const [withoutReceiptLines, setWithoutReceiptLines] = useState<
    WithoutReceiptLine[]
  >([]);
  const [preparedWithoutReceiptLines, setPreparedWithoutReceiptLines] =
    useState<WithoutReceiptLine[] | null>(null);
  const [reason, setReason] = useState('');
  const [showReasonKeyboard, setShowReasonKeyboard] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentTotal, setPaymentTotal] = useState('0.00');
  const [paymentError, setPaymentError] = useState<string>();
  const [paymentKey, setPaymentKey] = useState(0);
  const [completedReturn, setCompletedReturn] = useState<SaleResponse | null>(
    null,
  );
  const [overrideProductId, setOverrideProductId] = useState<string>();
  const [overrideStep, setOverrideStep] = useState<'price' | 'reason'>('price');
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const offset = page * pageSize;
  const receipts = useQuery(
    receiptPageQueryOptions(pageSize, offset, mode === 'receipt' && canReceipt),
  );
  const receiptDetail = useQuery(
    receiptQueryOptions(
      selectedReceiptNumber,
      mode === 'receipt' && canReceipt && Boolean(selectedReceiptNumber),
    ),
  );
  const products = useProductSearchQuery(
    productSearch,
    mode === 'withoutReceipt' && canWithoutReceipt,
    context.organizationId,
    context.storeId,
  );
  const overrideLine = withoutReceiptLines.find(
    (line) => line.product.id === overrideProductId,
  );
  useQuery(
    productQueryOptions(
      overrideProductId ?? '',
      Boolean(overrideLine && canOverridePrice),
    ),
  );
  const submission = useReturnSubmission(cashierSession.id);

  const receiptLines = useMemo(() => {
    if (!receiptDetail.data) return [];
    return receiptDetail.data.items.flatMap((item) => {
      const selection = receiptSelections[item.id];
      return selection ? [{ item, ...selection }] : [];
    });
  }, [receiptDetail.data, receiptSelections]);

  const activeWithoutLines = preparedWithoutReceiptLines ?? withoutReceiptLines;
  const validReceiptLines = receiptLines.every(
    ({ item, quantity }) =>
      returnQuantitySchema(item.unit_code, item.returnable_quantity).safeParse(
        quantity,
      ).success,
  );
  const validWithoutLines = withoutReceiptLines.every(
    ({ product, quantity }) =>
      returnQuantitySchema(product.unit).safeParse(quantity).success,
  );
  const activeLinesHaveDisposition =
    mode === 'receipt'
      ? receiptLines.every((line) => line.returnDisposition)
      : withoutReceiptLines.every((line) => line.returnDisposition);
  const hasLines =
    mode === 'receipt'
      ? receiptLines.length > 0
      : withoutReceiptLines.length > 0;
  const quantitiesValid =
    mode === 'receipt' ? validReceiptLines : validWithoutLines;
  const previewTotal =
    hasLines && quantitiesValid
      ? calculateReturnTotal(
          mode === 'receipt'
            ? receiptLines.map(({ item, quantity }) => ({
                quantity,
                unitPrice: item.unit_price,
              }))
            : withoutReceiptLines.map((line) => ({
                quantity: line.quantity,
                unitPrice: itemPrice(line),
              })),
        )
      : '0.00';
  const formReady =
    hasLines &&
    quantitiesValid &&
    activeLinesHaveDisposition &&
    returnReasonSchema.safeParse(reason).success &&
    previewTotal !== '0.00';

  const selectReceipt = (value: string) => {
    setSelectedReceiptNumber(value);
    setReceiptNumber(value);
    setReceiptSelections({});
    setFormError(null);
  };

  const searchReceipt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = receiptNumberSchema.safeParse(receiptNumber);
    if (!parsed.success) {
      setReceiptSearchError(
        parsed.error.issues[0]?.message ?? 'Неверный номер',
      );
      return;
    }
    setReceiptSearchError(null);
    selectReceipt(parsed.data);
  };

  const addProduct = (product: ProductResponse) => {
    if (
      product.retail_price === null ||
      withoutReceiptLines.some((line) => line.product.id === product.id)
    ) {
      return;
    }
    if (withoutReceiptLines.length >= 300) {
      setFormError('Можно вернуть не более 300 позиций.');
      return;
    }
    setWithoutReceiptLines((lines) => [
      ...lines,
      {
        catalogUnitPrice: product.retail_price!,
        product,
        quantity: '',
        returnDisposition: null,
      },
    ]);
    setPreparedWithoutReceiptLines(null);
  };

  const updateWithoutLine = (
    productId: string,
    update: Partial<WithoutReceiptLine>,
  ) => {
    setWithoutReceiptLines((lines) =>
      lines.map((line) =>
        line.product.id === productId ? { ...line, ...update } : line,
      ),
    );
    setPreparedWithoutReceiptLines(null);
    setFormError(null);
  };

  const refreshProducts = async () => {
    const refreshed = await Promise.all(
      withoutReceiptLines.map(async (line) => ({
        line,
        product: await queryClient.fetchQuery({
          ...productQueryOptions(line.product.id, true),
          queryFn: () => getProduct(line.product.id),
          staleTime: 0,
        }),
      })),
    );
    if (refreshed.some(({ product }) => product.retail_price === null)) {
      throw new Error('У одного из товаров больше нет цены продажи.');
    }
    if (
      refreshed.some(
        ({ line, product }) =>
          line.priceOverride &&
          !priceOverrideSchema(product.retail_price!).safeParse(
            line.priceOverride,
          ).success,
      )
    ) {
      throw new Error('Изменённая цена совпала с новой ценой каталога.');
    }
    const next = refreshed.map(({ line, product }) => ({
      ...line,
      catalogUnitPrice: product.retail_price!,
      product,
    }));
    setWithoutReceiptLines(next);
    setPreparedWithoutReceiptLines(next);
    return next;
  };

  const openPayment = async () => {
    if (!formReady) return;
    try {
      const lines =
        mode === 'withoutReceipt' ? await refreshProducts() : receiptLines;
      const total = calculateReturnTotal(
        mode === 'receipt'
          ? receiptLines.map(({ item, quantity }) => ({
              quantity,
              unitPrice: item.unit_price,
            }))
          : (lines as WithoutReceiptLine[]).map((line) => ({
              quantity: line.quantity,
              unitPrice: itemPrice(line),
            })),
      );
      if (total === '0.00') {
        throw new Error('Сумма возврата должна быть больше нуля.');
      }
      setPaymentTotal(total);
      setPaymentError(undefined);
      setPaymentKey((value) => value + 1);
      setPaymentOpen(true);
    } catch (error) {
      setFormError(getHttpErrorMessage(error, (error as Error).message));
    }
  };

  const confirmReturn = async (payments: ReturnPaymentPayload[]) => {
    const parsedReason = returnReasonSchema.parse(reason);
    try {
      const result = await submission.submit.mutateAsync(
        mode === 'receipt'
          ? {
              payload: {
                items: receiptLines.map(
                  ({ item, quantity, returnDisposition }) => ({
                    quantity,
                    returnDisposition: returnDisposition!,
                    saleItemId: item.id,
                  }),
                ),
                payments,
                reason: parsedReason,
              },
              receiptNumber: selectedReceiptNumber,
              type: 'receipt',
            }
          : {
              payload: {
                items: activeWithoutLines.map((line) => ({
                  ...(line.priceOverride
                    ? { priceOverride: line.priceOverride }
                    : {}),
                  productId: line.product.id,
                  quantity: line.quantity,
                  returnDisposition: line.returnDisposition!,
                })),
                payments,
                reason: parsedReason,
              },
              type: 'withoutReceipt',
            },
      );
      setPaymentOpen(false);
      setCompletedReturn(result);
    } catch (error) {
      const code = getHttpErrorCode(error);
      const message = getHttpErrorMessage(
        error,
        'Не удалось завершить возврат.',
      );
      if (code === ErrorCode.ReturnQuantityExceeded) {
        setPaymentOpen(false);
        setFormError(message);
      } else if (code === ErrorCode.PaymentAmountMismatch) {
        setPaymentOpen(false);
        setPreparedWithoutReceiptLines(null);
        setFormError(
          'Цена товара изменилась. Проверьте итог и выберите выплату снова.',
        );
        await refreshProducts().catch(() => undefined);
      } else {
        setPaymentKey((value) => value + 1);
        setPaymentError(message);
      }
    }
  };

  const resetForm = () => {
    setCompletedReturn(null);
    setReceiptSelections({});
    setSelectedReceiptNumber('');
    setReceiptNumber('');
    setWithoutReceiptLines([]);
    setPreparedWithoutReceiptLines(null);
    setReason('');
    setFormError(null);
    setPaymentError(undefined);
  };

  const continueOverride = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overrideLine) return;
    const parsed = priceOverrideSchema(overrideLine.catalogUnitPrice)
      .pick({ unitPrice: true })
      .safeParse({ unitPrice: overridePrice });
    if (!parsed.success) {
      setOverrideError(parsed.error.issues[0]?.message ?? 'Проверьте цену');
      return;
    }
    setOverrideError(null);
    setOverrideStep('reason');
  };

  const saveOverride = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overrideLine) return;
    const parsed = priceOverrideSchema(overrideLine.catalogUnitPrice).safeParse(
      { reason: overrideReason, unitPrice: overridePrice },
    );
    if (!parsed.success) {
      setOverrideError(parsed.error.issues[0]?.message ?? 'Проверьте цену');
      return;
    }
    updateWithoutLine(overrideLine.product.id, {
      priceOverride: parsed.data,
    });
    setOverrideProductId(undefined);
  };

  if (!canReceipt && !canWithoutReceipt) {
    return (
      <FullPageState
        description="Для работы нужен доступ к созданию возврата и хотя бы одному режиму."
        onRetry={onBackToSales}
        retryLabel="Вернуться к продажам"
        title="Нет доступа к возвратам"
      />
    );
  }

  if (submission.pendingCommand) {
    const recoveryError = submission.retry.error ?? submission.submit.error;
    const isConflict =
      getHttpErrorCode(recoveryError) === ErrorCode.ReturnIdempotencyConflict;
    return (
      <main className="grid min-h-full place-items-center bg-workspace px-6 py-10">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
          <AlertTriangle
            aria-hidden="true"
            className="mx-auto mb-4 size-8 text-amber-600"
          />
          <h1 className="text-xl font-bold">
            {isConflict ? 'Возврат требует проверки' : 'Незавершённый возврат'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Редактирование заблокировано. Повтор будет отправлен с тем же UUID и
            данными.
          </p>
          {recoveryError ? (
            <p className="mt-3 text-sm font-medium text-destructive">
              {getHttpErrorMessage(recoveryError)}
            </p>
          ) : null}
          <Button
            className="mt-6"
            disabled={submission.retry.isPending || isConflict}
            onClick={() =>
              void submission.retry
                .mutateAsync()
                .then(setCompletedReturn)
                .catch(() => undefined)
            }
            type="button"
          >
            {submission.retry.isPending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            Повторить сохранённый возврат
          </Button>
        </section>
      </main>
    );
  }

  if (completedReturn) {
    return (
      <main className="grid min-h-full place-items-center bg-workspace px-6 py-10">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto mb-4 size-10 text-emerald-600"
          />
          <h1 className="text-2xl font-bold">Возврат успешно завершён</h1>
          <p className="mt-3 text-3xl font-extrabold text-primary">
            {formatCash(completedReturn.total)}
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Button onClick={resetForm} type="button" variant="ghost">
              Новый возврат
            </Button>
            <Button onClick={onBackToSales} type="button">
              Вернуться к продажам
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-workspace px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-surface)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              aria-label="Вернуться к продажам"
              onClick={onBackToSales}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                Возвраты
              </h1>
              <p className="text-sm text-muted-foreground">
                Касса работает, текущая корзина продаж сохранена
              </p>
            </div>
          </div>
          <div
            aria-label="Режим возврата"
            className="grid grid-cols-2 gap-2"
            role="group"
          >
            <Button
              aria-pressed={mode === 'receipt'}
              disabled={!canReceipt}
              onClick={() => setMode('receipt')}
              type="button"
              variant={mode === 'receipt' ? 'default' : 'ghost'}
            >
              По чеку
            </Button>
            <Button
              aria-pressed={mode === 'withoutReceipt'}
              disabled={!canWithoutReceipt}
              onClick={() => setMode('withoutReceipt')}
              type="button"
              variant={mode === 'withoutReceipt' ? 'default' : 'ghost'}
            >
              Без чека
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 space-y-5 rounded-2xl border border-border/80 bg-card p-5 shadow-[var(--shadow-surface)]">
            {mode === 'receipt' ? (
              <>
                <form
                  className="flex flex-col gap-3 sm:flex-row"
                  onSubmit={searchReceipt}
                >
                  <FormField className="flex-1">
                    <Label htmlFor="return-receipt-number">
                      Точный номер чека
                    </Label>
                    <Input
                      aria-invalid={Boolean(receiptSearchError)}
                      id="return-receipt-number"
                      inputMode="numeric"
                      onChange={(event) => {
                        setReceiptNumber(event.target.value);
                        setReceiptSearchError(null);
                      }}
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
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-5 animate-spin"
                      />
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
                  ) : receipts.data.receipts.length === 0 ? (
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
                          onClick={() =>
                            selectReceipt(receiptSummary.receipt_number)
                          }
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
                  {!receipts.isPending && !receipts.isError ? (
                    <div className="mt-4 flex justify-between gap-3">
                      <Button
                        disabled={page === 0 || receipts.isFetching}
                        onClick={() => setPage((value) => value - 1)}
                        type="button"
                        variant="ghost"
                      >
                        Предыдущая
                      </Button>
                      <Button
                        disabled={
                          !receipts.data.meta.has_more || receipts.isFetching
                        }
                        onClick={() => setPage((value) => value + 1)}
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
                    <h2 className="mb-3 font-bold">
                      Чек №{selectedReceiptNumber}
                    </h2>
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
                    ) : (
                      <ReceiptItems
                        disabled={submission.submit.isPending}
                        onChange={setReceiptSelections}
                        receipt={receiptDetail.data}
                        selections={receiptSelections}
                      />
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <FormField>
                  <Label htmlFor="return-product-search">Поиск товаров</Label>
                  <Input
                    id="return-product-search"
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Название, SKU или штрихкод"
                    value={productSearch}
                  />
                </FormField>
                {products.isPending && productSearch.trim().length >= 2 ? (
                  <p className="py-5 text-center text-muted-foreground">
                    Ищем товары
                  </p>
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
                            withoutReceiptLines.some(
                              (line) => line.product.id === product.id,
                            )
                          }
                          key={product.id}
                          onClick={() => addProduct(product)}
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
                  lines={withoutReceiptLines}
                  onOverride={(line) => {
                    setOverrideProductId(line.product.id);
                    setOverrideStep('price');
                    setOverridePrice(line.priceOverride?.unitPrice ?? '');
                    setOverrideReason(line.priceOverride?.reason ?? '');
                    setOverrideError(null);
                  }}
                  onRemove={(productId) =>
                    setWithoutReceiptLines((lines) =>
                      lines.filter((line) => line.product.id !== productId),
                    )
                  }
                  onUpdate={updateWithoutLine}
                />
              </>
            )}
          </section>

          <aside className="h-fit rounded-2xl border border-border/80 bg-card p-5 shadow-[var(--shadow-surface)]">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <ReceiptText aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-bold">Текущий возврат</h2>
                <p className="text-xs text-muted-foreground">
                  {hasLines
                    ? `${mode === 'receipt' ? receiptLines.length : withoutReceiptLines.length} позиций`
                    : 'Выберите товары'}
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-primary/15 bg-primary/[0.045] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Предварительный итог
              </p>
              <p className="mt-2 text-3xl font-extrabold text-primary">
                {formatCash(previewTotal)}
              </p>
            </div>
            <FormField className="mt-5">
              <Label htmlFor="return-reason">Причина возврата</Label>
              <textarea
                aria-label="Причина возврата"
                className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                id="return-reason"
                maxLength={500}
                onChange={(event) => {
                  setReason(event.target.value);
                  setFormError(null);
                }}
                value={reason}
              />
              <Button
                onClick={() => setShowReasonKeyboard((value) => !value)}
                type="button"
                variant="ghost"
              >
                Экранная клавиатура
              </Button>
              <VirtualKeyboardOverlay
                compact
                maxLength={500}
                onOpenChange={setShowReasonKeyboard}
                onValueChange={(value) => setReason(value)}
                open={showReasonKeyboard}
                value={reason}
              />
            </FormField>
            {formError ? (
              <p
                className="mt-3 text-sm font-medium text-destructive"
                role="alert"
              >
                {formError}
              </p>
            ) : null}
            <Button
              className="mt-5 min-h-14 w-full"
              disabled={!formReady || submission.submit.isPending}
              onClick={() => void openPayment()}
              type="button"
            >
              Выбрать способ выплаты
            </Button>
          </aside>
        </div>
      </div>

      <ReturnPaymentDialog
        key={paymentKey}
        onConfirm={confirmReturn}
        onOpenChange={(open) => {
          if (!submission.submit.isPending) setPaymentOpen(open);
        }}
        open={paymentOpen}
        originalPayments={
          mode === 'receipt'
            ? receiptDetail.data?.payments.map(({ amount, method }) => ({
                amount,
                method,
              }))
            : undefined
        }
        pending={submission.submit.isPending}
        serverErrorMessage={paymentError}
        total={paymentTotal}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open) setOverrideProductId(undefined);
        }}
        open={Boolean(overrideLine && overrideStep === 'price')}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Изменить цену</DialogTitle>
            <DialogDescription>{overrideLine?.product.name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={continueOverride}>
            <FormField>
              <Label htmlFor="return-override-price">Новая цена, ₸</Label>
              <Input
                id="return-override-price"
                inputMode="decimal"
                onChange={(event) => setOverridePrice(event.target.value)}
                value={overridePrice}
              />
              <NumericKeypad
                onValueChange={setOverridePrice}
                value={overridePrice}
              />
            </FormField>
            {overrideError ? (
              <p className="text-sm font-medium text-destructive">
                {overrideError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit">Далее</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setOverrideProductId(undefined);
        }}
        open={Boolean(overrideLine && overrideStep === 'reason')}
      >
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Укажите причину изменения цены</DialogTitle>
            <DialogDescription>{overrideLine?.product.name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveOverride}>
            <FormField>
              <Label htmlFor="return-override-reason">
                Причина изменения цены
              </Label>
              <Input
                id="return-override-reason"
                maxLength={500}
                onChange={(event) => setOverrideReason(event.target.value)}
                value={overrideReason}
              />
              <VirtualKeyboard
                compact
                maxLength={500}
                onValueChange={setOverrideReason}
                value={overrideReason}
              />
            </FormField>
            {overrideError ? (
              <p className="text-sm font-medium text-destructive">
                {overrideError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                onClick={() => {
                  setOverrideError(null);
                  setOverrideStep('price');
                }}
                type="button"
                variant="ghost"
              >
                Назад
              </Button>
              <Button type="submit">Сохранить цену</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ReceiptItems({
  disabled,
  onChange,
  receipt,
  selections,
}: {
  disabled: boolean;
  onChange: React.Dispatch<
    React.SetStateAction<Record<string, ReceiptSelection>>
  >;
  receipt: ReceiptResponse;
  selections: Record<string, ReceiptSelection>;
}) {
  return (
    <div className="space-y-3">
      {receipt.items.map((item) => {
        const selected = selections[item.id];
        const fullyReturned = !/[1-9]/.test(item.returnable_quantity);
        return (
          <div
            className="rounded-xl border border-border bg-background p-4"
            key={item.id}
          >
            <div className="flex items-start gap-3">
              <input
                aria-label={`Выбрать ${item.name}`}
                checked={Boolean(selected)}
                className="mt-1 size-5"
                disabled={disabled || fullyReturned}
                onChange={(event) =>
                  onChange((current) => {
                    if (event.target.checked) {
                      return {
                        ...current,
                        [item.id]: { quantity: '', returnDisposition: null },
                      };
                    }
                    const next = { ...current };
                    delete next[item.id];
                    return next;
                  })
                }
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku} · доступно{' '}
                      {formatQuantity(item.returnable_quantity, item.unit_code)}
                    </p>
                  </div>
                  <p className="font-bold">{formatCash(item.unit_price)}</p>
                </div>
                {fullyReturned ? (
                  <p className="mt-2 text-sm font-semibold text-muted-foreground">
                    Полностью возвращено
                  </p>
                ) : null}
                {selected ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <FormField>
                      <Label htmlFor={`receipt-quantity-${item.id}`}>
                        Количество {item.name}
                      </Label>
                      <Input
                        aria-label={`Количество ${item.name}`}
                        id={`receipt-quantity-${item.id}`}
                        inputMode="decimal"
                        onChange={(event) =>
                          onChange((current) => ({
                            ...current,
                            [item.id]: {
                              ...current[item.id]!,
                              quantity: event.target.value,
                            },
                          }))
                        }
                        value={selected.quantity}
                      />
                    </FormField>
                    <DispositionButtons
                      name={item.name}
                      onChange={(returnDisposition) =>
                        onChange((current) => ({
                          ...current,
                          [item.id]: {
                            ...current[item.id]!,
                            returnDisposition,
                          },
                        }))
                      }
                      value={selected.returnDisposition}
                    />
                    {returnQuantitySchema(
                      item.unit_code,
                      item.returnable_quantity,
                    ).safeParse(selected.quantity).success ? (
                      <p className="text-sm font-bold text-primary sm:col-span-2">
                        Сумма:{' '}
                        {formatCash(
                          calculateReturnLineTotal(
                            selected.quantity,
                            item.unit_price,
                          ),
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DispositionButtons({
  name,
  onChange,
  value,
}: {
  name: string;
  onChange: (value: ReturnDisposition) => void;
  value: ReturnDisposition | null;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Состояние товара</p>
      <div className="grid grid-cols-2 gap-2">
        {dispositionOptions.map((option) => (
          <Button
            aria-label={`${option.label} ${name}`}
            aria-pressed={value === option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
            variant={value === option.value ? 'default' : 'ghost'}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function WithoutReceiptItems({
  canOverridePrice,
  lines,
  onOverride,
  onRemove,
  onUpdate,
}: {
  canOverridePrice: boolean;
  lines: WithoutReceiptLine[];
  onOverride: (line: WithoutReceiptLine) => void;
  onRemove: (productId: string) => void;
  onUpdate: (productId: string, update: Partial<WithoutReceiptLine>) => void;
}) {
  if (!lines.length) return null;
  return (
    <div className="space-y-3 border-t border-border pt-5">
      <h2 className="font-bold">Позиции возврата</h2>
      {lines.map((line) => (
        <div
          className="rounded-xl border border-border bg-background p-4"
          key={line.product.id}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{line.product.name}</p>
              <p className="text-xs text-muted-foreground">
                {line.product.sku}
              </p>
              {!line.product.is_active ? (
                <span className="mt-1 inline-block text-xs font-semibold text-amber-700">
                  Неактивен
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <p className="font-bold">{formatCash(itemPrice(line))}</p>
              {canOverridePrice ? (
                <Button
                  aria-label={`Изменить цену ${line.product.name}`}
                  onClick={() => onOverride(line)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" />
                </Button>
              ) : null}
              <Button
                aria-label={`Удалить ${line.product.name}`}
                onClick={() => onRemove(line.product.id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FormField>
              <Label htmlFor={`without-quantity-${line.product.id}`}>
                Количество {line.product.name}
              </Label>
              <Input
                aria-label={`Количество ${line.product.name}`}
                id={`without-quantity-${line.product.id}`}
                inputMode="decimal"
                onChange={(event) =>
                  onUpdate(line.product.id, { quantity: event.target.value })
                }
                value={line.quantity}
              />
            </FormField>
            <DispositionButtons
              name={line.product.name}
              onChange={(returnDisposition) =>
                onUpdate(line.product.id, { returnDisposition })
              }
              value={line.returnDisposition}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
