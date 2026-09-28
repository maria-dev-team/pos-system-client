import { type BrowserWindow, ipcMain } from 'electron';

import { CameraApiClient } from './camera-api.client';
import { CameraDiscoveryWorker } from './camera-discovery-worker';
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
  const api = new CameraApiClient(apiUrl);
  const manager = new CameraManager(api);
  const discovery = new CameraDiscoveryWorker(api);
  ipcMain.on(CHANNEL, (event, context: unknown) => {
    if (event.sender !== mainWindow.webContents || !isContext(context)) return;
    manager.setContext(context);
    discovery.setContext(context);
  });
  mainWindow.on('closed', () => {
    discovery.stop();
    ipcMain.removeAllListeners(CHANNEL);
    void manager.shutdown();
  });
  return manager;
};
