import { RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';

import { syncCameraContext } from '@renderer/common/camera/camera-context';
import type { AppRouter } from '@renderer/common/router';
import { useAuthStore } from '@renderer/features/auth';

type AppProps = {
  router: AppRouter;
};

function App({ router }: AppProps) {
  const accessToken = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    syncCameraContext(accessToken);
  }, [accessToken]);

  return <RouterProvider router={router} />;
}

export default App;
