import { RouterProvider } from '@tanstack/react-router';

import type { AppRouter } from '@renderer/common/router';
import { AppUpdateProvider } from '@renderer/features/app-update';

type AppProps = {
  router: AppRouter;
};

function App({ router }: AppProps) {
  return (
    <AppUpdateProvider>
      <RouterProvider router={router} />
    </AppUpdateProvider>
  );
}

export default App;
