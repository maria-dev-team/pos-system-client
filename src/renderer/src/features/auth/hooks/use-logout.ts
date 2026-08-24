import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { httpErrorHandler } from '@renderer/common/helpers/http-error.helper';

import { useAuthStore } from '../stores/auth-store';

type LogoutFlow = {
  isLoggingOut: boolean;
  logout: () => Promise<void>;
};

export const useLogout = (): LogoutFlow => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useAuthStore((state) => state.logout);
  const isLoggingOut = useAuthStore((state) => state.isLoggingOut);

  return {
    isLoggingOut,
    logout: async (): Promise<void> => {
      try {
        await logout();
        queryClient.clear();
        await navigate({ replace: true, to: '/login' });
      } catch (error) {
        httpErrorHandler(error, 'Не удалось выйти из системы.');
      }
    },
  };
};
