import { contextBridge, ipcRenderer } from 'electron';

import type { AppUpdateState } from '../main/app-updater';

type CameraContext = {
  accessToken: string;
  registerId: string | null;
};

type PrintableReceipt = {
  cashier: string;
  completedAt: string;
  currency: 'KZT';
  discountAmount: string;
  discountPercentage: string | null;
  fiscal: {
    address: string;
    buyerBinIin: string | null;
    cashboxUniqueNumber: string;
    fiscalSign: string;
    offline: boolean;
    ofdName: string;
    ofdWebsite: string;
    qrUrl: string;
    receiptNumber: string;
    registrationNumber: string;
    shiftNumber: string;
    vatTotal: string;
  };
  isTest: boolean;
  items: Array<{
    discountAmount: string;
    lineNumber: number;
    lineSubtotal: string;
    lineTotal: string;
    markingCode: string | null;
    name: string;
    ntinCode: string | null;
    quantity: string;
    unitLabel: string;
    unitPrice: string;
    vatAmount: string;
    vatRate: 'NONE' | '0' | '5' | '10' | '16';
  }>;
  localReceiptNumber: string;
  operationType: 'SALE' | 'RETURN';
  organization: {
    binIin: string | null;
    displayName: string;
    legalName: string | null;
  };
  payments: Array<{
    amount: string;
    change: string | null;
    method: 'CASH' | 'CASHLESS';
    received: string | null;
  }>;
  store: { address: string | null; name: string };
  subtotal: string;
  timeZone: string;
  total: string;
};

type PrintableShiftReport =
  import('../main/receipt-printer/shift-report-document').PrintableShiftReport;

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

contextBridge.exposeInMainWorld('receiptPrinter', {
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
});
