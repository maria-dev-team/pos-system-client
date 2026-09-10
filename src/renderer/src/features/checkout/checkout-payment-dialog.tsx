import { Banknote, CreditCard, LoaderCircle, Split } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';

import type {
  FiscalizationMode,
  FiscalizationPolicy,
  SalePaymentPayload,
  SaleResponse,
} from '@renderer/common/api';
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
import { formatCash } from '@renderer/common/helpers/format-cash';

import {
  createCashPayment,
  createCashlessPayment,
  createMixedPayments,
  getCashChange,
} from './checkout-payment';

type PaymentMode = 'CASH' | 'CASHLESS' | 'MIXED';

type CheckoutPaymentDialogProps = {
  fiscalizationEnabled?: boolean;
  fiscalizationPolicy?: FiscalizationPolicy;
  onConfirm: (
    payments: SalePaymentPayload[],
    buyerBinIin?: string,
    fiscalizationMode?: FiscalizationMode,
  ) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending: boolean;
  sale: SaleResponse;
  serverErrorMessage?: string;
};

const modes = [
  { icon: Banknote, label: 'Наличные', value: 'CASH' },
  { icon: CreditCard, label: 'Безналичные', value: 'CASHLESS' },
  { icon: Split, label: 'Смешанная', value: 'MIXED' },
] as const;

