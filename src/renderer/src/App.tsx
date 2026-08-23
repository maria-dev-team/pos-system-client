import { RouterProvider } from '@tanstack/react-router';

import type { AppRouter } from '@renderer/common/router';

type AppProps = {
  router: AppRouter;
};

function App({ router }: AppProps) {
  return <RouterProvider router={router} />;
}

export default App;
