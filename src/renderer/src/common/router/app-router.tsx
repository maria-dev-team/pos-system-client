/* eslint-disable react-refresh/only-export-components */
import { type QueryClient, useQuery } from '@tanstack/react-query';
import {
  Outlet,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { FullPageState } from '@renderer/common/components/full-page-state';
import { getHttpErrorMessage } from '@renderer/common/helpers/http-error.helper';
import {
  LoginView,
  OrganizationSelectionView,
  StoreSelectionView,
  authContextQueryOptions,
  useAuthStore,
} from '@renderer/features/auth';
import {
  CashierSessionView,
  currentCashierSessionQueryOptions,
} from '@renderer/features/cashier-sessions';
import { CheckoutView } from '@renderer/features/checkout';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import {
  RegisterShiftSelectionView,
  currentRegisterShiftQueryOptions,
} from '@renderer/features/register-shifts';
import { StatusBar } from '@renderer/features/status-bar';
import { currentUserQueryOptions } from '@renderer/features/user';

type RouterContext = {
  queryClient: QueryClient;
};

function SessionRedirect(): null {
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const accessToken = useAuthStore((state) => state.accessToken);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  useEffect(() => {
    if (isInitialized && !accessToken && pathname !== '/login') {
      void navigate({ replace: true, to: '/login' });
    }
  }, [accessToken, isInitialized, navigate, pathname]);

  return null;
}

function RootLayout() {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <StatusBar />
      <div className="min-h-0 flex-1 overflow-auto">
        <SessionRedirect />
        <Outlet />
      </div>
    </div>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const indexRoute = createRoute({
  beforeLoad: async ({ context: { queryClient } }) => {
    await useAuthStore.getState().initialize();
    if (!useAuthStore.getState().accessToken) throw redirect({ to: '/login' });

    const [context] = await Promise.all([
      queryClient.ensureQueryData(authContextQueryOptions()),
      queryClient.ensureQueryData(currentUserQueryOptions()),
      queryClient.ensureQueryData(organizationsQueryOptions()),
    ]);

    if (!context.userOrganizationId)
      throw redirect({ to: '/select-organization' });
    if (!context.storeId) throw redirect({ to: '/select-store' });
    throw redirect({ to: '/select-register-shift' });
  },
  component: () => <FullPageState isLoading title="Восстанавливаем сессию" />,
  getParentRoute: () => rootRoute,
  path: '/',
});

const loginRoute = createRoute({
  beforeLoad: async () => {
    await useAuthStore.getState().initialize();
    if (useAuthStore.getState().accessToken) throw redirect({ to: '/' });
  },
  component: LoginView,
  getParentRoute: () => rootRoute,
  path: 'login',
});

const authenticatedRoute = createRoute({
  beforeLoad: async () => {
    await useAuthStore.getState().initialize();
    if (!useAuthStore.getState().accessToken) throw redirect({ to: '/login' });
  },
  component: Outlet,
  getParentRoute: () => rootRoute,
  id: '_authenticated',
});

const organizationRoute = createRoute({
  component: OrganizationSelectionView,
  getParentRoute: () => authenticatedRoute,
  path: 'select-organization',
});

const storeRoute = createRoute({
  beforeLoad: async ({ context: { queryClient } }) => {
    const context = await queryClient.ensureQueryData(
      authContextQueryOptions(),
    );
    if (!context.userOrganizationId)
      throw redirect({ to: '/select-organization' });
  },
  component: StoreSelectionView,
  getParentRoute: () => authenticatedRoute,
  path: 'select-store',
});

const registerShiftRoute = createRoute({
  beforeLoad: async ({ context: { queryClient } }) => {
    const context = await queryClient.ensureQueryData(
      authContextQueryOptions(),
    );
    if (!context.userOrganizationId)
      throw redirect({ to: '/select-organization' });
    if (!context.storeId) throw redirect({ to: '/select-store' });
  },
  component: RegisterShiftSelectionView,
  getParentRoute: () => authenticatedRoute,
  path: 'select-register-shift',
});

function CashierSessionRouteComponent() {
  const { registerId, registerShiftId } = cashierSessionRoute.useSearch();
  return registerId && registerShiftId ? (
    <CashierSessionView
      registerId={registerId}
      registerShiftId={registerShiftId}
    />
  ) : null;
}

const cashierSessionRoute = createRoute({
  beforeLoad: async ({ context: { queryClient }, search }) => {
    const context = await queryClient.ensureQueryData(
      authContextQueryOptions(),
    );
    if (!context.userOrganizationId)
      throw redirect({ to: '/select-organization' });
    if (!context.storeId) throw redirect({ to: '/select-store' });
    if (!search.registerId || !search.registerShiftId)
      throw redirect({ to: '/select-register-shift' });

    const registerShift = await queryClient.ensureQueryData(
      currentRegisterShiftQueryOptions(search.registerId),
    );
    if (
      !registerShift ||
      registerShift.id !== search.registerShiftId ||
      registerShift.status !== 'OPEN'
    ) {
      throw redirect({ to: '/select-register-shift' });
    }
  },
  component: CashierSessionRouteComponent,
  getParentRoute: () => authenticatedRoute,
  path: 'cashier-session',
  validateSearch: (search: Record<string, unknown>) => ({
    registerId:
      typeof search.registerId === 'string' && search.registerId
        ? search.registerId
        : undefined,
    registerShiftId:
      typeof search.registerShiftId === 'string' && search.registerShiftId
        ? search.registerShiftId
        : undefined,
  }),
});

function CheckoutRouteComponent() {
  const navigate = useNavigate();
  const { registerId, registerShiftId } = checkoutRoute.useSearch();
  const cashierSession = useQuery(
    currentCashierSessionQueryOptions(registerId ?? ''),
  );
  const session = cashierSession.data;
  const [locallyEndedSession, setLocallyEndedSession] =
    useState<typeof session>();
  const retainedSession =
    session?.status === 'ENDED' && locallyEndedSession?.id === session.id
      ? locallyEndedSession
      : session;
  const isCheckoutSession = Boolean(
    retainedSession &&
    ['ACTIVE', 'LOCKED'].includes(retainedSession.status) &&
    retainedSession.register_id === registerId &&
    retainedSession.register_shift_id === registerShiftId,
  );

  useEffect(() => {
    if (
      !registerId ||
      !registerShiftId ||
      cashierSession.isPending ||
      cashierSession.isError ||
      isCheckoutSession
    ) {
      return;
    }

    void navigate({
      replace: true,
      search: { registerId, registerShiftId },
      to: '/cashier-session',
    });
  }, [
    cashierSession.isError,
    cashierSession.isPending,
    isCheckoutSession,
    navigate,
    registerId,
    registerShiftId,
  ]);

  if (cashierSession.isPending) {
    return <FullPageState isLoading title="Проверяем доступ к кассе" />;
  }
  if (cashierSession.isError) {
    return (
      <FullPageState
        description={getHttpErrorMessage(
          cashierSession.error,
          'Не удалось проверить доступ к кассе.',
        )}
        onRetry={() => void cashierSession.refetch()}
        title="Не удалось проверить доступ к кассе"
      />
    );
  }
  if (!retainedSession || !isCheckoutSession) {
    return <FullPageState isLoading title="Проверяем доступ к кассе" />;
  }

  return (
    <CheckoutView
      cashierSession={retainedSession}
      onRetrySession={() => void cashierSession.refetch()}
      onSessionEndedLocally={() => setLocallyEndedSession(session)}
      onSessionEnded={() =>
        void navigate({ replace: true, to: '/select-register-shift' })
      }
    />
  );
}

const checkoutRoute = createRoute({
  beforeLoad: async ({ context: { queryClient }, search }) => {
    const context = await queryClient.ensureQueryData(
      authContextQueryOptions(),
    );
    if (!context.userOrganizationId)
      throw redirect({ to: '/select-organization' });
    if (!context.storeId) throw redirect({ to: '/select-store' });
    if (!search.registerId || !search.registerShiftId)
      throw redirect({ to: '/select-register-shift' });

    const registerShift = await queryClient.ensureQueryData(
      currentRegisterShiftQueryOptions(search.registerId),
    );
    if (
      !registerShift ||
      registerShift.id !== search.registerShiftId ||
      registerShift.status !== 'OPEN'
    ) {
      throw redirect({ to: '/select-register-shift' });
    }

    const cashierSession = await queryClient.ensureQueryData(
      currentCashierSessionQueryOptions(search.registerId),
    );
    if (
      !cashierSession ||
      !['ACTIVE', 'LOCKED'].includes(cashierSession.status) ||
      cashierSession.register_id !== search.registerId ||
      cashierSession.register_shift_id !== search.registerShiftId
    ) {
      throw redirect({
        search: {
          registerId: search.registerId,
          registerShiftId: search.registerShiftId,
        },
        to: '/cashier-session',
      });
    }
  },
  component: CheckoutRouteComponent,
  getParentRoute: () => authenticatedRoute,
  path: 'checkout',
  validateSearch: (search: Record<string, unknown>) => ({
    registerId:
      typeof search.registerId === 'string' && search.registerId
        ? search.registerId
        : undefined,
    registerShiftId:
      typeof search.registerShiftId === 'string' && search.registerShiftId
        ? search.registerShiftId
        : undefined,
  }),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  authenticatedRoute.addChildren([
    organizationRoute,
    storeRoute,
    registerShiftRoute,
    cashierSessionRoute,
    checkoutRoute,
  ]),
]);

export const createAppRouter = (queryClient: QueryClient) =>
  createRouter({
    context: { queryClient },
    defaultPendingComponent: () => (
      <FullPageState isLoading title="Загружаем данные" />
    ),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree,
  });

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
