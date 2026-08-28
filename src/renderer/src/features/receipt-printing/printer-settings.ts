const STORAGE_KEY = 'maria.receipt-printer';

export type ReceiptPrinterSettings = {
  deviceName: string | null;
  printWidthDots: number;
};

export const defaultReceiptPrinterSettings: ReceiptPrinterSettings = {
  deviceName: null,
  printWidthDots: 384,
};

const isSettings = (value: unknown): value is ReceiptPrinterSettings => {
  if (typeof value !== 'object' || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (
    (settings.deviceName === null ||
      (typeof settings.deviceName === 'string' &&
        settings.deviceName.length > 0)) &&
    typeof settings.printWidthDots === 'number' &&
    Number.isInteger(settings.printWidthDots) &&
    settings.printWidthDots >= 128 &&
    settings.printWidthDots <= 832
  );
};

export const readReceiptPrinterSettings = (): ReceiptPrinterSettings => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultReceiptPrinterSettings;
    const parsed: unknown = JSON.parse(stored);
    return isSettings(parsed) ? parsed : defaultReceiptPrinterSettings;
  } catch {
    return defaultReceiptPrinterSettings;
  }
};

export const writeReceiptPrinterSettings = (
  settings: ReceiptPrinterSettings,
): boolean => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};
