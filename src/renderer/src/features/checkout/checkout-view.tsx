import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  CreditCard,
  History,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  PackageSearch,
  Pause,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  ScanLine,
  ShoppingBasket,
  Star,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  type CashierSessionResponse,
  type FiscalizationMode,
  type HeldSaleResponse,
  type ProductResponse,
  type SaleItemResponse,
  type SalePaymentPayload,
  type SaleResponse,
} from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
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
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';
import {
  localPosActive,
  localPosProfile,
} from '@renderer/common/lib/local-pos';
import {
  adjustQuantityByOne,
  formatQuantity,
  quantitySchema,
} from '@renderer/common/lib/quantity';
import { authContextQueryOptions } from '@renderer/features/auth';
import { CashMovementsDialog } from '@renderer/features/cash-movements';
import { EndCashierSessionAction } from '@renderer/features/cashier-sessions';
import { ProductLookupStatus } from '@renderer/features/local-pos';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import { useProductSearchQuery } from '@renderer/features/products';
import {
  LastZReportPrintButton,
  ReceiptPrintButton,
  XReportPrintButton,
} from '@renderer/features/receipt-printing';
import {
  activeRegistersQueryOptions,
  registerShiftHistoryQueryOptions,
} from '@renderer/features/register-shifts';

import { assertProductSellable } from '../../../../shared/pos/product-policy';
import { CheckoutCategoryPicker } from './checkout-category-picker';
import { CheckoutHeldSalesDialog } from './checkout-held-sales-dialog';
import {
  priceOverrideSchema,
  saleCancellationSchema,
  saleDiscountSchema,
} from './checkout-input';
import { CheckoutPaymentDialog } from './checkout-payment-dialog';
import { CheckoutPriceCheckDialog } from './checkout-price-check-dialog';
import {
  currentSaleQueryOptions,
  heldSalesQueryOptions,
} from './checkout-query-options';
import { LocalPosStatus } from './local-pos-status';
import {
  focusCheckoutWorkspace,
  useCheckoutBarcodeScanner,
} from './use-checkout-barcode-scanner';
import { useCheckoutProductScan } from './use-checkout-product-scan';
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
const priceReasonOptions = [
  'Ошибка в цене',
  'Цена по договорённости',
  'Акция',
] as const;
const discountReasonOptions = [
  'Постоянный покупатель',
  'Акция',
  'Компенсация',
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
  const workspaceRef = useRef<HTMLElement>(null);
  const context = useQuery(authContextQueryOptions());
  const activeRegisters = useQuery(
    activeRegistersQueryOptions(context.data?.storeId),
  );
  const canReadShift = Boolean(
    context.data &&
    (context.data.isSystemPosition ||
      context.data.permissions.includes('register_shift.read')),
  );
  const organizations = useQuery({
    ...organizationsQueryOptions(),
    enabled: canReadShift,
  });
  const shiftHistory = useQuery(
    registerShiftHistoryQueryOptions(cashierSession.register_id, canReadShift),
  );
  const currentSale = useQuery(currentSaleQueryOptions(cashierSession.id));
  const transitions = useCheckoutSaleTransitions(cashierSession.id);
  const sale = currentSale.data?.status === 'DRAFT' ? currentSale.data : null;
  const currentKey = queryKeys.sales.current(cashierSession.id);
  const [search, setSearch] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [cashMovementType, setCashMovementType] = useState<
    'DEPOSIT' | 'WITHDRAWAL' | null
  >(null);
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
  const [priceStep, setPriceStep] = useState<'value' | 'reason'>('value');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [discountStep, setDiscountStep] = useState<'value' | 'reason'>('value');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const heldSales = useQuery({
    ...heldSalesQueryOptions(cashierSession.id),
    enabled: heldOpen,
  });
  const [paymentSale, setPaymentSale] = useState<SaleResponse | null>(null);
  const [paymentError, setPaymentError] = useState<string>();
  const [transitionError, setTransitionError] = useState<string>();
  const [completedSale, setCompletedSale] = useState<SaleResponse | null>(null);
  const activeRegister = activeRegisters.data?.find(
    ({ id }) => id === cashierSession.register_id,
  );
  const localRegister = localPosProfile()?.register;
  const fiscalizationPolicy =
    activeRegister?.fiscalization?.policy ??
    localRegister?.fiscalization.policy ??
    'ALWAYS';
  const fiscalizationEnabled =
    activeRegister?.fiscalization?.enabled ??
    localRegister?.fiscalization.enabled ??
    true;
  const fiscalizationPreviewEnabled =
    import.meta.env.DEV &&
    import.meta.env.VITE_PREVIEW_FISCALIZATION === 'true';
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
  const timeZone =
    organizations.data?.find(
      ({ organization }) => organization?.id === context.data?.organizationId,
    )?.organization?.timezone ?? 'Asia/Almaty';
  const lastClosedShift = shiftHistory.data?.find(
    ({ status }) => status === 'CLOSED',
  );

  const refocus = () =>
    window.setTimeout(() => focusCheckoutWorkspace(workspaceRef.current));
  const closeDialogs = () => {
    setQuantityItem(null);
    setRemoveItem(null);
    setPriceItem(null);
    setDiscountOpen(false);
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
    queryClient.setQueryData<SaleResponse | null>(currentKey, null);
    setCancelError(null);
    setCancelOpen(false);
    toast.success('Чек отменён');
  };

  const commandState = useSaleCommandMutation(cashierSession.id, sale, {
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
      if (submitted.type === 'applyDiscount') {
        setDiscountError(message);
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
      } else if (submitted.type === 'applyDiscount') {
        setDiscountError(null);
        setDiscountOpen(false);
      }
      refocus();
    },
  });

  // A local cache miss must not disable the cart's buttons or unrelated edit dialogs.
  const command = {
    ...commandState,
    isPending:
      commandState.isPending &&
      !(
        localPosActive() &&
        ['scan', 'add'].includes(commandState.variables?.type ?? '')
      ),
  };

  const scanFirstProduct = useCheckoutProductScan({
    cashierSessionId: cashierSession.id,
    organizationId: cashierSession.organization_id,
    execute: command.mutateAsync,
    onIssue: setScanIssue,
    onResolved: (barcode) =>
      setSearch((value) => (value.trim() === barcode ? '' : value)),
    refocus,
  });
  const products = useProductSearchQuery(
    search,
    canSearch &&
      canAddProduct &&
      (!command.isPending || localPosActive()) &&
      !transitions.cancel.isPending &&
      !transitions.checkout.isPending &&
      !transitions.hold.isPending &&
      !transitions.resume.isPending,
    context.data?.organizationId,
    context.data?.storeId,
  );
  const transitionPending =
    transitions.cancel.isPending ||
    transitions.checkout.isPending ||
    transitions.hold.isPending ||
    transitions.resume.isPending;
  const scannerBlocked =
    (!localPosActive() && command.isPending) || transitionPending;
  useCheckoutBarcodeScanner({
    workspaceRef,
    enabled:
      canSearch &&
      canAddProduct &&
      !scannerBlocked &&
      !context.isPending &&
      !context.isError &&
      !currentSale.isPending &&
      !currentSale.isError &&
      !completedSale &&
      !paymentSale &&
      !heldOpen &&
      !cancelOpen &&
      !discountOpen &&
      !categoryPickerOpen &&
      !priceCheckOpen &&
      !operationsOpen &&
      !cashMovementType &&
      !quantityItem &&
      !removeItem &&
      !priceItem,
    onScan: (barcode) => {
      void scanFirstProduct(barcode);
    },
  });

  useEffect(() => {
    if (!context.isPending && !currentSale.isPending) refocus();
  }, [context.isPending, currentSale.isPending, sale?.id]);

  if (
    context.isPending ||
    currentSale.isPending ||
    (currentSale.isFetching && currentSale.data === undefined)
  ) {
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
  const canOpenReceipts = canOpenSalesHistory || canOpenReturns;
  const rows: CheckoutRow[] = sale?.items.map((item) => ({ item })) ?? [];
  const isBusy = command.isPending || transitionPending;
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
    fiscalizationMode: FiscalizationMode = 'FISCAL',
  ) => {
    setPaymentError(undefined);
    setTransitionError(undefined);
    try {
      finishTransition(
        await transitions.checkout.mutateAsync({
          buyerBinIin,
          fiscalizationMode,
          payments,
        }),
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
    void scanFirstProduct(barcode);
  };
  const selectProduct = (product: ProductResponse) => {
    if (!canAddProduct) return;
    try {
      assertProductSellable(product);
    } catch (error) {
      setSearch('');
      setScanIssue({
        barcode: product.barcode,
        message: getHttpErrorMessage(error, 'Не удалось добавить товар.'),
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
    setPriceStep('value');
  };
  const submitPrice = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!priceItem) return;
    if (priceStep === 'value') {
      const parsedPrice =
        priceOverrideSchema.shape.unitPrice.safeParse(unitPrice);
      if (!parsedPrice.success) {
        setPriceError(parsedPrice.error.issues[0]?.message ?? 'Проверьте цену');
        return;
      }
      setPriceError(null);
      setPriceStep('reason');
      return;
    }
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
  const openDiscount = () => {
    setDiscountPercentage(sale?.discount_percentage ?? '');
    setDiscountReason(sale?.discount_reason ?? '');
    setDiscountError(null);
    setDiscountStep('value');
    setDiscountOpen(true);
  };
  const submitDiscount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (discountStep === 'value') {
      const parsedPercentage =
        saleDiscountSchema.shape.percentage.safeParse(discountPercentage);
      if (!parsedPercentage.success) {
        setDiscountError(
          parsedPercentage.error.issues[0]?.message ?? 'Проверьте скидку',
        );
        return;
      }
      setDiscountError(null);
      setDiscountStep('reason');
      return;
    }
    const parsed = saleDiscountSchema.safeParse({
      percentage: discountPercentage,
      reason: discountReason,
    });
    if (!parsed.success) {
      setDiscountError(parsed.error.issues[0]?.message ?? 'Проверьте скидку');
      return;
    }
    setDiscountError(null);
    submitCommand({ ...parsed.data, type: 'applyDiscount' });
  };
  const resetDiscount = () => submitCommand({ type: 'resetDiscount' });
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
    <main
      ref={workspaceRef}
      tabIndex={-1}
      aria-label="Рабочая зона продаж"
      className="flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden bg-workspace p-2 outline-none sm:p-3"
    >
      <LocalPosStatus sessionId={cashierSession.id} />
      <section
        aria-label="Поиск товаров"
        className="relative z-20 shrink-0 rounded-xl border border-border/80 bg-card p-2 shadow-[var(--shadow-surface)]"
      >
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-0">
            <ScanLine
              aria-hidden="true"
              className="absolute left-4 top-1/2 size-6 -translate-y-1/2 text-primary"
            />
            <Input
              aria-describedby={scanIssue ? 'scan-issue' : undefined}
              className="h-12 border-border bg-muted/35 pl-12 pr-14 text-base shadow-none md:text-base"
              disabled={!canSearch || !canAddProduct || scannerBlocked}
              id="checkout-search"
              maxLength={512}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch('');
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitScan();
                }
              }}
              placeholder="Сканируйте штрихкод или найдите товар"
              ref={inputRef}
              value={search}
            />
            {search ? (
              <Button
                aria-label="Очистить поиск"
                className="absolute right-1 top-1/2 size-11 min-h-11 -translate-y-1/2 p-0 active:translate-y-[-50%]"
                onClick={() => {
                  setSearch('');
                  refocus();
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            ) : null}
            <Label className="sr-only" htmlFor="checkout-search">
              Сканируйте или найдите товар
            </Label>
          </div>
          {canSearch ? (
            <Button
              className="h-12 shrink-0 border-border px-3 text-sm"
              disabled={scannerBlocked}
              onClick={() => setPriceCheckOpen(true)}
              type="button"
              variant="ghost"
            >
              <Tags aria-hidden="true" className="size-6" />
              Проверить цену
            </Button>
          ) : null}
          {canBrowseCategories ? (
            <Button
              className="h-12 shrink-0 px-3 text-sm"
              disabled={!canAddProduct || scannerBlocked}
              onClick={() => setCategoryPickerOpen(true)}
              type="button"
            >
              <Star aria-hidden="true" className="size-6" />
              Быстрые товары
            </Button>
          ) : null}
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
                inputRef.current?.focus();
              }}
              type="button"
              variant="ghost"
            >
              Вернуть код
            </Button>
          </div>
        ) : null}

        <ProductLookupStatus />
        {search.trim().length >= 2 &&
        products.isFetching &&
        !products.isPending ? (
          <p
            role="status"
            className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Обновляем результаты поиска…
          </p>
        ) : null}
        <div
          className="absolute inset-x-0 top-full mt-1 max-h-[45svh] overflow-auto rounded-xl border-border bg-card shadow-xl empty:hidden [&:not(:empty)]:border [&:not(:empty)]:p-2"
          aria-live="polite"
        >
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
                      <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 break-words font-semibold [overflow-wrap:anywhere]">
                          {product.name}
                        </span>
                        <span className="shrink-0 font-bold tabular-nums text-primary">
                          {formatCash(product.retail_price)}
                        </span>
                      </span>
                      <span className="mt-1 block break-all text-xs text-muted-foreground">
                        <span>{product.sku}</span> ·{' '}
                        <span>{product.barcode}</span>
                        {product.additional_barcode ? (
                          <span> · Доп.: {product.additional_barcode}</span>
                        ) : null}
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
          className="rounded-xl bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
          role="alert"
        >
          {transitionError}
        </p>
      ) : null}

      <section
        aria-label="Текущий чек"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--shadow-surface)]"
      >
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3">
          <div className="flex items-center gap-2">
            <ShoppingBasket
              aria-hidden="true"
              className="size-4 text-primary"
            />
            <h1 className="text-sm font-bold">Оформление продажи</h1>
          </div>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            Позиций: {rows.length}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="grid h-full min-h-40 place-items-center p-4 text-center text-muted-foreground">
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
            <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
              <colgroup>
                <col />
                <col className="w-[196px]" />
                <col className="w-[120px]" />
                <col className="w-[132px]" />
                <col className="w-[56px]" />
              </colgroup>
              <thead className="sticky top-0 z-[5] bg-muted/95 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground backdrop-blur">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Товар
                  </th>
                  <th scope="col" className="px-2 py-2 text-center">
                    Количество
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Цена
                  </th>
                  <th scope="col" className="px-2 py-2 text-right">
                    Сумма
                  </th>
                  <th scope="col">
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name = row.item.name;
                  const isOverridden = rowIsOverridden(row);
                  return (
                    <tr
                      className="border-b border-border/70 align-middle transition-colors last:border-b-0 hover:bg-primary/[0.018]"
                      key={row.item.id}
                    >
                      <td className="min-w-0 px-3 py-2">
                        <p className="break-words font-semibold leading-snug [overflow-wrap:anywhere]">
                          {name}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {row.item.barcode}
                        </p>
                        {isOverridden ? (
                          <span className="mt-1 mr-1 inline-flex rounded-full bg-warning-muted px-2 py-0.5 text-xs font-semibold text-warning">
                            Цена изменена
                          </span>
                        ) : null}
                        {row.item.is_marked ? (
                          <span className="mt-1 mr-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            Data Matrix считан
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-center rounded-lg border border-border bg-background">
                          <Button
                            aria-label={`Уменьшить ${name}`}
                            className="size-11 min-h-11 rounded-r-none p-0"
                            disabled={isBusy || row.item.is_marked}
                            onClick={() => adjustQuantity(row, -1)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Minus aria-hidden="true" className="size-4" />
                          </Button>
                          <Button
                            aria-label={`Изменить количество ${name}`}
                            className="h-11 min-h-11 flex-1 rounded-none px-1 py-0 text-sm tabular-nums text-foreground"
                            disabled={isBusy || row.item.is_marked}
                            onClick={() => openQuantity(row)}
                            type="button"
                            variant="ghost"
                          >
                            {formatQuantity(row.item.quantity, rowUnit(row))}
                          </Button>
                          <Button
                            aria-label={`Увеличить ${name}`}
                            className="size-11 min-h-11 rounded-l-none p-0"
                            disabled={isBusy || row.item.is_marked}
                            onClick={() => adjustQuantity(row, 1)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Plus aria-hidden="true" className="size-4" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {canOverridePrice ? (
                          <Button
                            aria-label={`Изменить цену ${name}`}
                            className="h-11 min-h-11 w-full justify-end gap-1 px-1 py-0 text-sm tabular-nums text-foreground"
                            disabled={isBusy}
                            onClick={() => openPrice(row)}
                            type="button"
                            variant="ghost"
                          >
                            <Pencil
                              aria-hidden="true"
                              className="size-3 text-muted-foreground"
                            />
                            {formatCash(rowUnitPrice(row))}
                          </Button>
                        ) : (
                          <span className="font-semibold tabular-nums">
                            {formatCash(rowUnitPrice(row))}
                          </span>
                        )}
                        {canOverridePrice && isOverridden ? (
                          <Button
                            aria-label={`Сбросить цену ${name}`}
                            className="h-11 min-h-11 w-full justify-end gap-1 px-1 py-0 text-xs"
                            disabled={isBusy}
                            onClick={() => resetPrice(row)}
                            type="button"
                            variant="ghost"
                          >
                            <RotateCcw aria-hidden="true" className="size-3" />{' '}
                            Сбросить
                          </Button>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.item.discount_amount !== '0.00' ? (
                          <>
                            <p className="text-sm text-muted-foreground line-through">
                              {formatCash(row.item.line_subtotal)}
                            </p>
                            <p className="text-sm font-semibold text-destructive">
                              −{formatCash(row.item.discount_amount)}
                            </p>
                          </>
                        ) : null}
                        <p className="text-base font-bold">
                          {formatCash(rowLineTotal(row))}
                        </p>
                      </td>
                      <td className="px-1 py-1">
                        <Button
                          aria-label={`Удалить ${name}`}
                          className="size-11 min-h-11 p-0 text-muted-foreground hover:bg-destructive/5 hover:text-destructive"
                          disabled={isBusy}
                          onClick={() => openRemove(row)}
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <footer
        aria-label="Итог и оплата"
        className="grid shrink-0 gap-3 rounded-xl border border-border/80 bg-card p-3 shadow-[var(--shadow-surface)] sm:grid-cols-[minmax(160px,0.85fr)_minmax(0,3fr)] lg:grid-cols-[minmax(200px,1fr)_minmax(0,3fr)]"
      >
        <div className="flex min-w-0 flex-col justify-between gap-2 sm:border-r sm:border-border/70 sm:pr-3">
          <dl className="space-y-1 text-xs tabular-nums">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Подытог</dt>
              <dd className="font-semibold">
                {formatCash(sale?.subtotal ?? '0.00')}
              </dd>
            </div>
            <div
              className="flex justify-between gap-2"
              title={sale?.discount_reason ?? undefined}
            >
              <dt className="text-muted-foreground">
                Скидка
                {sale?.discount_percentage
                  ? ` ${Number(sale.discount_percentage).toLocaleString('ru-RU')}%`
                  : ''}
              </dt>
              <dd
                className={
                  sale?.discount_percentage
                    ? 'font-semibold text-destructive'
                    : 'text-muted-foreground'
                }
              >
                {sale?.discount_percentage ? '−' : ''}
                {formatCash(sale?.discount_amount ?? '0.00')}
              </dd>
            </div>
          </dl>
          <div className="border-t border-border/70 pt-2">
            <p className="text-xs font-medium text-muted-foreground">Итого</p>
            <p className="break-words text-2xl font-extrabold tracking-tight tabular-nums text-primary">
              {formatCash(sale?.total ?? '0.00')}
            </p>
          </div>
        </div>
        <div
          aria-label="Действия с чеком"
          className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {canOverridePrice ? (
            <Button
              className="h-auto min-h-13 gap-2 whitespace-normal border-border bg-muted/45 px-2 py-2 text-sm leading-tight text-foreground"
              disabled={!sale || rows.length === 0 || isBusy}
              onClick={openDiscount}
              type="button"
              variant="ghost"
            >
              <Tags aria-hidden="true" className="size-4" />
              {sale?.discount_percentage ? 'Изменить скидку' : 'Скидка на чек'}
            </Button>
          ) : null}
          {hasPermission('sales.hold') ? (
            <Button
              className="h-auto min-h-13 gap-2 whitespace-normal border-warning/20 bg-warning-muted px-2 py-2 text-sm leading-tight text-warning hover:border-warning/30 hover:bg-warning-muted/70 hover:text-warning"
              disabled={!canHold || rows.length === 0 || isBusy}
              onClick={() => void holdCurrent()}
              type="button"
              variant="ghost"
            >
              <Pause aria-hidden="true" className="size-4" /> Отложить чек
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              className="h-auto min-h-13 gap-2 whitespace-normal border-destructive/20 bg-destructive/5 px-2 py-2 text-sm leading-tight text-destructive hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              disabled={!canCancelCurrent || isBusy}
              onClick={openCancel}
              type="button"
              variant="ghost"
            >
              <Ban aria-hidden="true" className="size-4" /> Отменить чек
            </Button>
          ) : null}
          <Button
            className="h-auto min-h-13 gap-2 whitespace-normal border-border bg-muted/45 px-2 py-2 text-sm leading-tight text-foreground"
            disabled={isBusy}
            onClick={() => setHeldOpen(true)}
            type="button"
            variant="ghost"
          >
            <ReceiptText aria-hidden="true" className="size-4" /> Отложенные
            чеки
          </Button>
          {canOpenReceipts ? (
            <Button
              className="h-auto min-h-13 gap-2 whitespace-normal border-border bg-muted/45 px-2 py-2 text-sm leading-tight text-foreground"
              disabled={isBusy}
              onClick={canOpenSalesHistory ? onOpenSalesHistory : onOpenReturns}
              type="button"
              variant="ghost"
            >
              <History aria-hidden="true" className="size-4" /> Чеки и возвраты
            </Button>
          ) : null}
          <Button
            aria-haspopup="dialog"
            className="h-auto min-h-13 gap-2 whitespace-normal border-border bg-muted/45 px-2 py-2 text-sm leading-tight text-foreground"
            disabled={isBusy}
            onClick={() => setOperationsOpen(true)}
            type="button"
            variant="ghost"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" /> Операции
          </Button>
          <Button
            className="col-span-3 h-auto min-h-14 flex-col gap-2 px-3 py-3 text-base shadow-md shadow-primary/20 sm:col-span-1 sm:col-start-4 sm:row-span-2 sm:row-start-1"
            disabled={!canPay || rows.length === 0 || isBusy}
            onClick={openPayment}
            type="button"
          >
            <CreditCard aria-hidden="true" className="size-6" /> Оплатить
          </Button>
        </div>
      </footer>

      <Dialog open={operationsOpen} onOpenChange={setOperationsOpen}>
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            refocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Операции с кассой</DialogTitle>
            <DialogDescription>
              Внесение, изъятие и отчёты по смене
            </DialogDescription>
          </DialogHeader>
          <section className="border-t border-border/70 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Касса и отчёты
            </p>
            {hasPermission('cash_movement.create') ? (
              <div className="mb-2 grid grid-cols-2 gap-2">
                <Button
                  className="min-h-14 border-border text-sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => {
                    setOperationsOpen(false);
                    setCashMovementType('DEPOSIT');
                  }}
                >
                  Внесение
                </Button>
                <Button
                  className="min-h-14 border-border text-sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => {
                    setOperationsOpen(false);
                    setCashMovementType('WITHDRAWAL');
                  }}
                >
                  Изъятие
                </Button>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {canReadShift ? (
                <XReportPrintButton
                  className="min-h-14 w-full justify-start gap-3 whitespace-normal border-border bg-background px-4 py-3 text-left text-sm leading-tight"
                  registerShiftId={cashierSession.register_shift_id}
                  timeZone={timeZone}
                />
              ) : null}
              {lastClosedShift ? (
                <LastZReportPrintButton
                  className="min-h-14 w-full justify-start gap-3 whitespace-normal border-border bg-background px-4 py-3 text-left text-sm leading-tight"
                  registerShiftId={lastClosedShift.id}
                  timeZone={timeZone}
                />
              ) : (
                <div
                  aria-label="Z-отчёт пока недоступен"
                  className="flex min-h-18 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/35 px-2 py-3 text-center text-xs leading-tight text-muted-foreground"
                >
                  <ReceiptText aria-hidden="true" className="size-5" />
                  Z-отчёт после закрытия
                </div>
              )}
            </div>
            {canEndSession ? (
              <div className="mt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Завершение работы и сверка наличных
                </p>
                <SessionEndAction
                  cashierSession={cashierSession}
                  onSessionEndedLocally={onSessionEndedLocally}
                  onSessionEnded={onSessionEnded}
                />
              </div>
            ) : null}
          </section>
          {sale?.discount_percentage && canOverridePrice ? (
            <Button
              className="min-h-12 border-border text-sm"
              disabled={isBusy}
              onClick={() => {
                setOperationsOpen(false);
                resetDiscount();
              }}
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" className="size-4" /> Сбросить
              скидку
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>

      {cashMovementType && hasPermission('cash_movement.create') ? (
        <CashMovementsDialog
          session={cashierSession}
          initialType={cashMovementType}
          onClose={() => {
            setCashMovementType(null);
            refocus();
          }}
        />
      ) : null}
      {canSearch && priceCheckOpen ? (
        <CheckoutPriceCheckDialog
          canAdd={canAddProduct && !isBusy}
          onClose={() => {
            setPriceCheckOpen(false);
            refocus();
          }}
          onAdd={(product, markingCode) =>
            command.mutateAsync({
              type: 'add',
              productId: product.id,
              ...(markingCode ? { markingCode } : {}),
            })
          }
          organizationId={cashierSession.organization_id}
          storeId={cashierSession.store_id}
        />
      ) : null}

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
          fiscalizationEnabled={
            fiscalizationEnabled || fiscalizationPreviewEnabled
          }
          fiscalizationPolicy={fiscalizationPolicy}
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
        open={discountOpen}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
          showCloseButton={!command.isPending}
        >
          <DialogHeader>
            <DialogTitle>Скидка на весь чек</DialogTitle>
            <DialogDescription>
              Скидку рассчитает сервер для каждой позиции и итоговой суммы.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={submitDiscount}>
            {discountStep === 'value' ? (
              <>
                <FormField>
                  <Label htmlFor="sale-discount-percentage">Скидка, %</Label>
                  <Input
                    autoFocus
                    id="sale-discount-percentage"
                    inputMode="decimal"
                    maxLength={6}
                    onChange={(event) => {
                      setDiscountPercentage(event.target.value);
                      setDiscountError(null);
                    }}
                    value={discountPercentage}
                  />
                </FormField>
              </>
            ) : (
              <FormField>
                <Label htmlFor="sale-discount-reason">Причина скидки</Label>
                <textarea
                  aria-label="Причина скидки"
                  autoFocus
                  className="min-h-24 w-full resize-none rounded-lg border border-input bg-background p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                  id="sale-discount-reason"
                  maxLength={500}
                  onChange={(event) => {
                    setDiscountReason(event.target.value);
                    setDiscountError(null);
                  }}
                  placeholder="Коротко укажите причину скидки"
                  value={discountReason}
                />
                <div className="flex flex-wrap gap-2">
                  {discountReasonOptions.map((reason) => (
                    <Button
                      className="min-h-9 px-3 py-1.5 text-xs"
                      key={reason}
                      onClick={() => {
                        setDiscountReason(reason);
                        setDiscountError(null);
                      }}
                      type="button"
                      variant="ghost"
                    >
                      {reason}
                    </Button>
                  ))}
                </div>
                <span className="block text-right text-xs text-muted-foreground">
                  {discountReason.length}/500
                </span>
              </FormField>
            )}
            {discountError ? (
              <p className="text-sm font-medium text-destructive">
                {discountError}
              </p>
            ) : null}
            <DialogFooter>
              {discountStep === 'value' ? (
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
              ) : (
                <Button
                  className="min-h-12"
                  disabled={command.isPending}
                  onClick={() => {
                    setDiscountError(null);
                    setDiscountStep('value');
                  }}
                  type="button"
                  variant="ghost"
                >
                  Назад
                </Button>
              )}
              <Button
                className="min-h-12"
                disabled={command.isPending}
                type="submit"
              >
                {discountStep === 'value' ? 'Далее' : 'Применить скидку'}
              </Button>
            </DialogFooter>
          </form>
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
            {priceStep === 'value' ? (
              <>
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
              </>
            ) : (
              <FormField>
                <Label htmlFor="override-reason">Причина изменения цены</Label>
                <textarea
                  aria-label="Причина изменения цены"
                  autoFocus
                  className="min-h-24 w-full resize-none rounded-lg border border-input bg-background p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                  id="override-reason"
                  maxLength={500}
                  onChange={(event) => {
                    setPriceReason(event.target.value);
                    setPriceError(null);
                  }}
                  placeholder="Коротко укажите причину изменения цены"
                  value={priceReason}
                />
                <div className="flex flex-wrap gap-2">
                  {priceReasonOptions.map((reason) => (
                    <Button
                      className="min-h-9 px-3 py-1.5 text-xs"
                      key={reason}
                      onClick={() => {
                        setPriceReason(reason);
                        setPriceError(null);
                      }}
                      type="button"
                      variant="ghost"
                    >
                      {reason}
                    </Button>
                  ))}
                </div>
                <span className="block text-right text-xs text-muted-foreground">
                  {priceReason.length}/500
                </span>
              </FormField>
            )}
            {priceError ? (
              <p className="text-sm font-medium text-destructive">
                {priceError}
              </p>
            ) : null}
            <DialogFooter>
              {priceStep === 'value' ? (
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
              ) : (
                <Button
                  className="min-h-12"
                  disabled={command.isPending}
                  onClick={() => {
                    setPriceError(null);
                    setPriceStep('value');
                  }}
                  type="button"
                  variant="ghost"
                >
                  Назад
                </Button>
              )}
              <Button
                className="min-h-12"
                disabled={command.isPending}
                type="submit"
              >
                {priceStep === 'value' ? 'Далее' : 'Сохранить цену'}
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
              <span className="block text-right text-xs text-muted-foreground">
                {cancelReason.length}/500
              </span>
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
