/* eslint-disable react-refresh/only-export-components */
import type { QueryClient } from '@tanstack/react-query';
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
import { useEffect } from 'react';

import { FullPageState } from '@renderer/common/components/full-page-state';
import {
  LoginView,
  OrganizationSelectionView,
  StoreSelectionView,
  authContextQueryOptions,
  useAuthStore,
} from '@renderer/features/auth';
import { AuthDebugView } from '@renderer/features/development';
import { organizationsQueryOptions } from '@renderer/features/organizations';
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
    <>
      <SessionRedirect />
      <Outlet />
    </>
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
    throw redirect({ to: '/debug' });
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

const debugRoute = createRoute({
  beforeLoad: async ({ context: { queryClient } }) => {
    const context = await queryClient.ensureQueryData(
      authContextQueryOptions(),
    );
    if (!context.userOrganizationId)
      throw redirect({ to: '/select-organization' });
    if (!context.storeId) throw redirect({ to: '/select-store' });
  },
  component: AuthDebugView,
  getParentRoute: () => authenticatedRoute,
  path: 'debug',
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  authenticatedRoute.addChildren([organizationRoute, storeRoute, debugRoute]),
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
