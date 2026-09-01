import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleStop, LoaderCircle } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  type FiscalShiftReportResponse,
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
import { ZReportPrintButton } from '@renderer/features/receipt-printing';

import { registerShiftClosingSchema } from './register-shift.schema';

type CloseRegisterShiftActionProps = {
  onClosed?: (registerShift: RegisterShiftResponse) => void;
  registerShift: RegisterShiftResponse;
  timeZone: string;
};

export function CloseRegisterShiftAction({
  onClosed,
  registerShift,
  timeZone,
}: CloseRegisterShiftActionProps) {
  const queryClient = useQueryClient();
  const reconciliationRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const recoveryCash =
    registerShift.status === 'CLOSING' ? (registerShift.actual_cash ?? '') : '';
  const [actualCash, setActualCash] = useState(recoveryCash);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [closedShift, setClosedShift] = useState<RegisterShiftResponse | null>(
    null,
  );
  const [zReport, setZReport] = useState<FiscalShiftReportResponse | null>();
  const mutation = useMutation({
    mutationFn: (cash: string) =>
      closeRegisterShift(registerShift.id, { actualCash: cash }),
    onError: async (error) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.registerShifts.current(registerShift.register_id),
      });
      httpErrorHandler(error, 'Не удалось закрыть кассу.');
    },
    onSuccess: ({ register_shift, z_report }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.registerShifts.history(registerShift.register_id),
      });
      setClosedShift(register_shift);
      setZReport(z_report);
    },
  });

  useEffect(() => {
    if (closedShift) reconciliationRef.current?.focus();
  }, [closedShift]);

  const reset = () => {
    setActualCash(recoveryCash);
    setValidationError(null);
    setClosedShift(null);
    setZReport(undefined);
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
        aria-label={
          registerShift.status === 'CLOSING'
            ? 'Завершить закрытие'
            : 'Закрыть кассу'
        }
        className="min-h-11 w-full border-border bg-background px-4 text-muted-foreground hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
        onClick={() => setIsOpen(true)}
        type="button"
        variant="ghost"
      >
        <CircleStop aria-hidden="true" />
        {registerShift.status === 'CLOSING'
          ? 'Завершить закрытие'
          : 'Закрыть кассу'}
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

              {zReport ? (
                <ZReportPrintButton report={zReport} timeZone={timeZone} />
              ) : (
                <p className="text-sm font-medium text-muted-foreground">
                  Печать Z-отчёта недоступна для этого провайдера.
                </p>
              )}

              <Button className="min-h-13 w-full text-base" onClick={finish}>
                К списку касс
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {registerShift.status === 'CLOSING'
                    ? 'Завершить закрытие'
                    : 'Закрыть кассу'}
                </DialogTitle>
                <DialogDescription>
                  {registerShift.status === 'CLOSING'
                    ? 'Сервер сохранил сумму. Повторите закрытие смены.'
                    : 'Пересчитайте наличные. Касса будет закрыта, ОФД сформирует Z-отчёт. После закрытия сумму нельзя изменить.'}
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-5" onSubmit={submit}>
                {registerShift.status === 'CLOSING' ? (
                  <div className="rounded-xl bg-muted p-4">
                    <p className="text-sm text-muted-foreground">
                      Сохранённые фактические наличные
                    </p>
                    <p className="mt-2 text-lg font-bold tabular-nums text-foreground">
                      {actualCash ? formatCash(actualCash) : 'Не указаны'}
                    </p>
                    {validationError ? (
                      <p className="mt-2 text-sm font-medium text-destructive">
                        {validationError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <FormField>
                      <Label htmlFor="actual-cash">
                        Фактические наличные, ₸
                      </Label>
                      <Input
                        aria-describedby={
                          validationError ? 'actual-cash-error' : undefined
                        }
                        aria-invalid={Boolean(validationError)}
                        autoFocus
                        className="h-14 text-lg tabular-nums md:text-lg"
                        data-keyboard-inline
                        disabled={mutation.isPending}
                        id="actual-cash"
                        inputMode="decimal"
                        onChange={(event) =>
                          changeActualCash(event.target.value)
                        }
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
                  </>
                )}

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
                    {registerShift.status === 'CLOSING'
                      ? 'Завершить закрытие'
                      : 'Закрыть смену'}
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
