import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';

import {
  type AuthContextResponse,
  type CashierSessionResponse,
  type ProductResponse,
  type ReturnPaymentPayload,
  type SaleResponse,
  getProduct,
} from '@renderer/common/api';
import { ErrorCode } from '@renderer/common/constants';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
} from '@renderer/common/helpers/http-error.helper';
import { useProductSearchQuery } from '@renderer/features/products';

import {
  calculateReturnTotal,
  getReturnUnitPrice,
} from '../returns-calculations';
import {
  priceOverrideSchema,
  receiptNumberSchema,
  returnQuantitySchema,
  returnReasonSchema,
} from '../returns.schema';
import type { ReceiptSelection, WithoutReceiptLine } from '../returns.types';
import {
  productQueryOptions,
  receiptPageQueryOptions,
  receiptQueryOptions,
} from './returns-query-options';
import { useReturnSubmission } from './use-return-submission';

const pageSize = 20;

const permission = (context: AuthContextResponse, value: string) =>
  Boolean(context.isSystemPosition || context.permissions.includes(value));

export function useReturnsFlow(
  cashierSession: CashierSessionResponse,
  context: AuthContextResponse,
  initialReceiptNumber = '',
) {
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
  const [receiptNumber, setReceiptNumberState] = useState(initialReceiptNumber);
  const [receiptSearchError, setReceiptSearchError] = useState<string | null>(
    null,
  );
  const [selectedReceiptNumber, setSelectedReceiptNumber] =
    useState(initialReceiptNumber);
  const [receiptSelections, setReceiptSelections] = useState<
    Record<string, ReceiptSelection>
  >({});
  const [productSearch, setProductSearch] = useState('');
  const [withoutReceiptLines, setWithoutReceiptLines] = useState<
    WithoutReceiptLine[]
  >([]);
  const [preparedWithoutReceiptLines, setPreparedWithoutReceiptLines] =
    useState<WithoutReceiptLine[] | null>(null);
  const [reason, setReasonState] = useState('');
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
    receiptPageQueryOptions(
      pageSize,
      offset,
      mode === 'receipt' && canReceipt,
      cashierSession.organization_id,
      cashierSession.store_id,
    ),
  );
  const receiptDetail = useQuery(
    receiptQueryOptions(
      selectedReceiptNumber,
      mode === 'receipt' && canReceipt && Boolean(selectedReceiptNumber),
      cashierSession.organization_id,
      cashierSession.store_id,
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
  const submission = useReturnSubmission(
    cashierSession.id,
    cashierSession.organization_id,
    cashierSession.store_id,
  );

  const receiptLines = useMemo(() => {
    if (!receiptDetail.data) return [];
    return receiptDetail.data.items.flatMap((item) => {
      const selection = receiptSelections[item.id];
      return selection ? [{ item, ...selection }] : [];
    });
  }, [receiptDetail.data, receiptSelections]);

  const activeWithoutLines = preparedWithoutReceiptLines ?? withoutReceiptLines;
  const quantitiesValid =
    mode === 'receipt'
      ? receiptLines.every(
          ({ item, quantity }) =>
            returnQuantitySchema(
              item.unit_code,
              item.returnable_quantity,
            ).safeParse(quantity).success,
        )
      : withoutReceiptLines.every(
          ({ product, quantity }) =>
            returnQuantitySchema(product.unit).safeParse(quantity).success,
        );
  const linesHaveDisposition =
    mode === 'receipt'
      ? receiptLines.every((line) => line.returnDisposition)
      : withoutReceiptLines.every((line) => line.returnDisposition);
  const hasLines =
    mode === 'receipt'
      ? receiptLines.length > 0
      : withoutReceiptLines.length > 0;
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
                unitPrice: getReturnUnitPrice(line),
              })),
        )
      : '0.00';
  const formReady =
    hasLines &&
    quantitiesValid &&
    linesHaveDisposition &&
    returnReasonSchema.safeParse(reason).success &&
    previewTotal !== '0.00';
  const openReceipt = (value: string) => {
    setSelectedReceiptNumber(value);
    setReceiptNumberState(value);
    setReceiptSelections({});
    setFormError(null);
  };

  const toggleReceipt = (value: string) => {
    if (selectedReceiptNumber === value) {
      setSelectedReceiptNumber('');
      setReceiptSelections({});
      setFormError(null);
      return;
    }
    openReceipt(value);
  };

  const setReceiptNumber = (value: string) => {
    setReceiptNumberState(value);
    setReceiptSearchError(null);
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
    openReceipt(parsed.data);
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
    const catalogUnitPrice = product.retail_price;
    setWithoutReceiptLines((lines) => [
      ...lines,
      {
        catalogUnitPrice,
        product,
        quantity: '1',
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

  const removeWithoutLine = (productId: string) =>
    setWithoutReceiptLines((lines) =>
      lines.filter((line) => line.product.id !== productId),
    );

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
              unitPrice: getReturnUnitPrice(line),
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
    setReceiptNumberState('');
    setWithoutReceiptLines([]);
    setPreparedWithoutReceiptLines(null);
    setReasonState('');
    setFormError(null);
    setPaymentError(undefined);
  };

  const openOverride = (line: WithoutReceiptLine) => {
    setOverrideProductId(line.product.id);
    setOverrideStep('price');
    setOverridePrice(line.priceOverride?.unitPrice ?? '');
    setOverrideReason(line.priceOverride?.reason ?? '');
    setOverrideError(null);
  };

  const closeOverride = () => setOverrideProductId(undefined);

  const backToOverridePrice = () => {
    setOverrideError(null);
    setOverrideStep('price');
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

  const setReason = (value: string) => {
    setReasonState(value);
    setFormError(null);
  };
  const recoveryError = submission.retry.error ?? submission.submit.error;
  const isConflict =
    getHttpErrorCode(recoveryError) === ErrorCode.ReturnIdempotencyConflict;

  return {
    access: { canReceipt, canWithoutReceipt },
    completedReturn,
    lineCount:
      mode === 'receipt' ? receiptLines.length : withoutReceiptLines.length,
    mode,
    onModeChange: setMode,
    onReset: resetForm,
    overrideDialogs: {
      error: overrideError,
      line: overrideLine,
      onBack: backToOverridePrice,
      onClose: closeOverride,
      onContinue: continueOverride,
      onPriceChange: setOverridePrice,
      onReasonChange: setOverrideReason,
      onSave: saveOverride,
      price: overridePrice,
      reason: overrideReason,
      step: overrideStep,
    },
    paymentDialog: {
      onConfirm: confirmReturn,
      onOpenChange: (open: boolean) => {
        if (!submission.submit.isPending) setPaymentOpen(open);
      },
      open: paymentOpen,
      originalPayments:
        mode === 'receipt'
          ? receiptDetail.data?.payments.map(({ amount, method }) => ({
              amount,
              method,
            }))
          : undefined,
      pending: submission.submit.isPending,
      serverErrorMessage: paymentError,
      total: paymentTotal,
    },
    paymentKey,
    receiptPanel: {
      disabled: submission.submit.isPending,
      onNextPage: () => setPage((value) => value + 1),
      onPreviousPage: () => setPage((value) => value - 1),
      onReceiptNumberChange: setReceiptNumber,
      onSearch: searchReceipt,
      onSelectReceipt: toggleReceipt,
      onSelectionsChange: setReceiptSelections,
      page,
      receiptDetail,
      receiptNumber,
      receiptSearchError,
      receipts,
      selections: receiptSelections,
      selectedReceiptNumber,
    },
    recovery: {
      error: recoveryError,
      isConflict,
      isPending: submission.retry.isPending,
      isSubmitting: submission.submit.isPending,
      onRetry: () =>
        submission.retry
          .mutateAsync()
          .then(setCompletedReturn)
          .catch(() => undefined),
      pendingCommand: submission.pendingCommand,
    },
    returnForm: {
      error: formError,
      isReady: formReady,
      isSubmitPending: submission.submit.isPending,
      onOpenPayment: openPayment,
      onReasonChange: setReason,
      onReasonKeyboardOpenChange: setShowReasonKeyboard,
      previewTotal,
      reason,
      showReasonKeyboard,
    },
    withoutReceiptPanel: {
      canOverridePrice,
      lines: withoutReceiptLines,
      onAddProduct: addProduct,
      onOverride: openOverride,
      onProductSearchChange: setProductSearch,
      onRemove: removeWithoutLine,
      onUpdate: updateWithoutLine,
      productSearch,
      products,
    },
  };
}
