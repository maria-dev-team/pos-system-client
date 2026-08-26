import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Banknote,
  CircleAlert,
  CircleCheck,
  Clock3,
  LoaderCircle,
  MonitorSmartphone,
  Store,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { type RegisterResponse, openRegisterShift } from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
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
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';
import { authContextQueryOptions } from '@renderer/features/auth';

import { CloseRegisterShiftAction } from './close-register-shift-action';
import {
  activeRegistersQueryOptions,
  currentRegisterShiftQueryOptions,
} from './register-shift-query-options';
import { registerShiftOpeningSchema } from './register-shift.schema';

const openedAtFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const cashFormatter = new Intl.NumberFormat('ru-RU', {
  currency: 'KZT',
  maximumFractionDigits: 2,
  style: 'currency',
});

export function RegisterShiftSelectionView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const context = useQuery(authContextQueryOptions());
  const registers = useQuery(
    activeRegistersQueryOptions(context.data?.storeId),
  );
  const shiftQueries = useQueries({
    queries: (registers.data ?? []).map(({ id }) =>
      currentRegisterShiftQueryOptions(id),
    ),
  });
  const [selectedRegister, setSelectedRegister] =
    useState<RegisterResponse | null>(null);
  const [openingCash, setOpeningCash] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const openingMutation = useMutation({
    mutationFn: openRegisterShift,
    onError: async (error, { registerId }) => {
      if (getHttpErrorCode(error) === ErrorCode.RegisterShiftAlreadyOpen) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.registerShifts.current(registerId),
        });
      }
      httpErrorHandler(error, 'Не удалось открыть кассовую смену.');
    },
    onSuccess: async (registerShift) => {
      queryClient.setQueryData(
        queryKeys.registerShifts.current(registerShift.register_id),
        registerShift,
      );
      await navigate({
        search: {
          registerId: registerShift.register_id,
          registerShiftId: registerShift.id,
        },
        to: '/cashier-session',
      });
    },
  });

  const closeDialog = () => {
    if (openingMutation.isPending) return;
    setSelectedRegister(null);
    setOpeningCash('');
    setValidationError(null);
    openingMutation.reset();
  };

  const openDialog = (register: RegisterResponse) => {
    setSelectedRegister(register);
    setOpeningCash('');
    setValidationError(null);
  };

  const changeOpeningCash = (value: string) => {
    setOpeningCash(value);
    if (validationError) setValidationError(null);
  };

  const submitOpening = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRegister) return;

    const parsed = registerShiftOpeningSchema.safeParse({ openingCash });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Проверьте сумму');
      return;
    }

    setValidationError(null);
    openingMutation.mutate({
      ...parsed.data,
      registerId: selectedRegister.id,
    });
  };

  if (context.isPending || registers.isPending) {
    return <FullPageState isLoading title="Загружаем кассовые смены" />;
  }
  if (context.isError) {
    return (
      <FullPageState
        description={getHttpErrorMessage(
          context.error,
          'Не удалось загрузить рабочий контекст.',
        )}
        onRetry={() => void context.refetch()}
        title="Не удалось загрузить рабочий контекст"
      />
    );
  }
  if (registers.isError) {
    return (
      <FullPageState
        description={getHttpErrorMessage(
          registers.error,
          'Не удалось загрузить активные кассы.',
        )}
        onRetry={() => void registers.refetch()}
        title="Не удалось загрузить активные кассы"
      />
    );
  }

  const store = context.data.storeScope.stores.find(
    ({ id }) => id === context.data.storeId,
  );
  const canOpenShift =
    context.data.isSystemPosition ||
    context.data.permissions.includes('register_shift.open');

  return (
    <main className="min-h-full bg-workspace px-4 py-5 sm:px-6 sm:py-7">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-surface)] sm:p-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Store aria-hidden="true" className="size-4" />
              {store?.name ?? 'Текущий магазин'}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-card-foreground sm:text-3xl">
              Выберите кассовую смену
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Выберите открытую смену или откройте новую на нужной кассе
            </p>
          </div>
          <Button
            className="min-h-12 px-4"
            onClick={() =>
              void navigate({ replace: true, to: '/select-store' })
            }
            type="button"
            variant="ghost"
          >
            <Store aria-hidden="true" />
            Сменить магазин
          </Button>
        </header>

        {registers.data.length === 0 ? (
          <section className="grid min-h-56 place-items-center rounded-2xl border border-border bg-card p-8 text-center shadow-[var(--shadow-surface)]">
            <div>
              <MonitorSmartphone
                aria-hidden="true"
                className="mx-auto size-9 text-muted-foreground"
              />
              <h2 className="mt-4 text-xl font-bold text-card-foreground">
                Нет активных касс
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Обратитесь к администратору магазина
              </p>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {registers.data.map((register, index) => {
              const shiftQuery = shiftQueries[index];
              const registerShift = shiftQuery?.data;
              const canCloseShift =
                Boolean(registerShift) &&
                (context.data.isSystemPosition ||
                  context.data.permissions.includes(
                    'register_shift.close_others',
                  ) ||
                  (context.data.permissions.includes('register_shift.close') &&
                    registerShift?.opened_by_membership_id ===
                      context.data.userOrganizationId));

              return (
                <article
                  className="flex min-h-[240px] flex-col rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-surface)] sm:p-6"
                  key={register.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                      <MonitorSmartphone
                        aria-hidden="true"
                        className="size-6"
                      />
                    </span>
                    {shiftQuery?.isPending ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-sm font-semibold text-muted-foreground">
                        <LoaderCircle
                          aria-hidden="true"
                          className="size-4 animate-spin"
                        />
                        Проверяем
                      </span>
                    ) : registerShift ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-success-muted px-3 py-1.5 text-sm font-semibold text-success">
                        <CircleCheck aria-hidden="true" className="size-4" />
                        Смена открыта
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 rounded-full bg-warning-muted px-3 py-1.5 text-sm font-semibold text-warning">
                        <Clock3 aria-hidden="true" className="size-4" />
                        Смена не открыта
                      </span>
                    )}
                  </div>

                  <h2 className="mt-4 text-xl font-bold text-card-foreground">
                    {register.name}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-muted-foreground">
                    {register.code}
                  </p>

                  <div className="mt-4 flex-1 text-sm text-muted-foreground">
                    {shiftQuery?.isError ? (
                      <div className="flex items-start gap-2 text-destructive">
                        <CircleAlert
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0"
                        />
                        Не удалось проверить текущую смену
                      </div>
                    ) : registerShift ? (
                      <div className="space-y-1.5">
                        <p>
                          Открыта{' '}
                          {openedAtFormatter.format(
                            new Date(registerShift.opened_at),
                          )}
                        </p>
                        <p className="flex items-center gap-2 font-semibold text-foreground">
                          <Banknote aria-hidden="true" className="size-4" />
                          На начало:{' '}
                          {cashFormatter.format(
                            Number(registerShift.opening_cash),
                          )}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {shiftQuery?.isError ? (
                    <Button
                      className="mt-5 min-h-13 w-full"
                      onClick={() => void shiftQuery.refetch()}
                      type="button"
                      variant="ghost"
                    >
                      Повторить
                    </Button>
                  ) : registerShift ? (
                    <div className="mt-5 grid gap-2">
                      <Button
                        aria-label={`Выбрать смену кассы ${register.name}`}
                        className="min-h-13 w-full text-base"
                        onClick={() =>
                          void navigate({
                            search: {
                              registerId: register.id,
                              registerShiftId: registerShift.id,
                            },
                            to: '/cashier-session',
                          })
                        }
                        type="button"
                      >
                        Выбрать смену
                      </Button>
                      {canCloseShift ? (
                        <CloseRegisterShiftAction
                          registerShiftId={registerShift.id}
                        />
                      ) : null}
                    </div>
                  ) : canOpenShift ? (
                    <Button
                      aria-label={`Открыть смену кассы ${register.name}`}
                      className="mt-5 min-h-13 w-full text-base"
                      disabled={shiftQuery?.isPending}
                      onClick={() => openDialog(register)}
                      type="button"
                    >
                      Открыть смену
                    </Button>
                  ) : (
                    <p className="mt-5 min-h-13 rounded-lg bg-muted px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                      Нет права открывать смену
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        open={Boolean(selectedRegister)}
      >
        <DialogContent
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl"
          showCloseButton={!openingMutation.isPending}
        >
          <DialogHeader>
            <DialogTitle>Открыть кассовую смену</DialogTitle>
            <DialogDescription>
              {selectedRegister?.name} · {selectedRegister?.code}. Укажите
              фактическую сумму наличных в кассе перед началом работы.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" onSubmit={submitOpening}>
            <div className="space-y-2.5">
              <Label htmlFor="opening-cash">
                Наличные в кассе на начало, ₸
              </Label>
              <Input
                aria-describedby={
                  validationError ? 'opening-cash-error' : undefined
                }
                aria-invalid={Boolean(validationError)}
                autoFocus
                className="h-14 text-lg tabular-nums md:text-lg"
                disabled={openingMutation.isPending}
                id="opening-cash"
                inputMode="decimal"
                onChange={(event) => changeOpeningCash(event.target.value)}
                placeholder="0.00"
                value={openingCash}
              />
              {validationError ? (
                <p
                  className="text-sm font-medium text-destructive"
                  id="opening-cash-error"
                >
                  {validationError}
                </p>
              ) : null}
            </div>

            <NumericKeypad
              disabled={openingMutation.isPending}
              onValueChange={changeOpeningCash}
              value={openingCash}
            />

            <DialogFooter>
              <DialogClose asChild>
                <Button
                  className="min-h-13 text-base"
                  disabled={openingMutation.isPending}
                  type="button"
                  variant="ghost"
                >
                  Отмена
                </Button>
              </DialogClose>
              <Button
                className="min-h-13 text-base"
                disabled={openingMutation.isPending}
                type="submit"
              >
                {openingMutation.isPending ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : null}
                Открыть и выбрать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
