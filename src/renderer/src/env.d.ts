/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  localPos?: import('../../shared/pos/contracts').LocalPosBridge;
  windowControls?: {
    minimize: () => void;
  };
  appUpdates?: import('../../shared/desktop-contracts').AppUpdatesBridge;
  camera?: {
    setContext: (
      context: { accessToken: string; registerId: string | null } | null,
    ) => void;
  };
  receiptPrinter?: import('../../shared/desktop-contracts').ReceiptPrinterBridge;
}
