import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { FullPageState } from '@renderer/common/components/full-page-state';
import { Button } from '@renderer/common/components/ui/button';
import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';
import { authContextQueryOptions } from '@renderer/features/auth';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import {
  CloseRegisterShiftAction,
  activeRegistersQueryOptions,
} from '@renderer/features/register-shifts';
import { currentUserQueryOptions } from '@renderer/features/user';

type DebugBlockProps = {
  title: string;
  value: unknown;
};

function DebugBlock({ title, value }: DebugBlockProps) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-card-foreground">
        {title}
      </h2>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

type AuthDebugViewProps = {
  registerShiftId: string;
};

export function AuthDebugView({ registerShiftId }: AuthDebugViewProps) {
  const navigate = useNavigate();
  const user = useQuery(currentUserQueryOptions());
  const organizations = useQuery(organizationsQueryOptions());
  const context = useQuery(authContextQueryOptions());
  const registers = useQuery(
    activeRegistersQueryOptions(context.data?.storeId),
  );

  useEffect(() => {
    if (registers.error) {
      httpErrorHandler(
        registers.error,
        'Не удалось загрузить доступные кассы.',
        'registers-error',
      );
    }
  }, [registers.error]);

  if (user.isLoading || organizations.isLoading || context.isLoading) {
    return <FullPageState isLoading title="Восстанавливаем рабочий контекст" />;
  }
  if (user.isError || organizations.isError || context.isError) {
    return (
      <FullPageState
        description="Проверьте соединение с сервером и повторите запрос."
        onRetry={() => {
          void Promise.all([
            user.refetch(),
            organizations.refetch(),
            context.refetch(),
          ]);
        }}
        title="Не удалось загрузить данные авторизации"
      />
    );
  }

  const membership = organizations.data?.find(
    ({ membership_id }) => membership_id === context.data?.userOrganizationId,
  );
  const store = context.data?.storeScope.stores.find(
    ({ id }) => id === context.data?.storeId,
  );
  const canCloseRegisterShift =
    context.data?.isSystemPosition ||
    context.data?.permissions.includes('register_shift.close') ||
    context.data?.permissions.includes('register_shift.close_others');

  return (
    <main className="min-h-full bg-workspace px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-surface)]">
          <div>
            <p className="text-sm font-medium text-primary">Developer view</p>
            <h1 className="mt-1 text-2xl font-bold text-card-foreground">
              Данные авторизации
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {membership?.organization?.name ?? 'Организация не найдена'} ·{' '}
              {store?.name ?? 'Магазин не найден'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCloseRegisterShift ? (
              <CloseRegisterShiftAction
                onClosed={() =>
                  void navigate({
                    replace: true,
                    to: '/select-register-shift',
                  })
                }
                registerShiftId={registerShiftId}
              />
            ) : null}
            <Button
              onClick={() =>
                void navigate({ replace: true, to: '/select-organization' })
              }
              type="button"
              variant="ghost"
            >
              Сменить организацию
            </Button>
            <Button
              onClick={() =>
                void navigate({ replace: true, to: '/select-store' })
              }
              type="button"
              variant="ghost"
            >
              Сменить магазин
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <DebugBlock title="Пользователь" value={user.data} />
          <DebugBlock
            title="Организация и магазин"
            value={{
              organization: membership?.organization ?? null,
              position: membership?.position ?? null,
              store,
            }}
          />
          <DebugBlock
            title="Доступы и store scope"
            value={{
              isSystemPosition: context.data?.isSystemPosition,
              permissions: context.data?.permissions ?? [],
              position: context.data?.position,
              storeScope: context.data?.storeScope,
            }}
          />
          <DebugBlock
            title="Активные кассы"
            value={
              registers.isError
                ? { error: 'Недостаточно прав или кассы недоступны' }
                : (registers.data ?? [])
            }
          />
          <DebugBlock
            title="Выбранная кассовая смена"
            value={{ registerShiftId }}
          />
        </div>
      </div>
    </main>
  );
}
