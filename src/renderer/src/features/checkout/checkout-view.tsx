import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  CreditCard,
  Keyboard,
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
import { VirtualKeyboard } from '@renderer/common/components/virtual-keyboard';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';
import { authContextQueryOptions } from '@renderer/features/auth';
import { EndCashierSessionAction } from '@renderer/features/cashier-sessions';

import { useCheckoutCartStore } from './checkout-cart-store';
import { CheckoutHeldSalesDialog } from './checkout-held-sales-dialog';
import {
  adjustQuantityByOne,
  formatQuantity,
  priceOverrideSchema,
  quantitySchema,
  saleCancellationSchema,
} from './checkout-input';
import {
  type CartItem,
  adjustCartItemQuantity,
  findProductByExactBarcode,
  getCartLineTotal,
  getCartTotal,
} from './checkout-local-cart';
import { CheckoutPaymentDialog } from './checkout-payment-dialog';
import {
  currentSaleQueryOptions,
  heldSalesQueryOptions,
  useProductSearchQuery,
} from './checkout-query-options';
import { useCheckoutSaleTransitions } from './use-checkout-sale-transitions';
import {
  type SaleCommand,
  useSaleCommandMutation,
} from './use-sale-command-mutation';

const unitLabels = { kg: 'кг', l: 'л', m: 'м', pcs: 'шт.' } as const;

type CheckoutViewProps = {
  cashierSession: CashierSessionResponse;
  onRetrySession?: () => void;
  onSessionEnded: () => void;
  onSessionEndedLocally?: () => void;
};

type CheckoutRow =
  | { item: CartItem; mode: 'local' }
  | { item: SaleItemResponse; mode: 'server' };

const rowUnit = (row: CheckoutRow) =>
  row.mode === 'local' ? row.item.unit : row.item.unit_code;

const rowUnitPrice = (row: CheckoutRow) =>
  row.mode === 'local'
    ? (row.item.priceOverride?.unitPrice ?? row.item.catalogUnitPrice)
    : row.item.unit_price;

const rowLineTotal = (row: CheckoutRow) =>
  row.mode === 'local' ? getCartLineTotal(row.item) : row.item.line_total;

