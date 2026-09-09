export const syncCameraContext = (
  accessToken: string | null,
  registerId: string | null = null,
): void => {
  window.camera?.setContext(accessToken ? { accessToken, registerId } : null);
};
