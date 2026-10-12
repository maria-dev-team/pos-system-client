import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import { startAnalytics } from '@renderer/common/analytics';
import { configureAccessTokenProvider } from '@renderer/common/api';
import { TooltipProvider } from '@renderer/common/components/ui/tooltip';
import { createQueryClient } from '@renderer/common/lib/query-client';
import { createAppRouter } from '@renderer/common/router';
import { authTokenProvider, useAuthStore } from '@renderer/features/auth';

import App from './App';
import {
  refreshDiagnosticContext,
  reportPosError,
} from './common/analytics/error-reporting';
import './common/styles/base.css';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

configureAccessTokenProvider({
  ...authTokenProvider,
  resyncAuth: () => {
    queryClient.removeQueries();
    void router.invalidate();
  },
});

const stopAnalytics = startAnalytics(() => router.state.location.pathname);
const stopAuthDiagnostics = useAuthStore.subscribe(refreshDiagnosticContext);
const stopRouteDiagnostics = router.subscribe(
  'onResolved',
  refreshDiagnosticContext,
);

createRoot(document.getElementById('root')!, {
  onCaughtError: (error) => reportPosError(error, 'renderer', 'react'),
  onUncaughtError: (error) => reportPosError(error, 'renderer', 'react'),
  onRecoverableError: (error) => reportPosError(error, 'renderer', 'react'),
}).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <App router={router} />
          <Toaster position="top-center" richColors />
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopAnalytics();
    stopAuthDiagnostics();
    stopRouteDiagnostics();
  });
