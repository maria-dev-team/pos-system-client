import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
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
import { syncCameraContext } from '@renderer/common/camera/camera-context';
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
import { FormField } from '@renderer/common/components/ui/form-field';
import { Input } from '@renderer/common/components/ui/input';
import { Label } from '@renderer/common/components/ui/label';
import { ErrorCode, queryKeys } from '@renderer/common/constants';
import {
  getHttpErrorCode,
  getHttpErrorMessage,
  httpErrorHandler,
} from '@renderer/common/helpers/http-error.helper';
import { authContextQueryOptions, useAuthStore } from '@renderer/features/auth';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import {
  LastZReportPrintButton,
  XReportPrintButton,
} from '@renderer/features/receipt-printing';

import { CloseRegisterShiftAction } from './close-register-shift-action';
import {
  activeRegistersQueryOptions,
  currentRegisterShiftQueryOptions,
  registerShiftHistoryQueryOptions,
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
  const canReadShift = Boolean(
    context.data?.isSystemPosition ||
    context.data?.permissions.includes('register_shift.read'),
  );
  const organizations = useQuery(organizationsQueryOptions());
  const registers = useQuery(
    activeRegistersQueryOptions(context.data?.storeId),
  );
  const shiftQueries = useQueries({
    queries: (registers.data ?? []).map(({ id }) =>
      currentRegisterShiftQueryOptions(id),
    ),
  });
  const shiftHistoryQueries = useQueries({
    queries: (registers.data ?? []).map(({ id }) =>
      registerShiftHistoryQueryOptions(id, canReadShift),
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
      httpErrorHandler(error, 'Не удалось открыть кассу.');
    },
    onSuccess: async (registerShift) => {
      const accessToken = useAuthStore.getState().accessToken;
      if (accessToken) {
        syncCameraContext(accessToken, registerShift.register_id);
      }
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
    return <FullPageState isLoading title="Загружаем кассы" />;
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
  const timeZone =
    organizations.data?.find(
      ({ organization }) => organization?.id === context.data.organizationId,
    )?.organization?.timezone ?? 'Asia/Almaty';

  return (
    <main className="min-h-full bg-workspace px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Store aria-hidden="true" className="size-4" />
              {store?.name ?? 'Текущий магазин'}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-[-0.04em] text-card-foreground sm:text-4xl">
              Выберите кассу
            </h1>
            <p className="mt-2 text-base text-muted-foreground">
              Выберите рабочее место, чтобы начать продажи
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="min-h-11 border-border bg-background px-4"
              onClick={() =>
                void navigate({ replace: true, to: '/select-store' })
              }
              type="button"
              variant="ghost"
            >
              <Store aria-hidden="true" />
              Сменить магазин
            </Button>
          </div>
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
          <div className="space-y-4">
            {registers.data.map((register, index) => {
              const shiftQuery = shiftQueries[index];
              const shiftHistoryQuery = shiftHistoryQueries[index];
              const registerShift = shiftQuery?.data;
              const lastClosedShift = shiftHistoryQuery?.data?.find(
                ({ status }) => status === 'CLOSED',
              );
              const lastZReportAction = lastClosedShift ? (
                <LastZReportPrintButton
                  className="h-auto min-h-11 w-full whitespace-normal border-border bg-background px-4 py-3 text-center leading-tight text-muted-foreground"
                  registerShiftId={lastClosedShift.id}
                  timeZone={timeZone}
                />
              ) : null;
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
                  className="grid gap-6 rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-surface)] transition-colors hover:border-primary/20 sm:p-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center"
                  key={register.id}
                >
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                      <MonitorSmartphone
                        aria-hidden="true"
                        className="size-7"
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-xl font-bold text-card-foreground">
                          {register.name}
                        </h2>
                        {shiftQuery?.isPending ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                            <LoaderCircle
                              aria-hidden="true"
                              className="size-3.5 animate-spin"
                            />
                            Проверяем
                          </span>
                        ) : registerShift?.status === 'CLOSING' ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-muted px-2.5 py-1 text-xs font-semibold text-warning">
                            <CircleAlert
                              aria-hidden="true"
                              className="size-3.5"
                            />
                            Закрытие не завершено
                          </span>
                        ) : registerShift ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-muted px-2.5 py-1 text-xs font-semibold text-success">
                            <CircleCheck
                              aria-hidden="true"
                              className="size-3.5"
                            />
                            Касса открыта
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-muted px-2.5 py-1 text-xs font-semibold text-warning">
                            <Clock3 aria-hidden="true" className="size-3.5" />
                            Касса закрыта
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-medium text-muted-foreground">
                        Код кассы: {register.code}
                      </p>

                      <div className="mt-4 text-sm text-muted-foreground">
                        {shiftQuery?.isError ? (
                          <div className="flex items-start gap-2 text-destructive">
                            <CircleAlert
                              aria-hidden="true"
                              className="mt-0.5 size-4 shrink-0"
                            />
                            Не удалось проверить состояние кассы
                          </div>
                        ) : registerShift ? (
                          <div className="flex flex-wrap gap-x-6 gap-y-2">
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
                        ) : (
                          <p>
                            Перед началом работы потребуется указать наличные
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {shiftQuery?.isError ? (
                    <Button
                      className="min-h-12 w-full border-border bg-background"
                      onClick={() => void shiftQuery.refetch()}
                      type="button"
                      variant="ghost"
                    >
                      Повторить
                    </Button>
                  ) : registerShift ? (
                    <div className="grid gap-3">
                      {registerShift.status === 'OPEN' ? (
                        <>
                          <Button
                            aria-label={`Начать работу на кассе ${register.name}`}
                            className="min-h-13 w-full justify-between px-5 text-base"
                            onClick={() => {
                              const accessToken =
                                useAuthStore.getState().accessToken;
                              if (accessToken) {
                                syncCameraContext(accessToken, register.id);
                              }
                              void navigate({
                                search: {
                                  registerId: register.id,
                                  registerShiftId: registerShift.id,
                                },
                                to: '/cashier-session',
                              });
                            }}
                            type="button"
                          >
                            Начать работу
                            <ArrowRight aria-hidden="true" />
                          </Button>
                          {canReadShift ? (
                            <XReportPrintButton
                              registerShiftId={registerShift.id}
                              timeZone={timeZone}
                            />
                          ) : null}
                        </>
                      ) : null}
                      {canCloseShift ? (
                        <CloseRegisterShiftAction
                          registerShift={registerShift}
                          timeZone={timeZone}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {canOpenShift ? (
                        <Button
                          aria-label={`Открыть кассу ${register.name}`}
                          className="min-h-13 w-full justify-between px-5 text-base"
                          disabled={shiftQuery?.isPending}
                          onClick={() => openDialog(register)}
                          type="button"
                        >
                          Открыть кассу
                          <ArrowRight aria-hidden="true" />
                        </Button>
                      ) : (
                        <p className="min-h-13 rounded-lg bg-muted px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                          Нет права открывать кассу
                        </p>
                      )}
                      {lastZReportAction}
                    </div>
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
          className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
          showCloseButton={!openingMutation.isPending}
        >
          <DialogHeader>
            <DialogTitle>Открыть кассу</DialogTitle>
            <DialogDescription>
              {selectedRegister?.name} · {selectedRegister?.code}. Пересчитайте
              наличные перед началом работы.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-5" onSubmit={submitOpening}>
            <FormField>
              <Label htmlFor="opening-cash">Наличные в кассе, ₸</Label>
              <Input
                aria-describedby={
                  validationError ? 'opening-cash-error' : undefined
                }
                aria-invalid={Boolean(validationError)}
                autoFocus
                className="h-14 text-lg tabular-nums md:text-lg"
                data-keyboard-inline
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
            </FormField>

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
                Открыть и начать
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
