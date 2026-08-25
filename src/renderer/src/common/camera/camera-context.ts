let selectedRegisterId: string | null = null;

export const syncCameraContext = (
  accessToken: string | null,
  registerId?: string | null,
): void => {
  if (registerId !== undefined) selectedRegisterId = registerId;
  if (!accessToken) selectedRegisterId = null;
  window.camera?.setContext(
    accessToken ? { accessToken, registerId: selectedRegisterId } : null,
  );
};
