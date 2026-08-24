import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Building2, LoaderCircle } from 'lucide-react';

import { selectContext } from '@renderer/common/api';
import { FullPageState } from '@renderer/common/components/full-page-state';
import { queryKeys } from '@renderer/common/constants';
import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';
import { organizationsQueryOptions } from '@renderer/features/organizations';

import { AuthShell } from './components/auth-shell';
import { useAuthStore } from './stores/auth-store';

export function OrganizationSelectionView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organizations = useQuery(organizationsQueryOptions());
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const mutation = useMutation({
    mutationFn: (membershipId: string) => selectContext(membershipId),
    onError: (error) =>
      httpErrorHandler(error, 'Не удалось выбрать организацию.'),
    onSuccess: async (auth) => {
      setAccessToken(auth.access_token);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.auth.context(),
      });
      await navigate({ replace: true, to: '/select-store' });
    },
  });

  if (organizations.isLoading) {
    return <FullPageState isLoading title="Загружаем организации" />;
  }
  if (organizations.isError) {
    return (
      <FullPageState
        description="Проверьте соединение с сервером и повторите запрос."
        onRetry={() => void organizations.refetch()}
        title="Не удалось загрузить организации"
      />
    );
  }

  const memberships = (organizations.data ?? []).filter(
    (membership) => membership.organization !== null,
  );

  return (
    <AuthShell
      description="Выберите рабочую организацию для этой сессии"
      title="Выберите организацию"
    >
      {memberships.length > 0 ? (
        <div className="space-y-3">
          {memberships.map((membership) => (
            <button
              className="flex w-full items-center gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50"
              disabled={mutation.isPending}
              key={membership.membership_id}
              onClick={() => mutation.mutate(membership.membership_id)}
              type="button"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                {mutation.isPending &&
                mutation.variables === membership.membership_id ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-5 animate-spin"
                  />
                ) : (
                  <Building2 aria-hidden="true" className="size-5" />
                )}
              </span>
              <span>
                <span className="block font-semibold text-card-foreground">
                  {membership.organization!.name}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {membership.position?.name ?? 'Должность не назначена'}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-muted p-5 text-center text-sm text-muted-foreground">
          Нет доступных организаций
        </p>
      )}
    </AuthShell>
  );
}
