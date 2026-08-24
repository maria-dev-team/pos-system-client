import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleStop, LoaderCircle } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  type RegisterShiftResponse,
  closeRegisterShift,
} from '@renderer/common/api';
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
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { queryKeys } from '@renderer/common/constants';
import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';

import { registerShiftClosingSchema } from './register-shift.schema';

const integerFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});

const formatCash = (value: string | null) => {
  if (value === null) return '—';
  const [integer = '0', fraction = ''] = value.split('.');
  return `${integerFormatter
    .format(BigInt(integer))
    .replaceAll('\u00a0', ' ')},${fraction.padEnd(2, '0')} ₸`;
};

type CloseRegisterShiftActionProps = {
  onClosed: (registerShift: RegisterShiftResponse) => void;
  registerShiftId: string;
};

export function CloseRegisterShiftAction({
  onClosed,
  registerShiftId,
}: CloseRegisterShiftActionProps) {
  const queryClient = useQueryClient();
  const reconciliationRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actualCash, setActualCash] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [closedShift, setClosedShift] = useState<RegisterShiftResponse | null>(
    null,
  );
  const mutation = useMutation({
    mutationFn: (cash: string) =>
      closeRegisterShift(registerShiftId, { actualCash: cash }),
    onError: (error) =>
      httpErrorHandler(error, 'Не удалось закрыть кассовую смену.'),
    onSuccess: (registerShift) => {
      queryClient.setQueryData(
        queryKeys.registerShifts.current(registerShift.register_id),
        null,
      );
      setClosedShift(registerShift);
    },
  });

  useEffect(() => {
    if (closedShift) reconciliationRef.current?.focus();
  }, [closedShift]);

  const reset = () => {
    setActualCash('');
    setValidationError(null);
    setClosedShift(null);
    mutation.reset();
  };

  const changeOpen = (open: boolean) => {
    if (mutation.isPending || (!open && closedShift)) return;
    setIsOpen(open);
    if (open) return;
    reset();
  };

  const changeActualCash = (value: string) => {
    setActualCash(value);
    if (validationError) setValidationError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = registerShiftClosingSchema.safeParse({ actualCash });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Проверьте сумму');
      return;
    }

    setValidationError(null);
    mutation.mutate(parsed.data.actualCash);
  };

  const finish = () => {
    if (!closedShift) return;
    const result = closedShift;
    setIsOpen(false);
    reset();
    onClosed(result);
  };

  return (
    <>
      <Button
        aria-label="Закрыть кассовую смену"
        className="min-h-12 bg-destructive px-4 text-white hover:bg-destructive/90"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <CircleStop aria-hidden="true" />
        Закрыть смену
      </Button>

      <Dialog onOpenChange={changeOpen} open={isOpen}>
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
          showCloseButton={!mutation.isPending && !closedShift}
        >
          {closedShift ? (
            <div
              aria-label="Результат сверки"
              className="space-y-5 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              ref={reconciliationRef}
              role="status"
              tabIndex={-1}
            >
              <DialogHeader>
                <span className="mb-2 grid size-12 place-items-center rounded-full bg-success-muted text-success">
                  <CircleCheck aria-hidden="true" className="size-7" />
                </span>
                <DialogTitle>Смена закрыта</DialogTitle>
                <DialogDescription>
                  Сверка сохранена на сервере. Проверьте итог перед выходом.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-sm text-muted-foreground">Ожидалось</p>
                  <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
                    {formatCash(closedShift.expected_cash)}
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-sm text-muted-foreground">Фактически</p>
                  <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
                    {formatCash(closedShift.actual_cash)}
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-4">
                  <p className="text-sm text-muted-foreground">Расхождение</p>
                  <p
                    className={`mt-2 text-lg font-bold tabular-nums ${
                      closedShift.difference === '0.00'
                        ? 'text-success'
                        : 'text-destructive'
                    }`}
                  >
                    {formatCash(closedShift.difference)}
                  </p>
                </div>
              </div>

              <Button className="min-h-13 text-base" onClick={finish}>
                К списку смен
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Закрыть кассовую смену</DialogTitle>
                <DialogDescription>
                  Пересчитайте наличные в кассе. После закрытия сумму нельзя
                  изменить.
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-5" onSubmit={submit}>
                <div className="space-y-2.5">
                  <Label htmlFor="actual-cash">Фактические наличные, ₸</Label>
                  <Input
                    aria-describedby={
                      validationError ? 'actual-cash-error' : undefined
                    }
                    aria-invalid={Boolean(validationError)}
                    autoFocus
                    className="h-14 text-lg tabular-nums md:text-lg"
                    disabled={mutation.isPending}
                    id="actual-cash"
                    inputMode="decimal"
                    onChange={(event) => changeActualCash(event.target.value)}
                    placeholder="0.00"
                    value={actualCash}
                  />
                  {validationError ? (
                    <p
                      className="text-sm font-medium text-destructive"
                      id="actual-cash-error"
                    >
                      {validationError}
                    </p>
                  ) : null}
                </div>

                <NumericKeypad
                  disabled={mutation.isPending}
                  onValueChange={changeActualCash}
                  value={actualCash}
                />

                <DialogFooter>
                  <DialogClose asChild>
                    <Button
                      className="min-h-13 text-base"
                      disabled={mutation.isPending}
                      type="button"
                      variant="ghost"
                    >
                      Отмена
                    </Button>
                  </DialogClose>
                  <Button
                    className="min-h-13 bg-destructive text-base text-white hover:bg-destructive/90"
                    disabled={mutation.isPending}
                    type="submit"
                  >
                    {mutation.isPending ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : null}
                    Закрыть смену
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
