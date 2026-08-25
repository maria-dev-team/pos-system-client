import { type BrowserWindow, ipcMain } from 'electron';

import { CameraApiClient } from './camera-api.client';
import { CameraManager } from './camera-manager';
import type { CameraAuthContext } from './camera.types';

const CHANNEL = 'camera:set-context';

const isContext = (value: unknown): value is CameraAuthContext | null => {
  if (value === null) return true;
  if (typeof value !== 'object' || !value) return false;
  const context = value as Record<string, unknown>;
  return (
    typeof context.accessToken === 'string' &&
    context.accessToken.length > 0 &&
    (context.registerId === null || typeof context.registerId === 'string')
  );
};

export const registerCameraIpc = (
  mainWindow: BrowserWindow,
  apiUrl: string,
): CameraManager => {
  const manager = new CameraManager(new CameraApiClient(apiUrl));
  ipcMain.on(CHANNEL, (event, context: unknown) => {
    if (event.sender !== mainWindow.webContents || !isContext(context)) return;
    manager.setContext(context);
  });
  mainWindow.on('closed', () => {
    ipcMain.removeAllListeners(CHANNEL);
    void manager.shutdown();
  });
  return manager;
};
