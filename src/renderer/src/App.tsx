import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';

import { syncCameraContext } from '@renderer/common/camera/camera-context';
import type { AppRouter } from '@renderer/common/router';
import { AppUpdateProvider } from '@renderer/features/app-update/app-update-provider';
import { useAuthStore } from '@renderer/features/auth';

type AppProps = {
  router: AppRouter;
};

function App({ router }: AppProps) {
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    syncCameraContext(accessToken);
  }, [accessToken]);

  return (
    <AppUpdateProvider>
      <RouterProvider router={router} />
    </AppUpdateProvider>
  );
}

export default App;
