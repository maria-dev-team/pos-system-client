import { contextBridge, ipcRenderer } from 'electron';

import type { ReceiptPrinterBridge } from '../shared/desktop-contracts';
import type { AppUpdateState } from '../shared/desktop-contracts';
import type { DiagnosticsBridge } from '../shared/diagnostics';
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

// A send/on capability probe is safe even when an older main process has no
// diagnostics support. Never invoke an unregistered handler during renderer HMR.
let diagnosticsProbe: Promise<boolean> | undefined;
let diagnosticsProbeId = 0;
const diagnosticsReady = (): Promise<boolean> => {
  if (diagnosticsProbe) return diagnosticsProbe;
  const id = ++diagnosticsProbeId;
  diagnosticsProbe = new Promise<boolean>((resolve) => {
    const finish = (available: boolean): void => {
      clearTimeout(timer);
      ipcRenderer.removeListener('diagnostics:ready', listener);
      resolve(available);
    };
    const listener = (
      _event: Electron.IpcRendererEvent,
      replyId: unknown,
    ): void => {
      if (replyId === id) finish(true);
    };
    const timer = setTimeout(() => finish(false), 1000);
    ipcRenderer.on('diagnostics:ready', listener);
    ipcRenderer.send('diagnostics:connect', id);
  }).finally(() => {
    diagnosticsProbe = undefined;
  });
  return diagnosticsProbe;
};
const invokeDiagnostics = async (
  channel: string,
  payload: unknown,
): Promise<unknown> => {
  if (!(await diagnosticsReady())) {
    throw new Error(
      'Диагностика POS ещё не подключена. Перезапустите приложение POS.',
    );
  }
  return ipcRenderer.invoke(channel, payload);
};
const diagnostics: DiagnosticsBridge = {
  ready: diagnosticsReady,
  report: async (error, owner) => {
    await invokeDiagnostics('diagnostics:report', { error, owner });
  },
  context: async (owner, page) => {
    await invokeDiagnostics('diagnostics:context', { owner, page });
  },
  pending: async (owner) =>
    (await invokeDiagnostics('diagnostics:pending', owner)) as Awaited<
      ReturnType<DiagnosticsBridge['pending']>
    >,
  acknowledge: async (owner, ids) => {
    await invokeDiagnostics('diagnostics:ack', { owner, ids });
  },
  retry: async (filter) => {
    await invokeDiagnostics('diagnostics:retry', filter);
  },
};
contextBridge.exposeInMainWorld('diagnostics', diagnostics);
