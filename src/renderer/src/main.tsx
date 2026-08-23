import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import { configureAccessTokenProvider } from '@renderer/common/api';
import { TooltipProvider } from '@renderer/common/components/ui/tooltip';
import { createQueryClient } from '@renderer/common/lib/query-client';
import { createAppRouter } from '@renderer/common/router';
import { authTokenProvider } from '@renderer/features/auth';

import App from './App';
import './common/styles/base.css';

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

configureAccessTokenProvider(authTokenProvider);

createRoot(document.getElementById('root')!).render(
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
