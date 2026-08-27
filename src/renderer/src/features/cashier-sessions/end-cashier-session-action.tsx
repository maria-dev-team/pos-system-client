import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  CircleCheck,
  CircleStop,
  LoaderCircle,
  ReceiptText,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  type CashierSessionResponse,
  endCashierSession,
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
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import { formatCash } from '@renderer/common/helpers/format-cash';
import {
  getHttpErrorCode,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';

import { cashierSessionClosingSchema } from './cashier-session.schema';

type BlockingSale = {
  id: string;
  items_count: number;
  status: string;
  total: string;
};

const getBlockingSales = (error: unknown): BlockingSale[] => {
  if (!axios.isAxiosError(error) || !Array.isArray(error.response?.data?.sales))
    return [];
  return error.response.data.sales as BlockingSale[];
};

type EndCashierSessionActionProps = {
  cashierSession: CashierSessionResponse;
  onEnded: () => void;
  onEndedLocally?: () => void;
};

export function EndCashierSessionAction({
  cashierSession,
  onEnded,
  onEndedLocally,
}: EndCashierSessionActionProps) {
  const queryClient = useQueryClient();
  const reconciliationRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [actualCash, setActualCash] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [blockingSales, setBlockingSales] = useState<BlockingSale[]>([]);
  const [endedSession, setEndedSession] =
    useState<CashierSessionResponse | null>(null);
  const mutation = useMutation({
    mutationFn: (cash: string) =>
      endCashierSession(cashierSession.id, { actualCash: cash }),
    onError: (error) => {
      if (getHttpErrorCode(error) === ErrorCode.CashierSessionHasOpenSales) {
        setBlockingSales(getBlockingSales(error));
        return;
      }
      httpErrorHandler(error, 'Не удалось завершить работу.');
    },
    onSuccess: (session) => {
      onEndedLocally?.();
      queryClient.setQueryData(
        queryKeys.cashierSessions.current(cashierSession.register_id),
        session,
      );
      setEndedSession(session);
    },
  });

  useEffect(() => {
    if (endedSession) reconciliationRef.current?.focus();
  }, [endedSession]);

  const reset = () => {
    setActualCash('');
    setValidationError(null);
    setBlockingSales([]);
    setEndedSession(null);
    mutation.reset();
  };

  const changeOpen = (open: boolean) => {
    if (mutation.isPending || (!open && endedSession)) return;
    setIsOpen(open);
    if (!open) reset();
  };

  const changeActualCash = (value: string) => {
    setActualCash(value);
    if (validationError) setValidationError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = cashierSessionClosingSchema.safeParse({ actualCash });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Проверьте сумму');
      return;
    }

    setValidationError(null);
    setBlockingSales([]);
    mutation.mutate(parsed.data.actualCash);
  };

  const finish = () => {
    queryClient.setQueryData(
      queryKeys.cashierSessions.current(cashierSession.register_id),
      null,
    );
    setIsOpen(false);
    reset();
    onEnded();
  };

  return (
    <>
      <Button
        aria-label="Завершить работу на кассе"
        className="min-h-11 w-full border-border bg-background px-4 text-muted-foreground hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
        onClick={() => setIsOpen(true)}
        type="button"
        variant="ghost"
      >
        <CircleStop aria-hidden="true" />
        Завершить работу
      </Button>

      <Dialog onOpenChange={changeOpen} open={isOpen}>
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!mutation.isPending && !endedSession}
        >
          {endedSession ? (
            <div
              aria-label="Сверка смены кассира"
              className="space-y-5 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              ref={reconciliationRef}
              role="status"
              tabIndex={-1}
            >
              <DialogHeader>
                <span className="mb-2 grid size-12 place-items-center rounded-full bg-success-muted text-success">
                  <CircleCheck aria-hidden="true" className="size-7" />
                </span>
                <DialogTitle>Работа завершена</DialogTitle>
                <DialogDescription>
                  Касса остаётся открытой для следующего сотрудника. Проверьте
                  итог.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ['Ожидалось', endedSession.expected_cash],
                  ['Фактически', endedSession.actual_cash],
                  ['Расхождение', endedSession.difference],
                ].map(([label, value]) => (
                  <div className="rounded-xl bg-muted p-4" key={label}>
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p
                      className={`mt-2 text-lg font-bold tabular-nums ${
                        label === 'Расхождение' && value !== '0.00'
                          ? 'text-destructive'
                          : 'text-foreground'
                      }`}
                    >
                      {formatCash(value ?? null)}
                    </p>
                  </div>
                ))}
              </div>

              <Button className="min-h-13 w-full text-base" onClick={finish}>
                К выбору кассы
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Завершить работу на кассе</DialogTitle>
                <DialogDescription>
                  Пересчитайте свои наличные. Касса останется открытой для
                  следующего сотрудника.
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-5" onSubmit={submit}>
                <FormField>
                  <Label htmlFor="cashier-actual-cash">
                    Наличные у кассира, ₸
                  </Label>
                  <Input
                    aria-describedby={
                      validationError ? 'cashier-actual-cash-error' : undefined
                    }
                    aria-invalid={Boolean(validationError)}
                    autoFocus
                    className="h-14 text-lg tabular-nums md:text-lg"
                    disabled={mutation.isPending}
                    id="cashier-actual-cash"
                    inputMode="decimal"
                    onChange={(event) => changeActualCash(event.target.value)}
                    placeholder="0.00"
                    value={actualCash}
                  />
                  {validationError ? (
                    <p
                      className="text-sm font-medium text-destructive"
                      id="cashier-actual-cash-error"
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

                {blockingSales.length > 0 ? (
                  <section
                    aria-live="polite"
                    className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                  >
                    <h3 className="font-semibold text-destructive">
                      Сначала завершите открытые продажи
                    </h3>
                    <div className="mt-3 space-y-2">
                      {blockingSales.map((sale) => (
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card p-3 text-sm"
                          key={sale.id}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <ReceiptText
                              aria-hidden="true"
                              className="size-4"
                            />
                            {sale.id} · {sale.status}
                          </span>
                          <span className="text-muted-foreground">
                            {sale.items_count} позиции ·{' '}
                            {formatCash(sale.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

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
                    Завершить работу
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
