import { type BrowserWindow, type IpcMainEvent, ipcMain } from 'electron';

const MINIMIZE_CHANNEL = 'window-controls:minimize';

export const registerWindowControlsIpc = (mainWindow: BrowserWindow): void => {
  const minimizeWindow = (event: IpcMainEvent): void => {
    if (event.sender !== mainWindow.webContents) return;
    mainWindow.minimize();
  };

  ipcMain.on(MINIMIZE_CHANNEL, minimizeWindow);
  mainWindow.on('closed', () => {
    ipcMain.removeListener(MINIMIZE_CHANNEL, minimizeWindow);
  });
};