function PaymentForm({
  fiscalizationEnabled = true,
  fiscalizationPolicy = 'ALWAYS',
  onConfirm,
  onOpenChange,
  pending,
  sale,
  serverErrorMessage,
}: Omit<CheckoutPaymentDialogProps, 'open'>) {
  const [mode, setMode] = useState<PaymentMode>('CASH');
  const [cashAmount, setCashAmount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [buyerBinIin, setBuyerBinIin] = useState('');
  const [fiscalize, setFiscalize] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [dismissedServerError, setDismissedServerError] = useState<
    string | null
  >(null);
  const confirmingRef = useRef(false);

  const edit = (setter: (value: string) => void, value: string) => {
    setter(value);
    setValidationError(null);
    setDismissedServerError(serverErrorMessage ?? null);
  };

  const changeMode = (nextMode: PaymentMode) => {
    setMode(nextMode);
    setValidationError(null);
    setDismissedServerError(serverErrorMessage ?? null);
  };

  const payments =
    mode === 'CASH'
      ? createCashPayment(sale.total, cashReceived)
      : mode === 'CASHLESS'
        ? createCashlessPayment(sale.total)
        : createMixedPayments(sale.total, cashAmount, cashReceived);
  const change =
    mode === 'CASH'
      ? getCashChange(cashReceived, sale.total)
      : mode === 'MIXED'
        ? getCashChange(cashReceived, cashAmount)
        : null;
  const cashlessRemainder =
    mode === 'MIXED'
      ? (payments?.find((payment) => payment.method === 'CASHLESS')?.amount ??
        null)
      : null;
  const visibleServerError =
    serverErrorMessage && serverErrorMessage !== dismissedServerError
      ? serverErrorMessage
      : null;
  const fiscalizationMode: FiscalizationMode = !fiscalizationEnabled
    ? 'NON_FISCAL'
    : fiscalizationPolicy === 'SELECTIVE'
      ? fiscalize
        ? 'FISCAL'
        : 'NON_FISCAL'
      : fiscalizationPolicy === 'CASHLESS_ONLY' && mode !== 'CASHLESS'
        ? 'NON_FISCAL'
        : 'FISCAL';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || confirmingRef.current) return;
    if (!payments) {
      setValidationError(
        mode === 'CASH'
          ? 'Полученной суммы недостаточно или сумма указана неверно.'
          : mode === 'MIXED'
            ? 'Наличная часть должна быть больше нуля и меньше итога, а полученная сумма — не меньше наличной части.'
            : 'Сумма продажи недоступна для оплаты.',
      );
      return;
    }
    const normalizedBuyerBinIin = buyerBinIin.trim();
    if (normalizedBuyerBinIin && !/^\d{12}$/u.test(normalizedBuyerBinIin)) {
      setValidationError('БИН/ИИН покупателя должен содержать 12 цифр.');
      return;
    }

    setValidationError(null);
    setDismissedServerError(null);
    confirmingRef.current = true;
    try {
      void Promise.resolve(
        fiscalizationMode === 'NON_FISCAL'
          ? onConfirm(payments, undefined, fiscalizationMode)
          : normalizedBuyerBinIin
            ? onConfirm(payments, normalizedBuyerBinIin)
            : onConfirm(payments),
      )
        .catch(() => undefined)
        .finally(() => {
          confirmingRef.current = false;
        });
    } catch {
      confirmingRef.current = false;
    }
  };

  return (
    <DialogContent
      className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
      showCloseButton={!pending}
    >
      <DialogHeader>
        <DialogTitle>Оплата чека</DialogTitle>
        <DialogDescription>
          Итог с сервера является окончательной суммой оплаты.
        </DialogDescription>
      </DialogHeader>

      <div>
        <div
          aria-label="Сумма на сервере"
          className="rounded-2xl border border-primary/15 bg-primary/5 p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            К оплате
          </p>
          <p className="mt-2 text-3xl font-extrabold tracking-[-0.04em] tabular-nums text-primary">
            {formatCash(sale.total)}
          </p>
        </div>
      </div>

      <form className="space-y-5" onSubmit={submit}>
        <div
          aria-label="Способ оплаты"
          className="grid grid-cols-3 gap-3"
          role="group"
        >
          {modes.map((option) => {
            const Icon = option.icon;
            return (
              <Button
                aria-pressed={mode === option.value}
                className={
                  mode === option.value
                    ? 'min-h-14 px-2'
                    : 'min-h-14 border-border bg-background px-2'
                }
                disabled={pending}
                key={option.value}
                onClick={() => changeMode(option.value)}
                type="button"
                variant={mode === option.value ? 'default' : 'ghost'}
              >
                <Icon aria-hidden="true" className="size-5" />
                {option.label}
              </Button>
            );
          })}
        </div>

        {fiscalizationEnabled && fiscalizationPolicy === 'SELECTIVE' ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-4 px-1">
              <p className="text-sm font-semibold">Тип чека</p>
              <p className="text-xs text-muted-foreground">
                Для текущей продажи
              </p>
            </div>
            <div
              aria-label="Тип чека"
              className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1"
              role="radiogroup"
            >
              <button
                aria-checked={fiscalize}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 ${fiscalize ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}
                disabled={pending}
                onClick={() => setFiscalize(true)}
                role="radio"
                type="button"
              >
                С фискализацией
              </button>
              <button
                aria-checked={!fiscalize}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 ${!fiscalize ? 'bg-background text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}
                disabled={pending}
                onClick={() => setFiscalize(false)}
                role="radio"
                type="button"
              >
                Без фискализации
              </button>
            </div>
          </div>
        ) : null}

        {fiscalizationEnabled && fiscalizationPolicy === 'CASHLESS_ONLY' ? (
          <p className="text-sm text-muted-foreground">
            {mode === 'CASHLESS'
              ? 'Безналичная оплата будет фискализирована.'
              : 'Для этого способа оплаты чек будет нефискальным.'}
          </p>
        ) : null}

        {!fiscalizationEnabled ? (
          <p className="text-sm text-muted-foreground">
            Фискализация для этой кассы не подключена.
          </p>
        ) : null}

        {mode === 'CASH' ? (
          <FormField>
            <Label htmlFor="checkout-cash-received">
              Получено наличными, ₸
            </Label>
            <Input
              aria-invalid={Boolean(validationError)}
              autoFocus
              className="h-14 text-lg tabular-nums md:text-lg"
              disabled={pending}
              id="checkout-cash-received"
              inputMode="decimal"
              onChange={(event) => edit(setCashReceived, event.target.value)}
              placeholder="0.00"
              value={cashReceived}
            />
            <Button
              className="min-h-11 border-border bg-background"
              disabled={pending}
              onClick={() => edit(setCashReceived, sale.total)}
              type="button"
              variant="ghost"
            >
              Без сдачи · {formatCash(sale.total)}
            </Button>
          </FormField>
        ) : null}

        {mode === 'MIXED' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField>
              <Label htmlFor="checkout-mixed-cash">Наличная часть, ₸</Label>
              <Input
                aria-invalid={Boolean(validationError)}
                autoFocus
                className="h-14 text-lg tabular-nums md:text-lg"
                disabled={pending}
                id="checkout-mixed-cash"
                inputMode="decimal"
                onChange={(event) => edit(setCashAmount, event.target.value)}
                placeholder="0.00"
                value={cashAmount}
              />
            </FormField>
            <FormField>
              <Label htmlFor="checkout-mixed-received">
                Получено наличными, ₸
              </Label>
              <Input
                aria-invalid={Boolean(validationError)}
                className="h-14 text-lg tabular-nums md:text-lg"
                disabled={pending}
                id="checkout-mixed-received"
                inputMode="decimal"
                onChange={(event) => edit(setCashReceived, event.target.value)}
                placeholder="0.00"
                value={cashReceived}
              />
            </FormField>
          </div>
        ) : null}

        {fiscalizationMode === 'FISCAL' ? (
          <FormField>
            <Label htmlFor="checkout-buyer-bin-iin">
              БИН/ИИН покупателя — по запросу
            </Label>
            <Input
              disabled={pending}
              id="checkout-buyer-bin-iin"
              inputMode="numeric"
              maxLength={12}
              onChange={(event) => {
                setBuyerBinIin(event.target.value.replace(/\D/gu, ''));
                setValidationError(null);
              }}
              placeholder="12 цифр"
              value={buyerBinIin}
            />
          </FormField>
        ) : null}

        {cashlessRemainder || change ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {cashlessRemainder ? (
              <div className="rounded-xl bg-muted p-4">
                <p className="text-sm text-muted-foreground">
                  Безналичная часть
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {formatCash(cashlessRemainder)}
                </p>
              </div>
            ) : null}
            {change ? (
              <div className="rounded-xl bg-muted p-4">
                <p className="text-sm text-muted-foreground">Сдача</p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {formatCash(change)}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {validationError || visibleServerError ? (
          <p
            aria-live="polite"
            className="text-sm font-medium text-destructive"
            role="alert"
          >
            {validationError ?? visibleServerError}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            className="min-h-12"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Отмена
          </Button>
          <Button
            className="min-h-13 px-6 text-base shadow-md shadow-primary/20"
            disabled={pending}
            type="submit"
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Подтвердить оплату
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export function CheckoutPaymentDialog({
  open,
  onOpenChange,
  pending,
  ...props
}: CheckoutPaymentDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
      open={open}
    >
      {open ? (
        <PaymentForm {...props} onOpenChange={onOpenChange} pending={pending} />
      ) : null}
    </Dialog>
  );
}
