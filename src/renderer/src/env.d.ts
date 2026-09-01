/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  camera?: {
    setContext: (
      context: { accessToken: string; registerId: string | null } | null,
    ) => void;
  };
  receiptPrinter?: {
    getPrinters: () => Promise<
      Array<{ description: string; displayName: string; name: string }>
    >;
    print: (request: {
      deviceName: string | null;
      paperWidthMm: 58 | 80;
      rasterThreshold: 112 | 136 | 160 | 192 | 216;
      receipt: {
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
    }) => Promise<
      | { ok: true }
      | {
          code: 'NO_PRINTER' | 'PRINTER_NOT_FOUND' | 'PRINT_FAILED';
          message: string;
          ok: false;
        }
    >;
    printShiftReport: (request: {
      deviceName: string | null;
      paperWidthMm: 58 | 80;
      rasterThreshold: 112 | 136 | 160 | 192 | 216;
      report: import('../../main/receipt-printer/shift-report-document').PrintableShiftReport;
    }) => Promise<
      | { ok: true }
      | {
          code: 'NO_PRINTER' | 'PRINTER_NOT_FOUND' | 'PRINT_FAILED';
          message: string;
          ok: false;
        }
    >;
  };
}
