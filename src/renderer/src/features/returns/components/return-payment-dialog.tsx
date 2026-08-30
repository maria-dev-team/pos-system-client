import Decimal from 'decimal.js';
import { Banknote, CreditCard, LoaderCircle, Split } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import type { ReturnPaymentPayload } from '@renderer/common/api';
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
import { formatCash } from '@renderer/common/helpers/format-cash';
import { cn } from '@renderer/common/lib/utils';

import {
  type ReturnPaymentMode,
  buildReturnPayments,
} from '../returns-calculations';

type ReturnPaymentDialogProps = {
  onConfirm: (
    payments: ReturnPaymentPayload[],
    buyerBinIin?: string,
  ) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  originalPayments?: ReturnPaymentPayload[];
  pending: boolean;
  serverErrorMessage?: string;
  total: string;
};

const modes = [
  {
    description: 'Выдать всю сумму из кассы',
    icon: Banknote,
    label: 'Наличные',
    value: 'CASH',
  },
  {
    description: 'Вернуть всю сумму на карту',
    icon: CreditCard,
    label: 'Безналичные',
    value: 'CASHLESS',
  },
  {
    description: 'Разделить сумму возврата',
    icon: Split,
    label: 'Смешанный',
    value: 'MIXED',
  },
] as const;

const paymentLabel = (method: ReturnPaymentPayload['method']) =>
  method === 'CASH' ? 'Наличные' : 'Безналичные';

const getCashlessAmount = (total: string, cashAmount: string) => {
  try {
    const cash = new Decimal(cashAmount || 0);
    const result = new Decimal(total).minus(cash);
    return result.isNegative() ? '0.00' : result.toFixed(2);
  } catch {
    return total;
  }
};

export function ReturnPaymentDialog({
  onConfirm,
  onOpenChange,
  open,
  originalPayments,
  pending,
  serverErrorMessage,
  total,
}: ReturnPaymentDialogProps) {
  const [mode, setMode] = useState<ReturnPaymentMode | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [buyerBinIin, setBuyerBinIin] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const errorMessage = validationError ?? serverErrorMessage;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mode || pending) return;
    try {
      const payments = buildReturnPayments(total, mode, cashAmount);
      const normalizedBuyerBinIin = buyerBinIin.trim();
      if (normalizedBuyerBinIin && !/^\d{12}$/u.test(normalizedBuyerBinIin)) {
        setValidationError('БИН/ИИН покупателя должен содержать 12 цифр.');
        return;
      }
      setValidationError(null);
      void (normalizedBuyerBinIin
        ? onConfirm(payments, normalizedBuyerBinIin)
        : onConfirm(payments));
    } catch {
      setValidationError(
        'Наличная часть должна быть больше нуля и меньше итога.',
      );
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_1fr] overflow-y-auto p-0 sm:min-h-[430px] sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-6 pr-20 text-left">
          <DialogTitle className="text-xl">Способ возврата</DialogTitle>
          <DialogDescription className="mt-1">
            Выберите, как вернуть покупателю {formatCash(total)}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-5 px-6 pb-6 pt-1"
          onSubmit={submit}
        >
          {originalPayments?.length ? (
            <div className="rounded-xl border border-border bg-muted/35 p-4 text-sm">
              <span className="sr-only">
                В исходном чеке:{' '}
                {originalPayments
                  .map(
                    ({ amount, method }) =>
                      `${paymentLabel(method)} — ${formatCash(amount)}`,
                  )
                  .join(', ')}
              </span>
              <p className="font-semibold text-foreground">
                Оплата в исходном чеке
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {originalPayments.map(({ amount, method }) => (
                  <span
                    className="rounded-lg border border-border bg-background px-3 py-2 text-muted-foreground"
                    key={`${method}-${amount}`}
                  >
                    {paymentLabel(method)}
                    <span aria-hidden="true" className="mx-2 text-border">
                      ·
                    </span>
                    <span className="font-semibold text-foreground">
                      {formatCash(amount)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div
            aria-label="Способ выплаты"
            className="grid grid-cols-3 gap-3"
            role="group"
          >
            {modes.map((option) => {
              const Icon = option.icon;
              const selected = mode === option.value;
              return (
                <button
                  aria-label={option.label}
                  aria-pressed={selected}
                  className={cn(
                    'min-h-24 rounded-xl border px-4 py-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-50',
                    selected
                      ? 'border-primary bg-primary/8 text-foreground'
                      : 'border-border bg-background hover:border-primary/35 hover:bg-muted/55',
                  )}
                  disabled={pending}
                  key={option.value}
                  onClick={() => {
                    setMode(option.value);
                    setValidationError(null);
                  }}
                  type="button"
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'size-5',
                        selected ? 'text-primary' : 'text-muted-foreground',
                      )}
                    />
                    {option.label}
                  </span>
                  <span className="mt-2 block text-sm leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          {mode === 'MIXED' ? (
            <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-[minmax(0,1fr)_minmax(250px,1.15fr)]">
              <FormField>
                <Label htmlFor="return-cash-amount">Наличная часть, ₸</Label>
                <Input
                  aria-invalid={Boolean(validationError)}
                  className="h-14 text-lg font-semibold"
                  id="return-cash-amount"
                  inputMode="decimal"
                  onChange={(event) => {
                    setCashAmount(event.target.value);
                    setValidationError(null);
                  }}
                  placeholder="0,00"
                  value={cashAmount}
                />
                <div className="rounded-lg bg-muted/55 px-3 py-2 text-sm text-muted-foreground">
                  Безналичными:{' '}
                  <span className="font-semibold text-foreground">
                    {formatCash(getCashlessAmount(total, cashAmount))}
                  </span>
                </div>
              </FormField>
              <NumericKeypad
                disabled={pending}
                onValueChange={(value) => {
                  setCashAmount(value);
                  setValidationError(null);
                }}
                value={cashAmount}
              />
            </div>
          ) : null}

          <FormField>
            <Label htmlFor="return-buyer-bin-iin">
              БИН/ИИН покупателя — по запросу
            </Label>
            <Input
              disabled={pending}
              id="return-buyer-bin-iin"
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

          <div aria-live="polite" className="min-h-6">
            {errorMessage ? (
              <p className="text-sm font-medium text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mt-auto border-t border-border pt-5">
            <Button className="w-64" disabled={!mode || pending} type="submit">
              <LoaderCircle
                aria-hidden="true"
                className={cn(
                  'size-5',
                  pending ? 'animate-spin opacity-100' : 'opacity-0',
                )}
              />
              Подтвердить возврат
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
