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
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';

import { registerShiftClosingSchema } from './register-shift.schema';

type CloseRegisterShiftActionProps = {
  onClosed?: (registerShift: RegisterShiftResponse) => void;
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
    onError: (error) => httpErrorHandler(error, 'Не удалось закрыть кассу.'),
    onSuccess: (registerShift) => {
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
    queryClient.setQueryData(
      queryKeys.registerShifts.current(result.register_id),
      null,
    );
    setIsOpen(false);
    reset();
    onClosed?.(result);
  };

  return (
    <>
      <Button
        aria-label="Закрыть кассу"
        className="min-h-11 w-full border-border bg-background px-4 text-muted-foreground hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
        onClick={() => setIsOpen(true)}
        type="button"
        variant="ghost"
      >
        <CircleStop aria-hidden="true" />
        Закрыть кассу
      </Button>

      <Dialog onOpenChange={changeOpen} open={isOpen}>
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
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
                <DialogTitle>Касса закрыта</DialogTitle>
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

              <Button className="min-h-13 w-full text-base" onClick={finish}>
                К списку касс
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Закрыть кассу</DialogTitle>
                <DialogDescription>
                  Пересчитайте наличные. После закрытия кассы сумму нельзя
                  изменить.
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-5" onSubmit={submit}>
                <FormField>
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
                </FormField>

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
                    Закрыть кассу
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
