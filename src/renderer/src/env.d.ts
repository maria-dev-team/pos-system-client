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
      receipt: {
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
