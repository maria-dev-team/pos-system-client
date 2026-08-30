import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  CreditCard,
  History,
  Keyboard,
  LayoutGrid,
  LoaderCircle,
  Minus,
  PackageSearch,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  ScanLine,
  ShoppingBasket,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  type CashierSessionResponse,
  type HeldSaleResponse,
  type ProductResponse,
  type SaleItemResponse,
  type SalePaymentPayload,
  type SaleResponse,
  searchProducts,
} from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
import { NumericKeypad } from '@renderer/common/components/numeric-keypad';
import { Button } from '@renderer/common/components/ui/button';
import {
  Dialog,
  DialogClose,
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
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';
import { parseGs1DataMatrix } from '@renderer/common/lib/gs1-data-matrix';
import {
  adjustQuantityByOne,
  formatQuantity,
  quantitySchema,
} from '@renderer/common/lib/quantity';
import { authContextQueryOptions } from '@renderer/features/auth';
import { EndCashierSessionAction } from '@renderer/features/cashier-sessions';
import { useProductSearchQuery } from '@renderer/features/products';
import {
  ReceiptPrintButton,
  ReceiptPrinterSettingsButton,
} from '@renderer/features/receipt-printing';

import { CheckoutCategoryPicker } from './checkout-category-picker';
import { CheckoutHeldSalesDialog } from './checkout-held-sales-dialog';
import { priceOverrideSchema, saleCancellationSchema } from './checkout-input';
import { CheckoutPaymentDialog } from './checkout-payment-dialog';
import {
  currentSaleQueryOptions,
  heldSalesQueryOptions,
} from './checkout-query-options';
import { useCheckoutSaleTransitions } from './use-checkout-sale-transitions';
import {
  type SaleCommand,
  useSaleCommandMutation,
} from './use-sale-command-mutation';

const unitLabels = { kg: 'кг', l: 'л', m: 'м', pcs: 'шт.' } as const;

const cancellationReasonOptions = [
  'Покупатель передумал',
  'Ошибка при добавлении товара',
  'Дублирующий чек',
] as const;

type CheckoutViewProps = {
  cashierSession: CashierSessionResponse;
  onOpenReturns?: () => void;
  onOpenSalesHistory?: () => void;
  onRetrySession?: () => void;
  onSessionEnded: () => void;
  onSessionEndedLocally?: () => void;
};

type CheckoutRow = { item: SaleItemResponse };

const rowUnit = (row: CheckoutRow) => row.item.unit_code;

const rowUnitPrice = (row: CheckoutRow) => row.item.unit_price;

const rowLineTotal = (row: CheckoutRow) => row.item.line_total;

const rowIsOverridden = (row: CheckoutRow) =>
  row.item.price_override_reason !== null ||
  row.item.price_overridden_by_membership_id !== null ||
  row.item.unit_price !== row.item.base_unit_price;

function SessionEndAction({
  cashierSession,
  onSessionEnded,
  onSessionEndedLocally,
}: Pick<
  CheckoutViewProps,
  'cashierSession' | 'onSessionEnded' | 'onSessionEndedLocally'
>) {
  return (
    <EndCashierSessionAction
      cashierSession={cashierSession}
      onEndedLocally={onSessionEndedLocally}
      onEnded={onSessionEnded}
    />
  );
}

function LockedCheckout({
  cashierSession,
  onRetrySession,
  onSessionEnded,
  onSessionEndedLocally,
}: CheckoutViewProps) {
  const queryClient = useQueryClient();
  const currentSale = queryClient.getQueryData<SaleResponse | null>(
    queryKeys.sales.current(cashierSession.id),
  );
  const canEnd = currentSale?.status !== 'DRAFT';

  return (
    <main className="grid min-h-full place-items-center bg-workspace p-6">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 text-center shadow-[var(--shadow-surface)]">
        <Ban aria-hidden="true" className="mx-auto size-10 text-warning" />
        <h1 className="mt-4 text-2xl font-bold">Смена кассира заблокирована</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Продажи недоступны. Повторите проверку или завершите работу на кассе.
        </p>
        <div className={`mt-6 grid gap-3 ${canEnd ? 'sm:grid-cols-2' : ''}`}>
          <Button
            className="min-h-12"
            disabled={!onRetrySession}
            onClick={onRetrySession}
            type="button"
            variant="ghost"
          >
            Повторить
          </Button>
          {canEnd ? (
            <SessionEndAction
              cashierSession={cashierSession}
              onSessionEndedLocally={onSessionEndedLocally}
              onSessionEnded={onSessionEnded}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function ActiveCheckout({
  cashierSession,
  onOpenReturns,
  onOpenSalesHistory,
  onSessionEnded,
  onSessionEndedLocally,
}: CheckoutViewProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const context = useQuery(authContextQueryOptions());
  const currentSale = useQuery(currentSaleQueryOptions(cashierSession.id));
  const transitions = useCheckoutSaleTransitions(cashierSession.id);
  const sale = currentSale.data?.status === 'DRAFT' ? currentSale.data : null;
  const currentKey = queryKeys.sales.current(cashierSession.id);
  const [search, setSearch] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [scanIssue, setScanIssue] = useState<{
    barcode: string;
    message: string;
  } | null>(null);
  const [quantityItem, setQuantityItem] = useState<CheckoutRow | null>(null);
  const [quantity, setQuantity] = useState('');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [removeItem, setRemoveItem] = useState<CheckoutRow | null>(null);
  const [priceItem, setPriceItem] = useState<CheckoutRow | null>(null);
  const [unitPrice, setUnitPrice] = useState('');
  const [priceReason, setPriceReason] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelKeyboardOpen, setCancelKeyboardOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const heldSales = useQuery({
    ...heldSalesQueryOptions(cashierSession.id),
    enabled: heldOpen,
  });
  const [paymentSale, setPaymentSale] = useState<SaleResponse | null>(null);
  const [paymentError, setPaymentError] = useState<string>();
  const [transitionError, setTransitionError] = useState<string>();
  const [completedSale, setCompletedSale] = useState<SaleResponse | null>(null);
  const canSearch = Boolean(
    context.data?.isSystemPosition ||
    context.data?.permissions.includes('product.read'),
  );
  const canBrowseCategories = Boolean(
    context.data &&
    (context.data.isSystemPosition ||
      (context.data.permissions.includes('category.read') &&
        context.data.permissions.includes('product.read'))),
  );
  const canAddProduct = Boolean(
    context.data &&
    (context.data.isSystemPosition ||
      context.data.permissions.includes(
        sale ? 'sales.modify' : 'sales.create',
      )),
  );

  const refocus = () => window.setTimeout(() => inputRef.current?.focus());
  const closeDialogs = () => {
    setQuantityItem(null);
    setRemoveItem(null);
    setPriceItem(null);
    setCancelOpen(false);
    setCancelKeyboardOpen(false);
    refocus();
  };
  const openCancel = () => {
    setCancelOpen(true);
    setCancelReason('');
    setCancelError(null);
    setCancelKeyboardOpen(false);
  };
  const finishCancelled = () => {
    void queryClient.cancelQueries({ exact: true, queryKey: currentKey });
    queryClient.setQueryData<SaleResponse | null>(currentKey, null);
    setCancelError(null);
    setCancelOpen(false);
    toast.success('Чек отменён');
  };

  const command = useSaleCommandMutation(cashierSession.id, sale, {
    onError: (error, submitted) => {
      if (
        submitted.type === 'remove' &&
        getHttpErrorCode(error) === ErrorCode.SaleEmpty
      ) {
        setRemoveItem(null);
        openCancel();
        return;
      }
      const message = getHttpErrorMessage(error, 'Не удалось изменить чек.');
      if (
        submitted.type === 'scan' &&
        getHttpErrorCode(error) === ErrorCode.ProductNotFound
      ) {
        setScanIssue({
          barcode: submitted.barcode,
          message: `Товар с кодом ${submitted.barcode} не найден`,
        });
        refocus();
        return;
      }
      if (
        (submitted.type === 'scan' || submitted.type === 'add') &&
        getHttpErrorCode(error) === ErrorCode.ProductMarkingCodeRequired
      ) {
        setScanIssue({
          barcode:
            submitted.type === 'scan' ? submitted.barcode : submitted.productId,
          message: 'Для этого товара отсканируйте Data Matrix с упаковки.',
        });
        refocus();
        return;
      }
      if (submitted.type === 'setQuantity' && quantityItem) {
        setQuantityError(message);
        return;
      }
      if (submitted.type === 'overridePrice') {
        setPriceError(message);
        return;
      }
      httpErrorHandler(error, 'Не удалось изменить чек.');
      refocus();
    },
    onSuccess: (_updatedSale, submitted) => {
      if (submitted.type === 'scan' || submitted.type === 'add') {
        setScanIssue(null);
        if (submitted.type === 'scan') {
          setSearch((value) =>
            value.trim() === submitted.barcode ? '' : value,
          );
        } else {
          setSearch('');
        }
      } else if (submitted.type === 'setQuantity') {
        setQuantityError(null);
        setQuantityItem(null);
      } else if (submitted.type === 'remove') {
        setRemoveItem(null);
      } else if (submitted.type === 'overridePrice') {
        setPriceError(null);
        setPriceItem(null);
      }
      refocus();
    },
  });

  const scanFirstProduct = async (scannedValue: string) => {
    setScanIssue(null);
    const dataMatrix = parseGs1DataMatrix(scannedValue);
    const searchValue = dataMatrix?.gtin ?? scannedValue;
    try {
      const result = await searchProducts({
        limit: 20,
        offset: 0,
        search: searchValue,
      });
      const exact = result.products.find(
        (product) =>
          product.barcode === searchValue || product.nkt?.gtin === searchValue,
      );
      if (!exact) {
        setScanIssue({
          barcode: scannedValue,
          message: `Товар с кодом ${searchValue} не найден`,
        });
        return;
      }
      if (!exact.is_active) {
        setScanIssue({
          barcode: scannedValue,
          message: `Товар с кодом ${searchValue} неактивен`,
        });
        return;
      }
      if (exact.retail_price === null) {
        setScanIssue({
          barcode: scannedValue,
          message: `У товара с кодом ${searchValue} нет цены`,
        });
        return;
      }
      if (exact.nkt?.is_marked && !dataMatrix) {
        setScanIssue({
          barcode: scannedValue,
          message: `Товар «${exact.name}» маркирован. Отсканируйте Data Matrix с упаковки.`,
        });
        return;
      }
      if (!exact.nkt?.is_marked && dataMatrix) {
        setScanIssue({
          barcode: scannedValue,
          message: `Товар с GTIN ${dataMatrix.gtin} не отмечен как маркированный.`,
        });
        return;
      }
      await command.mutateAsync({
        ...(dataMatrix ? { markingCode: dataMatrix.markingCode } : {}),
        productId: exact.id,
        type: 'add',
      });
      setScanIssue(null);
      setSearch((value) => (value.trim() === scannedValue ? '' : value));
    } catch (error) {
      setScanIssue({
        barcode: scannedValue,
        message: getHttpErrorMessage(
          error,
          `Не удалось добавить товар с кодом ${searchValue}`,
        ),
      });
    } finally {
      refocus();
    }
  };
  const products = useProductSearchQuery(
    search,
    canSearch &&
      canAddProduct &&
      !command.isPending &&
      !transitions.cancel.isPending &&
      !transitions.checkout.isPending &&
      !transitions.hold.isPending &&
      !transitions.resume.isPending,
    context.data?.organizationId,
    context.data?.storeId,
  );

  useEffect(() => {
    if (!context.isPending && !currentSale.isPending) refocus();
  }, [context.isPending, currentSale.isPending, sale?.id]);

  if (context.isPending || currentSale.isPending || currentSale.isFetching) {
    return <FullPageState isLoading title="Открываем чек" />;
  }
  if (context.isError || currentSale.isError) {
    return (
      <FullPageState
        description={getHttpErrorMessage(
          context.error ?? currentSale.error,
          'Не удалось открыть чек.',
        )}
        onRetry={() =>
          void (context.isError ? context.refetch() : currentSale.refetch())
        }
        title="Не удалось открыть чек"
      />
    );
  }

  const canOverridePrice = Boolean(
    context.data.isSystemPosition ||
    (context.data.permissions.includes('sales.modify') &&
      context.data.permissions.includes('sales.price.override')),
  );
  const canCancel = Boolean(
    context.data.isSystemPosition ||
    context.data.permissions.includes('sales.cancel'),
  );
  const hasPermission = (permission: string) =>
    context.data.isSystemPosition ||
    context.data.permissions.includes(permission);
  const canPay = Boolean(sale && hasPermission('sales.complete'));
  const canCancelCurrent = canCancel && Boolean(sale);
  const canHold = Boolean(sale && hasPermission('sales.hold'));
  const canOpenReturns = Boolean(
    onOpenReturns &&
    hasPermission('returns.create') &&
    (hasPermission('sales.read') ||
      (hasPermission('returns.without_receipt') &&
        hasPermission('product.read'))),
  );
  const canOpenSalesHistory = Boolean(
    onOpenSalesHistory && hasPermission('sales.read'),
  );
  const rows: CheckoutRow[] = sale?.items.map((item) => ({ item })) ?? [];
  const transitionPending =
    transitions.cancel.isPending ||
    transitions.checkout.isPending ||
    transitions.hold.isPending ||
    transitions.resume.isPending;
  const isBusy = command.isPending || transitionPending;
  const scannerBlocked = command.isPending || transitionPending;
  const canResume = hasPermission('sales.hold') && !sale && !transitionPending;
  const canEndSession = !sale && !isBusy;

  const showTransitionError = (error: unknown, fallback: string) =>
    setTransitionError(getHttpErrorMessage(error, fallback));
  const finishTransition = (result: SaleResponse) => {
    setTransitionError(undefined);
    if (result.status === 'COMPLETED') {
      setPaymentSale(null);
      setPaymentError(undefined);
      setCompletedSale(result);
    } else if (result.status === 'HELD') {
      setHeldOpen(false);
      toast.success('Чек отложен');
      refocus();
    } else if (result.status === 'CANCELLED') {
      finishCancelled();
    }
  };
  const openPayment = () => {
    if (!canPay || !sale || rows.length === 0) return;
    setPaymentError(undefined);
    setTransitionError(undefined);
    setPaymentSale(sale);
  };
  const confirmPayment = async (
    payments: SalePaymentPayload[],
    buyerBinIin?: string,
  ) => {
    setPaymentError(undefined);
    setTransitionError(undefined);
    try {
      finishTransition(
        await transitions.checkout.mutateAsync({ buyerBinIin, payments }),
      );
    } catch (error) {
      const message = getHttpErrorMessage(error, 'Не удалось оплатить чек.');
      const authoritative = queryClient.getQueryData<SaleResponse | null>(
        currentKey,
      );
      if (authoritative?.status === 'DRAFT') {
        setPaymentSale(authoritative);
      } else {
        setPaymentSale(null);
      }
      setPaymentError(message);
    }
  };
  const holdCurrent = async () => {
    if (!canHold || rows.length === 0) return;
    setTransitionError(undefined);
    try {
      finishTransition(await transitions.hold.mutateAsync());
    } catch (error) {
      showTransitionError(error, 'Не удалось отложить чек.');
    }
  };
  const resumeHeld = async (held: HeldSaleResponse) => {
    if (!canResume) return;
    setTransitionError(undefined);
    try {
      await transitions.resume.mutateAsync(held);
      setHeldOpen(false);
      refocus();
    } catch (error) {
      showTransitionError(error, 'Не удалось возобновить чек.');
    }
  };
  const visibleCompletedSale = completedSale;

  if (visibleCompletedSale) {
    return (
      <main className="grid min-h-full place-items-center bg-workspace p-4">
        <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-surface)]">
          <div className="border-b border-border bg-success-muted/60 px-6 py-5">
            <span className="grid size-12 place-items-center rounded-xl bg-success text-white shadow-sm">
              <CheckCircle2 aria-hidden="true" className="size-6" />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-[-0.03em]">
              Оплата завершена
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Чек успешно оплачен и сохранён на сервере
            </p>
          </div>
          <div className="p-6">
            <div
              aria-label="Итог завершённого чека"
              className="rounded-xl border border-primary/15 bg-primary/5 p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Итого оплачено
              </p>
              <p className="mt-2 text-4xl font-extrabold tracking-[-0.04em] tabular-nums text-primary">
                {formatCash(visibleCompletedSale.total)}
              </p>
            </div>
            <div className="mt-4 space-y-3">
              {visibleCompletedSale.payments.map((payment) => (
                <div
                  className="rounded-xl border border-border bg-background p-4"
                  key={payment.id}
                >
                  <div className="flex justify-between gap-3">
                    <span className="font-semibold">
                      {payment.method === 'CASH' ? 'Наличные' : 'Безналичные'}
                    </span>
                    <span className="font-bold tabular-nums">
                      {formatCash(payment.amount)}
                    </span>
                  </div>
                  {payment.received ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Получено: {formatCash(payment.received)}
                    </p>
                  ) : null}
                  {payment.change ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Сдача: {formatCash(payment.change)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <ReceiptPrintButton
                cashierSession={cashierSession}
                className="min-h-12"
                context={context.data}
                sale={visibleCompletedSale}
              />
              <Button
                className="min-h-12"
                onClick={() => {
                  setCompletedSale(null);
                  refocus();
                }}
                type="button"
              >
                Новый чек
              </Button>
              <SessionEndAction
                cashierSession={cashierSession}
                onSessionEndedLocally={onSessionEndedLocally}
                onSessionEnded={onSessionEnded}
              />
            </div>
          </div>
        </section>
      </main>
    );
  }

  const submitCommand = (nextCommand: SaleCommand) =>
    command.mutate(nextCommand);
  const submitScan = () => {
    const barcode = search.trim();
    if (!barcode || !canSearch || !canAddProduct || scannerBlocked) return;
    setSearch('');
    if (parseGs1DataMatrix(barcode)) void scanFirstProduct(barcode);
    else if (sale) submitCommand({ barcode, type: 'scan' });
    else void scanFirstProduct(barcode);
  };
  const selectProduct = (product: ProductResponse) => {
    if (!canAddProduct) return;
    if (product.nkt?.is_marked) {
      setSearch('');
      setScanIssue({
        barcode: product.id,
        message: `Товар «${product.name}» маркирован. Отсканируйте Data Matrix с упаковки.`,
      });
      refocus();
      return;
    }
    submitCommand({ productId: product.id, type: 'add' });
  };
  const openRemove = (row: CheckoutRow) => {
    if (sale?.items.length === 1) {
      openCancel();
      return;
    }
    setRemoveItem(row);
  };
  const adjustQuantity = (row: CheckoutRow, delta: -1 | 1) => {
    if (row.item.is_marked) return;
    const next = adjustQuantityByOne(row.item.quantity, delta);
    if (!next) {
      openRemove(row);
      return;
    }
    submitCommand({
      itemId: row.item.id,
      quantity: next,
      type: 'setQuantity',
    });
  };
  const openQuantity = (row: CheckoutRow) => {
    if (row.item.is_marked) return;
    setQuantityItem(row);
    setQuantity(row.item.quantity);
    setQuantityError(null);
  };
  const submitQuantity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quantityItem) return;
    const parsed = quantitySchema(rowUnit(quantityItem)).safeParse(quantity);
    if (!parsed.success) {
      setQuantityError(
        parsed.error.issues[0]?.message ?? 'Проверьте количество',
      );
      return;
    }
    setQuantityError(null);
    submitCommand({
      itemId: quantityItem.item.id,
      quantity: parsed.data,
      type: 'setQuantity',
    });
  };
  const removeRow = () => {
    if (!removeItem) return;
    submitCommand({ itemId: removeItem.item.id, type: 'remove' });
  };
  const openPrice = (row: CheckoutRow) => {
    setPriceItem(row);
    setUnitPrice('');
    setPriceReason('');
    setPriceError(null);
  };
  const submitPrice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!priceItem) return;
    const parsed = priceOverrideSchema.safeParse({
      reason: priceReason,
      unitPrice,
    });
    if (!parsed.success) {
      setPriceError(parsed.error.issues[0]?.message ?? 'Проверьте цену');
      return;
    }
    setPriceError(null);
    submitCommand({
      itemId: priceItem.item.id,
      reason: parsed.data.reason,
      type: 'overridePrice',
      unitPrice: parsed.data.unitPrice,
    });
  };
  const resetPrice = (row: CheckoutRow) => {
    submitCommand({ itemId: row.item.id, type: 'resetPrice' });
  };
  const submitCancel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = saleCancellationSchema.safeParse({ reason: cancelReason });
    if (!parsed.success) {
      setCancelError(parsed.error.issues[0]?.message ?? 'Проверьте причину');
      return;
    }
    setCancelError(null);
    try {
      const result = await transitions.cancel.mutateAsync(parsed.data.reason);
      if (result.status === 'CANCELLED') finishCancelled();
    } catch (error) {
      setCancelError(getHttpErrorMessage(error, 'Не удалось отменить чек.'));
    }
  };

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-workspace p-3 sm:p-4 lg:p-5">
      <section className="shrink-0 rounded-2xl border border-border/80 bg-card p-3 shadow-[var(--shadow-surface)] sm:p-4">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <ScanLine
              aria-hidden="true"
              className="absolute left-4 top-1/2 size-6 -translate-y-1/2 text-primary"
            />
            <Input
              aria-describedby={scanIssue ? 'scan-issue' : undefined}
              autoFocus
              className="h-15 border-border bg-muted/35 pl-13 pr-4 text-lg shadow-none md:text-lg"
              disabled={!canSearch || !canAddProduct || scannerBlocked}
              id="checkout-search"
              maxLength={512}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitScan();
                }
              }}
              placeholder="Сканируйте штрихкод или найдите товар"
              ref={inputRef}
              value={search}
            />
            <Label className="sr-only" htmlFor="checkout-search">
              Сканируйте или найдите товар
            </Label>
          </div>
          {canBrowseCategories ? (
            <Button
              className="min-h-15 shrink-0 px-4"
              disabled={!canAddProduct || scannerBlocked}
              onClick={() => setCategoryPickerOpen(true)}
              type="button"
            >
              <LayoutGrid aria-hidden="true" className="size-6" />
              Товары по категориям
            </Button>
          ) : null}
          <Button
            aria-label="Показать виртуальную клавиатуру"
            className="min-h-15 min-w-15 bg-muted/50"
            disabled={!canSearch || !canAddProduct || scannerBlocked}
            onClick={() => setKeyboardOpen((open) => !open)}
            type="button"
            variant="ghost"
          >
            <Keyboard aria-hidden="true" className="size-6" />
          </Button>
        </div>

        {scanIssue ? (
          <div
            className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-destructive/5 px-3 py-2 text-sm text-destructive"
            id="scan-issue"
          >
            <span>{scanIssue.message}</span>
            <Button
              aria-label={`Вернуть код ${scanIssue.barcode} в поле`}
              className="min-h-12 shrink-0"
              onClick={() => {
                setSearch(scanIssue.barcode);
                refocus();
              }}
              type="button"
              variant="ghost"
            >
              Вернуть код
            </Button>
          </div>
        ) : null}

        <VirtualKeyboardOverlay
          compact
          maxLength={512}
          onOpenChange={(open) => {
            setKeyboardOpen(open);
            if (!open) refocus();
          }}
          onValueChange={setSearch}
          open={keyboardOpen}
          value={search}
        />

        <div className="mt-2 max-h-52 overflow-auto" aria-live="polite">
          {!canSearch ? (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              Нет права искать и сканировать товары.
            </p>
          ) : search.trim().length >= 2 && products.isPending ? (
            <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              Ищем товары
            </p>
          ) : products.isError ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">
              <span>Не удалось найти товары</span>
              <Button
                className="min-h-12"
                onClick={() => void products.refetch()}
                type="button"
                variant="ghost"
              >
                Повторить
              </Button>
            </div>
          ) : products.data && search.trim().length >= 2 ? (
            products.data.products.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Ничего не найдено
              </p>
            ) : (
              <div className="grid gap-2 pt-1 sm:grid-cols-2 xl:grid-cols-3">
                {products.data.products.slice(0, 20).map((product) => {
                  const reason = !product.is_active
                    ? 'Товар неактивен'
                    : product.retail_price === null
                      ? 'Цена не указана'
                      : null;
                  return (
                    <button
                      aria-label={`Добавить товар ${product.name}`}
                      className="group min-h-17 rounded-xl border border-border bg-background p-3 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/30 hover:bg-primary/[0.025] hover:shadow-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={Boolean(reason) || !canAddProduct || isBusy}
                      key={product.id}
                      onClick={() => selectProduct(product)}
                      type="button"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{product.name}</span>
                        <span className="shrink-0 font-bold tabular-nums text-primary">
                          {formatCash(product.retail_price)}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        <span>{product.sku}</span> ·{' '}
                        <span>{product.barcode}</span>
                      </span>
                      {reason ? (
                        <span className="mt-1 block text-xs font-semibold text-destructive">
                          {reason}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
        </div>
      </section>

      {transitionError ? (
        <p
          className="mt-3 rounded-xl bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
          role="alert"
        >
          {transitionError}
        </p>
      ) : null}

      <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-h-0 overflow-auto rounded-2xl border border-border/80 bg-card shadow-[var(--shadow-surface)]">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border/70 bg-card/95 px-5 py-4 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <ShoppingBasket aria-hidden="true" className="size-5" />
              </span>
              <div>
                <h1 className="text-lg font-bold tracking-[-0.02em]">
                  Оформление продажи
                </h1>
                <p className="text-xs text-muted-foreground">
                  Товары текущего чека
                </p>
              </div>
            </div>
            <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'позиция' : 'позиций'}
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="grid min-h-72 place-items-center p-8 text-center text-muted-foreground">
              <div>
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-muted">
                  <PackageSearch aria-hidden="true" className="size-8" />
                </span>
                <p className="mt-4 text-base font-semibold text-foreground">
                  Корзина пуста
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm">
                  Отсканируйте штрихкод или найдите товар по названию — он
                  появится здесь
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-[73px] z-[5] bg-muted/95 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-5 py-3">Товар</th>
                  <th className="px-3 py-3">Количество</th>
                  <th className="px-3 py-3 text-right">Цена</th>
                  <th className="px-5 py-3 text-right">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = row.item.name;
                  const isOverridden = rowIsOverridden(row);
                  return (
                    <tr
                      className="border-b border-border/70 align-top transition-colors last:border-b-0 hover:bg-primary/[0.018]"
                      key={row.item.id}
                    >
                      <td className="px-5 py-4">
                        <p className="font-semibold leading-snug">{name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.item.barcode}
                        </p>
                        {isOverridden ? (
                          <span className="mt-2 inline-flex rounded-full bg-warning-muted px-2 py-1 text-xs font-semibold text-warning">
                            Цена изменена
                          </span>
                        ) : null}
                        {row.item.is_marked ? (
                          <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                            Data Matrix считан
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-4">
                        <p className="mb-2 font-bold tabular-nums">
                          {formatQuantity(row.item.quantity, rowUnit(row))}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            aria-label={`Уменьшить ${name}`}
                            className="min-h-10 min-w-10 border-border bg-background"
                            disabled={isBusy || row.item.is_marked}
                            onClick={() => adjustQuantity(row, -1)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Minus aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label={`Увеличить ${name}`}
                            className="min-h-10 min-w-10 border-border bg-background"
                            disabled={isBusy || row.item.is_marked}
                            onClick={() => adjustQuantity(row, 1)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Plus aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label={`Изменить количество ${name}`}
                            className="min-h-10 min-w-10 border-border bg-background"
                            disabled={isBusy || row.item.is_marked}
                            onClick={() => openQuantity(row)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button
                            aria-label={`Удалить ${name}`}
                            className="min-h-10 min-w-10 border-border bg-background text-destructive hover:text-destructive"
                            disabled={isBusy}
                            onClick={() => openRemove(row)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <p className="font-semibold tabular-nums">
                          {formatCash(rowUnitPrice(row))}
                        </p>
                        {canOverridePrice ? (
                          <div className="mt-2 flex justify-end gap-2">
                            <Button
                              aria-label={`Изменить цену ${name}`}
                              className="min-h-10 min-w-10 border-border bg-background"
                              disabled={isBusy}
                              onClick={() => openPrice(row)}
                              size="icon"
                              type="button"
                              variant="ghost"
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            {isOverridden ? (
                              <Button
                                aria-label={`Сбросить цену ${name}`}
                                className="min-h-10 min-w-10 border-border bg-background"
                                disabled={isBusy}
                                onClick={() => resetPrice(row)}
                                size="icon"
                                type="button"
                                variant="ghost"
                              >
                                <RotateCcw aria-hidden="true" />
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-right text-base font-bold tabular-nums">
                        {formatCash(rowLineTotal(row))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <aside className="flex min-h-0 flex-col overflow-auto rounded-2xl border border-border/80 bg-card p-5 shadow-[var(--shadow-surface)]">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <ReceiptText aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="font-bold">Текущий чек</p>
              <p className="text-xs text-muted-foreground">
                {rows.length === 0
                  ? 'Добавьте первый товар'
                  : `${rows.length} ${rows.length === 1 ? 'позиция' : 'позиций'}`}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-primary/15 bg-primary/[0.045] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Итого
            </p>
            <p className="mt-2 text-[2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums text-primary xl:text-4xl">
              {formatCash(sale?.total ?? '0.00')}
            </p>
          </div>

          <div className="space-y-2.5 pt-4">
            {rows.length > 0 && canPay ? (
              <Button
                className="min-h-15 w-full text-base shadow-md shadow-primary/20"
                disabled={isBusy}
                onClick={() => void openPayment()}
                type="button"
              >
                <CreditCard aria-hidden="true" className="size-5" />
                Оплатить
              </Button>
            ) : null}
            <Button
              className="min-h-12 w-full border-border bg-background"
              disabled={isBusy}
              onClick={() => setHeldOpen(true)}
              type="button"
              variant="ghost"
            >
              <ReceiptText aria-hidden="true" />
              Отложенные чеки
            </Button>
            {canOpenReturns ? (
              <Button
                className="min-h-12 w-full border-border bg-background"
                disabled={isBusy}
                onClick={onOpenReturns}
                type="button"
                variant="ghost"
              >
                <RotateCcw aria-hidden="true" />
                Возвраты
              </Button>
            ) : null}
            {canOpenSalesHistory ? (
              <Button
                className="min-h-12 w-full border-border bg-background"
                disabled={isBusy}
                onClick={onOpenSalesHistory}
                type="button"
                variant="ghost"
              >
                <History aria-hidden="true" />
                История продаж
              </Button>
            ) : null}
            <ReceiptPrinterSettingsButton className="min-h-12 w-full border-border bg-background" />
            {rows.length > 0 && canHold ? (
              <Button
                className="min-h-12 w-full border-border bg-background"
                disabled={isBusy}
                onClick={() => void holdCurrent()}
                type="button"
                variant="ghost"
              >
                Отложить чек
              </Button>
            ) : null}
            {sale && canCancelCurrent ? (
              <div className="my-3 border-t border-border/70" />
            ) : null}
            {sale && canCancelCurrent ? (
              <Button
                className="min-h-12 w-full text-destructive hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
                disabled={isBusy}
                onClick={openCancel}
                type="button"
                variant="ghost"
              >
                <Ban aria-hidden="true" />
                Отменить чек
              </Button>
            ) : null}
            {canEndSession ? (
              <div className="border-t border-border/70 pt-3">
                <SessionEndAction
                  cashierSession={cashierSession}
                  onSessionEndedLocally={onSessionEndedLocally}
                  onSessionEnded={onSessionEnded}
                />
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {canBrowseCategories ? (
        <CheckoutCategoryPicker
          disabled={!canAddProduct || isBusy}
          onOpenChange={(open) => {
            setCategoryPickerOpen(open);
            if (!open) refocus();
          }}
          onSelectProduct={(product) =>
            command.mutateAsync({ productId: product.id, type: 'add' })
          }
          open={categoryPickerOpen}
          organizationId={cashierSession.organization_id}
          storeId={cashierSession.store_id}
        />
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open && !command.isPending) closeDialogs();
        }}
        open={Boolean(quantityItem)}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
          showCloseButton={!command.isPending}
        >
          <DialogHeader>
            <DialogTitle>Количество товара</DialogTitle>
            <DialogDescription>{quantityItem?.item.name}</DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submitQuantity}>
            <FormField>
              <Label htmlFor="sale-item-quantity">
                Количество {quantityItem?.item.name},{' '}
                {quantityItem ? unitLabels[rowUnit(quantityItem)] : ''}
              </Label>
              <Input
                aria-invalid={Boolean(quantityError)}
                autoFocus
                id="sale-item-quantity"
                inputMode="decimal"
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setQuantityError(null);
                }}
                value={quantity}
              />
              {quantityError ? (
                <p className="text-sm font-medium text-destructive">
                  {quantityError}
                </p>
              ) : null}
            </FormField>
            <NumericKeypad
              disabled={command.isPending}
              onValueChange={(value) => {
                setQuantity(value);
                setQuantityError(null);
              }}
              value={quantity}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  className="min-h-12"
                  disabled={command.isPending}
                  type="button"
                  variant="ghost"
                >
                  Отмена
                </Button>
              </DialogClose>
              <Button
                className="min-h-12"
                disabled={command.isPending}
                type="submit"
              >
                Сохранить количество
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {paymentSale ? (
        <CheckoutPaymentDialog
          onConfirm={confirmPayment}
          onOpenChange={(open) => {
            if (!open && !transitions.checkout.isPending) {
              setPaymentSale(null);
              setPaymentError(undefined);
              refocus();
            }
          }}
          open
          pending={transitions.checkout.isPending}
          sale={paymentSale}
          serverErrorMessage={paymentError}
        />
      ) : null}

      <CheckoutHeldSalesDialog
        canResume={canResume}
        error={heldSales.isError}
        heldSales={heldSales.data}
        loading={heldSales.isPending || heldSales.isFetching}
        onOpenChange={(open) => {
          if (!transitions.resume.isPending) {
            setHeldOpen(open);
            if (!open) refocus();
          }
        }}
        onResume={(held) => void resumeHeld(held)}
        onRetry={() => void heldSales.refetch()}
        open={heldOpen}
        pending={transitions.resume.isPending}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open && !command.isPending) closeDialogs();
        }}
        open={Boolean(removeItem)}
      >
        <DialogContent showCloseButton={!command.isPending}>
          <DialogHeader>
            <DialogTitle>Удалить {removeItem?.item.name}?</DialogTitle>
            <DialogDescription>
              Позиция будет полностью удалена из чека.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button
                className="min-h-12"
                disabled={command.isPending}
                type="button"
                variant="ghost"
              >
                Назад
              </Button>
            </DialogClose>
            <Button
              className="min-h-12 bg-destructive text-white hover:bg-destructive/90"
              disabled={command.isPending}
              onClick={removeRow}
              type="button"
            >
              Удалить позицию
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !command.isPending) closeDialogs();
        }}
        open={Boolean(priceItem)}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
          showCloseButton={!command.isPending}
        >
          <DialogHeader>
            <DialogTitle>Изменить цену</DialogTitle>
            <DialogDescription>
              {priceItem?.item.name}: базовая{' '}
              {formatCash(priceItem?.item.base_unit_price ?? null)}, текущая{' '}
              {formatCash(priceItem ? rowUnitPrice(priceItem) : null)}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submitPrice}>
            <FormField>
              <Label htmlFor="override-unit-price">Новая цена, ₸</Label>
              <Input
                autoFocus
                id="override-unit-price"
                inputMode="decimal"
                onChange={(event) => {
                  setUnitPrice(event.target.value);
                  setPriceError(null);
                }}
                value={unitPrice}
              />
            </FormField>
            <NumericKeypad
              disabled={command.isPending}
              onValueChange={(value) => {
                setUnitPrice(value);
                setPriceError(null);
              }}
              value={unitPrice}
            />
            <FormField>
              <Label htmlFor="override-reason">Причина изменения цены</Label>
              <Input
                id="override-reason"
                maxLength={500}
                onChange={(event) => {
                  setPriceReason(event.target.value);
                  setPriceError(null);
                }}
                value={priceReason}
              />
            </FormField>
            <VirtualKeyboard
              disabled={command.isPending}
              maxLength={500}
              onValueChange={(value) => {
                setPriceReason(value);
                setPriceError(null);
              }}
              value={priceReason}
            />
            {priceError ? (
              <p className="text-sm font-medium text-destructive">
                {priceError}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  className="min-h-12"
                  disabled={command.isPending}
                  type="button"
                  variant="ghost"
                >
                  Отмена
                </Button>
              </DialogClose>
              <Button
                className="min-h-12"
                disabled={command.isPending}
                type="submit"
              >
                Сохранить цену
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !transitions.cancel.isPending) closeDialogs();
        }}
        open={cancelOpen}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
          showCloseButton={!transitions.cancel.isPending}
        >
          <DialogHeader>
            <DialogTitle>Отменить чек?</DialogTitle>
            <DialogDescription>
              Причина сохранится в истории. Отменённый чек нельзя восстановить.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submitCancel}>
            <FormField>
              <Label htmlFor="cancel-reason">Причина отмены</Label>
              <textarea
                aria-label="Причина отмены"
                autoFocus
                className="min-h-24 w-full resize-none rounded-lg border border-input bg-background p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                id="cancel-reason"
                maxLength={500}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                  setCancelError(null);
                }}
                placeholder="Коротко укажите, почему чек отменяется"
                value={cancelReason}
              />
              <div className="flex flex-wrap gap-2">
                {cancellationReasonOptions.map((reason) => (
                  <Button
                    key={reason}
                    onClick={() => {
                      setCancelReason(reason);
                      setCancelError(null);
                    }}
                    className="min-h-9 px-3 py-1.5 text-xs"
                    type="button"
                    variant="ghost"
                  >
                    {reason}
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <Button
                  onClick={() => setCancelKeyboardOpen(true)}
                  type="button"
                  variant="ghost"
                >
                  <Keyboard aria-hidden="true" />
                  Экранная клавиатура
                </Button>
                <span className="text-xs text-muted-foreground">
                  {cancelReason.length}/500
                </span>
              </div>
              <VirtualKeyboardOverlay
                compact
                maxLength={500}
                onOpenChange={setCancelKeyboardOpen}
                onValueChange={(value) => {
                  setCancelReason(value);
                  setCancelError(null);
                }}
                open={cancelKeyboardOpen}
                value={cancelReason}
              />
            </FormField>
            {cancelError ? (
              <p className="text-sm font-medium text-destructive">
                {cancelError}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  className="min-h-12"
                  disabled={transitions.cancel.isPending}
                  type="button"
                  variant="ghost"
                >
                  Назад
                </Button>
              </DialogClose>
              <Button
                className="min-h-12 bg-destructive text-white hover:bg-destructive/90"
                disabled={transitions.cancel.isPending}
                type="submit"
              >
                {transitions.cancel.isPending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                Подтвердить отмену
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export function CheckoutView(props: CheckoutViewProps) {
  return props.cashierSession.status === 'ACTIVE' ? (
    <ActiveCheckout {...props} />
  ) : (
    <LockedCheckout {...props} />
  );
}
