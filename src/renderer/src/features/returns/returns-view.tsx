import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  ReceiptText,
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

import { PriceOverrideDialogs } from './components/price-override-dialogs';
import {
  ReceiptReturnPanel,
  WithoutReceiptReturnPanel,
} from './components/return-mode-panels';
import { ReturnPaymentDialog } from './components/return-payment-dialog';
import { useReturnsFlow } from './hooks/use-returns-flow';

type ReturnsViewProps = {
  cashierSession: CashierSessionResponse;
  context: AuthContextResponse;
  onBackToSales: () => void;
};

export function ReturnsView({
  cashierSession,
  context,
  onBackToSales,
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
  } = useReturnsFlow(cashierSession, context);

  if (!access.canReceipt && !access.canWithoutReceipt) {
    return (
      <FullPageState
        description="Для работы нужен доступ к созданию возврата и хотя бы одному режиму."
        onRetry={onBackToSales}
        retryLabel="Вернуться к продажам"
        title="Нет доступа к возвратам"
      />
    );
  }

  if (recovery.pendingCommand) {
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
            <Button onClick={onReset} type="button" variant="ghost">
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
        </header>

        <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 space-y-5 rounded-2xl border border-border/80 bg-card p-5 shadow-[var(--shadow-surface)]">
            {mode === 'receipt' ? (
              <ReceiptReturnPanel {...receiptPanel} />
            ) : (
              <WithoutReceiptReturnPanel {...withoutReceiptPanel} />
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
                  {lineCount ? `${lineCount} позиций` : 'Выберите товары'}
                </p>
              </div>
            </div>
            <div className="mt-5 rounded-2xl border border-primary/15 bg-primary/[0.045] p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Предварительный итог
              </p>
              <p className="mt-2 text-3xl font-extrabold text-primary">
                {formatCash(returnForm.previewTotal)}
              </p>
            </div>
            <FormField className="mt-5">
              <Label htmlFor="return-reason">Причина возврата</Label>
              <textarea
                aria-label="Причина возврата"
                className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/25"
                id="return-reason"
                maxLength={500}
                onChange={(event) =>
                  returnForm.onReasonChange(event.target.value)
                }
                value={returnForm.reason}
              />
              <Button
                onClick={() =>
                  returnForm.onReasonKeyboardOpenChange(
                    !returnForm.showReasonKeyboard,
                  )
                }
                type="button"
                variant="ghost"
              >
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
              className="mt-5 min-h-14 w-full"
              disabled={!returnForm.isReady || returnForm.isSubmitPending}
              onClick={() => void returnForm.onOpenPayment()}
              type="button"
            >
              Выбрать способ выплаты
            </Button>
          </aside>
        </div>
      </div>

      <ReturnPaymentDialog key={paymentKey} {...paymentDialog} />

      <PriceOverrideDialogs {...overrideDialogs} />
    </main>
  );
}
