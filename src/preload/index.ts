import { contextBridge, ipcRenderer } from 'electron';

import type { ReceiptPrinterBridge } from '../shared/desktop-contracts';
import type { AppUpdateState } from '../shared/desktop-contracts';
import type { LocalPosBridge } from '../shared/pos/contracts';
import type { PrintableReceipt } from '../shared/printing/receipt-document';
import type { PrintableShiftReport } from '../shared/printing/shift-report-document';

const localPos: LocalPosBridge = {
  request: (request) => ipcRenderer.invoke('pos:request', request),
  onChange: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on('pos:changed', listener);
    return () => ipcRenderer.removeListener('pos:changed', listener);
  },
};
contextBridge.exposeInMainWorld('localPos', localPos);

type CameraContext = {
  accessToken: string;
  registerId: string | null;
};

contextBridge.exposeInMainWorld('camera', {
  setContext: (context: CameraContext | null) => {
    ipcRenderer.send('camera:set-context', context);
  },
});

contextBridge.exposeInMainWorld('appUpdates', {
  continueWithoutUpdate: (): Promise<void> =>
    ipcRenderer.invoke('app-updater:continue'),
  getState: (): Promise<AppUpdateState> =>
    ipcRenderer.invoke('app-updater:get-state'),
  onStateChange: (callback: (state: AppUpdateState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: AppUpdateState,
    ): void => callback(state);
    ipcRenderer.on('app-updater:state-changed', listener);
    return (): void => {
      ipcRenderer.removeListener('app-updater:state-changed', listener);
    };
  },
  retryDownload: (): Promise<void> =>
    ipcRenderer.invoke('app-updater:retry-download'),
});

contextBridge.exposeInMainWorld('windowControls', {
  minimize: (): void => {
    ipcRenderer.send('window-controls:minimize');
  },
});

const receiptPrinter: ReceiptPrinterBridge = {
  getPrinters: () => ipcRenderer.invoke('receipt-printer:get-printers'),
  print: ({
    deviceName,
    paperWidthMm,
    rasterThreshold,
    receipt,
  }: {
    deviceName: string | null;
    paperWidthMm: 58 | 80;
    rasterThreshold: 112 | 136 | 160 | 192 | 216;
    receipt: PrintableReceipt;
  }) =>
    ipcRenderer.invoke('receipt-printer:print', {
      deviceName,
      paperWidthMm,
      rasterThreshold,
      receipt,
    }),
  printShiftReport: ({
    deviceName,
    paperWidthMm,
    rasterThreshold,
    report,
  }: {
    deviceName: string | null;
    paperWidthMm: 58 | 80;
    rasterThreshold: 112 | 136 | 160 | 192 | 216;
    report: PrintableShiftReport;
  }) =>
    ipcRenderer.invoke('receipt-printer:print-shift-report', {
      deviceName,
      paperWidthMm,
      rasterThreshold,
      report,
    }),
};
contextBridge.exposeInMainWorld('receiptPrinter', receiptPrinter);
