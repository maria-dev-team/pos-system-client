import { contextBridge, ipcRenderer } from 'electron';

type CameraContext = {
  accessToken: string;
  registerId: string | null;
};

type PrintableReceipt = {
  cashier: string;
  completedAt: string;
  currency: 'KZT';
  items: Array<{
    lineNumber: number;
    lineTotal: string;
    name: string;
    quantity: string;
    unitLabel: string;
    unitPrice: string;
  }>;
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
  receiptNumber: string;
  store: { address: string | null; name: string };
  timeZone: string;
  total: string;
};

contextBridge.exposeInMainWorld('camera', {
  setContext: (context: CameraContext | null) => {
    ipcRenderer.send('camera:set-context', context);
  },
});

contextBridge.exposeInMainWorld('receiptPrinter', {
  getPrinters: () => ipcRenderer.invoke('receipt-printer:get-printers'),
  print: ({
    deviceName,
    printWidthDots,
    receipt,
  }: {
    deviceName: string | null;
    printWidthDots: number;
    receipt: PrintableReceipt;
  }) =>
    ipcRenderer.invoke('receipt-printer:print', {
      deviceName,
      printWidthDots,
      receipt,
    }),
});
