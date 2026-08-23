import { create } from 'zustand';

import {
  type AccessTokenProvider,
  logout as logoutRequest,
  refreshTokens,
} from '@renderer/common/api';

import {
  readStoredAccessToken,
  removeStoredAccessToken,
  storeAccessToken,
} from './access-token.storage';

type AuthState = {
  accessToken: string | null;
  clearAccessToken: () => void;
  initialize: () => Promise<void>;
  isInitialized: boolean;
  isInitializing: boolean;
  isLoggingOut: boolean;
  logout: () => Promise<void>;
  setAccessToken: (accessToken: string) => void;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  accessToken: readStoredAccessToken(),
  clearAccessToken: () => {
    removeStoredAccessToken();
    set({ accessToken: null });
  },
  initialize: async () => {
    if (get().isInitialized || get().isInitializing) return;
    if (get().accessToken) {
      set({ isInitialized: true });
      return;
    }

    set({ isInitializing: true });
    try {
      const auth = await refreshTokens();
      storeAccessToken(auth.access_token);
      set({ accessToken: auth.access_token });
    } catch {
      removeStoredAccessToken();
      set({ accessToken: null });
    } finally {
      set({ isInitialized: true, isInitializing: false });
    }
  },
  isInitialized: false,
  isInitializing: false,
  isLoggingOut: false,
  logout: async () => {
    set({ isLoggingOut: true });
    try {
      await logoutRequest();
      removeStoredAccessToken();
      set({ accessToken: null });
    } finally {
      set({ isLoggingOut: false });
    }
  },
  setAccessToken: (accessToken) => {
    storeAccessToken(accessToken);
    set({ accessToken });
  },
}));

export const authTokenProvider: AccessTokenProvider = {
  clearAccessToken: () => useAuthStore.getState().clearAccessToken(),
  getAccessToken: () => useAuthStore.getState().accessToken,
  setAccessToken: (accessToken) =>
    useAuthStore.getState().setAccessToken(accessToken),
};
