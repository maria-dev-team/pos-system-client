import { useQuery } from '@tanstack/react-query';
import { Clock, LoaderCircle, LogOut, Wifi, WifiOff } from 'lucide-react';

import { getApiHealth } from '@renderer/common/api';
import { Button } from '@renderer/common/components/ui/button';
import {
  type StatusBarItem,
  statusBarConfig,
} from '@renderer/common/config/status-bar.config';
import { queryKeys } from '@renderer/common/constants';
import {
  authContextQueryOptions,
  useAuthSession,
  useLogout,
} from '@renderer/features/auth';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import { SupportAction } from '@renderer/features/support';
import { currentUserQueryOptions } from '@renderer/features/user';

import { useMinuteClock } from './use-minute-clock';

const visibleItems: readonly StatusBarItem[] = [
  ...statusBarConfig.leftItems,
  ...statusBarConfig.rightItems,
];
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
});
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

export function StatusBar() {
  const now = useMinuteClock();
  const { isAuthenticated } = useAuthSession();
  const logout = useLogout();
  const needsContext =
    visibleItems.includes('context') || visibleItems.includes('user');
  const health = useQuery({
    enabled: visibleItems.includes('serverStatus'),
    queryFn: getApiHealth,
    queryKey: queryKeys.health.api(),
    refetchInterval: statusBarConfig.healthCheckIntervalMs,
    retry: false,
  });
  const user = useQuery({
    ...currentUserQueryOptions(),
    enabled: isAuthenticated && visibleItems.includes('user'),
  });
  const context = useQuery({
    ...authContextQueryOptions(),
    enabled: isAuthenticated && needsContext,
  });
  const organizations = useQuery({
    ...organizationsQueryOptions(),
    enabled: isAuthenticated && needsContext,
  });
  const membership = organizations.data?.find(
    ({ membership_id }) => membership_id === context.data?.userOrganizationId,
  );
  const store = context.data?.storeScope.stores.find(
    ({ id }) => id === context.data?.storeId,
  );
  const fullName =
    [user.data?.first_name, user.data?.last_name].filter(Boolean).join(' ') ||
    user.data?.email ||
    'Пользователь';
  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const contextName =
    [membership?.organization?.name, store?.name].filter(Boolean).join(' · ') ||
    'Maria POS';

  const renderItem = (item: StatusBarItem) => {
    switch (item) {
      case 'context':
        return (
          <div className="flex min-w-0 items-center gap-3" key={item}>
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary font-extrabold text-primary-foreground shadow-sm shadow-primary/20"
            >
              M
            </span>
            <span className="truncate text-sm font-semibold text-foreground">
              {contextName}
            </span>
          </div>
        );
      case 'user':
        if (!isAuthenticated || !user.data) return null;
        return (
          <div className="flex min-w-0 items-center gap-2.5" key={item}>
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground"
            >
              {initials}
            </span>
            <span className="min-w-0 max-w-52 leading-tight">
              <span className="block truncate text-sm font-semibold text-foreground">
                {fullName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {context.data?.position ??
                  membership?.position?.name ??
                  'Сотрудник'}
              </span>
            </span>
          </div>
        );
      case 'serverStatus': {
        const label = health.isPending
          ? 'Проверка'
          : health.isError
            ? 'Нет связи с сервером'
            : 'Сервер доступен';

        return (
          <span
            aria-label={label}
            className={
              health.isError
                ? 'flex items-center gap-2 text-sm font-medium text-destructive'
                : health.isPending
                  ? 'flex items-center gap-2 text-sm font-medium text-muted-foreground'
                  : 'flex items-center gap-2 text-sm font-medium text-success'
            }
            key={item}
            role="status"
          >
            {health.isPending ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : health.isError ? (
              <WifiOff aria-hidden="true" className="size-4" />
            ) : (
              <Wifi aria-hidden="true" className="size-4" />
            )}
            <span className="hidden lg:inline">{label}</span>
          </span>
        );
      }
      case 'clock':
        return (
          <time
            aria-label="Текущее время"
            className="flex items-center gap-2 text-sm font-medium tabular-nums text-foreground"
            dateTime={now.toISOString()}
            key={item}
          >
            <Clock
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
            <span className="hidden md:inline">
              {dateFormatter.format(now)}
            </span>
            <span>{timeFormatter.format(now)}</span>
          </time>
        );
      case 'support':
        if (!isAuthenticated) return null;
        return <SupportAction key={item} />;
      case 'logout':
        if (!isAuthenticated) return null;
        return (
          <Button
            aria-label="Выйти"
            className="min-h-12 min-w-12 px-3"
            disabled={logout.isLoggingOut}
            key={item}
            onClick={() => void logout.logout()}
            type="button"
            variant="ghost"
          >
            {logout.isLoggingOut ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <LogOut aria-hidden="true" />
            )}
            <span className="sr-only">Выйти</span>
          </Button>
        );
    }
  };

  return (
    <header
      aria-label="Статус приложения"
      className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card px-4 sm:px-5"
    >
      <div className="flex min-w-0 items-center gap-4">
        {statusBarConfig.leftItems.map(renderItem)}
      </div>
      <div className="flex min-w-0 shrink items-center gap-3 sm:gap-4">
        {statusBarConfig.rightItems.map(renderItem)}
      </div>
    </header>
  );
}
