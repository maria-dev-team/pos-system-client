import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Banknote, LoaderCircle, LogIn } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';

import { startCashierSession } from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
import { NumericKeypad } from '@renderer/common/components/numeric-keypad';
import { Button } from '@renderer/common/components/ui/button';
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { queryKeys } from '@renderer/common/constants';
import {
  getHttpErrorMessage,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';
import { authContextQueryOptions } from '@renderer/features/auth';

import { currentCashierSessionQueryOptions } from './cashier-session-query-options';
import { cashierSessionOpeningSchema } from './cashier-session.schema';

type CashierSessionViewProps = {
  registerId: string;
  registerShiftId: string;
};

export function CashierSessionView({
  registerId,
  registerShiftId,
}: CashierSessionViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const context = useQuery(authContextQueryOptions());
  const currentSession = useQuery(
    currentCashierSessionQueryOptions(registerId),
  );
  const [openingCash, setOpeningCash] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const startMutation = useMutation({
    mutationFn: (cash: string) =>
      startCashierSession(registerShiftId, { openingCash: cash }),
    onError: (error) => httpErrorHandler(error, 'Не удалось начать работу.'),
    onSuccess: async (cashierSession) => {
      queryClient.setQueryData(
        queryKeys.cashierSessions.current(registerId),
        cashierSession,
      );
      await navigate({
        replace: true,
        search: { registerId, registerShiftId },
        to: '/checkout',
      });
    },
  });

  useEffect(() => {
    const cashierSession = currentSession.data;
    if (!cashierSession) return;

    if (
      cashierSession.register_id !== registerId ||
      cashierSession.register_shift_id !== registerShiftId
    ) {
      void navigate({ replace: true, to: '/select-register-shift' });
      return;
    }

    if (
      cashierSession.status === 'ACTIVE' ||
      cashierSession.status === 'LOCKED'
    ) {
      void navigate({
        replace: true,
        search: { registerId, registerShiftId },
        to: '/checkout',
      });
    }
  }, [currentSession.data, navigate, registerId, registerShiftId]);

  const changeOpeningCash = (value: string) => {
    setOpeningCash(value);
    if (validationError) setValidationError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = cashierSessionOpeningSchema.safeParse({ openingCash });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Проверьте сумму');
      return;
    }

    setValidationError(null);
    startMutation.mutate(parsed.data.openingCash);
  };

  if (context.isPending || currentSession.isPending) {
    return <FullPageState isLoading title="Проверяем доступ к кассе" />;
  }
  if (context.isError || currentSession.isError) {
    const error = context.error ?? currentSession.error;
    return (
      <FullPageState
        description={getHttpErrorMessage(
          error,
          'Не удалось проверить доступ к кассе.',
        )}
        onRetry={() => {
          void Promise.all([context.refetch(), currentSession.refetch()]);
        }}
        title="Не удалось проверить доступ к кассе"
      />
    );
  }
  if (
    currentSession.data?.status === 'ACTIVE' ||
    currentSession.data?.status === 'LOCKED'
  ) {
    return <FullPageState isLoading title="Восстанавливаем работу" />;
  }

  const canStart =
    context.data.isSystemPosition ||
    context.data.permissions.includes('pos.login');

  if (!canStart) {
    return (
      <FullPageState
        description="Обратитесь к администратору магазина."
        onRetry={() =>
          void navigate({ replace: true, to: '/select-register-shift' })
        }
        retryLabel="К выбору кассы"
        title="Нет права работать на кассе"
      />
    );
  }

  return (
    <main className="grid min-h-full place-items-center bg-workspace p-4 sm:p-6">
      <section className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-surface)] sm:p-7">
        <header className="mb-5">
          <span className="grid size-12 place-items-center rounded-xl bg-secondary text-secondary-foreground">
            <LogIn aria-hidden="true" className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-[-0.035em] text-card-foreground sm:text-3xl">
            Начало работы
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Укажите личные наличные перед переходом к продажам
          </p>
        </header>

        <form className="space-y-5" onSubmit={submit}>
          <FormField>
            <Label htmlFor="cashier-opening-cash">Наличные у кассира, ₸</Label>
            <div className="relative">
              <Banknote
                aria-hidden="true"
                className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-describedby={
                  validationError ? 'cashier-opening-cash-error' : undefined
                }
                aria-invalid={Boolean(validationError)}
                autoFocus
                className="h-14 pl-12 text-lg tabular-nums md:text-lg"
                data-keyboard-inline
                disabled={startMutation.isPending}
                id="cashier-opening-cash"
                inputMode="decimal"
                onChange={(event) => changeOpeningCash(event.target.value)}
                placeholder="0.00"
                value={openingCash}
              />
            </div>
            {validationError ? (
              <p
                className="text-sm font-medium text-destructive"
                id="cashier-opening-cash-error"
              >
                {validationError}
              </p>
            ) : null}
          </FormField>

          <NumericKeypad
            disabled={startMutation.isPending}
            onValueChange={changeOpeningCash}
            value={openingCash}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              className="min-h-13 text-base"
              disabled={startMutation.isPending}
              onClick={() =>
                void navigate({
                  replace: true,
                  to: '/select-register-shift',
                })
              }
              type="button"
              variant="ghost"
            >
              Назад
            </Button>
            <Button
              className="min-h-13 text-base"
              disabled={startMutation.isPending}
              type="submit"
            >
              {startMutation.isPending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              Перейти к продажам
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
