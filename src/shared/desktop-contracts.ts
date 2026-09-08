import type {
  PrintableReceipt,
  ReceiptPaperWidthMm,
} from './printing/receipt-document';
import type { PrintableShiftReport } from './printing/shift-report-document';

export type AppUpdateState = Readonly<{
  status:
    | 'checking'
    | 'downloading'
    | 'download-failed'
    | 'restarting'
    | 'current'
    | 'unchecked'
    | 'outdated';
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number | null;
  downloadTransferred: number | null;
  downloadTotal: number | null;
  attempt: number;
  restartAt: number | null;
}>;

export type AppUpdatesBridge = {
  getState: () => Promise<AppUpdateState>;
  onStateChange: (callback: (state: AppUpdateState) => void) => () => void;
  retryDownload: () => Promise<void>;
  continueWithoutUpdate: () => Promise<void>;
};
export type PrintReply =
  | { ok: true }
  | {
      ok: false;
      code: 'NO_PRINTER' | 'PRINTER_NOT_FOUND' | 'PRINT_FAILED';
      message: string;
    };
type PrintOptions = {
  deviceName: string | null;
  paperWidthMm: ReceiptPaperWidthMm;
  rasterThreshold: 112 | 136 | 160 | 192 | 216;
};
export type ReceiptPrinterBridge = {
  getPrinters: () => Promise<
    Array<{ name: string; displayName: string; description: string }>
  >;
  print: (
    request: PrintOptions & { receipt: PrintableReceipt },
  ) => Promise<PrintReply>;
  printShiftReport: (
    request: PrintOptions & { report: PrintableShiftReport },
  ) => Promise<PrintReply>;
};