const rowIsOverridden = (row: CheckoutRow) =>
  row.mode === 'local'
    ? row.item.priceOverride !== undefined
    : row.item.price_override_reason !== null ||
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
      onEnded={() => {
        useCheckoutCartStore.getState().deleteSession(cashierSession.id);
        onSessionEnded();
      }}
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
  const localSession = useCheckoutCartStore(
    (state) => state.sessions[cashierSession.id],
  );
  const currentSale = queryClient.getQueryData<SaleResponse | null>(
    queryKeys.sales.current(cashierSession.id),
  );
  const canEnd =
    (localSession?.items.length ?? 0) === 0 &&
    localSession?.pendingOperation === undefined &&
    currentSale?.status !== 'DRAFT';

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
  onSessionEnded,
  onSessionEndedLocally,
}: CheckoutViewProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const context = useQuery(authContextQueryOptions());
  const currentSale = useQuery(currentSaleQueryOptions(cashierSession.id));
  const transitions = useCheckoutSaleTransitions(cashierSession.id);
  const localSession = useCheckoutCartStore(
    (state) => state.sessions[cashierSession.id],
  );
  const localItems = localSession?.items ?? [];
  const pendingOperation = localSession?.pendingOperation;
  const sale = currentSale.data?.status === 'DRAFT' ? currentSale.data : null;
  const currentKey = queryKeys.sales.current(cashierSession.id);
  const [search, setSearch] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
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
  const [heldOpen, setHeldOpen] = useState(false);
  const heldSales = useQuery({
    ...heldSalesQueryOptions(cashierSession.id),
    enabled: heldOpen,
  });
  const [paymentSale, setPaymentSale] = useState<SaleResponse | null>(null);
  const [paymentLocalTotal, setPaymentLocalTotal] = useState<
    string | undefined
  >();
  const [paymentError, setPaymentError] = useState<string>();
  const [transitionError, setTransitionError] = useState<string>();
  const [completedSale, setCompletedSale] = useState<SaleResponse | null>(null);
  const [dismissedCompletedSaleId, setDismissedCompletedSaleId] = useState<
    string | null
  >(null);
  const canSearch = Boolean(
    context.data?.isSystemPosition ||
    context.data?.permissions.includes('product.read'),
  );

  const refocus = () => window.setTimeout(() => inputRef.current?.focus());
  const closeDialogs = () => {
    setQuantityItem(null);
    setRemoveItem(null);
    setPriceItem(null);
    setCancelOpen(false);
    refocus();
  };
  const openCancel = () => {
    setCancelOpen(true);
    setCancelReason('');
    setCancelError(null);
  };
  const finishCancelled = () => {
    void queryClient.cancelQueries({ exact: true, queryKey: currentKey });
    useCheckoutCartStore.getState().deleteSession(cashierSession.id);
    queryClient.setQueryData<SaleResponse | null>(currentKey, null);
    setCancelError(null);
    setCancelOpen(false);
    toast.success('Чек отменён');
  };

  const command = useSaleCommandMutation(cashierSession.id, sale, {
    onError: (error, submitted, reconciledSale) => {
      if (
        submitted.type === 'cancel' &&
        reconciledSale?.status === 'CANCELLED'
      ) {
        finishCancelled();
        return;
      }
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
      if (submitted.type === 'setQuantity' && quantityItem) {
        setQuantityError(message);
        return;
      }
      if (submitted.type === 'overridePrice') {
        setPriceError(message);
        return;
      }
      if (submitted.type === 'cancel') {
        setCancelError(message);
        return;
      }
      httpErrorHandler(error, 'Не удалось изменить чек.');
      refocus();
    },
    onSuccess: (updatedSale, submitted) => {
      if (submitted.type === 'scan' || submitted.type === 'add') {
        if (submitted.type === 'scan') {
          setScanIssue((issue) =>
            issue?.barcode === submitted.barcode ? null : issue,
          );
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
      } else if (submitted.type === 'cancel') {
        if (updatedSale.status === 'CANCELLED') {
          finishCancelled();
        }
      }
      if (submitted.type !== 'cancel') refocus();
    },
  });

  const localScan = useMutation({
    mutationFn: async (barcode: string) => {
      const result = await searchProducts({
        limit: 20,
        offset: 0,
        search: barcode,
      });
      const exact = result.products.find(
        (product) => product.barcode === barcode,
      );
      const product = findProductByExactBarcode(result.products, barcode);
      if (!exact) {
        return { barcode, message: `Товар с кодом ${barcode} не найден` };
      }
      if (!exact.is_active) {
        return { barcode, message: `Товар с кодом ${barcode} неактивен` };
      }
      if (exact.retail_price === null) {
        return { barcode, message: `У товара с кодом ${barcode} нет цены` };
      }
      if (
        !product ||
        !useCheckoutCartStore.getState().addProduct(cashierSession.id, product)
      ) {
        return { barcode, message: `Не удалось добавить товар ${barcode}` };
      }
      return { barcode, message: null };
    },
    onSuccess: ({ barcode, message }) => {
      if (message) {
        setScanIssue({ barcode, message });
      } else {
        setScanIssue((issue) => (issue?.barcode === barcode ? null : issue));
        setSearch((value) => (value.trim() === barcode ? '' : value));
      }
      refocus();
    },
    onError: (_error, barcode) => {
      setScanIssue({
        barcode,
        message: `Не удалось найти товар с кодом ${barcode}`,
      });
      refocus();
    },
    scope: { id: `local-scan:${cashierSession.id}` },
  });
  const products = useProductSearchQuery(
    search,
    canSearch &&
      !localScan.isPending &&
      !command.isPending &&
      !transitions.prepare.isPending &&
      !transitions.checkout.isPending &&
      !transitions.hold.isPending &&
      !transitions.resume.isPending &&
      pendingOperation === undefined,
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
  const canPay = sale
    ? hasPermission('sales.complete')
    : hasPermission('sales.create') && hasPermission('sales.complete');
  const canHold = sale
    ? hasPermission('sales.hold')
    : hasPermission('sales.create') && hasPermission('sales.hold');
  const rows: CheckoutRow[] = sale
    ? sale.items.map((item) => ({ item, mode: 'server' }))
    : localItems.map((item) => ({ item, mode: 'local' }));
  const transitionPending =
    transitions.prepare.isPending ||
    transitions.checkout.isPending ||
    transitions.hold.isPending ||
    transitions.resume.isPending ||
    transitions.isRetryPending ||
    transitions.recovery.isFetching;
  const isBusy =
    command.isPending ||
    localScan.isPending ||
    transitionPending ||
    pendingOperation !== undefined;
  const scannerBlocked =
    command.isPending || transitionPending || pendingOperation !== undefined;
  const canResume =
    hasPermission('sales.hold') &&
    !sale &&
    localItems.length === 0 &&
    pendingOperation === undefined &&
    !transitionPending;
  const canEndSession =
    !sale &&
    localItems.length === 0 &&
    pendingOperation === undefined &&
    !isBusy;

  const showTransitionError = (error: unknown, fallback: string) =>
    setTransitionError(getHttpErrorMessage(error, fallback));
  const finishTransition = (result: SaleResponse) => {
    setTransitionError(undefined);
    if (result.status === 'COMPLETED') {
      setPaymentSale(null);
      setPaymentError(undefined);
      setDismissedCompletedSaleId(null);
      setCompletedSale(result);
    } else if (result.status === 'HELD') {
      setHeldOpen(false);
      toast.success('Чек отложен');
      refocus();
    }
  };
  const openPayment = async () => {
    if (!canPay || rows.length === 0 || pendingOperation) return;
    const localPreview = sale ? undefined : getCartTotal(localItems);
    setPaymentError(undefined);
    setTransitionError(undefined);
    try {
      const prepared = await transitions.prepare.mutateAsync();
      setPaymentLocalTotal(localPreview);
      setPaymentSale(prepared);
    } catch (error) {
      showTransitionError(error, 'Не удалось подготовить чек.');
      refocus();
    }
  };
  const confirmPayment = async (payments: SalePaymentPayload[]) => {
    setPaymentError(undefined);
    setTransitionError(undefined);
    try {
      finishTransition(await transitions.checkout.mutateAsync(payments));
    } catch (error) {
      const unresolved =
        useCheckoutCartStore.getState().sessions[cashierSession.id]
          ?.pendingOperation;
      const message = getHttpErrorMessage(error, 'Не удалось оплатить чек.');
      if (unresolved) {
        setPaymentSale(null);
        setTransitionError(message);
      } else {
        const authoritative = queryClient.getQueryData<SaleResponse | null>(
          currentKey,
        );
        if (authoritative?.status === 'DRAFT') {
          setPaymentSale((current) =>
            current?.id === authoritative.id ? authoritative : current,
          );
        }
        setPaymentError(message);
      }
    }
  };
  const holdCurrent = async () => {
    if (!canHold || rows.length === 0 || pendingOperation) return;
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
  const retryPending = async () => {
    setTransitionError(undefined);
    try {
      finishTransition(await transitions.retryPending());
    } catch (error) {
      showTransitionError(error, 'Не удалось повторить операцию.');
    }
  };

  const recoveredCompletedSale =
    transitions.recovery.data?.status === 'COMPLETED' &&
    transitions.recovery.data.id !== dismissedCompletedSaleId
      ? transitions.recovery.data
      : null;
  const visibleCompletedSale = completedSale ?? recoveredCompletedSale;

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
            <div
              className={`mt-6 grid gap-3 ${pendingOperation ? '' : 'sm:grid-cols-2'}`}
            >
              <Button
                className="min-h-12"
                onClick={() => {
                  setDismissedCompletedSaleId(visibleCompletedSale.id);
                  setCompletedSale(null);
                  refocus();
                }}
                type="button"
              >
                Новый чек
              </Button>
              {pendingOperation === undefined ? (
                <SessionEndAction
                  cashierSession={cashierSession}
                  onSessionEndedLocally={onSessionEndedLocally}
                  onSessionEnded={onSessionEnded}
                />
              ) : null}
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
    if (!barcode || !canSearch || scannerBlocked) return;
    setSearch('');
    if (sale) submitCommand({ barcode, type: 'scan' });
    else localScan.mutate(barcode);
  };
  const selectProduct = (product: ProductResponse) => {
    if (sale) {
      submitCommand({ productId: product.id, type: 'add' });
      return;
    }
    if (
      useCheckoutCartStore.getState().addProduct(cashierSession.id, product)
    ) {
      setSearch('');
      refocus();
    } else {
      toast.error('Не удалось добавить товар');
    }
  };
  const openRemove = (row: CheckoutRow) => {
    if (row.mode === 'server' && sale?.items.length === 1) {
      openCancel();
      return;
    }
    setRemoveItem(row);
  };
  const adjustQuantity = (row: CheckoutRow, delta: -1 | 1) => {
    if (row.mode === 'local') {
      const next = adjustCartItemQuantity(row.item, delta);
      if (!next) {
        openRemove(row);
        return;
      }
      useCheckoutCartStore
        .getState()
        .setQuantity(cashierSession.id, row.item.productId, next.quantity);
      return;
    }
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
    if (quantityItem.mode === 'local') {
      useCheckoutCartStore
        .getState()
        .setQuantity(
          cashierSession.id,
          quantityItem.item.productId,
          parsed.data,
        );
      setQuantityItem(null);
      refocus();
      return;
    }
    submitCommand({
      itemId: quantityItem.item.id,
      quantity: parsed.data,
      type: 'setQuantity',
    });
  };
  const removeRow = () => {
    if (!removeItem) return;
    if (removeItem.mode === 'local') {
      useCheckoutCartStore
        .getState()
        .remove(cashierSession.id, removeItem.item.productId);
      setRemoveItem(null);
      refocus();
      return;
    }
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
    if (priceItem.mode === 'local') {
      useCheckoutCartStore
        .getState()
        .overridePrice(
          cashierSession.id,
          priceItem.item.productId,
          parsed.data,
        );
      setPriceItem(null);
      refocus();
      return;
    }
    submitCommand({
      itemId: priceItem.item.id,
      reason: parsed.data.reason,
      type: 'overridePrice',
      unitPrice: parsed.data.unitPrice,
    });
  };
  const resetPrice = (row: CheckoutRow) => {
    if (row.mode === 'local') {
      useCheckoutCartStore
        .getState()
        .resetPrice(cashierSession.id, row.item.productId);
      refocus();
      return;
    }
    submitCommand({ itemId: row.item.id, type: 'resetPrice' });
  };
  const submitCancel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sale) {
      useCheckoutCartStore.getState().clear(cashierSession.id);
      setCancelOpen(false);
      refocus();
      return;
    }
    const parsed = saleCancellationSchema.safeParse({ reason: cancelReason });
    if (!parsed.success) {
      setCancelError(parsed.error.issues[0]?.message ?? 'Проверьте причину');
      return;
    }
    setCancelError(null);
    submitCommand({ reason: parsed.data.reason, type: 'cancel' });
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
              disabled={!canSearch || scannerBlocked}
              id="checkout-search"
              maxLength={255}
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
          <Button
            aria-label="Показать виртуальную клавиатуру"
            className="min-h-15 min-w-15 bg-muted/50"
            disabled={!canSearch || scannerBlocked}
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

        {keyboardOpen ? (
          <div className="mt-3 overflow-hidden rounded-xl bg-muted p-3">
            <VirtualKeyboard
              compact
              maxLength={255}
              onClose={() => {
                setKeyboardOpen(false);
                refocus();
              }}
              onValueChange={setSearch}
              value={search}
            />
          </div>
        ) : null}

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
                      disabled={Boolean(reason) || isBusy}
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

      {sale ? (
        <div className="mt-3 rounded-xl border border-warning/30 bg-warning-muted px-4 py-3 text-sm font-semibold text-warning">
          Восстановлен серверный черновик
        </div>
      ) : null}

      {pendingOperation ? (
        <section className="mt-3 rounded-xl border border-warning/30 bg-warning-muted px-4 py-3">
          <h2 className="font-bold">Проверьте статус операции</h2>
          {transitions.recovery.isFetching ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              Проверяем сервер, операция не будет отправлена повторно
            </p>
          ) : transitions.recovery.isError ? (
            <p className="mt-2 text-sm text-destructive">
              {getHttpErrorMessage(
                transitions.recovery.error,
                'Не удалось проверить статус. Локальные данные сохранены.',
              )}
            </p>
          ) : transitions.recovery.data?.status === 'DRAFT' ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Серверный чек остался черновиком. Повторите точную команду или
              вернитесь к редактированию.
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Результат операции неизвестен. Сначала проверьте статус или
              повторите точную сохранённую команду.
            </p>
          )}
          {transitionError ? (
            <p
              className="mt-2 text-sm font-medium text-destructive"
              role="alert"
            >
              {transitionError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {transitions.recovery.data?.status !== 'DRAFT' ? (
              <Button
                className="min-h-12"
                disabled={transitionPending}
                onClick={() => void transitions.recovery.refetch()}
                type="button"
                variant="ghost"
              >
                Проверить статус
              </Button>
            ) : null}
            <Button
              className="min-h-12"
              disabled={transitionPending}
              onClick={() => void retryPending()}
              type="button"
            >
              Повторить
            </Button>
            <Button
              className="min-h-12"
              disabled={transitionPending}
              onClick={() => {
                transitions.abandonPending();
                setTransitionError(undefined);
                refocus();
              }}
              type="button"
              variant="ghost"
            >
              Вернуться к редактированию
            </Button>
          </div>
        </section>
      ) : transitionError ? (
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
                      key={
                        row.mode === 'local' ? row.item.productId : row.item.id
                      }
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
                      </td>
                      <td className="px-3 py-4">
                        <p className="mb-2 font-bold tabular-nums">
                          {formatQuantity(row.item.quantity, rowUnit(row))}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            aria-label={`Уменьшить ${name}`}
                            className="min-h-10 min-w-10 border-border bg-background"
                            disabled={isBusy}
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
                            disabled={isBusy}
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
                            disabled={isBusy}
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
              {sale ? 'Итого' : 'Предварительный итог'}
            </p>
            <p className="mt-2 text-[2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums text-primary xl:text-4xl">
              {formatCash(sale ? sale.total : getCartTotal(localItems))}
            </p>
          </div>

          <div className="space-y-2.5 pt-4">
            {!pendingOperation && rows.length > 0 && canPay ? (
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
            {!pendingOperation && rows.length > 0 && canHold ? (
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
            {(sale && canCancel) || (!sale && localItems.length > 0) ? (
              <div className="my-3 border-t border-border/70" />
            ) : null}
            {sale && canCancel ? (
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
            {!sale && localItems.length > 0 ? (
              <Button
                className="min-h-12 w-full text-destructive hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
                disabled={isBusy}
                onClick={openCancel}
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
                Очистить корзину
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
          localPreviewTotal={paymentLocalTotal}
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
              {formatCash(
                priceItem?.mode === 'local'
                  ? (priceItem.item.catalogUnitPrice ?? null)
                  : (priceItem?.item.base_unit_price ?? null),
              )}
              , текущая {formatCash(priceItem ? rowUnitPrice(priceItem) : null)}
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
          if (!open && !command.isPending) closeDialogs();
        }}
        open={cancelOpen}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
          showCloseButton={!command.isPending}
        >
          <DialogHeader>
            <DialogTitle>
              {sale ? 'Отменить чек?' : 'Очистить корзину?'}
            </DialogTitle>
            <DialogDescription>
              {sale
                ? 'Отменённый чек нельзя восстановить.'
                : 'Все локальные позиции будут удалены.'}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submitCancel}>
            {sale ? (
              <>
                <FormField>
                  <Label htmlFor="cancel-reason">Причина отмены</Label>
                  <Input
                    autoFocus
                    id="cancel-reason"
                    maxLength={500}
                    onChange={(event) => {
                      setCancelReason(event.target.value);
                      setCancelError(null);
                    }}
                    value={cancelReason}
                  />
                </FormField>
                <VirtualKeyboard
                  compact
                  disabled={command.isPending}
                  maxLength={500}
                  onValueChange={(value) => {
                    setCancelReason(value);
                    setCancelError(null);
                  }}
                  value={cancelReason}
                />
              </>
            ) : null}
            {cancelError ? (
              <p className="text-sm font-medium text-destructive">
                {cancelError}
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
                  Назад
                </Button>
              </DialogClose>
              <Button
                className="min-h-12 bg-destructive text-white hover:bg-destructive/90"
                disabled={command.isPending}
                type="submit"
              >
                {sale ? 'Подтвердить отмену' : 'Очистить'}
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
