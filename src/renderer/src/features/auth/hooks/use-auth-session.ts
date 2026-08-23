import { useAuthStore } from '../stores/auth-store';

export const useAuthSession = () => {
  const accessToken = useAuthStore((state) => state.accessToken);
  const clearAccessToken = useAuthStore((state) => state.clearAccessToken);
  const initialize = useAuthStore((state) => state.initialize);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isLoggingOut = useAuthStore((state) => state.isLoggingOut);
  const logout = useAuthStore((state) => state.logout);
  const setAccessToken = useAuthStore((state) => state.setAccessToken);

  return {
    accessToken,
    clearAccessToken,
    initialize,
    isAuthenticated: Boolean(accessToken),
    isInitialized,
    isLoggingOut,
    logout,
    setAccessToken,
  };
};
