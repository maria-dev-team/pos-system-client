import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { BrowserWindow, app, net, protocol } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';

import icon from '../../resources/icon.png?asset';
import { registerCameraIpc } from './camera';
import { resolveRendererFilePath } from './renderer-protocol';

const apiUrl = (
  import.meta.env.MAIN_VITE_API_URL ?? 'http://localhost:4004'
).replace(/\/+$/g, '');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'maria',
    privileges: {
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

function registerRendererProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer');

  protocol.handle('maria', (request) => {
    const filePath = resolveRendererFilePath(rendererRoot, request.url);
    if (!filePath) return new Response('Not found', { status: 404 });

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    kiosk: !is.dev,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  registerCameraIpc(mainWindow, apiUrl);

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  if (!is.dev) {
    mainWindow.webContents.on('will-navigate', (event) =>
      event.preventDefault(),
    );
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadURL('maria://app/');
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('kz.maria.pos');

  registerRendererProtocol();

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
