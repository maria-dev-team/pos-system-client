export type AccessTokenProvider = {
  clearAccessToken: () => void;
  getAccessToken: () => string | null;
  setAccessToken: (accessToken: string) => void;
};

const emptyProvider: AccessTokenProvider = {
  clearAccessToken: () => undefined,
  getAccessToken: () => null,
  setAccessToken: () => undefined,
};

let accessTokenProvider = emptyProvider;

export const configureAccessTokenProvider = (
  provider: AccessTokenProvider,
): void => {
  accessTokenProvider = provider;
};

export const clearAccessToken = (): void =>
  accessTokenProvider.clearAccessToken();
export const getAccessToken = (): string | null =>
  accessTokenProvider.getAccessToken();
export const setAccessToken = (accessToken: string): void =>
  accessTokenProvider.setAccessToken(accessToken);
