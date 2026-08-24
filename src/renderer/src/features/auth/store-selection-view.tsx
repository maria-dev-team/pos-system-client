import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LoaderCircle, MapPin, Store } from 'lucide-react';

import { selectContext } from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
import { Button } from '@renderer/common/components/ui/button';
import { queryKeys } from '@renderer/common/constants';
import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';

import { AuthShell } from './components/auth-shell';
import { authContextQueryOptions } from './hooks/use-auth-context-query';
import { useAuthStore } from './stores/auth-store';

export function StoreSelectionView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const context = useQuery(authContextQueryOptions());
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const mutation = useMutation({
    mutationFn: (storeId: string) =>
      selectContext(context.data!.userOrganizationId!, storeId),
    onError: (error) => httpErrorHandler(error, 'Не удалось выбрать магазин.'),
    onSuccess: async (auth) => {
      setAccessToken(auth.access_token);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.context(),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.registers.all(),
      });
      await navigate({ replace: true, to: '/select-register-shift' });
    },
  });

  if (context.isLoading)
    return <FullPageState isLoading title="Загружаем магазины" />;
  if (context.isError) {
    return (
      <FullPageState
        description="Проверьте соединение с сервером и повторите запрос."
        onRetry={() => void context.refetch()}
        title="Не удалось загрузить магазины"
      />
    );
  }

  const stores = context.data?.storeScope.stores ?? [];

  return (
    <AuthShell
      description="Выберите магазин, в котором работает касса"
      title="Выберите магазин"
    >
      {stores.length > 0 ? (
        <div className="space-y-3">
          {stores.map((store) => (
            <button
              className="flex w-full items-center gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50"
              disabled={mutation.isPending}
              key={store.id}
              onClick={() => mutation.mutate(store.id)}
              type="button"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                {mutation.isPending && mutation.variables === store.id ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-5 animate-spin"
                  />
                ) : (
                  <Store aria-hidden="true" className="size-5" />
                )}
              </span>
              <span>
                <span className="block font-semibold text-card-foreground">
                  {store.name}
                </span>
                <span className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin aria-hidden="true" className="size-3.5" />
                  {store.address ?? 'Адрес не указан'}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-muted p-5 text-center text-sm text-muted-foreground">
          Нет доступных магазинов
        </p>
      )}

      <Button
        className="mt-6 w-full"
        onClick={() =>
          void navigate({ replace: true, to: '/select-organization' })
        }
        type="button"
        variant="ghost"
      >
        Выбрать другую организацию
      </Button>
    </AuthShell>
  );
}
