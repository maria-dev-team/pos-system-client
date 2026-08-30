import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Keyboard,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';

import type {
  AuthContextResponse,
  CashierSessionResponse,
} from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
import { Button } from '@renderer/common/components/ui/button';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Label } from '@renderer/common/components/ui/label';
import { VirtualKeyboardOverlay } from '@renderer/common/components/virtual-keyboard';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import {
  ReceiptPrintButton,
  ReceiptPrinterSettingsButton,
} from '@renderer/features/receipt-printing';

import { PriceOverrideDialogs } from './components/price-override-dialogs';
import {
  ReceiptReturnPanel,
  WithoutReceiptReturnPanel,
} from './components/return-mode-panels';
import { ReturnPaymentDialog } from './components/return-payment-dialog';
import { useReturnsFlow } from './hooks/use-returns-flow';

type ReturnsViewProps = {
  backLabel?: string;
  cashierSession: CashierSessionResponse;
  context: AuthContextResponse;
  focusedFlow?: boolean;
  initialMode?: 'receipt' | 'withoutReceipt';
  initialReceiptNumber?: string;
  onBack: () => void;
};

export function ReturnsView({
  backLabel = 'Вернуться к продажам',
  cashierSession,
  context,
  focusedFlow = false,
  initialMode,
  initialReceiptNumber,
  onBack,
}: ReturnsViewProps) {
  const {
    access,
    completedReturn,
    lineCount,
    mode,
    onModeChange,
    onReset,
    overrideDialogs,
    paymentDialog,
    paymentKey,
    receiptPanel,
    recovery,
    returnForm,
    withoutReceiptPanel,
  } = useReturnsFlow(
    cashierSession,
    context,
    initialReceiptNumber,
    initialMode,
    focusedFlow,
  );

  if (!access.canReceipt && !access.canWithoutReceipt) {
    return (
      <FullPageState
        description="Для работы нужен доступ к созданию возврата и хотя бы одному режиму."
        onRetry={onBack}
        retryLabel={backLabel}
        title="Нет доступа к возвратам"
      />
    );
  }

  if (recovery.pendingCommand && !recovery.isSubmitting) {
    return (
      <main className="grid min-h-full place-items-center bg-workspace px-6 py-10">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
          <AlertTriangle
            aria-hidden="true"
            className="mx-auto mb-4 size-8 text-amber-600"
          />
          <h1 className="text-xl font-bold">
            {recovery.isConflict
              ? 'Возврат требует проверки'
              : 'Незавершённый возврат'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Редактирование заблокировано. Повтор будет отправлен с тем же UUID и
            данными.
          </p>
          {recovery.error ? (
            <p className="mt-3 text-sm font-medium text-destructive">
              {getHttpErrorMessage(recovery.error)}
            </p>
          ) : null}
          <Button
            className="mt-6"
            disabled={recovery.isPending || recovery.isConflict}
            onClick={() => void recovery.onRetry()}
            type="button"
          >
            {recovery.isPending ? (
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
        <section className="w-full max-w-2xl rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto mb-4 size-10 text-emerald-600"
          />
          <h1 className="text-2xl font-bold">Возврат успешно завершён</h1>
          <p className="mt-3 text-3xl font-extrabold text-primary">
            {formatCash(completedReturn.total)}
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <ReceiptPrintButton
              cashierSession={cashierSession}
              className="min-h-12 w-full whitespace-normal px-3 text-center leading-tight"
              context={context}
              sale={completedReturn}
            />
            <Button
              className="min-h-12 w-full whitespace-normal px-3 text-center leading-tight"
              onClick={onReset}
              type="button"
              variant="ghost"
            >
              Новый возврат
            </Button>
            <Button
              className="min-h-12 w-full whitespace-normal px-3 text-center leading-tight"
              onClick={onBack}
              type="button"
            >
              {backLabel}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-workspace p-4 sm:p-5">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <header className="flex shrink-0 flex-col gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-surface)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label={backLabel}
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight">
                Возвраты
              </h1>
              <p className="break-words text-sm text-muted-foreground">
                Касса работает, текущая корзина продаж сохранена
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ReceiptPrinterSettingsButton />
            {!focusedFlow ? (
              <div
                aria-label="Режим возврата"
                className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1"
                role="group"
              >
                <Button
                  aria-pressed={mode === 'receipt'}
                  disabled={!access.canReceipt}
                  onClick={() => onModeChange('receipt')}
                  type="button"
                  variant={mode === 'receipt' ? 'default' : 'ghost'}
                >
                  По чеку
                </Button>
                <Button
                  aria-pressed={mode === 'withoutReceipt'}
                  disabled={!access.canWithoutReceipt}
                  onClick={() => onModeChange('withoutReceipt')}
                  type="button"
                  variant={mode === 'withoutReceipt' ? 'default' : 'ghost'}
                >
                  Без чека
                </Button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section
            className={`min-h-0 min-w-0 rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-surface)] ${
              mode === 'receipt'
                ? 'flex flex-col overflow-hidden'
                : 'overflow-auto'
            }`}
          >
            {mode === 'receipt' ? (
              <ReceiptReturnPanel
                {...receiptPanel}
                cashierSession={cashierSession}
                context={context}
                focused={focusedFlow}
              />
            ) : (
              <WithoutReceiptReturnPanel {...withoutReceiptPanel} />
            )}
          </section>

          <aside className="h-fit min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-[var(--shadow-surface)]">
            <div className="border-b border-border pb-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">К возврату</h2>
                <span className="text-xs text-muted-foreground">
                  {lineCount ? `${lineCount} позиций` : 'Нет товаров'}
                </span>
              </div>
              <p className="mt-2 break-all text-3xl font-extrabold tabular-nums text-primary">
                {formatCash(returnForm.previewTotal)}
              </p>
            </div>
            <FormField className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="return-reason">Причина возврата</Label>
                <span className="text-xs text-muted-foreground">
                  {returnForm.reason.length}/500
                </span>
              </div>
              <textarea
                aria-label="Причина возврата"
                className="min-h-28 w-full resize-none rounded-lg border border-input bg-background p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                id="return-reason"
                maxLength={500}
                onChange={(event) =>
                  returnForm.onReasonChange(event.target.value)
                }
                placeholder="Например: товар не подошёл по размеру"
                value={returnForm.reason}
              />
              <Button
                className="w-full justify-start border-border bg-muted/45 px-4 hover:bg-muted/75"
                onClick={() =>
                  returnForm.onReasonKeyboardOpenChange(
                    !returnForm.showReasonKeyboard,
                  )
                }
                type="button"
                variant="ghost"
              >
                <Keyboard aria-hidden="true" />
                Экранная клавиатура
              </Button>
              <VirtualKeyboardOverlay
                compact
                maxLength={500}
                onOpenChange={returnForm.onReasonKeyboardOpenChange}
                onValueChange={returnForm.onReasonChange}
                open={returnForm.showReasonKeyboard}
                value={returnForm.reason}
              />
            </FormField>
            {returnForm.error ? (
              <p
                className="mt-3 text-sm font-medium text-destructive"
                role="alert"
              >
                {returnForm.error}
              </p>
            ) : null}
            <Button
              className="mt-4 min-h-14 w-full"
              disabled={!returnForm.isReady || returnForm.isSubmitPending}
              onClick={() => void returnForm.onOpenPayment()}
              type="button"
            >
              Оформить возврат
            </Button>
          </aside>
        </div>
      </div>

      <ReturnPaymentDialog key={paymentKey} {...paymentDialog} />

      <PriceOverrideDialogs {...overrideDialogs} />
    </main>
  );
}
