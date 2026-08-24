const ACCESS_TOKEN_STORAGE_KEY = 'maria.access-token';
const EXPIRATION_LEEWAY_MS = 5_000;

const getSessionStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const getTokenExpiration = (accessToken: string): number | null => {
  try {
    const encodedPayload = accessToken.split('.')[1];
    if (!encodedPayload) return null;

    const normalizedPayload = encodedPayload
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const paddingLength = (4 - (normalizedPayload.length % 4)) % 4;
    const payload = JSON.parse(
      atob(
        normalizedPayload.padEnd(normalizedPayload.length + paddingLength, '='),
      ),
    ) as {
      exp?: unknown;
    };

    return typeof payload.exp === 'number' ? payload.exp * 1_000 : null;
  } catch {
    return null;
  }
};

export const readStoredAccessToken = (): string | null => {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    const accessToken = storage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (!accessToken) return null;

    const expiration = getTokenExpiration(accessToken);
    if (!expiration || expiration <= Date.now() + EXPIRATION_LEEWAY_MS) {
      storage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      return null;
    }

    return accessToken;
  } catch {
    return null;
  }
};

export const storeAccessToken = (accessToken: string): void => {
  try {
    getSessionStorage()?.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  } catch {
    // Authentication continues in memory when storage is unavailable.
  }
};

export const removeStoredAccessToken = (): void => {
  try {
    getSessionStorage()?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // The in-memory token is still cleared by the auth store.
  }
};
