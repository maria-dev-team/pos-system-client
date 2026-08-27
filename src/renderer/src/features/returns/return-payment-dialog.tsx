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

import { type ReturnPaymentMode, buildReturnPayments } from './returns-input';

type ReturnPaymentDialogProps = {
  onConfirm: (payments: ReturnPaymentPayload[]) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  originalPayments?: ReturnPaymentPayload[];
  pending: boolean;
  serverErrorMessage?: string;
  total: string;
};

const modes = [
  { icon: Banknote, label: 'Наличные', value: 'CASH' },
  { icon: CreditCard, label: 'Безналичные', value: 'CASHLESS' },
  { icon: Split, label: 'Смешанный', value: 'MIXED' },
] as const;

const paymentLabel = (method: ReturnPaymentPayload['method']) =>
  method === 'CASH' ? 'Наличные' : 'Безналичные';

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
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mode || pending) return;
    try {
      const payments = buildReturnPayments(total, mode, cashAmount);
      setValidationError(null);
      void onConfirm(payments);
    } catch {
      setValidationError(
        'Наличная часть должна быть больше нуля и меньше итога.',
      );
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>Способ возврата</DialogTitle>
          <DialogDescription>
            Явно выберите, как выплатить {formatCash(total)}.
          </DialogDescription>
        </DialogHeader>

        {originalPayments?.length ? (
          <div className="rounded-xl border border-border bg-muted/45 p-3 text-sm text-muted-foreground">
            В исходном чеке:{' '}
            {originalPayments
              .map(
                ({ amount, method }) =>
                  `${paymentLabel(method)} — ${formatCash(amount)}`,
              )
              .join(', ')}
          </div>
        ) : null}

        <form className="space-y-5" onSubmit={submit}>
          <div
            aria-label="Способ выплаты"
            className="grid grid-cols-3 gap-3"
            role="group"
          >
            {modes.map((option) => {
              const Icon = option.icon;
              const selected = mode === option.value;
              return (
                <Button
                  aria-pressed={selected}
                  className={selected ? 'min-h-14 px-2' : 'min-h-14 px-2'}
                  disabled={pending}
                  key={option.value}
                  onClick={() => {
                    setMode(option.value);
                    setValidationError(null);
                  }}
                  type="button"
                  variant={selected ? 'default' : 'ghost'}
                >
                  <Icon aria-hidden="true" />
                  {option.label}
                </Button>
              );
            })}
          </div>

          {mode === 'MIXED' ? (
            <FormField>
              <Label htmlFor="return-cash-amount">Наличная часть, ₸</Label>
              <Input
                aria-invalid={Boolean(validationError)}
                id="return-cash-amount"
                inputMode="decimal"
                onChange={(event) => {
                  setCashAmount(event.target.value);
                  setValidationError(null);
                }}
                value={cashAmount}
              />
              <NumericKeypad
                disabled={pending}
                onValueChange={(value) => {
                  setCashAmount(value);
                  setValidationError(null);
                }}
                value={cashAmount}
              />
            </FormField>
          ) : null}

          {validationError ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {validationError}
            </p>
          ) : null}
          {serverErrorMessage ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {serverErrorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button disabled={!mode || pending} type="submit">
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              Подтвердить возврат
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
